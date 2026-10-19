import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
import {badRequest, errorResponse} from '@/lib/scheduler/http'
import {cancelById} from '@/lib/scheduler/service'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  const {id} = await params
  if (!UUID_RE.test(id)) return badRequest('Invalid booking id.')
  try {
    const booking = await cancelById(id)
    return NextResponse.json({ok: true, booking: {id: booking.id, status: booking.status}}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler admin cancel failed')
  }
}
