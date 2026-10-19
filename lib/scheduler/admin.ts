import {timingSafeEqual} from 'node:crypto'
import type {NextRequest} from 'next/server'
import type {ConferenceProvider, Question, Weekday, WeeklyHours} from './types'
import {cleanTimeZone} from './validate'

const WEEKDAYS = new Set<Weekday>(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])
const QUESTION_TYPES = new Set<Question['type']>(['text', 'textarea', 'select'])
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/
const KEY_RE = /^[a-z][a-z0-9_]{0,63}$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export interface EventTypeAdminUpdate {
  title: string
  description: string | null
  durationMin: number
  slotStepMin: number
  bufferBeforeMin: number
  bufferAfterMin: number
  minNoticeHours: number
  maxDaysAhead: number
  maxBookingsPerDay: number | null
  hours: WeeklyHours
  hostTz: string
  questions: Question[]
  requireWorkEmail: boolean
  conferenceProvider: ConferenceProvider
  active: boolean
}

export type AdminValidationResult = {ok: true; value: EventTypeAdminUpdate} | {ok: false; error: string}
export type AdminCreateValidationResult = {ok: true; value: EventTypeAdminUpdate & {slug: string}} | {ok: false; error: string}

function str(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function intInRange(value: unknown, min: number, max: number, label: string): {ok: true; value: number} | {ok: false; error: string} {
  const n = typeof value === 'number' ? value : Number.NaN
  if (!Number.isInteger(n) || n < min || n > max) {
    return {ok: false, error: `${label} must be a whole number between ${min} and ${max}.`}
  }
  return {ok: true, value: n}
}

function minutes(value: string): number | null {
  const match = TIME_RE.exec(value)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function validateHours(value: unknown): {ok: true; value: WeeklyHours} | {ok: false; error: string} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {ok: false, error: 'Hours must be an object keyed by weekday.'}
  }

  const out: WeeklyHours = {}
  for (const [day, ranges] of Object.entries(value)) {
    if (!WEEKDAYS.has(day as Weekday)) return {ok: false, error: `Unknown weekday: ${day}.`}
    if (!Array.isArray(ranges)) return {ok: false, error: `Hours for ${day} must be an array.`}

    const cleanRanges: Array<[string, string]> = []
    for (const range of ranges) {
      if (!Array.isArray(range) || range.length !== 2 || typeof range[0] !== 'string' || typeof range[1] !== 'string') {
        return {ok: false, error: `Each ${day} range must be ["HH:MM","HH:MM"].`}
      }
      const start = minutes(range[0])
      const end = minutes(range[1])
      if (start === null || end === null || start >= end) {
        return {ok: false, error: `Invalid ${day} range: ${range[0]}-${range[1]}.`}
      }
      cleanRanges.push([range[0], range[1]])
    }
    out[day as Weekday] = cleanRanges
  }
  return {ok: true, value: out}
}

function validateQuestions(value: unknown): {ok: true; value: Question[]} | {ok: false; error: string} {
  if (!Array.isArray(value)) return {ok: false, error: 'Questions must be an array.'}
  const seen = new Set<string>()
  const questions: Question[] = []

  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return {ok: false, error: 'Each question must be an object.'}
    const raw = item as Record<string, unknown>
    const key = str(raw.key)
    const label = str(raw.label)
    const type = str(raw.type) as Question['type']
    if (!KEY_RE.test(key)) return {ok: false, error: `Invalid question key: ${key || '(blank)'}.`}
    if (seen.has(key)) return {ok: false, error: `Duplicate question key: ${key}.`}
    if (!label) return {ok: false, error: `Question ${key} needs a label.`}
    if (!QUESTION_TYPES.has(type)) return {ok: false, error: `Question ${key} has an invalid type.`}

    const question: Question = {key, label, type}
    if (typeof raw.required === 'boolean') question.required = raw.required
    if (typeof raw.placeholder === 'string' && raw.placeholder.trim()) question.placeholder = raw.placeholder.trim()
    if (raw.leadField !== undefined) {
      if (raw.leadField !== 'role') return {ok: false, error: `Question ${key} has an unsupported leadField.`}
      question.leadField = 'role'
    }
    if (type === 'select') {
      if (!Array.isArray(raw.options)) return {ok: false, error: `Select question ${key} needs options.`}
      const options = raw.options.map(str).filter(Boolean)
      if (options.length === 0) return {ok: false, error: `Select question ${key} needs at least one option.`}
      if (new Set(options).size !== options.length) return {ok: false, error: `Select question ${key} has duplicate options.`}
      question.options = options
    }
    seen.add(key)
    questions.push(question)
  }

  return {ok: true, value: questions}
}

export function validateEventTypeAdminUpdate(body: Record<string, unknown>): AdminValidationResult {
  const title = str(body.title)
  if (!title) return {ok: false, error: 'Title is required.'}
  if (title.length > 200) return {ok: false, error: 'Title is too long.'}

  const description = str(body.description)
  const hostTz = cleanTimeZone(body.hostTz)
  if (!hostTz) return {ok: false, error: 'Host time zone must be a valid IANA time zone.'}

  const durationMin = intInRange(body.durationMin, 5, 480, 'Duration')
  if (!durationMin.ok) return durationMin
  const slotStepMin = intInRange(body.slotStepMin, 5, 240, 'Slot step')
  if (!slotStepMin.ok) return slotStepMin
  const bufferBeforeMin = intInRange(body.bufferBeforeMin, 0, 480, 'Buffer before')
  if (!bufferBeforeMin.ok) return bufferBeforeMin
  const bufferAfterMin = intInRange(body.bufferAfterMin, 0, 480, 'Buffer after')
  if (!bufferAfterMin.ok) return bufferAfterMin
  const minNoticeHours = intInRange(body.minNoticeHours, 0, 24 * 30, 'Minimum notice')
  if (!minNoticeHours.ok) return minNoticeHours
  const maxDaysAhead = intInRange(body.maxDaysAhead, 1, 90, 'Max days ahead')
  if (!maxDaysAhead.ok) return maxDaysAhead
  const maxBookingsPerDay = body.maxBookingsPerDay == null
    ? {ok: true as const, value: null}
    : intInRange(body.maxBookingsPerDay, 1, 100, 'Max bookings per day')
  if (!maxBookingsPerDay.ok) return maxBookingsPerDay

  const hours = validateHours(body.hours)
  if (!hours.ok) return hours
  const questions = validateQuestions(body.questions)
  if (!questions.ok) return questions

  const requireWorkEmail = bool(body.requireWorkEmail)
  if (requireWorkEmail === null) return {ok: false, error: 'requireWorkEmail must be boolean.'}
  const active = bool(body.active)
  if (active === null) return {ok: false, error: 'active must be boolean.'}
  const conferenceProvider = body.conferenceProvider
  if (conferenceProvider !== 'google_meet' && conferenceProvider !== 'zoom') {
    return {ok: false, error: 'Conference provider must be google_meet or zoom.'}
  }

  return {
    ok: true,
    value: {
      title,
      description: description || null,
      durationMin: durationMin.value,
      slotStepMin: slotStepMin.value,
      bufferBeforeMin: bufferBeforeMin.value,
      bufferAfterMin: bufferAfterMin.value,
      minNoticeHours: minNoticeHours.value,
      maxDaysAhead: maxDaysAhead.value,
      maxBookingsPerDay: maxBookingsPerDay.value,
      hours: hours.value,
      hostTz,
      questions: questions.value,
      requireWorkEmail,
      conferenceProvider,
      active,
    },
  }
}

export function validateEventTypeAdminCreate(body: Record<string, unknown>): AdminCreateValidationResult {
  const slug = str(body.slug)
  if (['admin', 'manage'].includes(slug)) return {ok: false, error: 'That slug is reserved.'}
  if (slug.length > 80 || !SLUG_RE.test(slug)) {
    return {ok: false, error: 'Slug must be lowercase letters, numbers, and single hyphens (up to 80 characters).'}
  }
  if (slug === 'admin' || slug === 'manage') {
    return {ok: false, error: 'That slug is reserved.'}
  }
  const parsed = validateEventTypeAdminUpdate(body)
  if (!parsed.ok) return parsed
  return {ok: true, value: {...parsed.value, slug}}
}

export function validateAvailabilityOverride(body: Record<string, unknown>) {
  const date = str(body.date)
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    return {ok: false as const, error: 'Date must be a valid YYYY-MM-DD date.'}
  }
  const hours = validateHours({mon: body.hours})
  if (!hours.ok) return hours
  return {ok: true as const, value: {date, hours: hours.value.mon ?? []}}
}

export function schedulerAdminAuthorized(request: NextRequest): boolean {
  const secret = process.env.SCHEDULER_ADMIN_TOKEN
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') || '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
