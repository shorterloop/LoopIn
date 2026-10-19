import {NextRequest, NextResponse} from 'next/server'
import {badRequest, errorResponse} from '@/lib/scheduler/http'
import {cancel} from '@/lib/scheduler/service'
import {isWellFormedToken} from '@/lib/scheduler/security'

export const dynamic = 'force-dynamic'

/** POST /api/scheduler/cancel {token} — cancels; Google emails the attendee. */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {token?: unknown}
  if (!isWellFormedToken(body.token)) return badRequest('This link is not valid.', 'not_found')
  try {
    await cancel(body.token)
    return NextResponse.json({ok: true})
  } catch (err) {
    return errorResponse(err, 'cancel failed')
  }
}
