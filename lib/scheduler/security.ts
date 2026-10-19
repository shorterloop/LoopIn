import {createHash, randomBytes} from 'node:crypto'

/**
 * Tokens, IP hashing and Cloudflare Turnstile for the scheduler.
 *
 * Environment:
 *   TURNSTILE_SECRET_KEY — server secret. When unset, verification is skipped
 *     (local dev / before the keys exist) and a warning is logged.
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY — the widget key the browser renders.
 */

/** A 32-byte random manage token (base64url) and the hash we store. */
export function newManageToken(): {token: string; hash: string} {
  const token = randomBytes(32).toString('base64url')
  return {token, hash: hashToken(token)}
}

/**
 * Lookup is by hash, so the comparison happens inside a unique index and a
 * timing difference can't reveal a token prefix — the "constant time" the
 * spec asks for, without comparing secrets in JS at all.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function isWellFormedToken(token: unknown): token is string {
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token)
}

/** The caller's IP from the proxy headers Vercel and Railway both set. */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0].trim() || null
  return headers.get('x-real-ip')
}

/** Rate limiting needs "same IP", not the IP itself — store only a hash. */
export function hashIp(ip: string | null): string | null {
  if (!ip) return null
  return createHash('sha256').update(`scheduler:${ip}`).digest('hex').slice(0, 32)
}

export async function verifyTurnstile(token: unknown, ip: string | null): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY
  if (!secret) {
    console.warn('[scheduler] TURNSTILE_SECRET_KEY not set — skipping bot check')
    return true
  }
  if (typeof token !== 'string' || !token) return false
  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: {'Content-Type': 'application/x-www-form-urlencoded'},
      body: new URLSearchParams({secret, response: token, ...(ip ? {remoteip: ip} : {})}),
      cache: 'no-store',
    })
    const json = (await res.json()) as {success?: boolean}
    return json.success === true
  } catch (err) {
    console.error('[scheduler] Turnstile verification failed:', err)
    return false
  }
}
