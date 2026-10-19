CREATE SCHEMA IF NOT EXISTS scheduler;

-- Needed for the exclusion constraint below (uuid = and range && in one index).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE scheduler.contacts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 email TEXT NOT NULL UNIQUE CHECK (email = lower(email)),
 name TEXT NOT NULL, company TEXT NOT NULL, role TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduler.event_types (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    slug                 TEXT NOT NULL UNIQUE,
    title                TEXT NOT NULL,
    description          TEXT,
    duration_min         INTEGER NOT NULL CHECK (duration_min BETWEEN 5 AND 480),
    slot_step_min        INTEGER NOT NULL DEFAULT 30 CHECK (slot_step_min BETWEEN 5 AND 240),
    buffer_before_min    INTEGER NOT NULL DEFAULT 0 CHECK (buffer_before_min >= 0),
    buffer_after_min     INTEGER NOT NULL DEFAULT 0 CHECK (buffer_after_min >= 0),
    min_notice_hours     INTEGER NOT NULL DEFAULT 12 CHECK (min_notice_hours >= 0),
    max_days_ahead       INTEGER NOT NULL DEFAULT 30 CHECK (max_days_ahead BETWEEN 1 AND 90),
    -- Per weekday, in host_tz: {"mon": [["09:00","12:00"], ["13:00","17:00"]], ...}
    hours                JSONB NOT NULL,
    host_tz              TEXT NOT NULL DEFAULT 'Europe/Amsterdam',
    -- [{"key":"bets","label":"Your top 3 bets for 2027","type":"textarea","required":true}]
    questions            JSONB NOT NULL DEFAULT '[]'::jsonb,
    require_work_email   BOOLEAN NOT NULL DEFAULT TRUE,
    conference_provider  TEXT NOT NULL DEFAULT 'google_meet'
                         CHECK (conference_provider IN ('google_meet', 'zoom')),
    active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS scheduler.bookings (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type_id        UUID NOT NULL REFERENCES scheduler.event_types(id),
    contact_id           UUID NOT NULL REFERENCES scheduler.contacts(id) ON DELETE CASCADE,
    starts_at            TIMESTAMPTZ NOT NULL,
    ends_at              TIMESTAMPTZ NOT NULL,
    attendee_name        TEXT NOT NULL,
    attendee_email       TEXT NOT NULL,
    company              TEXT NOT NULL,
    attendee_tz          TEXT,
    -- pending: row reserved, calendar event not yet created. Holds the slot.
    status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'confirmed', 'cancelled', 'rescheduled')),
    answers              JSONB NOT NULL DEFAULT '{}'::jsonb,
    utm                  JSONB NOT NULL DEFAULT '{}'::jsonb,
    source_page          TEXT,
    conference_provider  TEXT NOT NULL CHECK (conference_provider IN ('google_meet', 'zoom')),
    conference_id        TEXT,
    join_url             TEXT,
    google_event_id      TEXT,
    -- sha256 of the manage token. The token itself only ever exists in the
    -- calendar invite, so a database leak can't be turned into cancel links.
    manage_token_hash    TEXT NOT NULL UNIQUE,
    ip_hash              TEXT,
    rescheduled_from     UUID REFERENCES scheduler.bookings(id),
    cancelled_at         TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT bookings_time_order CHECK (ends_at > starts_at),
    -- Two live bookings can never overlap, however close together they arrive.
    CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
        tstzrange(starts_at, ends_at) WITH &&
    ) WHERE (status IN ('pending', 'confirmed'))
);

CREATE INDEX IF NOT EXISTS idx_sched_bookings_live
    ON scheduler.bookings (starts_at) WHERE status IN ('pending', 'confirmed');
CREATE INDEX IF NOT EXISTS idx_sched_bookings_email
    ON scheduler.bookings (lower(attendee_email), created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sched_bookings_ip
    ON scheduler.bookings (ip_hash, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sched_bookings_user
    ON scheduler.bookings (contact_id);


ALTER TABLE scheduler.event_types
  ADD COLUMN IF NOT EXISTS max_bookings_per_day INTEGER
    CHECK (max_bookings_per_day IS NULL OR max_bookings_per_day BETWEEN 1 AND 100);

CREATE TABLE IF NOT EXISTS scheduler.availability_overrides (
  event_type_id UUID NOT NULL REFERENCES scheduler.event_types(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  hours JSONB NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (event_type_id, local_date)
);


ALTER TABLE scheduler.bookings
  ADD COLUMN IF NOT EXISTS buffer_before_min INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS buffer_after_min INTEGER NOT NULL DEFAULT 0;

UPDATE scheduler.bookings b
SET buffer_before_min = e.buffer_before_min,
    buffer_after_min = e.buffer_after_min
FROM scheduler.event_types e
WHERE b.event_type_id = e.id;


CREATE TABLE IF NOT EXISTS scheduler.integration_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES scheduler.bookings(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN ('booking.created', 'booking.rescheduled', 'booking.cancelled')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_scheduler_integration_due
  ON scheduler.integration_events (next_attempt_at)
  WHERE delivered_at IS NULL;


CREATE TABLE IF NOT EXISTS scheduler.calendar_connections (
  id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

