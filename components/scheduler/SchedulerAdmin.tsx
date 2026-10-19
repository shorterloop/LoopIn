'use client'

import {useEffect, useMemo, useState, type ChangeEvent, type FormEvent} from 'react'
import type {EventType, Question, WeeklyHours} from '@/lib/scheduler/types'
import DateHoursEditor from './DateHoursEditor'
import QuestionsEditor from './QuestionsEditor'
import WeeklyHoursEditor from './WeeklyHoursEditor'
import styles from './SchedulerAdmin.module.css'

type LoadState = 'idle' | 'loading' | 'ready' | 'saving'

interface FormState {
  title: string
  description: string
  durationMin: number
  slotStepMin: number
  bufferBeforeMin: number
  bufferAfterMin: number
  minNoticeHours: number
  maxDaysAhead: number
  maxBookingsPerDay: number | null
  hostTz: string
  requireWorkEmail: boolean
  active: boolean
  conferenceProvider: EventType['conferenceProvider']
  hoursText: string
  questionsText: string
}

const STORAGE_KEY = 'scheduler-admin-token'
const NEW_ID = '__new__'

const newForm: FormState = {
  title: '',
  description: '',
  durationMin: 30,
  slotStepMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  minNoticeHours: 12,
  maxDaysAhead: 30,
  maxBookingsPerDay: null,
  hostTz: 'Europe/Amsterdam',
  requireWorkEmail: true,
  active: false,
  conferenceProvider: 'google_meet',
  hoursText: pretty({mon: [['09:00', '17:00']], tue: [['09:00', '17:00']], wed: [['09:00', '17:00']], thu: [['09:00', '17:00']], fri: [['09:00', '17:00']]}),
  questionsText: '[]',
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function formFromEventType(eventType: EventType): FormState {
  return {
    title: eventType.title,
    description: eventType.description ?? '',
    durationMin: eventType.durationMin,
    slotStepMin: eventType.slotStepMin,
    bufferBeforeMin: eventType.bufferBeforeMin,
    bufferAfterMin: eventType.bufferAfterMin,
    minNoticeHours: eventType.minNoticeHours,
    maxDaysAhead: eventType.maxDaysAhead,
    maxBookingsPerDay: eventType.maxBookingsPerDay,
    hostTz: eventType.hostTz,
    requireWorkEmail: eventType.requireWorkEmail,
    active: eventType.active,
    conferenceProvider: eventType.conferenceProvider,
    hoursText: pretty(eventType.hours),
    questionsText: pretty(eventType.questions),
  }
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`${label} is not valid JSON.`)
  }
}

function editableJson<T>(text: string, valid: (value: unknown) => boolean): T | null {
  try {
    const value: unknown = JSON.parse(text)
    return valid(value) ? value as T : null
  } catch { return null }
}

function editableHoursValue(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.values(value).every((ranges) => Array.isArray(ranges) && ranges.every((range) =>
      Array.isArray(range) && range.length === 2 && range.every((time: unknown) => typeof time === 'string'))))
}

function editableQuestionsValue(value: unknown): boolean {
  return Array.isArray(value) && value.every((question) =>
    question && typeof question === 'object' && typeof question.key === 'string' &&
    typeof question.label === 'string' && ['text', 'textarea', 'select'].includes(question.type))
}

function numberValue(value: string): number {
  return Number.parseInt(value, 10)
}

export default function SchedulerAdmin() {
  const [token, setToken] = useState('')
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [overrides, setOverrides] = useState<Array<{date: string; hours: Array<[string, string]>}>>([])
  const [overrideDate, setOverrideDate] = useState('')
  const [overrideHours, setOverrideHours] = useState('[]')
  const [form, setForm] = useState<FormState | null>(null)
  const [state, setState] = useState<LoadState>('idle')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [calendarMode, setCalendarMode] = useState<'environment' | 'database' | 'none' | null>(null)
  const [calendarId, setCalendarId] = useState('')
  const [calendarHealthy, setCalendarHealthy] = useState(false)
  const [connectingGoogle, setConnectingGoogle] = useState(false)

  const selected = useMemo(() => eventTypes.find((eventType) => eventType.id === selectedId) ?? null, [eventTypes, selectedId])
  const isCreating = selectedId === NEW_ID
  const editableHours = editableJson<WeeklyHours>(form?.hoursText ?? '', editableHoursValue)
  const editableQuestions = editableJson<Question[]>(form?.questionsText ?? '', editableQuestionsValue)
  const editableOverrideHours = editableJson<Array<[string, string]>>(overrideHours, (value) =>
    Array.isArray(value) && value.every((range) => Array.isArray(range) && range.length === 2 && range.every((time) => typeof time === 'string')))

  useEffect(() => {
    const saved = window.sessionStorage.getItem(STORAGE_KEY)
    if (saved) setToken(saved)
    const result = new URLSearchParams(window.location.search).get('calendar')
    if (result === 'connected') setMessage('Google Calendar connected. Load event types to refresh its status.')
    if (result === 'denied') setError('Google Calendar connection was not authorized. Try Connect Google again.')
    if (result === 'error') setError('Google Calendar connection failed. Check the server logs for the OAuth callback error, and verify the client credentials, redirect URI and encryption key.')
  }, [])

  useEffect(() => {
    if (selected) setForm(formFromEventType(selected))
  }, [selected])

  useEffect(() => {
    if (!selected || !token) return
    let cancelled = false
    fetch(`/api/scheduler/admin/event-types/${selected.id}/overrides`, {
      headers: {Authorization: `Bearer ${token}`}, cache: 'no-store',
    }).then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok) setOverrides(json.overrides)
    }).catch(() => { if (!cancelled) setOverrides([]) })
    return () => { cancelled = true }
  }, [selected, token])

  async function load(nextToken = token) {
    if (!nextToken.trim()) {
      setError('Enter the scheduler admin token.')
      return
    }
    setState('loading')
    setError('')
    setMessage('')
    try {
      const res = await fetch('/api/scheduler/admin/event-types', {
        headers: {Authorization: `Bearer ${nextToken.trim()}`},
        cache: 'no-store',
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(res.status === 401 ? 'Token rejected or SCHEDULER_ADMIN_TOKEN is not configured.' : json.error || 'Could not load event types.')
        return
      }
      const rows = json.eventTypes as EventType[]
      window.sessionStorage.setItem(STORAGE_KEY, nextToken.trim())
      setToken(nextToken.trim())
      setEventTypes(rows)
      setSelectedId((current) => (current === NEW_ID || rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ''))
      setMessage(`Loaded ${rows.length} event type${rows.length === 1 ? '' : 's'}.`)
      const calendarRes = await fetch('/api/scheduler/admin/google', {
        headers: {Authorization: `Bearer ${nextToken.trim()}`}, cache: 'no-store',
      }).catch(() => null)
      const calendarJson = await calendarRes?.json().catch(() => ({}))
      if (calendarRes?.ok && calendarJson?.ok) {
        setCalendarMode(calendarJson.mode)
        setCalendarId(calendarJson.calendarId)
        setCalendarHealthy(calendarJson.healthy)
      } else {
        setCalendarMode(null)
        setError(calendarJson?.error || 'Could not load Google Calendar status. Check the server logs and database migrations.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load event types.')
    } finally {
      setState('idle')
    }
  }

  async function connectGoogle() {
    if (connectingGoogle) return
    setConnectingGoogle(true)
    setError('')
    try {
      const res = await fetch('/api/scheduler/admin/google/connect', {
        method: 'POST', headers: {Authorization: `Bearer ${token.trim()}`},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(res.status === 401 ? 'Admin token rejected. Reload event types with the configured admin token.' : json.error || 'Could not start Google connection.')
      if (typeof json.url !== 'string') throw new Error('Google connection did not return an authorization URL.')
      window.location.assign(json.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Google connection.')
      setConnectingGoogle(false)
    }
  }

  async function disconnectGoogle() {
    if (!window.confirm('Disconnect Google Calendar? Existing bookings will no longer sync until a calendar is connected.')) return
    setError('')
    try {
      const res = await fetch('/api/scheduler/admin/google', {
        method: 'DELETE', headers: {Authorization: `Bearer ${token.trim()}`},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(json.error || 'Could not disconnect Google Calendar.')
      setCalendarMode('none')
      setCalendarHealthy(false)
      setMessage('Google Calendar disconnected.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not disconnect Google Calendar.')
    }
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => (current ? {...current, [key]: value} : current))
  }

  function onNumber(key: keyof Pick<FormState, 'durationMin' | 'slotStepMin' | 'bufferBeforeMin' | 'bufferAfterMin' | 'minNoticeHours' | 'maxDaysAhead'>) {
    return (event: ChangeEvent<HTMLInputElement>) => setField(key, numberValue(event.target.value))
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if ((!selected && !isCreating) || !form) return
    setState('saving')
    setError('')
    setMessage('')

    let hours: unknown
    let questions: unknown
    try {
      hours = parseJson(form.hoursText, 'Hours')
      questions = parseJson(form.questionsText, 'Questions')
    } catch (err) {
      setState('idle')
      setError(err instanceof Error ? err.message : 'Invalid JSON.')
      return
    }

    try {
      const res = await fetch(isCreating ? '/api/scheduler/admin/event-types' : `/api/scheduler/admin/event-types/${selected!.id}`, {
        method: isCreating ? 'POST' : 'PATCH',
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token.trim()}`},
        body: JSON.stringify({
          ...(isCreating ? {slug: newSlug} : {}),
          title: form.title,
          description: form.description,
          durationMin: form.durationMin,
          slotStepMin: form.slotStepMin,
          bufferBeforeMin: form.bufferBeforeMin,
          bufferAfterMin: form.bufferAfterMin,
          minNoticeHours: form.minNoticeHours,
          maxDaysAhead: form.maxDaysAhead,
          maxBookingsPerDay: form.maxBookingsPerDay,
          hostTz: form.hostTz,
          requireWorkEmail: form.requireWorkEmail,
          active: form.active,
          conferenceProvider: form.conferenceProvider,
          hours,
          questions,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(json.error || 'Could not save event type.')
        return
      }
      const updated = json.eventType as EventType
      setEventTypes((rows) => isCreating ? [...rows, updated].sort((a, b) => a.slug.localeCompare(b.slug)) : rows.map((row) => (row.id === updated.id ? updated : row)))
      setSelectedId(updated.id)
      setMessage(isCreating ? 'Event type created.' : 'Saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save event type.')
    } finally {
      setState('idle')
    }
  }

  async function saveOverride(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected) return
    let hours: unknown
    try { hours = parseJson(overrideHours, 'Override hours') }
    catch (err) { setError(err instanceof Error ? err.message : 'Invalid JSON.'); return }
    setError('')
    const res = await fetch(`/api/scheduler/admin/event-types/${selected.id}/overrides`, {
      method: 'PUT',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
      body: JSON.stringify({date: overrideDate, hours}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok || !json.ok) { setError(json.error || 'Could not save override.'); return }
    setOverrides((rows) => [...rows.filter((row) => row.date !== overrideDate), {date: overrideDate, hours: hours as Array<[string, string]>}].sort((a, b) => a.date.localeCompare(b.date)))
    setOverrideDate('')
    setOverrideHours('[]')
    setMessage('Date override saved.')
  }

  async function removeOverride(date: string) {
    if (!selected) return
    setError('')
    const res = await fetch(`/api/scheduler/admin/event-types/${selected.id}/overrides?date=${date}`, {
      method: 'DELETE', headers: {Authorization: `Bearer ${token}`},
    })
    if (!res.ok) { setError('Could not remove override.'); return }
    setOverrides((rows) => rows.filter((row) => row.date !== date))
    setMessage('Date override removed.')
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <nav><a href="/">Home</a><a href="/scheduler/admin/configuration">Configuration & embeds</a></nav>
        <header className={styles.header}>
          <div>
            <p className={styles.eyebrow}>Internal scheduler</p>
            <h1 className={styles.title}>Event types</h1>
            <p className={styles.lead}>
              Manage meeting types, booking rules, availability, and questions.
            </p>
          </div>
          <a className="btn btn--secondary" href="/scheduler/admin/bookings">
            Bookings
          </a>
        </header>

        <section className={styles.tokenBox} aria-label="Admin token">
          <label className={styles.field}>
            <span>Admin token</span>
            <div className={styles.tokenRow}>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                autoComplete="current-password"
                placeholder="SCHEDULER_ADMIN_TOKEN"
              />
              <button className="btn btn--primary" type="button" onClick={() => load()} disabled={state === 'loading'}>
                {state === 'loading' ? 'Loading...' : 'Load event types'}
              </button>
            </div>
          </label>
        </section>

        {error && <p className={`${styles.status} ${styles.error}`} role="alert">{error}</p>}
        {message && <p className={styles.status} role="status">{message}</p>}

        {calendarMode && <section className={styles.connection} aria-label="Google Calendar connection">
          <div><strong>Google Calendar</strong><p>{calendarMode === 'none' ? 'Not connected' : `${calendarHealthy ? 'Ready' : 'Connection needs attention'} · ${calendarMode} · ${calendarId}`}</p></div>
          {calendarMode === 'none' && <button className="btn btn--secondary" type="button" onClick={connectGoogle} disabled={connectingGoogle}>{connectingGoogle ? 'Connecting?' : 'Connect Google'}</button>}
          {calendarMode === 'database' && <button className="btn btn--secondary" type="button" onClick={disconnectGoogle}>Disconnect</button>}
        </section>}

        <section className={styles.grid}>
          <aside className={styles.panel} aria-label="Event types">
            <button className="btn btn--primary" type="button" onClick={() => { setSelectedId(NEW_ID); setNewSlug(''); setForm({...newForm}); setError(''); setMessage('') }} disabled={state === 'loading'}>
              New event type
            </button>
            {eventTypes.length === 0 ? (
              <p className={styles.empty}>Load event types or create a new one.</p>
            ) : (
              eventTypes.map((eventType) => (
                <button
                  className={`${styles.eventButton} ${eventType.id === selectedId ? styles.eventButtonActive : ''}`}
                  key={eventType.id}
                  type="button"
                  onClick={() => setSelectedId(eventType.id)}
                >
                  {eventType.title}
                  <span className={styles.eventSlug}>
                    {eventType.slug}
                    {eventType.active ? '' : ' - inactive'}
                  </span>
                </button>
              ))
            )}
          </aside>

          <section className={styles.editor} aria-label="Event type editor">
            {(!selected && !isCreating) || !form ? (
              <p className={styles.empty}>No event type selected.</p>
            ) : (
              <>
                <div className={styles.editorHeader}>
                  <div>
                    <h2>{isCreating ? 'New event type' : selected!.title}</h2>
                    {!isCreating && <p className={styles.slug}>{selected!.slug}</p>}
                  </div>
                  {!isCreating && selected!.active && <a className="btn btn--secondary btn--sm" href={`/scheduler/${selected!.slug}`} target="_blank" rel="noreferrer">Open booking page</a>}
                </div>

                <form className={styles.form} onSubmit={save}>
                  {isCreating && <label className={styles.field}>
                    <span>Booking URL slug</span>
                    <input value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="product-demo" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} required />
                  </label>}
                  <div className={styles.row}>
                    <label className={styles.field}>
                      <span>Title</span>
                      <input value={form.title} onChange={(event) => setField('title', event.target.value)} required />
                    </label>
                    <label className={styles.field}>
                      <span>Host time zone</span>
                      <input value={form.hostTz} onChange={(event) => setField('hostTz', event.target.value)} required />
                    </label>
                  </div>

                  <label className={styles.field}>
                    <span>Description</span>
                    <input value={form.description} onChange={(event) => setField('description', event.target.value)} />
                  </label>

                  <div className={styles.numberGrid}>
                    <label className={styles.field}>
                      <span>Duration</span>
                      <input type="number" min={5} max={480} value={form.durationMin} onChange={onNumber('durationMin')} />
                    </label>
                    <label className={styles.field}>
                      <span>Slot step</span>
                      <input type="number" min={5} max={240} value={form.slotStepMin} onChange={onNumber('slotStepMin')} />
                    </label>
                    <label className={styles.field}>
                      <span>Buffer before</span>
                      <input type="number" min={0} max={480} value={form.bufferBeforeMin} onChange={onNumber('bufferBeforeMin')} />
                    </label>
                    <label className={styles.field}>
                      <span>Buffer after</span>
                      <input type="number" min={0} max={480} value={form.bufferAfterMin} onChange={onNumber('bufferAfterMin')} />
                    </label>
                    <label className={styles.field}>
                      <span>Min notice hours</span>
                      <input type="number" min={0} max={720} value={form.minNoticeHours} onChange={onNumber('minNoticeHours')} />
                    </label>
                    <label className={styles.field}>
                      <span>Max days ahead</span>
                      <input type="number" min={1} max={90} value={form.maxDaysAhead} onChange={onNumber('maxDaysAhead')} />
                    </label>
                    <label className={styles.field}>
                      <span>Max bookings per day</span>
                      <input type="number" min={1} max={100} value={form.maxBookingsPerDay ?? ''} onChange={(event) => setField('maxBookingsPerDay', event.target.value ? numberValue(event.target.value) : null)} placeholder="No limit" />
                    </label>
                    <label className={styles.field}>
                      <span>Conference</span>
                      <select
                        value={form.conferenceProvider}
                        onChange={(event) => setField('conferenceProvider', event.target.value as EventType['conferenceProvider'])}
                      >
                        <option value="google_meet">Google Meet</option>
                        <option value="zoom">Zoom</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.checkRow}>
                    <label>
                      <input
                        type="checkbox"
                        checked={form.requireWorkEmail}
                        onChange={(event) => setField('requireWorkEmail', event.target.checked)}
                      />
                      Require work email
                    </label>
                    <label>
                      <input type="checkbox" checked={form.active} onChange={(event) => setField('active', event.target.checked)} />
                      Active
                    </label>
                  </div>

                  <section className={styles.formSection} aria-label="Weekly hours">
                    <h3>Weekly hours</h3>
                    {editableHours && <WeeklyHoursEditor value={editableHours} onChange={(hours) => setField('hoursText', pretty(hours))} />}
                    <details><summary>Advanced JSON</summary><textarea value={form.hoursText} onChange={(event) => setField('hoursText', event.target.value)} spellCheck={false} /></details>
                  </section>

                  <section className={styles.formSection} aria-label="Questions">
                    <h3>Questions</h3>
                    {editableQuestions && <QuestionsEditor value={editableQuestions} onChange={(questions) => setField('questionsText', pretty(questions))} />}
                    <details><summary>Advanced JSON</summary><textarea value={form.questionsText} onChange={(event) => setField('questionsText', event.target.value)} spellCheck={false} /></details>
                  </section>

                  <div className={styles.actions}>
                    <button className="btn btn--primary" type="submit" disabled={state === 'saving'}>
                      {state === 'saving' ? 'Saving...' : isCreating ? 'Create event type' : 'Save changes'}
                    </button>
                    <button className="btn btn--secondary" type="button" onClick={() => setForm(isCreating ? {...newForm} : formFromEventType(selected!))}>
                      Reset
                    </button>
                  </div>
                </form>
                {!isCreating && <section className={styles.overrides} aria-label="Date overrides">
                  <h3>Date overrides</h3>
                  <div className={styles.overrideList}>
                    {overrides.map((override) => <div className={styles.overrideItem} key={override.date}>
                      <span>{override.date} · {override.hours.length === 0 ? 'Closed' : override.hours.map((range) => range.join('-')).join(', ')}</span>
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setOverrideDate(override.date); setOverrideHours(pretty(override.hours)) }}>Edit</button>
                      <button className="btn btn--ghost btn--sm" type="button" onClick={() => removeOverride(override.date)}>Remove</button>
                    </div>)}
                    {overrides.length === 0 && <p className={styles.empty}>No upcoming overrides.</p>}
                  </div>
                  <form className={styles.overrideForm} onSubmit={saveOverride}>
                    <label className={styles.field}><span>Date</span><input type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} required /></label>
                    <div className={styles.overrideHours}>
                      {editableOverrideHours && <DateHoursEditor value={editableOverrideHours} onChange={(hours) => setOverrideHours(pretty(hours))} />}
                      <details><summary>Advanced JSON</summary><textarea value={overrideHours} onChange={(event) => setOverrideHours(event.target.value)} spellCheck={false} /></details>
                    </div>
                    <button className="btn btn--secondary" type="submit">Save date</button>
                  </form>
                </section>}
              </>
            )}
          </section>
        </section>
      </div>
    </main>
  )
}
