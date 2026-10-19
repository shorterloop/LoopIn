import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
import {errorResponse} from '@/lib/scheduler/http'
import {retryFailedIntegrationEvents} from '@/lib/scheduler/repo'
import {deliverIntegrationEvents} from '@/lib/scheduler/webhook'

export async function POST(request: NextRequest) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  try {
    await retryFailedIntegrationEvents()
    const report = await deliverIntegrationEvents()
    return NextResponse.json({ok: true, report}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler integration retry failed')
  }
}
