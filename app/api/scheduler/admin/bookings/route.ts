import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
import {errorResponse} from '@/lib/scheduler/http'
import {listBookingsForAdmin} from '@/lib/scheduler/repo'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  try {
    const bookings = await listBookingsForAdmin()
    return NextResponse.json({ok: true, bookings, webhookConfigured: Boolean(process.env.SCHEDULER_WEBHOOK_URL && process.env.SCHEDULER_WEBHOOK_SECRET)}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler admin booking list failed')
  }
}
