import {NextRequest, NextResponse} from 'next/server'
import {badRequest, errorResponse, parseInstant} from '@/lib/scheduler/http'
import {reschedule} from '@/lib/scheduler/service'
import {isWellFormedToken} from '@/lib/scheduler/security'
import {cleanTimeZone} from '@/lib/scheduler/validate'

export const dynamic = 'force-dynamic'

/**
 * POST /api/scheduler/reschedule {token, start, tz}
 * Moves the meeting; the old manage link stops working and the updated invite
 * carries a new one.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {token?: unknown; start?: unknown; tz?: unknown}
  if (!isWellFormedToken(body.token)) return badRequest('This link is not valid.', 'not_found')
  const start = parseInstant(body.start)
  if (!start) return badRequest('Please pick a time.')
  try {
    const booking = await reschedule(body.token, start, cleanTimeZone(body.tz))
    return NextResponse.json({
      ok: true,
      booking: {
        id: booking.id,
        startsAt: booking.startsAt.toISOString(),
        endsAt: booking.endsAt.toISOString(),
        joinUrl: booking.joinUrl,
      },
    })
  } catch (err) {
    return errorResponse(err, 'reschedule failed')
  }
}
