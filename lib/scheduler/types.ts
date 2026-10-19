/**
 * Scheduler domain types. Rows come from the `scheduler` Postgres schema
 * (db/migrations/001_scheduler.sql); these are their camelCase shapes.
 */

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun'

/** Per weekday, a list of [start, end] "HH:MM" ranges in the host time zone. */
export type WeeklyHours = Partial<Record<Weekday, Array<[string, string]>>>

export type ConferenceProvider = 'google_meet' | 'zoom'

export interface Question {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  options?: string[]
  leadField?: 'role'
}

export interface EventType {
  id: string
  slug: string
  title: string
  description: string | null
  durationMin: number
  slotStepMin: number
  bufferBeforeMin: number
  bufferAfterMin: number
  minNoticeHours: number
  maxDaysAhead: number
  maxBookingsPerDay: number | null
  hours: WeeklyHours
  hostTz: string
  questions: Question[]
  requireWorkEmail: boolean
  conferenceProvider: ConferenceProvider
  active: boolean
}

/** What the browser is allowed to see about an event type. */
export interface PublicEventType {
  slug: string
  title: string
  description: string | null
  durationMin: number
  maxDaysAhead: number
  questions: Question[]
  requireWorkEmail: boolean
  conferenceProvider: ConferenceProvider
}

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'rescheduled'

export interface Booking {
  id: string
  eventTypeId: string
  contactId: string
  startsAt: Date
  endsAt: Date
  attendeeName: string
  attendeeEmail: string
  company: string
  attendeeTz: string | null
  status: BookingStatus
  answers: Record<string, string>
  utm: Record<string, string>
  sourcePage: string | null
  conferenceProvider: ConferenceProvider
  conferenceId: string | null
  joinUrl: string | null
  googleEventId: string | null
  rescheduledFrom: string | null
  createdAt: Date
}

/** A half-open [start, end) interval in epoch milliseconds. */
export interface Interval {
  start: number
  end: number
}

export type DateOverrides = Record<string, Array<[string, string]>>

export function toPublicEventType(e: EventType): PublicEventType {
  return {
    slug: e.slug,
    title: e.title,
    description: e.description,
    durationMin: e.durationMin,
    maxDaysAhead: e.maxDaysAhead,
    questions: e.questions,
    requireWorkEmail: e.requireWorkEmail,
    conferenceProvider: e.conferenceProvider,
  }
}
