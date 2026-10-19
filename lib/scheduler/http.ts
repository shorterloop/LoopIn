import {NextResponse} from 'next/server'
import {SchedulerError} from './service'

const STATUS: Record<SchedulerError['code'], number> = {
  not_found: 404,
  slot_taken: 409,
  too_late: 409,
  invalid: 400,
  unavailable: 503,
}

/** Map any thrown error to the JSON shape the scheduler UI expects. */
export function errorResponse(err: unknown, context: string): NextResponse {
  if (err instanceof SchedulerError) {
    return NextResponse.json({ok: false, code: err.code, error: err.message}, {status: STATUS[err.code]})
  }
  console.error(`[scheduler] ${context}:`, err)
  return NextResponse.json(
    {ok: false, code: 'unavailable', error: 'The scheduler is unavailable right now. Please try again shortly.'},
    {status: 503},
  )
}

export function badRequest(error: string, code = 'invalid'): NextResponse {
  return NextResponse.json({ok: false, code, error}, {status: 400})
}

/** Parse an ISO instant; null when absent or malformed. */
export function parseInstant(value: unknown): Date | null {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms) : null
}
