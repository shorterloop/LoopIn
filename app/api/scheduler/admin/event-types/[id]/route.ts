import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized, validateEventTypeAdminUpdate} from '@/lib/scheduler/admin'
import {badRequest, errorResponse} from '@/lib/scheduler/http'
import {updateEventTypeForAdmin} from '@/lib/scheduler/repo'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** PATCH /api/scheduler/admin/event-types/:id — update editable event-type settings. */
export async function PATCH(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  const {id} = await params
  if (!UUID_RE.test(id)) return badRequest('Invalid event type id.')

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request.')
  }

  const parsed = validateEventTypeAdminUpdate(body)
  if (!parsed.ok) return badRequest(parsed.error)

  try {
    const eventType = await updateEventTypeForAdmin(id, parsed.value)
    if (!eventType) {
      return NextResponse.json({ok: false, code: 'not_found', error: 'Unknown event type.'}, {status: 404})
    }
    return NextResponse.json({ok: true, eventType}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler admin event-type update failed')
  }
}
