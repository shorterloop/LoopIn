import {upsertContact} from '../contacts'
import {sendSchedulerEmail} from '../resend'
import {answerList, eventDescription, eventSummary, formatWhen} from './copy'
import * as google from './google'
import * as repo from './repo'
import {hashToken, newManageToken} from './security'
import {isOpenSlot, openSlots} from './slots'
import type {Booking, EventType, Interval} from './types'
import {type BookingFields} from './validate'
import * as zoom from './zoom'

/**
 * Scheduler workflows: slots, book, cancel, reschedule, reconcile. Routes stay
 * thin — parse, call one of these, map the result to HTTP.
 */

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export class SchedulerError extends Error {
  constructor(
    readonly code: 'not_found' | 'slot_taken' | 'too_late' | 'unavailable' | 'invalid',
    message: string,
  ) {
    super(message)
  }
}

function extraGuests(): Array<{email: string}> {
  return (process.env.SCHEDULER_EXTRA_GUESTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((email) => ({email}))
}

async function busyFor(from: number, to: number, {fresh = false, excludeBooking}: {fresh?: boolean; excludeBooking?: Booking} = {}) {
  const [calendarBusy, bookings] = await Promise.all([
    google.freeBusy(from, to, {fresh}),
    repo.liveBookingIntervals(from, to, excludeBooking?.id),
  ])
  let busy: Interval[] = [...calendarBusy, ...bookings]
  if (excludeBooking) {
    // On reschedule the booking's own event is still on the calendar; it must
    // not block the time it is moving into.
    const s = excludeBooking.startsAt.getTime()
    const e = excludeBooking.endsAt.getTime()
    busy = busy.filter((b) => !(b.start === s && b.end === e))
  }
  return busy
}

// ---------------------------------------------------------------------------
// Slots
// ---------------------------------------------------------------------------

export async function listSlots(
  eventType: EventType,
  from: number,
  to: number,
  {excludeBooking}: {excludeBooking?: Booking} = {},
): Promise<number[]> {
  // Clamp to at most ~45 days so a hand-written query can't make us page
  // Google for a year of free/busy.
  const now = new Date()
  const lo = Math.max(from, now.getTime())
  const hi = Math.min(to, lo + 45 * DAY, now.getTime() + (eventType.maxDaysAhead + 2) * DAY)
  if (lo >= hi) return []
  const pad = (eventType.bufferBeforeMin + eventType.bufferAfterMin + eventType.durationMin) * MINUTE
  const busy = await busyFor(lo - pad, hi + pad, {excludeBooking})
  const availability = await repo.availabilityFor(eventType.id, new Date(lo), new Date(hi), eventType.hostTz, excludeBooking?.id)
  return openSlots(eventType, {from: lo, to: hi, now, busy, ...availability})
}

async function assertOpen(eventType: EventType, start: Date, excludeBooking?: Booking) {
  const s = start.getTime()
  const pad = (eventType.bufferBeforeMin + eventType.bufferAfterMin + eventType.durationMin) * MINUTE
  const busy = await busyFor(s - pad, s + pad, {fresh: true, excludeBooking})
  const availability = await repo.availabilityFor(eventType.id, start, start, eventType.hostTz, excludeBooking?.id)
  if (!isOpenSlot(eventType, s, {now: new Date(), busy, ...availability})) {
    throw new SchedulerError('slot_taken', 'That time was just taken. Please pick another.')
  }
}

// ---------------------------------------------------------------------------
// Book
// ---------------------------------------------------------------------------

export interface BookInput {
  eventType: EventType
  start: Date
  fields: BookingFields
  attendeeTz: string | null
  utm: Record<string, string>
  sourcePage: string | null
  ipHash: string | null
  userAgent: string | null
}

export interface BookResult {
  booking: Booking
}

/** Create the conference (Zoom only — Meet is created by the calendar event). */
async function createConference(eventType: EventType, summary: string, agenda: string, start: Date) {
  if (eventType.conferenceProvider !== 'zoom') return {conferenceId: null, joinUrl: null}
  const meeting = await zoom.createMeeting({
    topic: summary,
    agenda,
    start,
    durationMin: eventType.durationMin,
    timeZone: eventType.hostTz,
  })
  return {conferenceId: String(meeting.id), joinUrl: meeting.join_url}
}

function leadRole(eventType: EventType, answers: Record<string, string>): string | undefined {
  const roleQuestion = eventType.questions.find((q) => q.leadField === 'role')
  return roleQuestion ? answers[roleQuestion.key] : undefined
}

export async function book(input: BookInput): Promise<BookResult> {
  const {eventType, start, fields} = input
  const end = new Date(start.getTime() + eventType.durationMin * MINUTE)

  await assertOpen(eventType, start)

  // The local contact is the booking foreign key; no external CRM call is required.
  const contact = await upsertContact({
    email: fields.email, name: fields.name, company: fields.company,
    role: leadRole(eventType, fields.answers),
  })

  const {token, hash} = newManageToken()
  let pending: Booking
  try {
    pending = await repo.insertPendingBooking({
      eventTypeId: eventType.id,
      contactId: contact.id,
      startsAt: start,
      endsAt: end,
      attendeeName: fields.name,
      attendeeEmail: fields.email,
      company: fields.company,
      attendeeTz: input.attendeeTz,
      answers: fields.answers,
      utm: input.utm,
      sourcePage: input.sourcePage,
      conferenceProvider: eventType.conferenceProvider,
      manageTokenHash: hash,
      ipHash: input.ipHash,
      hostTz: eventType.hostTz,
      maxBookingsPerDay: eventType.maxBookingsPerDay,
      bufferBeforeMin: eventType.bufferBeforeMin,
      bufferAfterMin: eventType.bufferAfterMin,
    })
  } catch (err) {
    if (repo.isSlotTaken(err)) throw new SchedulerError('slot_taken', 'That time was just taken. Please pick another.')
    throw err
  }

  const summary = eventSummary(fields.company, eventType)
  let conference: {conferenceId: string | null; joinUrl: string | null} = {conferenceId: null, joinUrl: null}
  let googleEventId: string | null = null
  try {
    conference = await createConference(
      eventType,
      summary,
      `${fields.name} <${fields.email}>`,
      start,
    )
    if (conference.conferenceId) await repo.attachPendingConference(pending.id, conference.conferenceId, conference.joinUrl)
    const event = await google.createEvent({
      bookingId: pending.id,
      summary,
      description: eventDescription({
        eventType,
        name: fields.name,
        email: fields.email,
        company: fields.company,
        answers: fields.answers,
        joinUrl: conference.joinUrl,
        token,
      }),
      start,
      end,
      timeZone: eventType.hostTz,
      attendees: [{email: fields.email, displayName: fields.name}, ...extraGuests()],
      createMeet: eventType.conferenceProvider === 'google_meet',
      location: conference.joinUrl ?? undefined,
    })
    googleEventId = event.id
    const joinUrl = conference.joinUrl ?? google.meetUrl(event)
    await repo.attachPendingCalendarEvent(pending.id, event.id, conference.conferenceId, joinUrl)
    const booking = await repo.confirmBooking(pending.id, {
      googleEventId: event.id,
      conferenceId: conference.conferenceId,
      joinUrl,
    }, 'booking.created')
    google.invalidateFreeBusy()

    await notifyHost('booked', eventType, booking).catch((err) =>
      console.error('[scheduler] host email failed (booking kept):', err),
    )
    return {booking}
  } catch (err) {
    console.error('[scheduler] booking failed after reserving the slot — rolling back:', err)
    const persisted = await repo.getBookingById(pending.id).catch((e) => {
      console.error('[scheduler] could not check booking status after failed confirmation:', e)
      return null
    })
    if (persisted?.status === 'confirmed') return {booking: persisted}
    if (!persisted) throw new SchedulerError('unavailable', 'Booking status is uncertain. Please contact us before trying again.')

    let calendarCleaned = false
    try {
      if (googleEventId) await google.deleteEvent(googleEventId)
      else await google.deleteBookingEvent(pending.id)
      calendarCleaned = true
    } catch (e) {
      console.error('[scheduler] calendar rollback failed; pending row kept for reconcile:', e)
    }
    let conferenceCleaned = true
    if (conference.conferenceId) {
      try { await zoom.deleteMeeting(conference.conferenceId) }
      catch (e) {
        conferenceCleaned = false
        console.error('[scheduler] Zoom rollback failed; pending row kept for reconcile:', e)
      }
    }
    if (calendarCleaned && conferenceCleaned) await repo.deleteBooking(pending.id).catch((e) => console.error('[scheduler] rollback delete failed:', e))
    throw new SchedulerError('unavailable', 'We couldn’t create the calendar invite. Please try again.')
  }
}

// ---------------------------------------------------------------------------
// Manage: cancel / reschedule
// ---------------------------------------------------------------------------

/** The live booking behind a manage token, or a SchedulerError saying why not. */
export async function bookingForToken(token: string): Promise<{booking: Booking; eventType: EventType}> {
  const booking = await repo.getBookingByTokenHash(hashToken(token))
  if (!booking) throw new SchedulerError('not_found', 'This link is not valid.')
  const eventType = await repo.getEventTypeById(booking.eventTypeId)
  if (!eventType) throw new SchedulerError('not_found', 'This link is not valid.')
  return {booking, eventType}
}

function assertChangeable(booking: Booking) {
  if (booking.status !== 'confirmed') {
    throw new SchedulerError(
      'invalid',
      booking.status === 'cancelled' ? 'This meeting is already cancelled.' : 'This meeting has already been changed.',
    )
  }
  if (booking.startsAt.getTime() <= Date.now()) {
    throw new SchedulerError('too_late', 'This meeting has already started, so it can no longer be changed.')
  }
}

export async function cancel(token: string): Promise<Booking> {
  const {booking, eventType} = await bookingForToken(token)
  return cancelBooking(booking, eventType)
}

export async function cancelById(id: string): Promise<Booking> {
  const booking = await repo.getBookingById(id)
  if (!booking) throw new SchedulerError('not_found', 'Booking not found.')
  const eventType = await repo.getEventTypeById(booking.eventTypeId)
  if (!eventType) throw new SchedulerError('not_found', 'Event type not found.')
  return cancelBooking(booking, eventType)
}

async function cancelBooking(booking: Booking, eventType: EventType): Promise<Booking> {
  assertChangeable(booking)

  if (booking.googleEventId) await google.deleteEvent(booking.googleEventId)
  if (booking.conferenceProvider === 'zoom' && booking.conferenceId) {
    await zoom.deleteMeeting(booking.conferenceId).catch((err) =>
      console.error('[scheduler] Zoom delete failed (booking cancelled anyway):', err),
    )
  }
  await repo.setStatus(booking.id, 'cancelled')
  google.invalidateFreeBusy()

  await notifyHost('cancelled', eventType, booking).catch((err) => console.error('[scheduler] host email failed:', err))
  return {...booking, status: 'cancelled'}
}

export async function reschedule(token: string, start: Date, attendeeTz: string | null): Promise<Booking> {
  const {booking: old, eventType} = await bookingForToken(token)
  return rescheduleBooking(old, eventType, start, attendeeTz)
}

export async function rescheduleById(id: string, start: Date): Promise<Booking> {
  const old = await repo.getBookingById(id)
  if (!old) throw new SchedulerError('not_found', 'Booking not found.')
  const eventType = await repo.getEventTypeById(old.eventTypeId)
  if (!eventType) throw new SchedulerError('not_found', 'Event type not found.')
  return rescheduleBooking(old, eventType, start, old.attendeeTz)
}

async function rescheduleBooking(old: Booking, eventType: EventType, start: Date, attendeeTz: string | null): Promise<Booking> {
  assertChangeable(old)
  if (start.getTime() === old.startsAt.getTime()) {
    throw new SchedulerError('invalid', 'That is the time already booked.')
  }
  await assertOpen(eventType, start, old)

  const end = new Date(start.getTime() + eventType.durationMin * MINUTE)
  const {token: newToken, hash} = newManageToken()
  let next: Booking
  try {
    next = await repo.insertRescheduledBooking(old.id, {
      eventTypeId: old.eventTypeId,
      contactId: old.contactId,
      startsAt: start,
      endsAt: end,
      attendeeName: old.attendeeName,
      attendeeEmail: old.attendeeEmail,
      company: old.company,
      attendeeTz: attendeeTz ?? old.attendeeTz,
      answers: old.answers,
      utm: old.utm,
      sourcePage: old.sourcePage,
      conferenceProvider: old.conferenceProvider,
      manageTokenHash: hash,
      ipHash: null,
      googleEventId: old.googleEventId,
      conferenceId: old.conferenceId,
      joinUrl: old.joinUrl,
      hostTz: eventType.hostTz,
      maxBookingsPerDay: eventType.maxBookingsPerDay,
      bufferBeforeMin: eventType.bufferBeforeMin,
      bufferAfterMin: eventType.bufferAfterMin,
    })
  } catch (err) {
    if (repo.isSlotTaken(err)) throw new SchedulerError('slot_taken', 'That time was just taken. Please pick another.')
    throw err
  }

  // Move the existing event and meeting rather than delete + recreate: the
  // attendee gets one "updated" email and keeps the same join link.
  try {
    if (old.conferenceProvider === 'zoom' && old.conferenceId) {
      await zoom.rescheduleMeeting(old.conferenceId, start, eventType.durationMin, eventType.hostTz)
    }
    if (!old.googleEventId) throw new Error('Booking has no calendar event')
    await google.updateEvent(old.googleEventId, {
      start,
      end,
      timeZone: eventType.hostTz,
      description: eventDescription({
        eventType,
        name: old.attendeeName,
        email: old.attendeeEmail,
        company: old.company,
        answers: old.answers,
        joinUrl: old.conferenceProvider === 'zoom' ? old.joinUrl : null,
        token: newToken,
      }),
    })
  } catch (err) {
    console.error('[scheduler] reschedule failed — reverting:', err)
    if (old.conferenceProvider === 'zoom' && old.conferenceId) {
      await zoom
        .rescheduleMeeting(old.conferenceId, old.startsAt, eventType.durationMin, eventType.hostTz)
        .catch(() => undefined)
    }
    await repo.revertReschedule(old.id, next.id).catch((e) => console.error('[scheduler] revert failed:', e))
    throw new SchedulerError('unavailable', 'We couldn’t update the calendar invite. Please try again.')
  }

  const confirmed = await repo.confirmBooking(next.id, {
    googleEventId: old.googleEventId,
    conferenceId: old.conferenceId,
    joinUrl: old.joinUrl,
  }, 'booking.rescheduled')
  google.invalidateFreeBusy()
  await notifyHost('rescheduled', eventType, confirmed, old).catch((err) =>
    console.error('[scheduler] host email failed:', err),
  )
  return confirmed
}

// ---------------------------------------------------------------------------
// Reconcile (nightly)
// ---------------------------------------------------------------------------

export interface ReconcileReport {
  checked: number
  cancelledMissingEvent: string[]
  clearedStalePending: string[]
  confirmedStaleReschedule: string[]
  failed: Array<{bookingId: string; error: string}>
}

/**
 * - A confirmed booking whose calendar event was deleted by hand is marked
 *   cancelled (and its Zoom meeting removed).
 * - A pending row left by a request that died mid-booking is cleared, so it
 *   stops holding the slot. A stale pending reschedule is reverted.
 */
export async function reconcile(): Promise<ReconcileReport> {
  const report: ReconcileReport = {checked: 0, cancelledMissingEvent: [], clearedStalePending: [], confirmedStaleReschedule: [], failed: []}

  for (const booking of await repo.upcomingConfirmed()) {
    report.checked++
    try {
      if (!booking.googleEventId) continue
      const event = await google.getEvent(booking.googleEventId)
      if (event && event.status !== 'cancelled') continue
      if (booking.conferenceProvider === 'zoom' && booking.conferenceId) {
        await zoom.deleteMeeting(booking.conferenceId)
      }
      await repo.setStatus(booking.id, 'cancelled')
      report.cancelledMissingEvent.push(booking.id)
    } catch (err) {
      report.failed.push({bookingId: booking.id, error: err instanceof Error ? err.message : 'Unknown error'})
    }
  }

  for (const booking of await repo.stalePending(15 * MINUTE)) {
    try {
      if (booking.rescheduledFrom) {
        const old = await repo.getBookingById(booking.rescheduledFrom)
        const event = booking.googleEventId ? await google.getEvent(booking.googleEventId) : null
        const moved = event?.start?.dateTime && Date.parse(event.start.dateTime) === booking.startsAt.getTime()
        if (moved && booking.googleEventId) {
          await repo.confirmBooking(booking.id, {
            googleEventId: booking.googleEventId,
            conferenceId: booking.conferenceId,
            joinUrl: booking.joinUrl,
          }, 'booking.rescheduled')
          report.confirmedStaleReschedule.push(booking.id)
        } else {
          if (old && booking.conferenceProvider === 'zoom' && booking.conferenceId) {
            const eventType = await repo.getEventTypeById(booking.eventTypeId)
            if (eventType) await zoom.rescheduleMeeting(booking.conferenceId, old.startsAt, eventType.durationMin, eventType.hostTz)
          }
          await repo.revertReschedule(booking.rescheduledFrom, booking.id)
          report.clearedStalePending.push(booking.id)
        }
      } else {
        if (booking.googleEventId) await google.deleteEvent(booking.googleEventId)
        else await google.deleteBookingEvent(booking.id)
        if (booking.conferenceId) await zoom.deleteMeeting(booking.conferenceId)
        await repo.deleteBooking(booking.id)
        report.clearedStalePending.push(booking.id)
      }
    } catch (err) {
      report.failed.push({bookingId: booking.id, error: err instanceof Error ? err.message : 'Unknown error'})
    }
  }

  if (report.cancelledMissingEvent.length || report.clearedStalePending.length || report.confirmedStaleReschedule.length) google.invalidateFreeBusy()
  return report
}

// ---------------------------------------------------------------------------

async function notifyHost(
  kind: 'booked' | 'cancelled' | 'rescheduled',
  eventType: EventType,
  booking: Booking,
  previous?: Booking,
) {
  await sendSchedulerEmail({
    kind,
    eventTitle: eventType.title,
    name: booking.attendeeName,
    email: booking.attendeeEmail,
    company: booking.company,
    when: formatWhen(booking.startsAt, eventType.hostTz),
    previousWhen: previous ? formatWhen(previous.startsAt, eventType.hostTz) : undefined,
    joinUrl: booking.joinUrl,
    answers: answerList(eventType, booking.answers),
    utm: booking.utm,
    sourcePage: booking.sourcePage,
  })
}
