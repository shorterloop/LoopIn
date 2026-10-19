import {NextRequest, NextResponse} from 'next/server'
import {timingSafeEqual} from 'node:crypto'
import {reconcile} from '@/lib/scheduler/service'
import {deliverIntegrationEvents} from '@/lib/scheduler/webhook'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Maintenance endpoint for any HTTP scheduler. Requires the CRON_SECRET bearer token. */
function authorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

async function run(request: NextRequest) {
  if (!authorized(request)) return NextResponse.json({ok: false}, {status: 401})
  try {
    const report = await reconcile()
    const deliveries = await deliverIntegrationEvents()
    console.log('[scheduler] reconcile:', JSON.stringify({...report, deliveries}))
    const ok = report.failed.length === 0 && deliveries.failed === 0
    return NextResponse.json({ok, report, deliveries}, {status: ok ? 200 : 500})
  } catch (err) {
    console.error('[scheduler] reconcile failed:', err)
    return NextResponse.json({ok: false}, {status: 500})
  }
}

export const GET = run
export const POST = run
