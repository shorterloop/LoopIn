/**
 * Zoom meetings for event types whose conference_provider is "zoom".
 *
 * Auth is a Server-to-Server OAuth app (Zoom App Marketplace → Build App →
 * Server-to-Server OAuth), created by a Zoom account admin. Scopes:
 *   meeting:write:meeting:admin, meeting:update:meeting:admin,
 *   meeting:delete:meeting:admin, meeting:read:meeting:admin
 *
 * Environment:
 *   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
 *   ZOOM_HOST_EMAIL — the Zoom user who hosts the meetings
 *
 * Zoom does not email anyone about API-created meetings; the Google Calendar
 * invite carries the join link, so the visitor gets exactly one invite.
 */

const API = 'https://api.zoom.us/v2'

export class ZoomError extends Error {
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

let cachedToken: {value: string; expiresAt: number} | null = null

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value
  const basic = Buffer.from(`${env('ZOOM_CLIENT_ID')}:${env('ZOOM_CLIENT_SECRET')}`).toString('base64')
  const res = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(env('ZOOM_ACCOUNT_ID'))}`,
    {method: 'POST', headers: {Authorization: `Basic ${basic}`}, cache: 'no-store'},
  )
  if (!res.ok) throw new ZoomError(`Zoom token request failed: ${res.status} ${await res.text()}`, res.status)
  const json = (await res.json()) as {access_token: string; expires_in: number}
  cachedToken = {value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000}
  return json.access_token
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
  if (!res.ok) throw new ZoomError(`Zoom ${method} ${path}: ${res.status} ${await res.text()}`, res.status)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export interface ZoomMeeting {
  id: number
  join_url: string
}

export async function createMeeting(input: {
  topic: string
  agenda: string
  start: Date
  durationMin: number
  timeZone: string
}): Promise<ZoomMeeting> {
  return call<ZoomMeeting>('POST', `/users/${encodeURIComponent(env('ZOOM_HOST_EMAIL'))}/meetings`, {
    topic: input.topic.slice(0, 200),
    agenda: input.agenda.slice(0, 2000),
    type: 2, // scheduled
    start_time: input.start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: input.durationMin,
    timezone: input.timeZone,
    settings: {
      join_before_host: true,
      waiting_room: false,
      auto_recording: 'none',
      // Google sends the invite; don't let Zoom email anyone.
      registrants_email_notification: false,
    },
  })
}

export async function rescheduleMeeting(meetingId: string, start: Date, durationMin: number, timeZone: string) {
  await call<void>('PATCH', `/meetings/${encodeURIComponent(meetingId)}`, {
    start_time: start.toISOString().replace(/\.\d{3}Z$/, 'Z'),
    duration: durationMin,
    timezone: timeZone,
  })
}

/** Delete a meeting. Already gone = fine. */
export async function deleteMeeting(meetingId: string): Promise<void> {
  try {
    await call<void>('DELETE', `/meetings/${encodeURIComponent(meetingId)}`)
  } catch (err) {
    if (err instanceof ZoomError && err.status === 404) return
    throw err
  }
}
