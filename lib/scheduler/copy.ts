import {DateTime} from 'luxon'
import {SITE_URL} from '../siteUrl'
import type {EventType} from './types'

/** `<Company> : <Event title>` — the calendar event title the spec fixes. */
export function eventSummary(company: string, eventType: Pick<EventType, 'title'>): string {
  return `${company} : ${eventType.title}`
}

/** Absolute manage-page URL. `action` focuses the page on one option. */
export function manageUrl(token: string, action?: 'cancel' | 'reschedule'): string {
  return `${SITE_URL}/scheduler/manage/${token}${action ? `?action=${action}` : ''}`
}

/** "Tue 13 Oct 2026, 14:30 CEST" in the given zone. */
export function formatWhen(date: Date, timeZone: string): string {
  return DateTime.fromJSDate(date, {zone: timeZone}).toFormat("ccc d LLL yyyy, HH:mm ZZZZ")
}

/** Question/answer pairs in the event type's question order. */
export function answerList(
  eventType: Pick<EventType, 'questions'>,
  answers: Record<string, string>,
): Array<{question: string; answer: string}> {
  return eventType.questions
    .filter((q) => answers[q.key])
    .map((q) => ({question: q.label, answer: answers[q.key]}))
}

/**
 * The calendar event description: who, their answers, then the manage links.
 * Plain text — Google renders newlines and autolinks URLs.
 */
export function eventDescription(input: {
  eventType: Pick<EventType, 'questions' | 'description'>
  name: string
  email: string
  company: string
  answers: Record<string, string>
  joinUrl?: string | null
  token: string
}): string {
  const lines = [`${input.name} <${input.email}> · ${input.company}`]
  if (input.joinUrl) lines.push('', `Join: ${input.joinUrl}`)
  for (const {question, answer} of answerList(input.eventType, input.answers)) {
    lines.push('', question, answer)
  }
  lines.push(
    '',
    '—',
    'Need to change this?',
    `Reschedule: ${manageUrl(input.token, 'reschedule')}`,
    `Cancel: ${manageUrl(input.token, 'cancel')}`,
  )
  return lines.join('\n')
}
