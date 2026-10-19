import {DateTime} from 'luxon'
import type {DateOverrides, EventType, Interval, Weekday} from './types'

/**
 * Slot maths — pure, no I/O, so every rule is unit-testable.
 *
 * Open slots = working hours (expanded per date in the host's zone, so 09:00
 * Amsterdam stays 09:00 across a DST change) − slots inside the minimum notice
 * − slots past the booking horizon − slots whose buffered range touches a
 * busy interval.
 */

const WEEKDAYS: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const MINUTE = 60_000

type SlotRules = Pick<
  EventType,
  | 'hours'
  | 'hostTz'
  | 'durationMin'
  | 'slotStepMin'
  | 'minNoticeHours'
  | 'maxDaysAhead'
  | 'bufferBeforeMin'
  | 'bufferAfterMin'
> & {maxBookingsPerDay?: number | null}

/** The earliest and latest instants a slot may start at, given "now". */
export function bookingWindow(rules: SlotRules, now: Date): Interval {
  const start = now.getTime() + rules.minNoticeHours * 60 * MINUTE
  // The horizon is whole days in the host's zone: "30 days ahead" ends at the
  // close of the 30th day, not at this exact minute 30 days on.
  const end = DateTime.fromJSDate(now, {zone: rules.hostTz})
    .startOf('day')
    .plus({days: rules.maxDaysAhead + 1})
    .toMillis()
  return {start, end}
}

function parseHm(value: string): {hour: number; minute: number} | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (hour > 24 || minute > 59 || (hour === 24 && minute !== 0)) return null
  return {hour, minute}
}

/**
 * Every slot start (epoch ms) the working hours allow inside [from, to),
 * before notice/horizon/busy filtering.
 */
export function candidateSlots(rules: SlotRules, from: number, to: number, overrides: DateOverrides = {}): number[] {
  const out: number[] = []
  const durationMs = rules.durationMin * MINUTE
  let day = DateTime.fromMillis(from, {zone: rules.hostTz}).startOf('day')
  const lastDay = DateTime.fromMillis(to, {zone: rules.hostTz}).startOf('day')

  while (day <= lastDay) {
    const weekday = WEEKDAYS[day.weekday - 1]
    const date = day.toISODate()!
    const ranges = Object.hasOwn(overrides, date) ? overrides[date] : rules.hours[weekday] ?? []
    for (const [startHm, endHm] of ranges) {
      const s = parseHm(startHm)
      const e = parseHm(endHm)
      if (!s || !e) continue
      const rangeStart = day.set({hour: s.hour, minute: s.minute, second: 0, millisecond: 0})
      const rangeEnd =
        e.hour === 24 ? day.plus({days: 1}) : day.set({hour: e.hour, minute: e.minute, second: 0, millisecond: 0})
      let t = rangeStart
      while (t.toMillis() + durationMs <= rangeEnd.toMillis()) {
        const ms = t.toMillis()
        if (ms >= from && ms < to) out.push(ms)
        t = t.plus({minutes: rules.slotStepMin})
      }
    }
    day = day.plus({days: 1})
  }
  return out
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end
}

/**
 * Open slot starts (epoch ms, ascending) within [from, to), given the busy
 * intervals already known for that range.
 */
export function openSlots(
  rules: SlotRules,
  {from, to, now, busy, overrides = {}, bookingsByDay = {}}: {
    from: number; to: number; now: Date; busy: Interval[]
    overrides?: DateOverrides; bookingsByDay?: Record<string, number>
  },
): number[] {
  const window = bookingWindow(rules, now)
  const lo = Math.max(from, window.start)
  const hi = Math.min(to, window.end)
  if (lo >= hi) return []

  const durationMs = rules.durationMin * MINUTE
  const before = rules.bufferBeforeMin * MINUTE
  const after = rules.bufferAfterMin * MINUTE
  const sortedBusy = [...busy].sort((a, b) => a.start - b.start)

  return candidateSlots(rules, lo, hi, overrides).filter((start) => {
    const date = DateTime.fromMillis(start, {zone: rules.hostTz}).toISODate()!
    if (rules.maxBookingsPerDay != null && (bookingsByDay[date] ?? 0) >= rules.maxBookingsPerDay) return false
    const blocked = {start: start - before, end: start + durationMs + after}
    return !sortedBusy.some((b) => overlaps(blocked, b))
  })
}

/** Whether `start` is exactly one of the open slots. Used to re-check a booking. */
export function isOpenSlot(
  rules: SlotRules,
  start: number,
  {now, busy, overrides, bookingsByDay}: {
    now: Date; busy: Interval[]; overrides?: DateOverrides; bookingsByDay?: Record<string, number>
  },
): boolean {
  // Look at the slot's own minute only: candidate generation is anchored to the
  // day's working hours, so a slot either lands exactly on `start` or not at all.
  return openSlots(rules, {from: start, to: start + 1, now, busy, overrides, bookingsByDay}).includes(start)
}
