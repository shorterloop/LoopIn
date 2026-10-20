'use client'

import {useEffect, useState, type FormEvent, type ReactNode} from 'react'
import {useRouter} from 'next/navigation'
import {FiCalendar, FiCheck, FiClock, FiGlobe, FiVideo} from 'react-icons/fi'
import SlotPicker from './SlotPicker'
import Turnstile, {TURNSTILE_SITE_KEY} from './Turnstile'
import {detectTimeZone, rangeLabel, timeLabel, longDateLabel} from './time'

/** Public booking flow shared by standalone and embedded pages. */

interface Question {
  key: string
  label: string
  type: 'text' | 'textarea' | 'select'
  required?: boolean
  placeholder?: string
  options?: string[]
  leadField?: 'role'
}

interface EventTypeInfo {
  slug: string
  title: string
  description: string | null
  durationMin: number
  maxDaysAhead: number
  questions: Question[]
  requireWorkEmail: boolean
  conferenceProvider: 'google_meet' | 'zoom'
}

export interface BookedSummary {
  id: string
  title: string
  startsAt: string
  endsAt: string
  joinUrl: string | null
  conferenceProvider: 'google_meet' | 'zoom'
}

interface SchedulerProps {
  eventType: string
  /** Resolved href of the after-booking page, or null for inline confirmation. */
  redirectHref?: string | null
  /** Small print under the form, already rendered (rich text). */
  footnote?: ReactNode
}

export const PROVIDER_LABEL = {google_meet: 'Google Meet', zoom: 'Zoom'} as const

function utmFromUrl(): Record<string, string> {
  const params = new URLSearchParams(window.location.search)
  const out: Record<string, string> = {}
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const v = params.get(key)
    if (v) out[key] = v
  }
  return out
}

export default function Scheduler({eventType: slug, redirectHref, footnote}: SchedulerProps) {
  const router = useRouter()
  const [info, setInfo] = useState<EventTypeInfo | null>(null)
  const [infoError, setInfoError] = useState('')
  const [timeZone, setTimeZone] = useState('UTC')
  const [slot, setSlot] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)
  const [status, setStatus] = useState<'idle' | 'submitting' | 'redirecting'>('idle')
  const [error, setError] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [captchaReset, setCaptchaReset] = useState(0)
  const [booked, setBooked] = useState<(BookedSummary & {email: string}) | null>(null)

  useEffect(() => setTimeZone(detectTimeZone()), [])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/scheduler/event-types/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (cancelled) return
        if (res.ok && json.ok) setInfo(json.eventType)
        else setInfoError(json.error || 'This scheduler is unavailable.')
      })
      .catch(() => !cancelled && setInfoError('Network error. Please reload the page.'))
    return () => {
      cancelled = true
    }
  }, [slug])

  function pick(next: string) {
    setNotice('')
    setError('')
    setSlot(next)
  }

  function backToSlots(message = '') {
    setSlot(null)
    setNotice(message)
    if (message) setRefreshKey((n) => n + 1)
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!info || !slot || status !== 'idle') return
    if (TURNSTILE_SITE_KEY && !captcha) {
      setError('Please complete the verification below.')
      return
    }
    setStatus('submitting')
    setError('')

    const data = new FormData(e.currentTarget)
    const answers: Record<string, string> = {}
    for (const q of info.questions) answers[q.key] = String(data.get(`q-${q.key}`) || '')

    try {
      const res = await fetch('/api/scheduler/book', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          type: info.slug,
          start: slot,
          name: data.get('name'),
          email: data.get('email'),
          company: data.get('company'),
          website: data.get('website'),
          answers,
          tz: timeZone,
          utm: utmFromUrl(),
          turnstileToken: captcha,
        }),
      })
      const json = await res.json().catch(() => ({}))

      if (res.ok && json.ok && json.booking) {
        const booking = json.booking as BookedSummary
        if (redirectHref) {
          setStatus('redirecting')
          if (/^https?:\/\//i.test(redirectHref)) {
            // Off-site: no booking id in the URL — it would leak to a third party.
            window.location.assign(redirectHref)
          } else {
            const url = new URL(redirectHref, window.location.origin)
            url.searchParams.set('b', booking.id)
            router.push(`${url.pathname}${url.search}${url.hash}`)
          }
          return
        }
        setBooked({...booking, email: String(data.get('email') || '')})
        setStatus('idle')
        return
      }

      setStatus('idle')
      setCaptchaReset((n) => n + 1)
      if (json.code === 'slot_taken') {
        backToSlots(json.error || 'That time was just taken. Please pick another.')
        return
      }
      setError(json.error || 'Something went wrong. Please try again.')
    } catch {
      setStatus('idle')
      setCaptchaReset((n) => n + 1)
      setError('Network error. Please try again.')
    }
  }

  if (infoError) {
    return (
      <div className="lb-scheduler lb-scheduler--single">
        <div className="lb-scheduler__main">
          <p className="lb-form__error" role="alert">
            {infoError}
          </p>
        </div>
      </div>
    )
  }

  if (!info) {
    return (
      <div className="lb-scheduler" aria-busy="true">
        <div className="lb-scheduler__summary">
          <div className="lb-scheduler__skeleton" aria-hidden="true">
            <span style={{width: '70%'}} />
            <span style={{width: '45%', height: 20}} />
            <span style={{width: '55%', height: 20}} />
          </div>
        </div>
        <div className="lb-scheduler__main">
          <p className="visually-hidden" role="status">
            Loading scheduler…
          </p>
          <div className="lb-scheduler__skeleton" aria-hidden="true">
            <span style={{height: 280}} />
          </div>
        </div>
      </div>
    )
  }

  if (booked) {
    return (
      <div className="lb-scheduler lb-scheduler--single">
        <div className="lb-form__success lb-scheduler__done" role="status">
          <div className="lb-form__success-mark" aria-hidden="true">
            <FiCheck />
          </div>
          <h2 className="headline-md">You’re booked</h2>
          <p className="meta">{booked.title}</p>
          <p className="lb-scheduler__done-when">{rangeLabel(booked.startsAt, booked.endsAt, timeZone)}</p>
          <p className="lb-form__hint">{timeZone.replace(/_/g, ' ')}</p>
          {booked.joinUrl && (
            <div className="lb-scheduler__actions">
              <a className="btn btn--primary" href={booked.joinUrl} target="_blank" rel="noopener noreferrer">
                <FiVideo aria-hidden="true" />
                Join with {PROVIDER_LABEL[booked.conferenceProvider]}
              </a>
            </div>
          )}
          <p className="lead">
            A calendar invite is on its way to <strong>{booked.email}</strong>. It has links to reschedule or cancel
            if plans change.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="lb-scheduler">
      <aside className="lb-scheduler__summary">
        <h1 className="lb-scheduler__title">{info.title}</h1>
        <ul className="lb-scheduler__facts">
          <li>
            <FiClock aria-hidden="true" />
            {info.durationMin} min
          </li>
          <li>
            <FiVideo aria-hidden="true" />
            {PROVIDER_LABEL[info.conferenceProvider]}
          </li>
          {slot && (
            <li>
              <FiCalendar aria-hidden="true" />
              <span>
                {timeLabel(slot, timeZone)}, {longDateLabel(slot, timeZone)}
              </span>
            </li>
          )}
          <li>
            <FiGlobe aria-hidden="true" />
            {timeZone.replace(/_/g, ' ')}
          </li>
        </ul>
        {info.description && <p className="lb-scheduler__description">{info.description}</p>}
      </aside>

      <section className="lb-scheduler__main">
        {!slot ? (
          <>
            <h2 className="lb-scheduler__step-title">Select a date & time</h2>
            <SlotPicker
              type={info.slug}
              maxDaysAhead={info.maxDaysAhead}
              timeZone={timeZone}
              onTimeZoneChange={setTimeZone}
              onPick={pick}
              refreshKey={refreshKey}
              notice={notice}
            />
          </>
        ) : (
          <form className="lb-form lb-scheduler__form" onSubmit={submit} noValidate>
            <h2 className="lb-scheduler__step-title">Enter your details</h2>
            <div className="lb-scheduler__chosen">
              <p>
                <strong>{longDateLabel(slot, timeZone)}</strong>
                <br />
                {timeLabel(slot, timeZone)} · {info.durationMin} min · {timeZone.replace(/_/g, ' ')}
              </p>
              <button type="button" className="lb-scheduler__link" onClick={() => backToSlots()}>
                Change
              </button>
            </div>

            <div className="lb-form__hp" aria-hidden="true">
              <label htmlFor="sch-website">Website</label>
              <input type="text" id="sch-website" name="website" tabIndex={-1} autoComplete="off" />
            </div>

            <div className="lb-form__field">
              <label htmlFor="sch-name">
                Name
                <Required />
              </label>
              <input id="sch-name" name="name" type="text" required autoComplete="name" maxLength={200} />
            </div>

            <div className="lb-form__row">
              <div className="lb-form__field">
                <label htmlFor="sch-email">
                  {info.requireWorkEmail ? 'Work email' : 'Email'}
                  <Required />
                </label>
                <input
                  id="sch-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  maxLength={200}
                  placeholder="you@company.com"
                />
              </div>
              <div className="lb-form__field">
                <label htmlFor="sch-company">
                  Company
                  <Required />
                </label>
                <input id="sch-company" name="company" type="text" required autoComplete="organization" maxLength={200} />
              </div>
            </div>

            {info.questions.map((q) => (
              <div className="lb-form__field" key={q.key}>
                <label htmlFor={`sch-q-${q.key}`}>
                  {q.label}
                  {q.required && <Required />}
                </label>
                {q.type === 'textarea' ? (
                  <textarea
                    id={`sch-q-${q.key}`}
                    name={`q-${q.key}`}
                    rows={4}
                    required={q.required}
                    maxLength={5000}
                    placeholder={q.placeholder}
                  />
                ) : q.type === 'select' ? (
                  <select id={`sch-q-${q.key}`} name={`q-${q.key}`} required={q.required} defaultValue="">
                    <option value="" disabled>
                      Select one
                    </option>
                    {(q.options ?? []).map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`sch-q-${q.key}`}
                    name={`q-${q.key}`}
                    type="text"
                    required={q.required}
                    maxLength={5000}
                    placeholder={q.placeholder}
                  />
                )}
              </div>
            ))}

            <Turnstile onToken={setCaptcha} resetKey={captchaReset} />

            {error && (
              <p className="lb-form__error" role="alert">
                {error}
              </p>
            )}

            <div>
              <button type="submit" className="btn btn--primary" disabled={status !== 'idle'}>
                {status === 'idle' ? 'Book meeting' : status === 'submitting' ? 'Booking…' : 'Booked — redirecting…'}
              </button>
              <div className="lb-form__fineprint">
                {footnote}
                <p>
                  By booking you agree to our{' '}
                  <a className="link-ember" href="/privacy-policy" target="_blank" rel="noopener noreferrer">
                    booking privacy information
                  </a>
                  .
                </p>
              </div>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}

/** Visual marker only; the input's `required` attribute carries the meaning. */
function Required() {
  return (
    <span className="lb-form__required" aria-hidden="true">
      *
    </span>
  )
}
