'use client'

import {useEffect, useState, type ReactNode} from 'react'
import {detectTimeZone, rangeLabel} from './time'
import {PROVIDER_LABEL} from './Scheduler'

/**
 * Booking details on a thank-you page. Reads `?b=<booking id>` — which the
 * scheduler appends when it redirects here — and shows the meeting time in
 * the visitor's zone with the join link. Opened without a booking (or with a
 * stale one), it shows `fallback` instead.
 */

interface Confirmation {
  title: string
  startsAt: string
  endsAt: string
  status: 'confirmed' | 'cancelled' | 'rescheduled'
  joinUrl: string | null
  conferenceProvider: 'google_meet' | 'zoom'
}

type State = {state: 'loading'} | {state: 'none'} | {state: 'ready'; booking: Confirmation}

export default function BookingConfirmation({fallback}: {fallback?: ReactNode}) {
  const [load, setLoad] = useState<State>({state: 'loading'})
  const [timeZone, setTimeZone] = useState('UTC')

  useEffect(() => {
    setTimeZone(detectTimeZone())
    const id = new URLSearchParams(window.location.search).get('b')
    if (!id) {
      setLoad({state: 'none'})
      return
    }
    let cancelled = false
    fetch(`/api/scheduler/confirmation?b=${encodeURIComponent(id)}`, {cache: 'no-store'})
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        setLoad(res.ok && json.ok ? {state: 'ready', booking: json.booking} : {state: 'none'})
      })
      .catch(() => !cancelled && setLoad({state: 'none'}))
    return () => {
      cancelled = true
    }
  }, [])

  if (load.state === 'loading') return <div className="lb-booking-confirmation" aria-busy="true" />
  if (load.state === 'none') return fallback ? <div className="lb-booking-confirmation">{fallback}</div> : null

  const {booking} = load
  return (
    <div className="lb-booking-confirmation card" role="status">
      <p className="eyebrow">{booking.status === 'confirmed' ? 'Confirmed' : 'No longer scheduled'}</p>
      <h3>{booking.title}</h3>
      <p className="lb-scheduler__done-when">{rangeLabel(booking.startsAt, booking.endsAt, timeZone)}</p>
      <p className="lb-form__hint">{timeZone.replace(/_/g, ' ')}</p>
      {booking.status === 'confirmed' && booking.joinUrl && (
        <p>
          <a className="btn btn--primary btn--sm" href={booking.joinUrl} target="_blank" rel="noopener noreferrer">
            Join with {PROVIDER_LABEL[booking.conferenceProvider]}
          </a>
        </p>
      )}
      {booking.status === 'confirmed' && (
        <p className="lb-form__hint">The calendar invite in your inbox has links to reschedule or cancel.</p>
      )}
    </div>
  )
}
