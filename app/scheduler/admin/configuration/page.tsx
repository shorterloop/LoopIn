'use client'

import {useEffect, useState} from 'react'
import {FiCheck, FiCopy, FiExternalLink, FiMinus, FiX} from 'react-icons/fi'
import {Notice, PageHeader, useAdmin} from '@/components/admin/AdminShell'
import styles from './page.module.css'

interface Configuration {publicUrl: string; embedOrigins: string; checks: Record<string, boolean>}

/** What each server check means, which variables drive it, and whether the app needs it. */
const CHECKS: Array<{key: string; label: string; env: string; required: boolean}> = [
  {key: 'database', label: 'Database', env: 'DATABASE_URL', required: true},
  {key: 'googleOAuth', label: 'Google OAuth client', env: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET', required: true},
  {key: 'encryption', label: 'Encryption key', env: 'SCHEDULER_TOKEN_KEY (64 hex characters)', required: true},
  {key: 'cron', label: 'Scheduled maintenance', env: 'CRON_SECRET', required: true},
  {key: 'hostEmail', label: 'Host notification email', env: 'RESEND_API_KEY, RESEND_FROM, SCHEDULER_HOST_EMAIL', required: false},
  {key: 'zoom', label: 'Zoom meetings', env: 'ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET, ZOOM_HOST_EMAIL', required: false},
  {key: 'turnstile', label: 'Turnstile bot protection', env: 'NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY', required: false},
  {key: 'webhook', label: 'Booking webhooks', env: 'SCHEDULER_WEBHOOK_URL, SCHEDULER_WEBHOOK_SECRET', required: false},
]

const htmlEscape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export default function ConfigurationPage() {
  const {token, signOut} = useAdmin()
  const [config, setConfig] = useState<Configuration | null>(null)
  const [types, setTypes] = useState<Array<{slug: string; title: string; active: boolean}>>([])
  const [slug, setSlug] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const headers = {Authorization: `Bearer ${token}`}
        const [a, b] = await Promise.all([
          fetch('/api/scheduler/admin/configuration', {headers, cache: 'no-store'}),
          fetch('/api/scheduler/admin/event-types', {headers, cache: 'no-store'}),
        ])
        if (a.status === 401 || b.status === 401) {
          signOut('Your session has expired. Sign in again.')
          return
        }
        if (!a.ok || !b.ok) throw new Error('Unable to load configuration. Check the server logs and database.')
        const c = await a.json(), t = await b.json()
        if (cancelled) return
        setConfig(c)
        setTypes(t.eventTypes)
        setSlug((t.eventTypes.find((e: {active: boolean}) => e.active) ?? t.eventTypes[0])?.slug || '')
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load configuration')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [token, signOut])

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      window.setTimeout(() => setCopied((current) => (current === label ? '' : current)), 2000)
    } catch {
      setError('Copy failed. Select the text and copy it manually.')
    }
  }

  const base = config?.publicUrl.replace(/\/+$/, '') ?? ''
  const embed = config && slug ? `${base}/embed/${encodeURIComponent(slug)}` : ''
  const link = config && slug ? `${base}/scheduler/${encodeURIComponent(slug)}` : ''
  const iframe = embed ? `<iframe src="${htmlEscape(embed)}" title="Book a meeting" width="100%" height="850" style="border:0" loading="lazy"></iframe>` : ''
  const selectedType = types.find((t) => t.slug === slug)
  const missingRequired = config ? CHECKS.filter((c) => c.required && !config.checks[c.key]).length : 0

  return (
    <>
      <PageHeader
        title="Configuration"
        description="Server settings come from environment variables in your hosting provider. This page shows what is set, never the values."
      />

      {error && <Notice tone="error" onDismiss={() => setError('')}>{error}</Notice>}

      {!config && !error && <p className={styles.muted}>Loading configuration…</p>}

      {config && (
        <>
          <section className={styles.card} aria-labelledby="share-heading">
            <div className={styles.cardHead}>
              <h2 id="share-heading">Share & embed</h2>
              <p>Send people a booking link, or place the scheduler on your own site with an iframe.</p>
            </div>

            {types.length === 0 ? (
              <p className={styles.muted}>Create a meeting type first.</p>
            ) : (
              <>
                <label className={styles.field}>
                  <span>Meeting type</span>
                  <select className="input" value={slug} onChange={(e) => setSlug(e.target.value)}>
                    {types.map((t) => <option key={t.slug} value={t.slug}>{t.title}{t.active ? '' : ' (not accepting bookings)'}</option>)}
                  </select>
                </label>

                {selectedType && !selectedType.active && (
                  <Notice tone="error">This meeting type is switched off, so its link and embed show “not found”. Turn it on under Meeting types.</Notice>
                )}

                <CopyRow label="Booking link" value={link} copied={copied === 'link'} onCopy={() => copy('link', link)} href={link} />
                <CopyRow label="Embed URL" value={embed} copied={copied === 'embed'} onCopy={() => copy('embed', embed)} href={embed} />

                <div className={styles.field}>
                  <div className={styles.fieldHead}>
                    <span>Iframe HTML</span>
                    <button type="button" className="btn btn--secondary btn--sm" onClick={() => copy('iframe', iframe)}>
                      {copied === 'iframe' ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />}
                      {copied === 'iframe' ? 'Copied' : 'Copy'}
                    </button>
                  </div>
                  <pre className={styles.code}><code>{iframe}</code></pre>
                </div>

                <p className={styles.hint}>
                  Allowed parent sites: <code>{config.embedOrigins || 'only this app'}</code>. Change{' '}
                  <code>SCHEDULER_EMBED_ORIGINS</code> and rebuild to embed elsewhere. Append UTM parameters to the URL for
                  campaign attribution.
                </p>
              </>
            )}
          </section>

          <section className={styles.card} aria-labelledby="checks-heading">
            <div className={styles.cardHead}>
              <h2 id="checks-heading">Server settings</h2>
              <p>
                {missingRequired === 0
                  ? 'All required settings are present.'
                  : `${missingRequired} required setting${missingRequired === 1 ? ' is' : 's are'} missing.`}{' '}
                These indicators check that values are set, not that providers are reachable.
              </p>
            </div>

            <div className={styles.publicUrl}>
              <span>Public URL</span>
              <code>{config.publicUrl || 'SCHEDULER_PUBLIC_URL is missing'}</code>
            </div>

            <ul className={styles.checks}>
              {CHECKS.map((check) => {
                const ok = config.checks[check.key]
                const tone = ok ? styles.ok : check.required ? styles.bad : styles.off
                return (
                  <li key={check.key} className={styles.check}>
                    <span className={`${styles.checkIcon} ${tone}`} aria-hidden="true">
                      {ok ? <FiCheck /> : check.required ? <FiX /> : <FiMinus />}
                    </span>
                    <div className={styles.checkText}>
                      <strong>
                        {check.label}
                        {!check.required && <span className={styles.optional}>Optional</span>}
                      </strong>
                      <code>{check.env}</code>
                    </div>
                    <span className={`badge ${ok ? 'badge--ok' : check.required ? 'badge--error' : ''}`}>
                      {ok ? 'Configured' : 'Not set'}
                    </span>
                  </li>
                )
              })}
            </ul>
          </section>
        </>
      )}
    </>
  )
}

function CopyRow({label, value, copied, onCopy, href}: {label: string; value: string; copied: boolean; onCopy: () => void; href: string}) {
  return (
    <div className={styles.field}>
      <span>{label}</span>
      <div className={styles.copyRow}>
        <code className={styles.copyValue}>{value}</code>
        <a className="btn btn--ghost btn--sm" href={href} target="_blank" rel="noreferrer" aria-label={`Open ${label.toLowerCase()}`}>
          <FiExternalLink aria-hidden="true" />
        </a>
        <button type="button" className="btn btn--secondary btn--sm" onClick={onCopy}>
          {copied ? <FiCheck aria-hidden="true" /> : <FiCopy aria-hidden="true" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
