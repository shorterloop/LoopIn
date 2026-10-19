'use client'

import {Fragment, useEffect, useState} from 'react'
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

const STORAGE_KEY = 'scheduler-admin-token'

function todayLocal(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export default function SchedulerBookings() {
  const [token, setToken] = useState('')
  const [bookings, setBookings] = useState<AdminBooking[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<string[]>([])
  const [hostTz, setHostTz] = useState('')
  const [selectedStart, setSelectedStart] = useState('')
  const [slotBusy, setSlotBusy] = useState(false)
  const [webhookConfigured, setWebhookConfigured] = useState(false)
  const [notice, setNotice] = useState('')

  useEffect(() => { setToken(window.sessionStorage.getItem(STORAGE_KEY) ?? '') }, [])

  async function load() {
    if (!token.trim()) { setError('Enter the scheduler admin token.'); return }
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/scheduler/admin/bookings', {
        headers: {Authorization: `Bearer ${token.trim()}`}, cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(res.status === 401 ? 'Admin token rejected.' : json.error || 'Could not load bookings.')
      window.sessionStorage.setItem(STORAGE_KEY, token.trim())
      setBookings(json.bookings)
      setWebhookConfigured(Boolean(json.webhookConfigured))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load bookings.')
    } finally {
      setBusy(false)
    }
  }

  async function retrySync() {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch('/api/scheduler/admin/integrations/retry', {
        method: 'POST', headers: {Authorization: `Bearer ${token.trim()}`},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not retry sync.')
      setNotice(`${json.report.delivered} delivered, ${json.report.failed} failed.`)
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
        method: 'POST', headers: {Authorization: `Bearer ${token.trim()}`},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not cancel booking.')
      setBookings((rows) => rows.map((row) => row.id === booking.id ? {...row, status: 'cancelled'} : row))
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
        headers: {Authorization: `Bearer ${token.trim()}`}, cache: 'no-store',
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
        headers: {Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json'},
        body: JSON.stringify({start: selectedStart}),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not reschedule booking.')
      setEditingId(null)
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reschedule booking.')
    } finally {
      setBusy(false)
    }
  }

  return <main className={styles.page}>
    <div className={styles.shell}>
      <nav><a href="/">Home</a><a href="/scheduler/admin/configuration">Configuration & embeds</a></nav>
        <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Internal scheduler</p>
          <h1>Bookings</h1>
        </div>
        <div className={styles.actions}>
          {webhookConfigured && <button className="btn btn--secondary" type="button" onClick={() => void retrySync()} disabled={busy}>Retry sync</button>}
          <a className="btn btn--secondary" href="/scheduler/admin">Event types</a>
        </div>
      </header>
      <div className={styles.controls}>
        <label className={styles.field}>
          <span>Admin token</span>
          <input type="password" value={token} onChange={(event) => setToken(event.target.value)} autoComplete="current-password" />
        </label>
        <button className="btn btn--primary" type="button" onClick={load} disabled={busy}>{busy ? 'Loading...' : 'Load bookings'}</button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead><tr><th>When</th><th>Meeting</th><th>Attendee</th><th>Status</th><th>Sync</th><th>Action</th></tr></thead>
          <tbody>{bookings.map((booking) => <Fragment key={booking.id}>
          <tr>
            <td><time dateTime={booking.startsAt}>{new Date(booking.startsAt).toLocaleString()}</time></td>
            <td><strong>{booking.eventTitle}</strong><details><summary>Details</summary>
              {Object.entries(booking.answers).map(([key, value]) => <p key={key}>{key}: {value}</p>)}
              {Object.keys(booking.utm).length > 0 && <p>UTM: {Object.entries(booking.utm).map(([key, value]) => `${key}=${value}`).join(', ')}</p>}
              {booking.sourcePage && <p>Source: {booking.sourcePage}</p>}
            </details></td>
            <td><a href={`mailto:${booking.attendeeEmail}`}>{booking.attendeeName}</a><small>{booking.company}</small></td>
            <td>{booking.status}</td>
            <td>{booking.delivery.replace('_', ' ')}</td>
            <td>{booking.status === 'confirmed' && new Date(booking.startsAt).getTime() > Date.now() && <div className={styles.actions}>
              <button className="btn btn--secondary btn--sm" type="button" onClick={() => { setEditingId(booking.id); void loadSlots(booking, todayLocal()) }} disabled={busy}>Reschedule</button>
              <button className="btn btn--secondary btn--sm" type="button" onClick={() => cancel(booking)} disabled={busy}>Cancel</button>
            </div>}</td>
          </tr>
          {editingId === booking.id && <tr><td colSpan={6}>
            <div className={styles.reschedule}>
              <label className={styles.field}><span>Date</span><input type="date" value={date} onChange={(event) => void loadSlots(booking, event.target.value)} /></label>
              <label className={styles.field}><span>Available time {hostTz && `(${hostTz})`}</span>
                <select value={selectedStart} onChange={(event) => setSelectedStart(event.target.value)} disabled={slotBusy || slots.length === 0}>
                  <option value="">{slotBusy ? 'Loading...' : slots.length === 0 ? 'No openings' : 'Select a time'}</option>
                  {slots.map((slot) => <option key={slot} value={slot}>{new Intl.DateTimeFormat(undefined, {timeZone: hostTz, hour: 'numeric', minute: '2-digit'}).format(new Date(slot))}</option>)}
                </select>
              </label>
              <button className="btn btn--primary btn--sm" type="button" onClick={() => void moveBooking(booking)} disabled={busy || !selectedStart}>Save new time</button>
              <button className="btn btn--secondary btn--sm" type="button" onClick={() => setEditingId(null)}>Close</button>
            </div>
          </td></tr>}
          </Fragment>)}</tbody>
        </table>
        {bookings.length === 0 && <p className={styles.empty}>Load bookings to see upcoming and recent meetings.</p>}
      </div>
    </div>
  </main>
}
