import type {Interval} from './types'
import {getRefreshToken} from './connection'

/**
 * Google Calendar access for the scheduler — plain REST over fetch, no SDK.
 *
 * Auth is one OAuth refresh token for the Scheduler Google account
 * (scopes: calendar.events + calendar.freebusy), minted once with
 * `npm run scheduler:google-token`. Never sent to the browser.
 *
 * Environment:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
 *   SCHEDULER_CALENDAR_ID — defaults to "primary"
 */

const API = 'https://www.googleapis.com/calendar/v3'
const FREEBUSY_TTL_MS = 60_000

export class GoogleCalendarError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} environment variable is not configured`)
  return value
}

export function calendarId(): string {
  return process.env.SCHEDULER_CALENDAR_ID || 'primary'
}

let cachedToken: {value: string; expiresAt: number; refreshToken: string} | null = null

async function accessToken(): Promise<string> {
  const refreshToken = await getRefreshToken()
  if (cachedToken?.refreshToken === refreshToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    // invalid_grant here almost always means the refresh token was revoked or
    // expired (an External OAuth app left in "Testing" expires tokens after 7 days).
    throw new GoogleCalendarError(`Google token refresh failed: ${res.status} ${await res.text()}`, res.status)
  }
  const json = (await res.json()) as {access_token: string; expires_in: number}
  cachedToken = {value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000, refreshToken}
  return json.access_token
}

export function invalidateAccessToken(): void {
  cachedToken = null
  invalidateFreeBusy()
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body ? {'Content-Type': 'application/json'} : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new GoogleCalendarError(`Google Calendar ${method} ${path}: ${res.status} ${await res.text()}`, res.status)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// ---------------------------------------------------------------------------
// Free/busy
// ---------------------------------------------------------------------------

const freeBusyCache = new Map<string, {at: number; busy: Interval[]}>()

/**
 * Busy intervals on the host calendar in [from, to). Cached for 60 seconds per
 * range for the slot list; pass `fresh` when booking so the check is live.
 */
export async function freeBusy(from: number, to: number, {fresh = false} = {}): Promise<Interval[]> {
  const key = `${from}:${to}`
  const hit = freeBusyCache.get(key)
  if (!fresh && hit && Date.now() - hit.at < FREEBUSY_TTL_MS) return hit.busy

  const id = calendarId()
  const json = await call<{calendars: Record<string, {busy?: Array<{start: string; end: string}>; errors?: unknown[]}>}>(
    'POST',
    '/freeBusy',
    {timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(), items: [{id}]},
  )
  const entry = json.calendars[id] ?? Object.values(json.calendars)[0]
  if (!entry || entry.errors?.length) {
    throw new GoogleCalendarError(`Google free/busy returned errors: ${JSON.stringify(entry?.errors)}`, 502)
  }
  const busy = (entry.busy ?? []).map((b) => ({start: Date.parse(b.start), end: Date.parse(b.end)}))

  if (freeBusyCache.size > 200) freeBusyCache.clear()
  freeBusyCache.set(key, {at: Date.now(), busy})
  return busy
}

/** Drop cached free/busy so the next slot list sees a booking just made. */
export function invalidateFreeBusy(): void {
  freeBusyCache.clear()
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface CalendarEventInput {
  bookingId: string
  summary: string
  description: string
  start: Date
  end: Date
  timeZone: string
  attendees: Array<{email: string; displayName?: string}>
  /** Create a Google Meet link on the event. */
  createMeet: boolean
  /** Shown as the event location — the Zoom join URL for Zoom bookings. */
  location?: string
}

export interface CalendarEvent {
  id: string
  status?: string
  description?: string
  location?: string
  start?: {dateTime?: string}
  end?: {dateTime?: string}
  extendedProperties?: {private?: {booking_id?: string}}
  hangoutLink?: string
  htmlLink?: string
  conferenceData?: {
    createRequest?: {status?: {statusCode?: string}}
    entryPoints?: Array<{entryPointType: string; uri: string}>
  }
}

export function meetUrl(event: CalendarEvent): string | null {
  return (
    event.hangoutLink ||
    event.conferenceData?.entryPoints?.find((p) => p.entryPointType === 'video')?.uri ||
    null
  )
}

export function bookingEventId(bookingId: string): string {
  return bookingId.replaceAll('-', '').toLowerCase()
}

const path = (eventId?: string) =>
  `/calendars/${encodeURIComponent(calendarId())}/events${eventId ? `/${encodeURIComponent(eventId)}` : ''}`

export async function createEvent(input: CalendarEventInput): Promise<CalendarEvent> {
  const eventId = bookingEventId(input.bookingId)
  const body: Record<string, unknown> = {
    id: eventId,
    summary: input.summary,
    description: input.description,
    start: {dateTime: input.start.toISOString(), timeZone: input.timeZone},
    end: {dateTime: input.end.toISOString(), timeZone: input.timeZone},
    attendees: input.attendees,
    guestsCanModify: false,
    guestsCanInviteOthers: false,
    extendedProperties: {private: {booking_id: input.bookingId}},
    ...(input.location ? {location: input.location} : {}),
    ...(input.createMeet
      ? {
          conferenceData: {
            createRequest: {requestId: input.bookingId, conferenceSolutionKey: {type: 'hangoutsMeet'}},
          },
        }
      : {}),
  }
  let event: CalendarEvent
  try {
    event = await call<CalendarEvent>('POST', `${path()}?conferenceDataVersion=1&sendUpdates=all`, body)
  } catch (err) {
    // A timed-out insert may still have succeeded remotely. The stable ID lets
    // us recover that exact event without creating a duplicate invitation.
    const existing = await getEvent(eventId).catch(() => null)
    if (existing?.extendedProperties?.private?.booking_id !== input.bookingId) throw err
    event = existing
  }

  // Meet creation is usually synchronous but may come back "pending"; give it
  // a moment and read the event again so the confirmation can show the link.
  if (input.createMeet && !meetUrl(event)) {
    for (let i = 0; i < 3 && !meetUrl(event); i++) {
      await new Promise((r) => setTimeout(r, 700))
      event = await getEvent(event.id).then((e) => e ?? event).catch(() => event)
    }
  }
  return event
}

export async function deleteBookingEvent(bookingId: string): Promise<void> {
  const event = await getEvent(bookingEventId(bookingId))
  if (event?.extendedProperties?.private?.booking_id === bookingId) await deleteEvent(event.id)
}

export async function getEvent(eventId: string): Promise<CalendarEvent | null> {
  try {
    return await call<CalendarEvent>('GET', path(eventId))
  } catch (err) {
    if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410)) return null
    throw err
  }
}

/** Move and/or re-describe an event. Google emails the attendee the update. */
export async function updateEvent(
  eventId: string,
  patch: {start?: Date; end?: Date; timeZone?: string; description?: string; location?: string},
): Promise<CalendarEvent> {
  const body: Record<string, unknown> = {}
  if (patch.start) body.start = {dateTime: patch.start.toISOString(), timeZone: patch.timeZone}
  if (patch.end) body.end = {dateTime: patch.end.toISOString(), timeZone: patch.timeZone}
  if (patch.description !== undefined) body.description = patch.description
  if (patch.location !== undefined) body.location = patch.location
  try {
    return await call<CalendarEvent>('PATCH', `${path(eventId)}?conferenceDataVersion=1&sendUpdates=all`, body)
  } catch (err) {
    // A failed response can arrive after Google committed the update. Accept
    // only an event whose requested fields all match the intended state.
    const existing = await getEvent(eventId).catch(() => null)
    if (existing &&
      (!patch.start || Date.parse(existing.start?.dateTime ?? '') === patch.start.getTime()) &&
      (!patch.end || Date.parse(existing.end?.dateTime ?? '') === patch.end.getTime()) &&
      (patch.description === undefined || existing.description === patch.description) &&
      (patch.location === undefined || existing.location === patch.location)) return existing
    throw err
  }
}

/** Delete an event; Google emails the attendee a cancellation. Gone already = fine. */
export async function deleteEvent(eventId: string): Promise<void> {
  try {
    await call<void>('DELETE', `${path(eventId)}?sendUpdates=all`)
  } catch (err) {
    if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410)) return
    throw err
  }
}
