'use client'

import {useEffect, useRef} from 'react'

/**
 * Cloudflare Turnstile widget. Renders nothing when
 * NEXT_PUBLIC_TURNSTILE_SITE_KEY is unset (the server skips the check too).
 * The script is injected by this bundle, so the strict CSP's 'strict-dynamic'
 * lets it run without a nonce.
 */

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string
  remove: (id: string) => void
  reset: (id: string) => void
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let scriptPromise: Promise<void> | null = null

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve()
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = SCRIPT_SRC
      s.async = true
      s.onload = () => resolve()
      s.onerror = () => {
        scriptPromise = null
        reject(new Error('Turnstile failed to load'))
      }
      document.head.appendChild(s)
    })
  }
  return scriptPromise
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''

export default function Turnstile({onToken, resetKey}: {onToken: (token: string) => void; resetKey?: number}) {
  const ref = useRef<HTMLDivElement>(null)
  const onTokenRef = useRef(onToken)
  onTokenRef.current = onToken

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY || !ref.current) return
    let widgetId: string | null = null
    let cancelled = false
    loadScript()
      .then(() => {
        if (cancelled || !ref.current || !window.turnstile) return
        widgetId = window.turnstile.render(ref.current, {
          sitekey: TURNSTILE_SITE_KEY,
          theme: 'auto',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(''),
          'error-callback': () => onTokenRef.current(''),
        })
      })
      .catch((err) => console.error(err))
    return () => {
      cancelled = true
      onTokenRef.current('')
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId)
    }
  }, [resetKey])

  if (!TURNSTILE_SITE_KEY) return null
  return <div className="lb-scheduler__captcha" ref={ref} />
}
