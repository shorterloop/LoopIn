import {NextRequest, NextResponse} from 'next/server'
import {getBookingById, getEventTypeById} from '@/lib/scheduler/repo'
import {errorResponse} from '@/lib/scheduler/http'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * GET /api/scheduler/confirmation?b=<booking id>
 * What a thank-you page shows: title, time, join link. Deliberately nothing
 * personal (no name, email, company) and never the manage token, because the
 * booking id travels in a URL.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('b') || ''
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ok: false, code: 'not_found', error: 'Booking not found.'}, {status: 404})
  }
  try {
    const booking = await getBookingById(id)
    if (!booking || booking.status === 'pending') {
      return NextResponse.json({ok: false, code: 'not_found', error: 'Booking not found.'}, {status: 404})
    }
    const eventType = await getEventTypeById(booking.eventTypeId)
    return NextResponse.json(
      {
        ok: true,
        booking: {
          title: eventType?.title ?? '',
          startsAt: booking.startsAt.toISOString(),
          endsAt: booking.endsAt.toISOString(),
          status: booking.status,
          joinUrl: booking.status === 'confirmed' ? booking.joinUrl : null,
          conferenceProvider: booking.conferenceProvider,
        },
      },
      {headers: {'Cache-Control': 'no-store'}},
    )
  } catch (err) {
    return errorResponse(err, 'confirmation lookup failed')
  }
}
