import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto'
import {pool, withDbRetry} from '../db'

function key(): Buffer {
  const raw = process.env.SCHEDULER_TOKEN_KEY || ''
  if (!/^[0-9a-f]{64}$/i.test(raw)) throw new Error('SCHEDULER_TOKEN_KEY must be 32 bytes of hex')
  return Buffer.from(raw, 'hex')
}

export function encryptRefreshToken(token: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString('base64url')).join('.')
}

export function decryptRefreshToken(value: string): string {
  const parts = value.split('.')
  if (parts.length !== 3) throw new Error('Invalid encrypted refresh token')
  const [iv, tag, encrypted] = parts.map((part) => Buffer.from(part, 'base64url'))
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Invalid encrypted refresh token')
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
}

export async function connectionMode(): Promise<'environment' | 'database' | 'none'> {
  if (process.env.GOOGLE_REFRESH_TOKEN) return 'environment'
  const {rows} = await withDbRetry(() => pool.query('SELECT 1 FROM scheduler.calendar_connections WHERE id = $1', ['host']))
  return rows.length ? 'database' : 'none'
}

export async function getRefreshToken(): Promise<string> {
  if (process.env.GOOGLE_REFRESH_TOKEN) return process.env.GOOGLE_REFRESH_TOKEN
  const {rows} = await withDbRetry(() => pool.query<{encrypted_refresh_token: string}>(
    'SELECT encrypted_refresh_token FROM scheduler.calendar_connections WHERE id = $1', ['host'],
  ))
  if (!rows[0]) throw new Error('Google calendar is not connected')
  return decryptRefreshToken(rows[0].encrypted_refresh_token)
}

export async function saveRefreshToken(token: string): Promise<void> {
  const encrypted = encryptRefreshToken(token)
  await withDbRetry(() => pool.query(
    `INSERT INTO scheduler.calendar_connections (id, encrypted_refresh_token) VALUES ($1, $2)
     ON CONFLICT (id) DO UPDATE SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token, updated_at = NOW()`,
    ['host', encrypted],
  ))
}

export async function disconnectCalendar(): Promise<void> {
  await withDbRetry(() => pool.query('DELETE FROM scheduler.calendar_connections WHERE id = $1', ['host']))
}
