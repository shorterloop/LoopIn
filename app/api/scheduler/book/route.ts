import {NextRequest, NextResponse} from 'next/server'
import {countRecentByEmail, countRecentByIp, getEventTypeBySlug} from '@/lib/scheduler/repo'
import {badRequest, errorResponse, parseInstant} from '@/lib/scheduler/http'
import {book} from '@/lib/scheduler/service'
import {clientIp, hashIp, verifyTurnstile} from '@/lib/scheduler/security'
import {cleanTimeZone, cleanUtm, validateBookingFields} from '@/lib/scheduler/validate'

export const dynamic = 'force-dynamic'

const HOUR = 60 * 60 * 1000
const MAX_PER_IP_PER_HOUR = 5
const MAX_PER_EMAIL_PER_DAY = 3

/**
 * POST /api/scheduler/book
 * {type, start, name, email, company, answers, tz, utm, turnstileToken, website}
 *
 * Order: honeypot → captcha → validation → rate limit → (service) live slot
 * re-check → lead upsert → reserve slot → conference + calendar event → confirm.
 */
export async function POST(request: NextRequest) {
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request.')
  }

  // Honeypot: real visitors never fill it. Pretend success to bots.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return NextResponse.json({ok: true})
  }

  const ip = clientIp(request.headers)
  if (!(await verifyTurnstile(body.turnstileToken, ip))) {
    return badRequest('Please complete the verification and try again.', 'captcha')
  }

  try {
    const eventType = await getEventTypeBySlug(typeof body.type === 'string' ? body.type : '')
    if (!eventType) {
      return NextResponse.json({ok: false, code: 'not_found', error: 'Unknown event type.'}, {status: 404})
    }

    const start = parseInstant(body.start)
    if (!start) return badRequest('Please pick a time.')

    const fields = validateBookingFields(eventType, body)
    if (!fields.ok) return badRequest(fields.error)

    const ipHash = hashIp(ip)
    const now = Date.now()
    const [byIp, byEmail] = await Promise.all([
      ipHash ? countRecentByIp(ipHash, now - HOUR) : Promise.resolve(0),
      countRecentByEmail(fields.value.email, now - 24 * HOUR),
    ])
    if (byIp >= MAX_PER_IP_PER_HOUR || byEmail >= MAX_PER_EMAIL_PER_DAY) {
      return NextResponse.json(
        {ok: false, code: 'rate_limited', error: 'Too many bookings. Please try again later or email us.'},
        {status: 429},
      )
    }

    const {booking} = await book({
      eventType,
      start,
      fields: fields.value,
      attendeeTz: cleanTimeZone(body.tz),
      utm: cleanUtm(body.utm),
      sourcePage: request.headers.get('referer'),
      ipHash,
      userAgent: request.headers.get('user-agent'),
    })

    return NextResponse.json({
      ok: true,
      booking: {
        id: booking.id,
        title: eventType.title,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        joinUrl: booking.joinUrl,
        conferenceProvider: booking.conferenceProvider,
      },
    })
  } catch (err) {
    return errorResponse(err, 'booking failed')
  }
}
