import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized, validateAvailabilityOverride} from '@/lib/scheduler/admin'
import {badRequest, errorResponse} from '@/lib/scheduler/http'
import {deleteAvailabilityOverride, getEventTypeById, listAvailabilityOverrides, setAvailabilityOverride} from '@/lib/scheduler/repo'

export const dynamic = 'force-dynamic'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function validate(request: NextRequest, id: string) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  if (!UUID_RE.test(id)) return badRequest('Invalid event type id.')
  return null
}

export async function GET(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  const invalid = await validate(request, id)
  if (invalid) return invalid
  try {
    const overrides = await listAvailabilityOverrides(id)
    return NextResponse.json({ok: true, overrides}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler override list failed')
  }
}

export async function PUT(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  const invalid = await validate(request, id)
  if (invalid) return invalid
  let body: Record<string, unknown>
  try { body = await request.json() } catch { return badRequest('Invalid request.') }
  const parsed = validateAvailabilityOverride(body)
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    if (!await getEventTypeById(id)) return NextResponse.json({ok: false, error: 'Unknown event type.'}, {status: 404})
    await setAvailabilityOverride(id, parsed.value.date, parsed.value.hours)
    return NextResponse.json({ok: true}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler override save failed')
  }
}

export async function DELETE(request: NextRequest, {params}: {params: Promise<{id: string}>}) {
  const {id} = await params
  const invalid = await validate(request, id)
  if (invalid) return invalid
  const date = request.nextUrl.searchParams.get('date')
  const parsed = validateAvailabilityOverride({date, hours: []})
  if (!parsed.ok) return badRequest(parsed.error)
  try {
    await deleteAvailabilityOverride(id, parsed.value.date)
    return NextResponse.json({ok: true}, {headers: {'Cache-Control': 'no-store'}})
  } catch (err) {
    return errorResponse(err, 'scheduler override delete failed')
  }
}
