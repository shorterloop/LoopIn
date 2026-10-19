import type {EventType} from './types'

/**
 * Booking input validation against the event type. Pure — the route calls it
 * before touching the database or Google.
 */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_FIELD = 200
const MAX_ANSWER = 5000

/** Common free/personal mailbox domains, rejected when require_work_email is on. */
export const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.uk',
  'yahoo.fr',
  'ymail.com',
  'hotmail.com',
  'hotmail.co.uk',
  'hotmail.fr',
  'outlook.com',
  'live.com',
  'msn.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'gmx.de',
  'gmx.net',
  'web.de',
  'mail.com',
  'yandex.com',
  'yandex.ru',
  'zoho.com',
  'tutanota.com',
  'fastmail.com',
  'hey.com',
  'qq.com',
  '163.com',
  '126.com',
  'rediffmail.com',
])

export function isFreeEmail(email: string): boolean {
  const domain = email.split('@').pop()?.toLowerCase().trim() ?? ''
  return FREE_EMAIL_DOMAINS.has(domain)
}

export interface BookingFields {
  name: string
  email: string
  company: string
  answers: Record<string, string>
}

export type ValidationResult = {ok: true; value: BookingFields} | {ok: false; error: string}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function validateBookingFields(eventType: EventType, body: Record<string, unknown>): ValidationResult {
  const name = str(body.name)
  const email = str(body.email).toLowerCase()
  const company = str(body.company)

  if (!name) return {ok: false, error: 'Please enter your name.'}
  if (!EMAIL_RE.test(email)) return {ok: false, error: 'Please enter a valid email address.'}
  if (eventType.requireWorkEmail && isFreeEmail(email)) {
    return {ok: false, error: 'Please use your work email address.'}
  }
  if (!company) return {ok: false, error: 'Please enter your company.'}
  if (name.length > MAX_FIELD || email.length > MAX_FIELD || company.length > MAX_FIELD) {
    return {ok: false, error: 'One of the fields is too long.'}
  }

  const raw = (body.answers && typeof body.answers === 'object' ? body.answers : {}) as Record<string, unknown>
  const answers: Record<string, string> = {}
  for (const q of eventType.questions) {
    const answer = str(raw[q.key])
    if (!answer) {
      if (q.required) return {ok: false, error: `Please answer: ${q.label}`}
      continue
    }
    if (q.type === 'select' && Array.isArray(q.options) && q.options.length > 0 && !q.options.includes(answer)) {
      return {ok: false, error: `Please choose a valid option for: ${q.label}`}
    }
    if (answer.length > MAX_ANSWER) return {ok: false, error: `That answer is too long: ${q.label}`}
    answers[q.key] = answer
  }

  return {ok: true, value: {name, email, company, answers}}
}

/** A valid IANA zone, or null. */
export function cleanTimeZone(value: unknown): string | null {
  if (typeof value !== 'string' || !value || value.length > 64) return null
  try {
    new Intl.DateTimeFormat('en-US', {timeZone: value})
    return value
  } catch {
    return null
  }
}

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const

export function cleanUtm(value: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!value || typeof value !== 'object') return out
  for (const key of UTM_KEYS) {
    const v = (value as Record<string, unknown>)[key]
    if (typeof v === 'string' && v.trim()) out[key] = v.trim().slice(0, 255)
  }
  return out
}

export function splitName(name: string): {firstName: string; lastName?: string} {
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return {firstName: parts[0]}
  return {firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1]}
}
