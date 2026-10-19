import {NextRequest, NextResponse} from 'next/server'
import {getEventTypeBySlug} from '@/lib/scheduler/repo'
import {badRequest, errorResponse, parseInstant} from '@/lib/scheduler/http'
import {bookingForToken, listSlots} from '@/lib/scheduler/service'
import {isWellFormedToken} from '@/lib/scheduler/security'

export const dynamic = 'force-dynamic'

/**
 * GET /api/scheduler/slots?type=demo&from=<ISO>&to=<ISO>[&token=<manage token>]
 * Open slot starts as UTC ISO strings. With a manage token (reschedule), the
 * booking's own time is not counted as busy and its event type is used.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams
  const from = parseInstant(q.get('from'))
  const to = parseInstant(q.get('to'))
  if (!from || !to || to <= from) return badRequest('from and to must be ISO timestamps, from < to.')

  try {
    const token = q.get('token')
    let eventType
    let excludeBooking
    if (token) {
      if (!isWellFormedToken(token)) return badRequest('Invalid link.', 'not_found')
      const found = await bookingForToken(token)
      eventType = found.eventType
      excludeBooking = found.booking
    } else {
      eventType = await getEventTypeBySlug(q.get('type') || '')
    }
    if (!eventType) {
      return NextResponse.json({ok: false, code: 'not_found', error: 'Unknown event type.'}, {status: 404})
    }

    const slots = await listSlots(eventType, from.getTime(), to.getTime(), {excludeBooking})
    return NextResponse.json(
      {ok: true, slots: slots.map((ms) => new Date(ms).toISOString())},
      {headers: {'Cache-Control': 'no-store'}},
    )
  } catch (err) {
    return errorResponse(err, 'slot listing failed')
  }
}
