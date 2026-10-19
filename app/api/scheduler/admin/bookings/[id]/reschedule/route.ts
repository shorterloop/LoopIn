import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
import {badRequest, errorResponse} from '@/lib/scheduler/http'
import {rescheduleById} from '@/lib/scheduler/service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  const {id} = await params
  if (!UUID_RE.test(id)) return badRequest('Invalid booking id.')
  const body = await request.json().catch(() => null)
  const start = typeof body?.start === 'string' ? new Date(body.start) : new Date(NaN)
  if (!Number.isFinite(start.getTime())) return badRequest('Invalid start time.')
  try {
    const booking = await rescheduleById(id, start)
    return NextResponse.json({ok: true, booking: {id: booking.id, startsAt: booking.startsAt.toISOString(), status: booking.status}}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler admin reschedule failed')
  }
}
