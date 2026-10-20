'use client'

import {useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent} from 'react'
import {
  addMonths,
  compareMonths,
  dateKey,
  longDateLabel,
  monthFetchRange,
  monthGrid,
  monthLabel,
  monthOf,
  timeLabel,
  timeZoneList,
  weekdayHeaders,
  zoneName,
  type Month,
} from './time'
import {FiChevronLeft, FiChevronRight} from 'react-icons/fi'

/**
 * Month calendar + slot list. Shared by booking and rescheduling: give it
 * either an event type slug or a manage token and it fetches open slots for
 * the visible month, grouped by day in the visitor's zone.
 */

interface SlotPickerProps {
  /** Event type slug (booking) … */
  type?: string
  /** … or a manage token (rescheduling). */
  token?: string
  maxDaysAhead: number
  timeZone: string
  onTimeZoneChange: (tz: string) => void
  onPick: (slot: string) => void
  /** Bump to force a refetch, e.g. after a slot was taken. */
  refreshKey?: number
  /** A message above the slot list, e.g. "That time was just taken". */
  notice?: string
}

type Load = {state: 'loading'} | {state: 'error'; message: string} | {state: 'ready'; slots: string[]}

export default function SlotPicker({
  type,
  token,
  maxDaysAhead,
  timeZone,
  onTimeZoneChange,
  onPick,
  refreshKey = 0,
  notice,
}: SlotPickerProps) {
  const todayKey = dateKey(Date.now(), timeZone)
  const firstMonth = monthOf(todayKey)
  const lastMonth = monthOf(dateKey(Date.now() + maxDaysAhead * 86_400_000, timeZone))

  const [month, setMonth] = useState<Month>(firstMonth)
  const [load, setLoad] = useState<Load>({state: 'loading'})
  const [selectedDay, setSelectedDay] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  const gridRef = useRef<HTMLDivElement>(null)
  const autoAdvanced = useRef(false)

  useEffect(() => {
    let cancelled = false
    setLoad({state: 'loading'})
    const {from, to} = monthFetchRange(month)
    const params = new URLSearchParams({from, to, ...(token ? {token} : {type: type || ''})})
    fetch(`/api/scheduler/slots?${params}`, {cache: 'no-store'})
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok || !json.ok) {
          setLoad({state: 'error', message: json.error || 'We couldn’t load available times.'})
          return
        }
        setLoad({state: 'ready', slots: json.slots as string[]})
      })
      .catch(() => {
        if (!cancelled) setLoad({state: 'error', message: 'Network error. Please try again.'})
      })
    return () => {
      cancelled = true
    }
  }, [month, type, token, refreshKey, retry])

  /** Slots grouped by "YYYY-MM-DD" in the visitor's zone, this month only. */
  const byDay = useMemo(() => {
    const map = new Map<string, string[]>()
    if (load.state !== 'ready') return map
    const prefix = `${month.year}-${String(month.month + 1).padStart(2, '0')}-`
    for (const slot of load.slots) {
      const key = dateKey(slot, timeZone)
      if (!key.startsWith(prefix)) continue
      const list = map.get(key)
      if (list) list.push(slot)
      else map.set(key, [slot])
    }
    return map
  }, [load, month, timeZone])

  const availableDays = useMemo(() => [...byDay.keys()].sort(), [byDay])

  // Keep a valid selection: default to the first open day of the month.
  useEffect(() => {
    if (load.state !== 'ready') return
    if (selectedDay && byDay.has(selectedDay)) return
    setSelectedDay(availableDays[0] ?? null)
  }, [load.state, byDay, availableDays, selectedDay])

  // An empty first month (late in the month, or fully booked) jumps ahead once.
  useEffect(() => {
    if (load.state !== 'ready' || autoAdvanced.current) return
    autoAdvanced.current = true
    if (availableDays.length === 0 && compareMonths(month, lastMonth) < 0) setMonth(addMonths(month, 1))
  }, [load.state, availableDays.length, month, lastMonth])

  const canPrev = compareMonths(month, firstMonth) > 0
  const canNext = compareMonths(month, lastMonth) < 0
  const zones = useMemo(() => timeZoneList(timeZone), [timeZone])
  const headers = useMemo(() => weekdayHeaders(), [])

  const onGridKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const steps: Record<string, number> = {ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7}
      const step = steps[e.key]
      if (!step || !gridRef.current) return
      const buttons = [...gridRef.current.querySelectorAll<HTMLButtonElement>('button[data-day]')]
      const index = buttons.findIndex((b) => b === document.activeElement)
      if (index === -1) return
      e.preventDefault()
      for (let i = index + step; i >= 0 && i < buttons.length; i += Math.sign(step)) {
        if (!buttons[i].disabled) {
          buttons[i].focus()
          return
        }
        if (Math.abs(step) === 7) break
      }
    },
    [],
  )

  const daySlots = selectedDay ? byDay.get(selectedDay) ?? [] : []

  return (
    <div className="lb-scheduler__picker">
      <div className="lb-scheduler__calendar">
        <div className="lb-scheduler__month">
          <button
            type="button"
            className="lb-scheduler__nav"
            onClick={() => setMonth(addMonths(month, -1))}
            disabled={!canPrev}
            aria-label="Previous month"
          >
            <FiChevronLeft aria-hidden="true" />
          </button>
          <p className="lb-scheduler__month-label" aria-live="polite">
            {monthLabel(month)}
          </p>
          <button
            type="button"
            className="lb-scheduler__nav"
            onClick={() => setMonth(addMonths(month, 1))}
            disabled={!canNext}
            aria-label="Next month"
          >
            <FiChevronRight aria-hidden="true" />
          </button>
        </div>

        <div className="lb-scheduler__grid" ref={gridRef} onKeyDown={onGridKeyDown} role="group" aria-label="Choose a day">
          {headers.map((h) => (
            <span className="lb-scheduler__weekday" key={h} aria-hidden="true">
              {h}
            </span>
          ))}
          {monthGrid(month).map((day, i) =>
            day ? (
              <button
                type="button"
                key={day}
                data-day={day}
                className={`lb-scheduler__day${day === selectedDay ? ' is-selected' : ''}${day === todayKey ? ' is-today' : ''}`}
                disabled={!byDay.has(day)}
                aria-pressed={day === selectedDay}
                aria-label={`${longDateLabel(`${day}T12:00:00Z`, 'UTC')}${byDay.has(day) ? '' : ', no times available'}`}
                onClick={() => setSelectedDay(day)}
              >
                {Number(day.slice(8))}
              </button>
            ) : (
              <span key={`pad-${i}`} aria-hidden="true" />
            ),
          )}
        </div>

        <div className="lb-form__field lb-scheduler__tz">
          <label htmlFor="lb-scheduler-tz">Time zone</label>
          <select id="lb-scheduler-tz" value={timeZone} onChange={(e) => onTimeZoneChange(e.target.value)}>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <p className="lb-form__hint">{zoneName(timeZone)}</p>
        </div>
      </div>

      <div className="lb-scheduler__slots">
        {notice && (
          <p className="lb-form__error" role="alert">
            {notice}
          </p>
        )}

        {load.state === 'loading' && (
          <div className="lb-scheduler__skeleton" role="status">
            <span className="visually-hidden">Loading available times…</span>
            <span aria-hidden="true" />
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </div>
        )}

        {load.state === 'error' && (
          <div className="lb-scheduler__status" role="alert">
            <p className="lb-form__error">{load.message}</p>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setRetry((n) => n + 1)}>
              Try again
            </button>
          </div>
        )}

        {load.state === 'ready' && availableDays.length === 0 && (
          <div className="lb-scheduler__status" role="status">
            <p>No times left in {monthLabel(month)}.</p>
            {canNext && (
              <button type="button" className="lb-scheduler__link" onClick={() => setMonth(addMonths(month, 1))}>
                See {monthLabel(addMonths(month, 1))} →
              </button>
            )}
          </div>
        )}

        {load.state === 'ready' && selectedDay && daySlots.length > 0 && (
          <>
            <p className="lb-scheduler__day-label">{longDateLabel(daySlots[0], timeZone)}</p>
            <ul className="lb-scheduler__slot-list" aria-label={`Times on ${longDateLabel(daySlots[0], timeZone)}`}>
              {daySlots.map((slot) => (
                <li key={slot}>
                  <button type="button" className="lb-scheduler__slot" onClick={() => onPick(slot)}>
                    {timeLabel(slot, timeZone)}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
