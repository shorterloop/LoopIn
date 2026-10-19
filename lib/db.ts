import {Pool} from 'pg'
const globalDb = globalThis as unknown as {schedulerPool?: Pool}
export const pool = globalDb.schedulerPool ?? new Pool({connectionString: process.env.DATABASE_URL, max: 5})
if (process.env.NODE_ENV !== 'production') globalDb.schedulerPool = pool
pool.on('error', (err) => console.error('[scheduler] idle database connection error:', err.message))
// Retry only reads/idempotent upserts passed by the repository. Transactions are never retried here.
export async function withDbRetry<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (err) {
    if (!['ECONNRESET', 'EPIPE', '57P01'].includes((err as {code?: string}).code ?? '')) throw err
    return fn()
  }
}
