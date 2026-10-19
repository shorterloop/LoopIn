import type {PoolClient} from 'pg'
import {pool, withDbRetry} from '../db'
import type {EventTypeAdminUpdate} from './admin'
import type {Booking, BookingStatus, DateOverrides, EventType, Interval} from './types'

/**
 * Data access for the `scheduler` schema. Raw SQL rather than Drizzle because
 * the interesting parts — the tstzrange exclusion constraint and partial
 * indexes — live in the database, not in a TS schema.
 */

/** Postgres exclusion_violation: the slot was taken by a concurrent booking. */
export const SLOT_TAKEN = '23P01'

export function isSlotTaken(err: unknown): boolean {
  return [SLOT_TAKEN, 'SL_DAILY_LIMIT', 'SL_BUFFER_CONFLICT'].includes((err as {code?: string})?.code ?? '')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toEventType(r: any): EventType {
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: r.description,
    durationMin: r.duration_min,
    slotStepMin: r.slot_step_min,
    bufferBeforeMin: r.buffer_before_min,
    bufferAfterMin: r.buffer_after_min,
    minNoticeHours: r.min_notice_hours,
    maxDaysAhead: r.max_days_ahead,
    maxBookingsPerDay: r.max_bookings_per_day,
    hours: r.hours ?? {},
    hostTz: r.host_tz,
    questions: Array.isArray(r.questions) ? r.questions : [],
    requireWorkEmail: r.require_work_email,
    conferenceProvider: r.conference_provider,
    active: r.active,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toBooking(r: any): Booking {
  return {
    id: r.id,
    eventTypeId: r.event_type_id,
    contactId: r.contact_id,
    startsAt: new Date(r.starts_at),
    endsAt: new Date(r.ends_at),
    attendeeName: r.attendee_name,
    attendeeEmail: r.attendee_email,
    company: r.company,
    attendeeTz: r.attendee_tz,
    status: r.status,
    answers: r.answers ?? {},
    utm: r.utm ?? {},
    sourcePage: r.source_page,
    conferenceProvider: r.conference_provider,
    conferenceId: r.conference_id,
    joinUrl: r.join_url,
    googleEventId: r.google_event_id,
    rescheduledFrom: r.rescheduled_from,
    createdAt: new Date(r.created_at),
  }
}

export async function getEventTypeBySlug(slug: string): Promise<EventType | null> {
  return withDbRetry(async () => {
    const {rows} = await pool.query('SELECT * FROM scheduler.event_types WHERE slug = $1 AND active', [slug])
    return rows[0] ? toEventType(rows[0]) : null
  })
}

export async function getEventTypeById(id: string): Promise<EventType | null> {
  return withDbRetry(async () => {
    const {rows} = await pool.query('SELECT * FROM scheduler.event_types WHERE id = $1', [id])
    return rows[0] ? toEventType(rows[0]) : null
  })
}

export async function listEventTypesForAdmin(): Promise<EventType[]> {
  return withDbRetry(async () => {
    const {rows} = await pool.query('SELECT * FROM scheduler.event_types ORDER BY slug')
    return rows.map(toEventType)
  })
}

export async function createEventTypeForAdmin(input: EventTypeAdminUpdate & {slug: string}): Promise<EventType> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `INSERT INTO scheduler.event_types
        (slug, title, description, duration_min, slot_step_min, buffer_before_min, buffer_after_min,
         min_notice_hours, max_days_ahead, max_bookings_per_day, hours, host_tz, questions, require_work_email, conference_provider, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING *`,
      [
        input.slug, input.title, input.description, input.durationMin, input.slotStepMin,
        input.bufferBeforeMin, input.bufferAfterMin, input.minNoticeHours, input.maxDaysAhead,
        input.maxBookingsPerDay, JSON.stringify(input.hours), input.hostTz, JSON.stringify(input.questions),
        input.requireWorkEmail, input.conferenceProvider, input.active,
      ],
    )
    return toEventType(rows[0])
  })
}

export async function updateEventTypeForAdmin(id: string, update: EventTypeAdminUpdate): Promise<EventType | null> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `UPDATE scheduler.event_types
          SET title = $2,
              description = $3,
              duration_min = $4,
              slot_step_min = $5,
              buffer_before_min = $6,
              buffer_after_min = $7,
              min_notice_hours = $8,
              max_days_ahead = $9,
              max_bookings_per_day = $10,
              hours = $11,
              host_tz = $12,
              questions = $13,
              require_work_email = $14,
              conference_provider = $15,
              active = $16,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        id,
        update.title,
        update.description,
        update.durationMin,
        update.slotStepMin,
        update.bufferBeforeMin,
        update.bufferAfterMin,
        update.minNoticeHours,
        update.maxDaysAhead,
        update.maxBookingsPerDay,
        JSON.stringify(update.hours),
        update.hostTz,
        JSON.stringify(update.questions),
        update.requireWorkEmail,
        update.conferenceProvider,
        update.active,
      ],
    )
    return rows[0] ? toEventType(rows[0]) : null
  })
}

export async function availabilityFor(eventTypeId: string, from: Date, to: Date, hostTz: string, excludeBookingId?: string) {
  return withDbRetry(async () => {
    const [overrideResult, countResult] = await Promise.all([
      pool.query(
        `SELECT local_date::text AS day, hours FROM scheduler.availability_overrides
          WHERE event_type_id = $1 AND local_date BETWEEN $2::date AND $3::date`,
        [eventTypeId, new Date(from.getTime() - 86_400_000).toISOString().slice(0, 10), new Date(to.getTime() + 86_400_000).toISOString().slice(0, 10)],
      ),
      pool.query(
        `SELECT (starts_at AT TIME ZONE $2)::date::text AS day, count(*)::int AS n
           FROM scheduler.bookings
          WHERE event_type_id = $1 AND status IN ('pending', 'confirmed')
            AND starts_at >= $3 AND starts_at < $4
            AND ($5::uuid IS NULL OR id <> $5::uuid)
          GROUP BY day`,
        [eventTypeId, hostTz, new Date(from.getTime() - 86_400_000), new Date(to.getTime() + 86_400_000), excludeBookingId ?? null],
      ),
    ])
    return {
      overrides: Object.fromEntries(overrideResult.rows.map((r) => [r.day, r.hours])) as DateOverrides,
      bookingsByDay: Object.fromEntries(countResult.rows.map((r) => [r.day, r.n])) as Record<string, number>,
    }
  })
}

export async function listAvailabilityOverrides(eventTypeId: string): Promise<Array<{date: string; hours: Array<[string, string]>}>> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `SELECT local_date::text AS date, hours FROM scheduler.availability_overrides
        WHERE event_type_id = $1 AND local_date >= CURRENT_DATE ORDER BY local_date LIMIT 120`,
      [eventTypeId],
    )
    return rows
  })
}

export async function setAvailabilityOverride(eventTypeId: string, date: string, hours: Array<[string, string]>): Promise<void> {
  await withDbRetry(() => pool.query(
    `INSERT INTO scheduler.availability_overrides (event_type_id, local_date, hours)
     VALUES ($1, $2::date, $3::jsonb)
     ON CONFLICT (event_type_id, local_date) DO UPDATE SET hours = EXCLUDED.hours`,
    [eventTypeId, date, JSON.stringify(hours)],
  ))
}

export async function deleteAvailabilityOverride(eventTypeId: string, date: string): Promise<void> {
  await withDbRetry(() => pool.query(
    'DELETE FROM scheduler.availability_overrides WHERE event_type_id = $1 AND local_date = $2::date',
    [eventTypeId, date],
  ))
}

/** Live (pending or confirmed) bookings overlapping [from, to). */
export async function liveBookingIntervals(from: number, to: number, excludeId?: string): Promise<Interval[]> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `SELECT starts_at - make_interval(mins => buffer_before_min) AS starts_at,
              ends_at + make_interval(mins => buffer_after_min) AS ends_at
         FROM scheduler.bookings
        WHERE status IN ('pending', 'confirmed')
          AND starts_at < $2 AND ends_at > $1
          AND ($3::uuid IS NULL OR id <> $3::uuid)`,
      [new Date(from), new Date(to), excludeId ?? null],
    )
    return rows.map((r) => ({start: new Date(r.starts_at).getTime(), end: new Date(r.ends_at).getTime()}))
  })
}

export async function countRecentByIp(ipHash: string, sinceMs: number): Promise<number> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      'SELECT count(*)::int AS n FROM scheduler.bookings WHERE ip_hash = $1 AND created_at > $2',
      [ipHash, new Date(sinceMs)],
    )
    return rows[0].n
  })
}

export async function countRecentByEmail(email: string, sinceMs: number): Promise<number> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      'SELECT count(*)::int AS n FROM scheduler.bookings WHERE lower(attendee_email) = lower($1) AND created_at > $2',
      [email, new Date(sinceMs)],
    )
    return rows[0].n
  })
}

export interface NewBooking {
  eventTypeId: string
  contactId: string
  startsAt: Date
  endsAt: Date
  attendeeName: string
  attendeeEmail: string
  company: string
  attendeeTz: string | null
  answers: Record<string, string>
  utm: Record<string, string>
  sourcePage: string | null
  conferenceProvider: string
  manageTokenHash: string
  ipHash: string | null
  hostTz: string
  maxBookingsPerDay: number | null
  bufferBeforeMin: number
  bufferAfterMin: number
  rescheduledFrom?: string | null
  /** Carried over on reschedule: the same calendar event and meeting move. */
  googleEventId?: string | null
  conferenceId?: string | null
  joinUrl?: string | null
}

async function assertDailyCapacity(client: PoolClient, b: NewBooking): Promise<void> {
  if (b.maxBookingsPerDay == null) return
  const dayResult = await client.query<{day: string}>(
    'SELECT ($1::timestamptz AT TIME ZONE $2)::date::text AS day',
    [b.startsAt, b.hostTz],
  )
  const day = dayResult.rows[0].day
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [b.eventTypeId, day])
  const count = await client.query<{n: number}>(
    `SELECT count(*)::int AS n FROM scheduler.bookings
      WHERE event_type_id = $1 AND status IN ('pending', 'confirmed')
        AND (starts_at AT TIME ZONE $2)::date = $3::date`,
    [b.eventTypeId, b.hostTz, day],
  )
  if (count.rows[0].n >= b.maxBookingsPerDay) {
    throw Object.assign(new Error('Daily booking limit reached'), {code: 'SL_DAILY_LIMIT'})
  }
}

async function assertReservationSpace(client: PoolClient, b: NewBooking): Promise<void> {
  // One calendar host: serialize reservations before checking buffered ranges.
  await client.query("SELECT pg_advisory_xact_lock(hashtext('scheduler-reservation'))")
  const {rowCount} = await client.query(
    `SELECT 1 FROM scheduler.bookings
      WHERE status IN ('pending', 'confirmed')
        AND starts_at - make_interval(mins => buffer_before_min) < $2
        AND ends_at + make_interval(mins => buffer_after_min) > $1
      LIMIT 1`,
    [new Date(b.startsAt.getTime() - b.bufferBeforeMin * 60_000), new Date(b.endsAt.getTime() + b.bufferAfterMin * 60_000)],
  )
  if (rowCount) throw Object.assign(new Error('Buffered slot is occupied'), {code: 'SL_BUFFER_CONFLICT'})
}

async function insertPending(client: PoolClient | typeof pool, b: NewBooking): Promise<Booking> {
  const {rows} = await client.query(
    `INSERT INTO scheduler.bookings
       (event_type_id, contact_id, starts_at, ends_at, attendee_name, attendee_email, company, attendee_tz,
        status, answers, utm, source_page, conference_provider, manage_token_hash, ip_hash,
        rescheduled_from, google_event_id, conference_id, join_url, buffer_before_min, buffer_after_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
     RETURNING *`,
    [
      b.eventTypeId,
      b.contactId,
      b.startsAt,
      b.endsAt,
      b.attendeeName,
      b.attendeeEmail,
      b.company,
      b.attendeeTz,
      JSON.stringify(b.answers),
      JSON.stringify(b.utm),
      b.sourcePage,
      b.conferenceProvider,
      b.manageTokenHash,
      b.ipHash,
      b.rescheduledFrom ?? null,
      b.googleEventId ?? null,
      b.conferenceId ?? null,
      b.joinUrl ?? null,
      b.bufferBeforeMin,
      b.bufferAfterMin,
    ],
  )
  return toBooking(rows[0])
}

/**
 * Reserve the slot. Throws a 23P01 (see isSlotTaken) if a live booking
 * already overlaps it — the database is the final word on double booking.
 */
export async function insertPendingBooking(b: NewBooking): Promise<Booking> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await assertReservationSpace(client, b)
    await assertDailyCapacity(client, b)
    const booking = await insertPending(client, b)
    await client.query('COMMIT')
    return booking
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/**
 * Atomically retire `oldId` (status → rescheduled) and reserve the new slot.
 * Retiring first frees the old range, so moving a meeting by 15 minutes into
 * its own time does not collide with itself.
 */
export async function insertRescheduledBooking(oldId: string, b: NewBooking): Promise<Booking> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtext('scheduler-reservation'))")
    const {rowCount} = await client.query(
      `UPDATE scheduler.bookings SET status = 'rescheduled' WHERE id = $1 AND status = 'confirmed'`,
      [oldId],
    )
    if (rowCount !== 1) throw new Error('Booking is no longer confirmed')
    await assertReservationSpace(client, b)
    await assertDailyCapacity(client, b)
    const booking = await insertPending(client, {...b, rescheduledFrom: oldId})
    await client.query('COMMIT')
    return booking
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

/** Undo insertRescheduledBooking when the calendar update fails. */
export async function revertReschedule(oldId: string, newId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM scheduler.bookings WHERE id = $1', [newId])
    await client.query(`UPDATE scheduler.bookings SET status = 'confirmed' WHERE id = $1`, [oldId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

export async function confirmBooking(
  id: string,
  fields: {googleEventId: string; conferenceId: string | null; joinUrl: string | null},
  kind: 'booking.created' | 'booking.rescheduled',
): Promise<Booking> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const {rows} = await client.query(
      `UPDATE scheduler.bookings
          SET status = 'confirmed', google_event_id = $2, conference_id = $3, join_url = $4
        WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, fields.googleEventId, fields.conferenceId, fields.joinUrl],
    )
    if (!rows[0]) throw new Error('Booking is no longer pending')
    const booking = toBooking(rows[0])
    await appendIntegrationEvent(client, booking, kind)
    await client.query('COMMIT')
    return booking
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

export async function attachPendingCalendarEvent(id: string, googleEventId: string, conferenceId: string | null, joinUrl: string | null): Promise<void> {
  await withDbRetry(() => pool.query(
    `UPDATE scheduler.bookings SET google_event_id = $2, conference_id = $3, join_url = $4
      WHERE id = $1 AND status = 'pending'`,
    [id, googleEventId, conferenceId, joinUrl],
  ))
}

export async function attachPendingConference(id: string, conferenceId: string, joinUrl: string | null): Promise<void> {
  await withDbRetry(() => pool.query(
    `UPDATE scheduler.bookings SET conference_id = $2, join_url = $3
      WHERE id = $1 AND status = 'pending'`,
    [id, conferenceId, joinUrl],
  ))
}

export async function deleteBooking(id: string): Promise<void> {
  await withDbRetry(() => pool.query('DELETE FROM scheduler.bookings WHERE id = $1', [id]))
}

export async function setStatus(id: string, status: BookingStatus): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const {rows} = await client.query(
      `UPDATE scheduler.bookings
          SET status = $2, cancelled_at = CASE WHEN $2 = 'cancelled' THEN NOW() ELSE cancelled_at END
        WHERE id = $1 AND status = 'confirmed' RETURNING *`,
      [id, status],
    )
    if (rows[0] && status === 'cancelled') await appendIntegrationEvent(client, toBooking(rows[0]), 'booking.cancelled')
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

async function appendIntegrationEvent(client: PoolClient, booking: Booking, kind: string): Promise<void> {
  const payload = {
    bookingId: booking.id,
    eventTypeId: booking.eventTypeId,
    contactId: booking.contactId,
    startsAt: booking.startsAt.toISOString(),
    endsAt: booking.endsAt.toISOString(),
    status: booking.status,
    attendee: {name: booking.attendeeName, email: booking.attendeeEmail, company: booking.company},
    answers: booking.answers,
    utm: booking.utm,
    sourcePage: booking.sourcePage,
    joinUrl: booking.joinUrl,
    rescheduledFrom: booking.rescheduledFrom,
  }
  await client.query(
    'INSERT INTO scheduler.integration_events (booking_id, event_type, payload) VALUES ($1, $2, $3::jsonb)',
    [booking.id, kind, JSON.stringify(payload)],
  )
}

export interface IntegrationEvent {
  id: string
  bookingId: string
  eventType: string
  payload: Record<string, unknown>
  createdAt: Date
  attempts: number
}

export async function claimIntegrationEvents(limit = 25): Promise<IntegrationEvent[]> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `UPDATE scheduler.integration_events SET attempts = attempts + 1,
              next_attempt_at = NOW() + INTERVAL '10 minutes'
        WHERE id IN (
          SELECT id FROM scheduler.integration_events
           WHERE delivered_at IS NULL AND next_attempt_at <= NOW()
           ORDER BY created_at LIMIT $1 FOR UPDATE SKIP LOCKED
        )
        RETURNING id, booking_id, event_type, payload, created_at, attempts`,
      [limit],
    )
    return rows.map((r) => ({
      id: r.id, bookingId: r.booking_id, eventType: r.event_type,
      payload: r.payload, createdAt: new Date(r.created_at), attempts: r.attempts,
    }))
  })
}

export async function markIntegrationDelivered(id: string): Promise<void> {
  await withDbRetry(() => pool.query(
    'UPDATE scheduler.integration_events SET delivered_at = NOW(), last_error = NULL WHERE id = $1', [id],
  ))
}

export async function markIntegrationFailed(id: string, attempts: number, error: string): Promise<void> {
  const delayMinutes = Math.min(2 ** Math.min(attempts, 8), 360)
  await withDbRetry(() => pool.query(
    `UPDATE scheduler.integration_events
        SET next_attempt_at = NOW() + ($2::int * INTERVAL '1 minute'), last_error = $3
      WHERE id = $1`, [id, delayMinutes, error.slice(0, 1000)],
  ))
}

export async function retryFailedIntegrationEvents(): Promise<void> {
  await withDbRetry(() => pool.query(
    `UPDATE scheduler.integration_events SET next_attempt_at = NOW()
      WHERE delivered_at IS NULL AND last_error IS NOT NULL`,
  ))
}

export async function getBookingByTokenHash(hash: string): Promise<Booking | null> {
  return withDbRetry(async () => {
    const {rows} = await pool.query('SELECT * FROM scheduler.bookings WHERE manage_token_hash = $1', [hash])
    return rows[0] ? toBooking(rows[0]) : null
  })
}

export async function getBookingById(id: string): Promise<Booking | null> {
  return withDbRetry(async () => {
    const {rows} = await pool.query('SELECT * FROM scheduler.bookings WHERE id = $1', [id])
    return rows[0] ? toBooking(rows[0]) : null
  })
}

export async function listBookingsForAdmin(): Promise<Array<{
  id: string; eventTitle: string; attendeeName: string; attendeeEmail: string; company: string;
  startsAt: string; endsAt: string; status: BookingStatus; answers: Record<string, string>;
  utm: Record<string, string>; sourcePage: string | null; joinUrl: string | null;
  delivery: 'not_configured' | 'pending' | 'failed' | 'delivered';
}>> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `SELECT b.id, e.title AS event_title, b.attendee_name, b.attendee_email, b.company,
              b.starts_at, b.ends_at, b.status, b.answers, b.utm, b.source_page, b.join_url,
              CASE WHEN i.delivered_at IS NOT NULL THEN 'delivered'
                   WHEN i.last_error IS NOT NULL THEN 'failed'
                   WHEN i.id IS NOT NULL THEN 'pending' ELSE 'not_configured' END AS delivery
         FROM scheduler.bookings b
         JOIN scheduler.event_types e ON e.id = b.event_type_id
         LEFT JOIN LATERAL (
           SELECT id, delivered_at, last_error FROM scheduler.integration_events
            WHERE booking_id = b.id ORDER BY created_at DESC LIMIT 1
         ) i ON TRUE
        WHERE b.starts_at >= NOW() - INTERVAL '30 days'
        ORDER BY b.starts_at ASC LIMIT 200`,
    )
    return rows.map((r) => ({
      id: r.id, eventTitle: r.event_title, attendeeName: r.attendee_name,
      attendeeEmail: r.attendee_email, company: r.company,
      startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
      status: r.status, answers: r.answers ?? {}, utm: r.utm ?? {},
      sourcePage: r.source_page, joinUrl: r.join_url,
      delivery: process.env.SCHEDULER_WEBHOOK_URL ? r.delivery : 'not_configured',
    }))
  })
}

/** Confirmed bookings that haven't ended yet — the reconcile job's worklist. */
export async function upcomingConfirmed(): Promise<Booking[]> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `SELECT * FROM scheduler.bookings WHERE status = 'confirmed' AND ends_at > NOW() ORDER BY starts_at`,
    )
    return rows.map(toBooking)
  })
}

/**
 * Pending rows older than `olderThanMs` are bookings whose request died between
 * reserving the slot and creating the event. They hold a slot for nobody.
 */
export async function stalePending(olderThanMs: number): Promise<Booking[]> {
  return withDbRetry(async () => {
    const {rows} = await pool.query(
      `SELECT * FROM scheduler.bookings WHERE status = 'pending' AND created_at < $1`,
      [new Date(Date.now() - olderThanMs)],
    )
    return rows.map(toBooking)
  })
}
