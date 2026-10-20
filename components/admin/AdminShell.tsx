'use client'

import {createContext, useCallback, useContext, useEffect, useState, type FormEvent, type ReactNode} from 'react'
import {usePathname} from 'next/navigation'
import {FiLogOut} from 'react-icons/fi'
import Logo from '../Logo'
import styles from './Admin.module.css'

/**
 * Frame for every admin page: top bar, navigation and a single sign-in gate.
 * The operator token is checked once, kept in session storage, and handed to
 * pages through useAdmin().
 */

export const TOKEN_KEY = 'scheduler-admin-token'

const NAV = [
  {href: '/scheduler/admin', label: 'Meeting types'},
  {href: '/scheduler/admin/bookings', label: 'Bookings'},
  {href: '/scheduler/admin/configuration', label: 'Configuration'},
]

interface AdminContextValue {
  token: string
  /** Forget the token and return to the sign-in screen, e.g. after a 401. */
  signOut: (reason?: string) => void
}

const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext)
  if (!value) throw new Error('useAdmin must be used inside <AdminShell>')
  return value
}

export default function AdminShell({children}: {children: ReactNode}) {
  const pathname = usePathname()
  // null while the saved token is being checked.
  const [token, setToken] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState('')

  const verify = useCallback(async (candidate: string) => {
    setChecking(true)
    setError('')
    try {
      const res = await fetch('/api/scheduler/admin/configuration', {
        headers: {Authorization: `Bearer ${candidate}`},
        cache: 'no-store',
      })
      if (res.ok) {
        window.sessionStorage.setItem(TOKEN_KEY, candidate)
        setToken(candidate)
        return
      }
      window.sessionStorage.removeItem(TOKEN_KEY)
      setToken('')
      setError(res.status === 401
        ? 'That token was not accepted. Check SCHEDULER_ADMIN_TOKEN on the server.'
        : 'The server could not check the token. Check the server logs.')
    } catch {
      setToken('')
      setError('Could not reach the server. Check your connection and try again.')
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    const saved = window.sessionStorage.getItem(TOKEN_KEY)
    if (saved) void verify(saved)
    else setToken('')
  }, [verify])

  const signOut = useCallback((reason?: string) => {
    window.sessionStorage.removeItem(TOKEN_KEY)
    setDraft('')
    setToken('')
    setError(reason ?? '')
  }, [])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const candidate = draft.trim()
    if (!candidate) {
      setError('Enter the admin token.')
      return
    }
    void verify(candidate)
  }

  const signedIn = Boolean(token)

  return (
    <div className={styles.app}>
      <header className={styles.topbar}>
        <div className={styles.topbarInner}>
          <Logo href="/scheduler/admin" />
          {signedIn && (
            <nav className={styles.nav} aria-label="Admin">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className={styles.navLink}
                  aria-current={pathname === item.href ? 'page' : undefined}
                >
                  {item.label}
                </a>
              ))}
            </nav>
          )}
          {signedIn && (
            <button type="button" className={`btn btn--ghost btn--sm ${styles.signOut}`} onClick={() => signOut()}>
              <FiLogOut aria-hidden="true" />
              Sign out
            </button>
          )}
        </div>
      </header>

      <main className={styles.main}>
        {token === null ? (
          <p className={styles.muted} role="status">
            Checking session…
          </p>
        ) : signedIn ? (
          <AdminContext.Provider value={{token, signOut}}>{children}</AdminContext.Provider>
        ) : (
          <form className={`card ${styles.signIn}`} onSubmit={submit}>
            <div className={styles.signInHead}>
              <h1 className="headline-md">Sign in to Loopin</h1>
              <p className={styles.muted}>
                Enter the admin token configured as <code>SCHEDULER_ADMIN_TOKEN</code>. It stays in this browser tab
                only.
              </p>
            </div>
            <div className="lb-form__field">
              <label htmlFor="admin-token">Admin token</label>
              <input
                id="admin-token"
                type="password"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                autoComplete="current-password"
                autoFocus
              />
            </div>
            {error && (
              <p className="lb-form__error" role="alert">
                {error}
              </p>
            )}
            <button className="btn btn--primary btn--block" type="submit" disabled={checking}>
              {checking ? 'Checking…' : 'Sign in'}
            </button>
          </form>
        )}
      </main>
    </div>
  )
}

/** Title row shared by admin pages. */
export function PageHeader({title, description, actions}: {title: string; description?: ReactNode; actions?: ReactNode}) {
  return (
    <header className={styles.pageHeader}>
      <div className={styles.pageHeaderText}>
        <h1 className={styles.pageTitle}>{title}</h1>
        {description && <p className={styles.muted}>{description}</p>}
      </div>
      {actions && <div className={styles.pageActions}>{actions}</div>}
    </header>
  )
}

/** Dismissible success / error line under the page header. */
export function Notice({tone, children, onDismiss}: {tone: 'ok' | 'error'; children: ReactNode; onDismiss?: () => void}) {
  return (
    <div className={`${styles.notice} ${tone === 'error' ? styles.noticeError : styles.noticeOk}`} role={tone === 'error' ? 'alert' : 'status'}>
      <span>{children}</span>
      {onDismiss && (
        <button type="button" className={styles.noticeClose} onClick={onDismiss} aria-label="Dismiss">
          ×
        </button>
      )}
    </div>
  )
}
