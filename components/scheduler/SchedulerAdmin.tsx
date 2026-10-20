'use client'

import {useEffect, useMemo, useState, type ChangeEvent, type FormEvent, type ReactNode} from 'react'
import {FiExternalLink, FiPlus} from 'react-icons/fi'
import type {EventType, Question, WeeklyHours} from '@/lib/scheduler/types'
import {Notice, PageHeader, useAdmin} from '../admin/AdminShell'
import DateHoursEditor from './DateHoursEditor'
import QuestionsEditor from './QuestionsEditor'
import WeeklyHoursEditor from './WeeklyHoursEditor'
import {timeZoneList} from './time'
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

const PROVIDER = {google_meet: 'Google Meet', zoom: 'Zoom'} as const

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

function overrideDateLabel(date: string): string {
  return new Intl.DateTimeFormat(undefined, {weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC'})
    .format(new Date(`${date}T12:00:00Z`))
}

export default function SchedulerAdmin() {
  const {token, signOut} = useAdmin()
  const [eventTypes, setEventTypes] = useState<EventType[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [newSlug, setNewSlug] = useState('')
  const [overrides, setOverrides] = useState<Array<{date: string; hours: Array<[string, string]>}>>([])
  const [overrideDate, setOverrideDate] = useState('')
  const [overrideHours, setOverrideHours] = useState('[]')
  const [form, setForm] = useState<FormState | null>(null)
  const [state, setState] = useState<LoadState>('loading')
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
  const zones = useMemo(() => timeZoneList(form?.hostTz || 'UTC'), [form?.hostTz])
  const dirty = Boolean(form && (isCreating || (selected && JSON.stringify(form) !== JSON.stringify(formFromEventType(selected)))))

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('calendar')
    if (result === 'connected') setMessage('Google Calendar connected.')
    if (result === 'denied') setError('Google Calendar connection was not authorized. Try Connect Google again.')
    if (result === 'error') setError('Google Calendar connection failed. Check the server logs for the OAuth callback error, and verify the client credentials, redirect URI and encryption key.')
    void load()
    // Load once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    if (selected) setForm(formFromEventType(selected))
  }, [selected])

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setOverrides([])
    fetch(`/api/scheduler/admin/event-types/${selected.id}/overrides`, {
      headers: {Authorization: `Bearer ${token}`}, cache: 'no-store',
    }).then((res) => res.json()).then((json) => {
      if (!cancelled && json.ok) setOverrides(json.overrides)
    }).catch(() => { if (!cancelled) setOverrides([]) })
    return () => { cancelled = true }
  }, [selected, token])

  async function load() {
    setState('loading')
    try {
      const res = await fetch('/api/scheduler/admin/event-types', {
        headers: {Authorization: `Bearer ${token}`},
        cache: 'no-store',
      })
      if (res.status === 401) {
        signOut('Your session has expired. Sign in again.')
        return
      }
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) {
        setError(json.error || 'Could not load meeting types.')
        return
      }
      const rows = json.eventTypes as EventType[]
      setEventTypes(rows)
      setSelectedId((current) => (current === NEW_ID || rows.some((row) => row.id === current) ? current : rows[0]?.id ?? ''))
      const calendarRes = await fetch('/api/scheduler/admin/google', {
        headers: {Authorization: `Bearer ${token}`}, cache: 'no-store',
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
      setError(err instanceof Error ? err.message : 'Could not load meeting types.')
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
        method: 'POST', headers: {Authorization: `Bearer ${token}`},
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok || !json.ok) throw new Error(res.status === 401 ? 'Admin token rejected. Sign in again.' : json.error || 'Could not start Google connection.')
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
        method: 'DELETE', headers: {Authorization: `Bearer ${token}`},
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

  function startNew() {
    setSelectedId(NEW_ID)
    setNewSlug('')
    setForm({...newForm})
    setError('')
    setMessage('')
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
        headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`},
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
        setError(json.error || 'Could not save meeting type.')
        return
      }
      const updated = json.eventType as EventType
      setEventTypes((rows) => isCreating ? [...rows, updated].sort((a, b) => a.slug.localeCompare(b.slug)) : rows.map((row) => (row.id === updated.id ? updated : row)))
      setSelectedId(updated.id)
      setMessage(isCreating ? 'Meeting type created.' : 'Changes saved.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save meeting type.')
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

  const bookingPath = selected ? `/scheduler/${selected.slug}` : ''

  return (
    <>
      <PageHeader
        title="Meeting types"
        description="Set up what people can book: duration, availability, booking rules and the questions you ask."
        actions={
          <button className="btn btn--primary" type="button" onClick={startNew} disabled={state === 'loading'}>
            <FiPlus aria-hidden="true" />
            New meeting type
          </button>
        }
      />

      {error && <Notice tone="error" onDismiss={() => setError('')}>{error}</Notice>}
      {message && <Notice tone="ok" onDismiss={() => setMessage('')}>{message}</Notice>}

      {calendarMode && (
        <section className={styles.connection} aria-label="Google Calendar connection">
          <span className={styles.connectionIcon} aria-hidden="true">
            <GoogleCalendarIcon />
          </span>
          <div className={styles.connectionText}>
            <strong>Google Calendar</strong>
            <p>
              {calendarMode === 'none'
                ? 'Connect a calendar so availability reflects busy times and bookings create invites.'
                : `${calendarId}${calendarMode === 'environment' ? ' · configured by environment' : ''}`}
            </p>
          </div>
          <span className={`badge ${calendarMode === 'none' ? '' : calendarHealthy ? 'badge--ok' : 'badge--warn'}`}>
            {calendarMode === 'none' ? 'Not connected' : calendarHealthy ? 'Connected' : 'Needs attention'}
          </span>
          {calendarMode === 'none' && (
            <button className="btn btn--primary btn--sm" type="button" onClick={connectGoogle} disabled={connectingGoogle}>
              {connectingGoogle ? 'Connecting…' : 'Connect Google'}
            </button>
          )}
          {calendarMode === 'database' && (
            <button className="btn btn--secondary btn--sm" type="button" onClick={disconnectGoogle}>
              Disconnect
            </button>
          )}
        </section>
      )}

      <div className={styles.grid}>
        <aside className={styles.list} aria-label="Meeting types">
          {state === 'loading' && eventTypes.length === 0 ? (
            <p className={styles.empty}>Loading…</p>
          ) : eventTypes.length === 0 && !isCreating ? (
            <div className={styles.empty}>
              <p>No meeting types yet.</p>
              <button className="btn btn--secondary btn--sm" type="button" onClick={startNew}>
                Create your first
              </button>
            </div>
          ) : (
            <>
              {eventTypes.map((eventType) => (
                <button
                  className={`${styles.listItem} ${eventType.id === selectedId ? styles.listItemActive : ''}`}
                  key={eventType.id}
                  type="button"
                  onClick={() => setSelectedId(eventType.id)}
                  aria-current={eventType.id === selectedId ? 'true' : undefined}
                >
                  <span className={styles.listTitle}>{eventType.title}</span>
                  <span className={styles.listMeta}>
                    {eventType.durationMin} min · {PROVIDER[eventType.conferenceProvider]}
                  </span>
                  <span className={styles.listFoot}>
                    <code>/{eventType.slug}</code>
                    <span className={`badge ${eventType.active ? 'badge--ok' : ''}`}>{eventType.active ? 'Live' : 'Off'}</span>
                  </span>
                </button>
              ))}
              {isCreating && (
                <div className={`${styles.listItem} ${styles.listItemActive}`}>
                  <span className={styles.listTitle}>{form?.title || 'New meeting type'}</span>
                  <span className={styles.listMeta}>Unsaved</span>
                </div>
              )}
            </>
          )}
        </aside>

        <section className={styles.editor} aria-label="Meeting type editor">
          {(!selected && !isCreating) || !form ? (
            state !== 'loading' && <p className={styles.empty}>Select a meeting type to edit it.</p>
          ) : (
            <>
              <form className={styles.form} onSubmit={save}>
                <div className={styles.editorHeader}>
                  <div className={styles.editorTitle}>
                    <h2>{isCreating ? 'New meeting type' : selected!.title}</h2>
                    {!isCreating && (
                      <a href={bookingPath} target="_blank" rel="noreferrer" className={styles.bookingLink}>
                        {bookingPath}
                        <FiExternalLink aria-hidden="true" />
                      </a>
                    )}
                  </div>
                  <label className={styles.switch}>
                    <input type="checkbox" role="switch" checked={form.active} onChange={(event) => setField('active', event.target.checked)} />
                    <span className={styles.switchTrack} aria-hidden="true" />
                    <span>{form.active ? 'Accepting bookings' : 'Not accepting bookings'}</span>
                  </label>
                </div>

                <Section title="Details">
                  <div className={styles.row}>
                    <Field label="Title">
                      <input className="input" value={form.title} onChange={(event) => setField('title', event.target.value)} placeholder="Product demo" required />
                    </Field>
                    {isCreating ? (
                      <Field label="Booking URL" hint="Lowercase letters, numbers and dashes.">
                        <div className={styles.prefixed}>
                          <span>/scheduler/</span>
                          <input className="input" value={newSlug} onChange={(event) => setNewSlug(event.target.value)} placeholder="product-demo" pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={80} required />
                        </div>
                      </Field>
                    ) : (
                      <Field label="Conference">
                        <ConferenceSelect value={form.conferenceProvider} onChange={(value) => setField('conferenceProvider', value)} />
                      </Field>
                    )}
                  </div>
                  <Field label="Description" hint="Shown on the booking page.">
                    <textarea className="input" rows={3} value={form.description} onChange={(event) => setField('description', event.target.value)} />
                  </Field>
                  <div className={styles.row}>
                    <Field label="Host time zone" hint="Weekly hours and overrides use this zone.">
                      <select className="input" value={form.hostTz} onChange={(event) => setField('hostTz', event.target.value)} required>
                        {zones.map((zone) => <option key={zone} value={zone}>{zone.replace(/_/g, ' ')}</option>)}
                      </select>
                    </Field>
                    {isCreating && (
                      <Field label="Conference">
                        <ConferenceSelect value={form.conferenceProvider} onChange={(value) => setField('conferenceProvider', value)} />
                      </Field>
                    )}
                  </div>
                  <label className={styles.check}>
                    <input type="checkbox" checked={form.requireWorkEmail} onChange={(event) => setField('requireWorkEmail', event.target.checked)} />
                    <span>
                      Require a work email
                      <small>Rejects common personal email domains.</small>
                    </span>
                  </label>
                </Section>

                <Section title="Booking rules">
                  <div className={styles.numberGrid}>
                    <NumberField label="Duration" unit="min" min={5} max={480} value={form.durationMin} onChange={onNumber('durationMin')} />
                    <NumberField label="Start times every" unit="min" min={5} max={240} value={form.slotStepMin} onChange={onNumber('slotStepMin')} />
                    <NumberField label="Buffer before" unit="min" min={0} max={480} value={form.bufferBeforeMin} onChange={onNumber('bufferBeforeMin')} />
                    <NumberField label="Buffer after" unit="min" min={0} max={480} value={form.bufferAfterMin} onChange={onNumber('bufferAfterMin')} />
                    <NumberField label="Minimum notice" unit="hours" min={0} max={720} value={form.minNoticeHours} onChange={onNumber('minNoticeHours')} />
                    <NumberField label="Book up to" unit="days ahead" min={1} max={90} value={form.maxDaysAhead} onChange={onNumber('maxDaysAhead')} />
                    <NumberField
                      label="Daily limit"
                      unit="bookings"
                      min={1}
                      max={100}
                      value={form.maxBookingsPerDay ?? ''}
                      placeholder="None"
                      onChange={(event) => setField('maxBookingsPerDay', event.target.value ? numberValue(event.target.value) : null)}
                    />
                  </div>
                </Section>

                <Section title="Weekly hours" description={`Times in ${form.hostTz.replace(/_/g, ' ')}.`}>
                  {editableHours ? (
                    <WeeklyHoursEditor value={editableHours} onChange={(hours) => setField('hoursText', pretty(hours))} />
                  ) : (
                    <p className={styles.jsonWarning}>The JSON below can’t be shown in the editor. Fix it to edit visually.</p>
                  )}
                  <details className={styles.advanced}>
                    <summary>Edit as JSON</summary>
                    <textarea value={form.hoursText} onChange={(event) => setField('hoursText', event.target.value)} spellCheck={false} />
                  </details>
                </Section>

                <Section title="Booking questions" description="Name, email and company are always asked.">
                  {editableQuestions ? (
                    <QuestionsEditor value={editableQuestions} onChange={(questions) => setField('questionsText', pretty(questions))} />
                  ) : (
                    <p className={styles.jsonWarning}>The JSON below can’t be shown in the editor. Fix it to edit visually.</p>
                  )}
                  <details className={styles.advanced}>
                    <summary>Edit as JSON</summary>
                    <textarea value={form.questionsText} onChange={(event) => setField('questionsText', event.target.value)} spellCheck={false} />
                  </details>
                </Section>

                <div className={`${styles.saveBar} ${dirty ? styles.saveBarDirty : ''}`}>
                  <span className={styles.saveHint}>{dirty ? 'You have unsaved changes.' : 'All changes saved.'}</span>
                  <button className="btn btn--secondary" type="button" onClick={() => setForm(isCreating ? {...newForm} : formFromEventType(selected!))} disabled={!dirty || state === 'saving'}>
                    Discard
                  </button>
                  <button className="btn btn--primary" type="submit" disabled={state === 'saving' || (!dirty && !isCreating)}>
                    {state === 'saving' ? 'Saving…' : isCreating ? 'Create meeting type' : 'Save changes'}
                  </button>
                </div>
              </form>

              {!isCreating && (
                <Section title="Date overrides" description="Change hours or close for specific dates. Saved immediately.">
                  {overrides.length === 0 ? (
                    <p className={styles.emptyInline}>No upcoming overrides.</p>
                  ) : (
                    <ul className={styles.overrideList}>
                      {overrides.map((override) => (
                        <li className={styles.overrideItem} key={override.date}>
                          <strong>{overrideDateLabel(override.date)}</strong>
                          <span>
                            {override.hours.length === 0
                              ? <span className="badge">Closed</span>
                              : override.hours.map((range) => range.join('–')).join(', ')}
                          </span>
                          <span className={styles.overrideActions}>
                            <button className="btn btn--ghost btn--sm" type="button" onClick={() => { setOverrideDate(override.date); setOverrideHours(pretty(override.hours)) }}>Edit</button>
                            <button className="btn btn--ghost btn--sm btn--danger" type="button" onClick={() => removeOverride(override.date)}>Remove</button>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <form className={styles.overrideForm} onSubmit={saveOverride}>
                    <Field label="Date">
                      <input className="input" type="date" value={overrideDate} onChange={(event) => setOverrideDate(event.target.value)} required />
                    </Field>
                    <div className={styles.overrideHours}>
                      <span className={styles.fieldLabel}>Hours</span>
                      {editableOverrideHours && <DateHoursEditor value={editableOverrideHours} onChange={(hours) => setOverrideHours(pretty(hours))} />}
                      <details className={styles.advanced}>
                        <summary>Edit as JSON</summary>
                        <textarea value={overrideHours} onChange={(event) => setOverrideHours(event.target.value)} spellCheck={false} />
                      </details>
                    </div>
                    <button className="btn btn--secondary" type="submit">Save override</button>
                  </form>
                </Section>
              )}
            </>
          )}
        </section>
      </div>
    </>
  )
}

function Section({title, description, children}: {title: string; description?: string; children: ReactNode}) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHead}>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Field({label, hint, children}: {label: string; hint?: string; children: ReactNode}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
      {hint && <span className={styles.fieldHint}>{hint}</span>}
    </label>
  )
}

function NumberField({label, unit, value, onChange, min, max, placeholder}: {
  label: string
  unit: string
  value: number | ''
  onChange: (event: ChangeEvent<HTMLInputElement>) => void
  min: number
  max: number
  placeholder?: string
}) {
  return (
    <label className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      <span className={styles.suffixed}>
        <input className="input" type="number" min={min} max={max} value={value} onChange={onChange} placeholder={placeholder} />
        <span>{unit}</span>
      </span>
    </label>
  )
}

function ConferenceSelect({value, onChange}: {value: EventType['conferenceProvider']; onChange: (value: EventType['conferenceProvider']) => void}) {
  return (
    <select className="input" value={value} onChange={(event) => onChange(event.target.value as EventType['conferenceProvider'])}>
      <option value="google_meet">Google Meet</option>
      <option value="zoom">Zoom</option>
    </select>
  )
}

function GoogleCalendarIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <rect x="3" y="4" width="18" height="17" rx="3" stroke="currentColor" strokeWidth="1.8" />
      <path d="M3 9h18M8 2.5v3M16 2.5v3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M9 13h2v4M13.5 13h2l-1.5 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
