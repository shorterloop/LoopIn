'use client'

import {Fragment, useEffect, useMemo, useState} from 'react'
import {FiChevronDown, FiRefreshCw} from 'react-icons/fi'
import {Notice, PageHeader, useAdmin} from '../admin/AdminShell'
import styles from './SchedulerBookings.module.css'

interface AdminBooking {
  id: string
  eventTitle: string
  attendeeName: string
  attendeeEmail: string
  company: string
  startsAt: string
  endsAt: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'rescheduled'
  answers: Record<string, string>
  utm: Record<string, string>
  sourcePage: string | null
  joinUrl: string | null
  delivery: 'not_configured' | 'pending' | 'failed' | 'delivered'
}

type Filter = 'upcoming' | 'past' | 'cancelled' | 'all'

const FILTERS: Array<[Filter, string]> = [['upcoming', 'Upcoming'], ['past', 'Past'], ['cancelled', 'Cancelled'], ['all', 'All']]

const STATUS: Record<AdminBooking['status'], [string, string]> = {
  confirmed: ['Confirmed', 'badge--ok'],
  pending: ['Pending', 'badge--warn'],
  cancelled: ['Cancelled', 'badge--error'],
  rescheduled: ['Rescheduled', ''],
}

const DELIVERY: Record<AdminBooking['delivery'], [string, string]> = {
  delivered: ['Delivered', 'badge--ok'],
  pending: ['Pending', 'badge--warn'],
  failed: ['Failed', 'badge--error'],
  not_configured: ['Off', ''],
}

function todayLocal(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

function matches(booking: AdminBooking, filter: Filter, now: number): boolean {
  const upcoming = new Date(booking.endsAt).getTime() > now
  const live = booking.status === 'confirmed' || booking.status === 'pending'
  if (filter === 'upcoming') return live && upcoming
  if (filter === 'past') return live && !upcoming
  if (filter === 'cancelled') return booking.status === 'cancelled' || booking.status === 'rescheduled'
  return true
}

const dayFormat = new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric'})
const timeFormat = new Intl.DateTimeFormat(undefined, {hour: 'numeric', minute: '2-digit'})

export default function SchedulerBookings() {
  const {token, signOut} = useAdmin()
  const [bookings, setBookings] = useState<AdminBooking[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('upcoming')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<string[]>([])
  const [hostTz, setHostTz] = useState('')
  const [selectedStart, setSelectedStart] = useState('')
  const [slotBusy, setSlotBusy] = useState(false)
  const [webhookConfigured, setWebhookConfigured] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => {
    void load()
    // Load once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  const now = Date.now()
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([key]) => [key, bookings.filter((b) => matches(b, key, now)).length])) as Record<Filter, number>, [bookings, now])
  const visible = useMemo(() => {
    const rows = bookings.filter((b) => matches(b, filter, now))
    return filter === 'past' ? [...rows].reverse() : rows
  }, [bookings, filter, now])

  async function load() {
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/scheduler/admin/bookings', {
        headers: {Authorization: `Bearer ${token}`}, cache: 'no-store',
      })
      if (res.status === 401) {
        signOut('Your session has expired. Sign in again.')
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not load bookings.')
      setBookings(json.bookings)
      setWebhookConfigured(Boolean(json.webhookConfigured))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bookings.')
    } finally {
      setBusy(false)
      setLoaded(true)
    }
  }

  async function retrySync() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/scheduler/admin/integrations/retry', {
        method: 'POST', headers: {Authorization: `Bearer ${token}`},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not retry sync.')
      setNotice(`Webhook retry: ${json.report.delivered} delivered, ${json.report.failed} failed.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not retry sync.')
    } finally {
      setBusy(false)
    }
  }

  async function cancel(booking: AdminBooking) {
    if (!window.confirm(`Cancel ${booking.eventTitle} with ${booking.attendeeName}? The calendar invite will be removed.`)) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/scheduler/admin/bookings/${booking.id}/cancel`, {
        method: 'POST', headers: {Authorization: `Bearer ${token}`},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not cancel booking.')
      setBookings((rows) => rows.map((row) => row.id === booking.id ? {...row, status: 'cancelled'} : row))
      setNotice(`Cancelled ${booking.eventTitle} with ${booking.attendeeName}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not cancel booking.')
    } finally {
      setBusy(false)
    }
  }

  async function loadSlots(booking: AdminBooking, selectedDate: string) {
    setDate(selectedDate)
    setSlots([])
    setSelectedStart('')
    setSlotBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/scheduler/admin/bookings/${booking.id}/slots?date=${selectedDate}`, {
        headers: {Authorization: `Bearer ${token}`}, cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not load available times.')
      setSlots(json.slots)
      setHostTz(json.hostTz)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load available times.')
    } finally {
      setSlotBusy(false)
    }
  }

  async function moveBooking(booking: AdminBooking) {
    if (!selectedStart) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch(`/api/scheduler/admin/bookings/${booking.id}/reschedule`, {
        method: 'POST',
        headers: {Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({start: selectedStart}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not reschedule booking.')
      setEditingId(null)
      setNotice(`Moved ${booking.eventTitle} with ${booking.attendeeName}. An updated invite was sent.`)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reschedule booking.')
    } finally {
      setBusy(false)
    }
  }

  const columns = webhookConfigured ? 6 : 5

  return (
    <>
      <PageHeader
        title="Bookings"
        description="Meetings from the last 30 days onward."
        actions={
          <>
            {webhookConfigured && (
              <button className="btn btn--secondary" type="button" onClick={() => void retrySync()} disabled={busy}>
                Retry webhooks
              </button>
            )}
            <button className="btn btn--secondary" type="button" onClick={() => void load()} disabled={busy}>
              <FiRefreshCw aria-hidden="true" />
              {busy ? 'Refreshing…' : 'Refresh'}
            </button>
          </>
        }
      />

      {error && <Notice tone="error" onDismiss={() => setError('')}>{error}</Notice>}
      {notice && <Notice tone="ok" onDismiss={() => setNotice('')}>{notice}</Notice>}

      <div className={styles.tabs} role="tablist" aria-label="Filter bookings">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={filter === key}
            className={styles.tab}
            onClick={() => setFilter(key)}
          >
            {label}
            <span className={styles.count}>{counts[key]}</span>
          </button>
        ))}
      </div>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Attendee</th>
              <th scope="col">Meeting</th>
              <th scope="col">Status</th>
              {webhookConfigured && <th scope="col">Webhook</th>}
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {visible.map((booking) => {
              const start = new Date(booking.startsAt)
              const changeable = booking.status === 'confirmed' && start.getTime() > now
              const hasDetails = Object.keys(booking.answers).length > 0 || Object.keys(booking.utm).length > 0 || Boolean(booking.sourcePage)
              const [statusLabel, statusClass] = STATUS[booking.status]
              const [deliveryLabel, deliveryClass] = DELIVERY[booking.delivery]
              return (
                <Fragment key={booking.id}>
                  <tr className={booking.status === 'cancelled' || booking.status === 'rescheduled' ? styles.inactive : undefined}>
                    <td>
                      <time dateTime={booking.startsAt} className={styles.when}>
                        <strong>{dayFormat.format(start)}</strong>
                        <span>{timeFormat.format(start)} – {timeFormat.format(new Date(booking.endsAt))}</span>
                      </time>
                    </td>
                    <td>
                      <div className={styles.person}>
                        <strong>{booking.attendeeName}</strong>
                        <a href={`mailto:${booking.attendeeEmail}`}>{booking.attendeeEmail}</a>
                        <span>{booking.company}</span>
                      </div>
                    </td>
                    <td>
                      <div className={styles.person}>
                        <strong>{booking.eventTitle}</strong>
                        {hasDetails && (
                          <button
                            type="button"
                            className={styles.detailsToggle}
                            aria-expanded={openId === booking.id}
                            onClick={() => setOpenId(openId === booking.id ? null : booking.id)}
                          >
                            Details
                            <FiChevronDown aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td><span className={`badge ${statusClass}`}>{statusLabel}</span></td>
                    {webhookConfigured && <td><span className={`badge ${deliveryClass}`}>{deliveryLabel}</span></td>}
                    <td>
                      <div className={styles.actions}>
                        {booking.joinUrl && booking.status === 'confirmed' && (
                          <a className="btn btn--ghost btn--sm" href={booking.joinUrl} target="_blank" rel="noopener noreferrer">Join</a>
                        )}
                        {changeable && (
                          <>
                            <button className="btn btn--secondary btn--sm" type="button" onClick={() => { setEditingId(booking.id); void loadSlots(booking, todayLocal()) }} disabled={busy}>Reschedule</button>
                            <button className="btn btn--secondary btn--sm btn--danger" type="button" onClick={() => cancel(booking)} disabled={busy}>Cancel</button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  {openId === booking.id && (
                    <tr className={styles.subRow}>
                      <td colSpan={columns}>
                        <dl className={styles.details}>
                          {Object.entries(booking.answers).map(([key, value]) => (
                            <div key={key}><dt>{key}</dt><dd>{value || '—'}</dd></div>
                          ))}
                          {Object.keys(booking.utm).length > 0 && (
                            <div><dt>UTM</dt><dd>{Object.entries(booking.utm).map(([key, value]) => `${key}=${value}`).join(', ')}</dd></div>
                          )}
                          {booking.sourcePage && <div><dt>Source</dt><dd>{booking.sourcePage}</dd></div>}
                        </dl>
                      </td>
                    </tr>
                  )}
                  {editingId === booking.id && (
                    <tr className={styles.subRow}>
                      <td colSpan={columns}>
                        <div className={styles.reschedule}>
                          <label className={styles.field}>
                            <span>New date</span>
                            <input className="input" type="date" value={date} onChange={(event) => void loadSlots(booking, event.target.value)} />
                          </label>
                          <label className={styles.field}>
                            <span>Available time {hostTz && `(${hostTz.replace(/_/g, ' ')})`}</span>
                            <select className="input" value={selectedStart} onChange={(event) => setSelectedStart(event.target.value)} disabled={slotBusy || slots.length === 0}>
                              <option value="">{slotBusy ? 'Loading…' : slots.length === 0 ? 'No openings' : 'Select a time'}</option>
                              {slots.map((slot) => <option key={slot} value={slot}>{new Intl.DateTimeFormat(undefined, {timeZone: hostTz, hour: 'numeric', minute: '2-digit'}).format(new Date(slot))}</option>)}
                            </select>
                          </label>
                          <div className={styles.actions}>
                            <button className="btn btn--primary btn--sm" type="button" onClick={() => void moveBooking(booking)} disabled={busy || !selectedStart}>Move booking</button>
                            <button className="btn btn--ghost btn--sm" type="button" onClick={() => setEditingId(null)}>Close</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
        {loaded && visible.length === 0 && (
          <p className={styles.empty}>
            {filter === 'upcoming' ? 'No upcoming meetings. Share a booking link to get started.' : 'Nothing here yet.'}
          </p>
        )}
        {!loaded && <p className={styles.empty}>Loading bookings…</p>}
      </div>
    </>
  )
}
