'use client'

import {useEffect, useState} from 'react'
import {FiArrowLeft, FiVideo} from 'react-icons/fi'
import SlotPicker from './SlotPicker'
import {PROVIDER_LABEL} from './Scheduler'
import {detectTimeZone, rangeLabel} from './time'

/**
 * The page behind the cancel / reschedule links in the calendar invite.
 * The server page has already resolved the token to a booking summary; this
 * component runs the two actions.
 */

export interface ManageSummary {
  title: string
  startsAt: string
  endsAt: string
  status: 'pending' | 'confirmed' | 'cancelled' | 'rescheduled'
  joinUrl: string | null
  conferenceProvider: 'google_meet' | 'zoom'
  maxDaysAhead: number
  started: boolean
}

type Mode = 'overview' | 'reschedule' | 'confirm-cancel' | 'cancelled' | 'rescheduled'

export default function ManageBooking({
  token,
  summary,
  initialAction,
}: {
  token: string
  summary: ManageSummary
  initialAction?: 'cancel' | 'reschedule'
}) {
  const changeable = summary.status === 'confirmed' && !summary.started
  const [mode, setMode] = useState<Mode>(
    !changeable ? 'overview' : initialAction === 'cancel' ? 'confirm-cancel' : initialAction === 'reschedule' ? 'reschedule' : 'overview',
  )
  const [timeZone, setTimeZone] = useState('UTC')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [current, setCurrent] = useState({startsAt: summary.startsAt, endsAt: summary.endsAt})

  useEffect(() => setTimeZone(detectTimeZone()), [])

  async function post(path: string, body: Record<string, unknown>) {
    setBusy(true)
    setError('')
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({token, ...body}),
      })
      const json = await res.json().catch(() => ({}))
      return {ok: res.ok && json.ok, json}
    } catch {
      return {ok: false, json: {error: 'Network error. Please try again.'}}
    } finally {
      setBusy(false)
    }
  }

  async function doCancel() {
    const {ok, json} = await post('/api/scheduler/cancel', {})
    if (ok) setMode('cancelled')
    else setError(json.error || 'Something went wrong. Please try again.')
  }

  async function doReschedule(slot: string) {
    if (busy) return
    const {ok, json} = await post('/api/scheduler/reschedule', {start: slot, tz: timeZone})
    if (ok) {
      setCurrent({startsAt: json.booking.startsAt, endsAt: json.booking.endsAt})
      setMode('rescheduled')
      return
    }
    if (json.code === 'slot_taken') {
      setNotice(json.error || 'That time was just taken. Please pick another.')
      setRefreshKey((n) => n + 1)
      return
    }
    setError(json.error || 'Something went wrong. Please try again.')
  }

  const when = rangeLabel(current.startsAt, current.endsAt, timeZone)

  return (
    <div className="lb-scheduler lb-scheduler--manage">
      <div className="card lb-scheduler__manage-card">
        <p className="eyebrow">
          {mode === 'cancelled' || summary.status === 'cancelled'
            ? 'Cancelled'
            : mode === 'rescheduled'
              ? 'Rescheduled'
              : summary.status === 'rescheduled'
                ? 'Moved'
                : 'Your meeting'}
        </p>
        <h2 className="headline-md">{summary.title}</h2>
        <p className="lb-scheduler__done-when">{when}</p>
        <p className="lb-form__hint">{timeZone.replace(/_/g, ' ')}</p>

        {mode === 'cancelled' && <p className="lead">Cancelled. We’ve let the host know and removed the invite.</p>}
        {mode === 'rescheduled' && (
          <p className="lead">Done. An updated invite is on its way, with new links to change it again.</p>
        )}
        {mode !== 'cancelled' && mode !== 'rescheduled' && summary.status === 'rescheduled' && (
          <p className="lead">This meeting was moved. Use the links in the most recent invite.</p>
        )}
        {mode !== 'cancelled' && summary.status === 'cancelled' && <p className="lead">This meeting was cancelled.</p>}
        {summary.status === 'confirmed' && summary.started && (
          <p className="lead">This meeting has already started, so it can no longer be changed.</p>
        )}

        {changeable && mode === 'overview' && (
          <>
            <div className="lb-scheduler__actions">
              {summary.joinUrl && (
                <a className="btn btn--primary" href={summary.joinUrl} target="_blank" rel="noopener noreferrer">
                  <FiVideo aria-hidden="true" />
                  Join with {PROVIDER_LABEL[summary.conferenceProvider]}
                </a>
              )}
              <button type="button" className="btn btn--secondary" onClick={() => setMode('reschedule')}>
                Reschedule
              </button>
              <button type="button" className="btn btn--secondary btn--danger" onClick={() => setMode('confirm-cancel')}>
                Cancel meeting
              </button>
            </div>
          </>
        )}

        {changeable && mode === 'confirm-cancel' && (
          <div className="lb-scheduler__actions">
            <button type="button" className="btn btn--danger-solid" onClick={doCancel} disabled={busy}>
              {busy ? 'Cancelling…' : 'Yes, cancel this meeting'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setMode('overview')} disabled={busy}>
              Keep it
            </button>
          </div>
        )}

        {error && (
          <p className="lb-form__error" role="alert">
            {error}
          </p>
        )}
      </div>

      {changeable && mode === 'reschedule' && (
        <>
          <div className="lb-scheduler__manage-bar">
            <p className="meta meta--upper">{busy ? 'Moving your meeting…' : 'Pick a new time'}</p>
            <button type="button" className="lb-scheduler__link" onClick={() => setMode('overview')}>
              <FiArrowLeft aria-hidden="true" />
              Back
            </button>
          </div>
          <SlotPicker
            token={token}
            maxDaysAhead={summary.maxDaysAhead}
            timeZone={timeZone}
            onTimeZoneChange={setTimeZone}
            onPick={doReschedule}
            refreshKey={refreshKey}
            notice={notice}
          />
        </>
      )}
    </div>
  )
}
