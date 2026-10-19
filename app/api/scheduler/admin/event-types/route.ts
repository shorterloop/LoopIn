import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized, validateEventTypeAdminCreate} from '@/lib/scheduler/admin'
import {badRequest, errorResponse} from '@/lib/scheduler/http'
import {createEventTypeForAdmin, listEventTypesForAdmin} from '@/lib/scheduler/repo'

export const dynamic = 'force-dynamic'

/** GET /api/scheduler/admin/event-types — internal editor worklist. */
export async function GET(request: NextRequest) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  try {
    const eventTypes = await listEventTypesForAdmin()
    return NextResponse.json({ok: true, eventTypes}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler admin event-type list failed')
  }
}

/** POST /api/scheduler/admin/event-types — create a shareable meeting type. */
export async function POST(request: NextRequest) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    return badRequest('Invalid request.')
  }
  const parsed = validateEventTypeAdminCreate(body)
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    const eventType = await createEventTypeForAdmin(parsed.value)
    return NextResponse.json({ok: true, eventType}, {status: 201, headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    if ((err as {code?: string})?.code === '23505') {
      return NextResponse.json({ok: false, code: 'conflict', error: 'That slug is already in use.'}, {status: 409})
    }
    return errorResponse(err, 'scheduler admin event-type create failed')
  }
}
