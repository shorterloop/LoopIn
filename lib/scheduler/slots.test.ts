import {describe, expect, it} from 'vitest'
import {DateTime} from 'luxon'
import {bookingWindow, candidateSlots, isOpenSlot, openSlots} from './slots'

const TZ = 'Europe/Amsterdam'
const WEEKDAY = [['09:00', '12:00'], ['13:00', '17:00']] as Array<[string, string]>

const rules = {
  hours: {mon: WEEKDAY, tue: WEEKDAY, wed: WEEKDAY, thu: WEEKDAY, fri: WEEKDAY},
  hostTz: TZ,
  durationMin: 30,
  slotStepMin: 30,
  minNoticeHours: 12,
  maxDaysAhead: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
}

const at = (iso: string) => DateTime.fromISO(iso, {zone: TZ}).toMillis()
const local = (ms: number) => DateTime.fromMillis(ms, {zone: TZ}).toFormat('ccc HH:mm')

describe('candidateSlots', () => {
  it('expands working hours in the host zone, stepping by slot_step_min', () => {
    // Tue 13 Oct 2026
    const slots = candidateSlots(rules, at('2026-10-13T00:00'), at('2026-10-14T00:00'))
    expect(slots.map(local)).toEqual([
      'Tue 09:00', 'Tue 09:30', 'Tue 10:00', 'Tue 10:30', 'Tue 11:00', 'Tue 11:30',
      'Tue 13:00', 'Tue 13:30', 'Tue 14:00', 'Tue 14:30', 'Tue 15:00', 'Tue 15:30', 'Tue 16:00', 'Tue 16:30',
    ])
  })

  it('never lets a meeting run past the end of a range', () => {
    const slots = candidateSlots({...rules, durationMin: 45}, at('2026-10-13T00:00'), at('2026-10-14T00:00'))
    expect(slots.map(local)).not.toContain('Tue 11:30')
    expect(slots.map(local)).toContain('Tue 11:00')
    expect(slots.map(local)).not.toContain('Tue 16:30')
  })

  it('offers nothing at the weekend', () => {
    expect(candidateSlots(rules, at('2026-10-17T00:00'), at('2026-10-19T00:00'))).toEqual([])
  })

  it('replaces weekly hours with date-specific openings or closures', () => {
    const from = at('2026-10-13T00:00')
    const to = at('2026-10-14T00:00')
    expect(candidateSlots(rules, from, to, {'2026-10-13': []})).toEqual([])
    expect(candidateSlots(rules, from, to, {'2026-10-13': [['18:00', '19:00']]}).map(local)).toEqual(['Tue 18:00', 'Tue 18:30'])
  })

  it('keeps 09:00 Amsterdam at 09:00 across the 25 Oct 2026 DST change', () => {
    const before = candidateSlots(rules, at('2026-10-23T00:00'), at('2026-10-24T00:00'))[0]
    const after = candidateSlots(rules, at('2026-10-26T00:00'), at('2026-10-27T00:00'))[0]
    expect(local(before)).toBe('Fri 09:00')
    expect(local(after)).toBe('Mon 09:00')
    // CEST (UTC+2) before, CET (UTC+1) after — the UTC hour shifts, the local hour doesn't.
    expect(new Date(before).toISOString()).toBe('2026-10-23T07:00:00.000Z')
    expect(new Date(after).toISOString()).toBe('2026-10-26T08:00:00.000Z')
  })

  it('handles the March change too', () => {
    const first = candidateSlots(rules, at('2027-03-29T00:00'), at('2027-03-30T00:00'))[0]
    expect(new Date(first).toISOString()).toBe('2027-03-29T07:00:00.000Z')
  })
})

describe('openSlots', () => {
  const now = new Date(at('2026-10-12T08:00')) // Mon 08:00

  it('drops slots inside the minimum notice', () => {
    const slots = openSlots(rules, {from: at('2026-10-12T00:00'), to: at('2026-10-14T00:00'), now, busy: []})
    // 12h after Mon 08:00 is Mon 20:00 — nothing left on Monday.
    expect(slots.map(local).some((s) => s.startsWith('Mon'))).toBe(false)
    expect(local(slots[0])).toBe('Tue 09:00')
  })

  it('drops slots beyond max_days_ahead', () => {
    const window = bookingWindow(rules, now)
    const slots = openSlots(rules, {from: now.getTime(), to: now.getTime() + 60 * 86_400_000, now, busy: []})
    expect(Math.max(...slots)).toBeLessThan(window.end)
    expect(DateTime.fromMillis(Math.max(...slots), {zone: TZ}).toISODate()).toBe('2026-11-11')
  })

  it('drops slots overlapping a busy interval, including the buffer after', () => {
    const busy = [{start: at('2026-10-13T10:00'), end: at('2026-10-13T11:00')}]
    const slots = openSlots(rules, {from: at('2026-10-13T00:00'), to: at('2026-10-14T00:00'), now, busy}).map(local)
    expect(slots).not.toContain('Tue 10:00')
    expect(slots).not.toContain('Tue 10:30')
    // 09:30–10:00 plus a 10 min buffer runs into the 10:00 meeting.
    expect(slots).not.toContain('Tue 09:30')
    expect(slots).toContain('Tue 09:00')
    expect(slots).toContain('Tue 11:00')
  })

  it('treats touching intervals as free', () => {
    const busy = [{start: at('2026-10-13T12:00'), end: at('2026-10-13T13:00')}]
    const slots = openSlots({...rules, bufferAfterMin: 0}, {from: at('2026-10-13T00:00'), to: at('2026-10-14T00:00'), now, busy}).map(local)
    expect(slots).toContain('Tue 11:30')
    expect(slots).toContain('Tue 13:00')
  })

  it('hides a host-local day once its booking limit is reached', () => {
    const slots = openSlots({...rules, maxBookingsPerDay: 2}, {
      from: at('2026-10-13T00:00'), to: at('2026-10-15T00:00'), now,
      busy: [], bookingsByDay: {'2026-10-13': 2},
    }).map(local)
    expect(slots.some((slot) => slot.startsWith('Tue'))).toBe(false)
    expect(slots.some((slot) => slot.startsWith('Wed'))).toBe(true)
  })
})

describe('isOpenSlot', () => {
  const now = new Date(at('2026-10-12T08:00'))

  it('accepts an exact open slot', () => {
    expect(isOpenSlot(rules, at('2026-10-13T09:00'), {now, busy: []})).toBe(true)
  })

  it('rejects a time off the slot grid', () => {
    expect(isOpenSlot(rules, at('2026-10-13T09:10'), {now, busy: []})).toBe(false)
  })

  it('rejects a busy slot', () => {
    const busy = [{start: at('2026-10-13T09:00'), end: at('2026-10-13T09:30')}]
    expect(isOpenSlot(rules, at('2026-10-13T09:00'), {now, busy})).toBe(false)
  })

  it('rejects a slot outside working hours', () => {
    expect(isOpenSlot(rules, at('2026-10-13T12:00'), {now, busy: []})).toBe(false)
  })
})
