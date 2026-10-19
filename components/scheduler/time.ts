/**
 * Browser-side time helpers for the scheduler. Slots arrive as UTC instants;
 * everything here re-expresses them in the visitor's chosen zone with Intl, so
 * no date library ships to the client.
 */

export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

const FALLBACK_ZONES = [
  'Pacific/Honolulu',
  'America/Anchorage',
  'America/Los_Angeles',
  'America/Denver',
  'America/Chicago',
  'America/New_York',
  'America/Sao_Paulo',
  'UTC',
  'Europe/London',
  'Europe/Amsterdam',
  'Europe/Berlin',
  'Europe/Helsinki',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

export function timeZoneList(current: string): string[] {
  let zones: string[] = FALLBACK_ZONES
  try {
    const supported = (Intl as unknown as {supportedValuesOf?: (key: string) => string[]}).supportedValuesOf
    if (supported) zones = supported('timeZone')
  } catch {
    // keep fallback
  }
  return zones.includes(current) ? zones : [current, ...zones]
}

const keyFormatters = new Map<string, Intl.DateTimeFormat>()

/** "YYYY-MM-DD" of an instant in a zone. */
export function dateKey(instant: string | number | Date, timeZone: string): string {
  let f = keyFormatters.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {timeZone, year: 'numeric', month: '2-digit', day: '2-digit'})
    keyFormatters.set(timeZone, f)
  }
  return f.format(new Date(instant))
}

export function timeLabel(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {timeZone, hour: 'numeric', minute: '2-digit'}).format(new Date(instant))
}

export function longDateLabel(instant: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(instant))
}

/** "Tuesday 13 October, 14:30 – 15:00" */
export function rangeLabel(start: string | Date, end: string | Date, timeZone: string): string {
  return `${longDateLabel(start, timeZone)}, ${timeLabel(start, timeZone)} – ${timeLabel(end, timeZone)}`
}

/** "Central European Summer Time" style name for the zone at a given instant. */
export function zoneName(timeZone: string, at: Date = new Date()): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, {timeZone, timeZoneName: 'long'})
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')
    return part?.value || timeZone
  } catch {
    return timeZone
  }
}

/** A calendar month, independent of zone: year + 0-based month. */
export interface Month {
  year: number
  month: number
}

export function monthOf(key: string): Month {
  const [y, m] = key.split('-').map(Number)
  return {year: y, month: m - 1}
}

export function addMonths({year, month}: Month, n: number): Month {
  const d = new Date(Date.UTC(year, month + n, 1))
  return {year: d.getUTCFullYear(), month: d.getUTCMonth()}
}

export function compareMonths(a: Month, b: Month): number {
  return a.year === b.year ? a.month - b.month : a.year - b.year
}

export function monthLabel({year, month}: Month): string {
  return new Intl.DateTimeFormat(undefined, {month: 'long', year: 'numeric', timeZone: 'UTC'}).format(
    new Date(Date.UTC(year, month, 1)),
  )
}

/**
 * The grid for a month view, Monday first: leading nulls for the days before
 * the 1st, then one "YYYY-MM-DD" per day.
 */
export function monthGrid({year, month}: Month): Array<string | null> {
  const first = new Date(Date.UTC(year, month, 1))
  const lead = (first.getUTCDay() + 6) % 7
  const days = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  const cells: Array<string | null> = Array.from({length: lead}, () => null)
  for (let d = 1; d <= days; d++) {
    cells.push(`${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  }
  return cells
}

export function weekdayHeaders(): string[] {
  // 2024-01-01 was a Monday.
  return Array.from({length: 7}, (_, i) =>
    new Intl.DateTimeFormat(undefined, {weekday: 'short', timeZone: 'UTC'}).format(new Date(Date.UTC(2024, 0, 1 + i))),
  )
}

/**
 * UTC fetch window for a month: a day of padding either side so every slot
 * that falls on one of the month's dates in ANY zone is included.
 */
export function monthFetchRange({year, month}: Month): {from: string; to: string} {
  const DAY = 86_400_000
  return {
    from: new Date(Date.UTC(year, month, 1) - DAY).toISOString(),
    to: new Date(Date.UTC(year, month + 1, 1) + DAY).toISOString(),
  }
}
