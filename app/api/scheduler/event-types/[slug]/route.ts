import {NextResponse} from 'next/server'
import {getEventTypeBySlug} from '@/lib/scheduler/repo'
import {errorResponse} from '@/lib/scheduler/http'
import {toPublicEventType} from '@/lib/scheduler/types'

export const dynamic = 'force-dynamic'

/** GET /api/scheduler/event-types/:slug — title, description, duration, questions. */
export async function GET(_req: Request, {params}: {params: Promise<{slug: string}>}) {
  const {slug} = await params
  try {
    const eventType = await getEventTypeBySlug(slug)
    if (!eventType) {
      return NextResponse.json({ok: false, code: 'not_found', error: 'Unknown event type.'}, {status: 404})
    }
    return NextResponse.json({ok: true, eventType: toPublicEventType(eventType)})
  } catch (err) {
    return errorResponse(err, 'event-type lookup failed')
  }
}
