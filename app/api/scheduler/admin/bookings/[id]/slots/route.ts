import {DateTime} from 'luxon'
import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
import {badRequest, errorResponse} from '@/lib/scheduler/http'
import {getBookingById, getEventTypeById} from '@/lib/scheduler/repo'
import {listSlots} from '@/lib/scheduler/service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function GET(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  const {id} = await params
  if (!UUID_RE.test(id)) return badRequest('Invalid booking id.')
  const day = request.nextUrl.searchParams.get('date') ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return badRequest('Invalid date.')
  try {
    const booking = await getBookingById(id)
    if (!booking || booking.status !== 'confirmed') return NextResponse.json({ok: false, error: 'Booking not found.'}, {status: 404})
    const eventType = await getEventTypeById(booking.eventTypeId)
    if (!eventType) return NextResponse.json({ok: false, error: 'Event type not found.'}, {status: 404})
    const localDay = DateTime.fromISO(day, {zone: eventType.hostTz})
    if (!localDay.isValid) return badRequest('Invalid date.')
    const starts = await listSlots(eventType, localDay.toMillis(), localDay.plus({days: 1}).toMillis(), {excludeBooking: booking})
    return NextResponse.json({ok: true, slots: starts.map((start) => new Date(start).toISOString()), hostTz: eventType.hostTz}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler admin slots failed')
  }
}
