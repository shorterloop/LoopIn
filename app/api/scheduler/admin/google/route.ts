import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
import {connectionMode, disconnectCalendar} from '@/lib/scheduler/connection'
import {calendarId, freeBusy, invalidateAccessToken} from '@/lib/scheduler/google'
import {errorResponse} from '@/lib/scheduler/http'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  try {
    const mode = await connectionMode()
    let healthy = false
    if (mode !== 'none') {
      try {
        const now = Date.now()
        await freeBusy(now, now + 60_000, {fresh: true})
        healthy = true
      } catch (err) {
        console.error('[scheduler] configured Google calendar health check failed:', err)
      }
    }
    return NextResponse.json({ok: true, mode, healthy, calendarId: calendarId()}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler Google status failed')
  }
}

export async function DELETE(request: NextRequest) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  try {
    if (await connectionMode() === 'environment') {
      return NextResponse.json({ok: false, error: 'Remove GOOGLE_REFRESH_TOKEN from the server environment first.'}, {status: 409})
    }
    await disconnectCalendar()
    invalidateAccessToken()
    return NextResponse.json({ok: true, mode: 'none'}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler Google disconnect failed')
  }
}
