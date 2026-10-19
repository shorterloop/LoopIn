import {timingSafeEqual} from 'node:crypto'
import {NextRequest, NextResponse} from 'next/server'
import {saveRefreshToken} from '@/lib/scheduler/connection'
import {invalidateAccessToken} from '@/lib/scheduler/google'

function sameState(a: string | undefined, b: string | null): boolean {
  if (!a || !b) return false
  const first = Buffer.from(a)
  const second = Buffer.from(b)
  return first.length === second.length && timingSafeEqual(first, second)
}

export async function GET(request: NextRequest) {
  const publicUrl = process.env.SCHEDULER_PUBLIC_URL
  if (!publicUrl) return NextResponse.json({ok: false}, {status: 503})
  const cookie = request.cookies.get('sl_scheduler_oauth')?.value
  if (!sameState(cookie, request.nextUrl.searchParams.get('state'))) {
    return NextResponse.json({ok: false, error: 'OAuth state mismatch.'}, {status: 400})
  }
  const redirect = new URL('/scheduler/admin', publicUrl)
  const code = request.nextUrl.searchParams.get('code')
  if (!code) {
    redirect.searchParams.set('calendar', 'denied')
  } else {
    try {
      const res = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {'Content-Type': 'application/x-www-form-urlencoded'},
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID || '',
          client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
          redirect_uri: new URL('/api/scheduler/admin/google/callback', publicUrl).toString(),
          grant_type: 'authorization_code',
        }),
        cache: 'no-store',
      })
      const json = await res.json() as {refresh_token?: string}
      if (!res.ok || !json.refresh_token) throw new Error('Google did not return a refresh token')
      await saveRefreshToken(json.refresh_token)
      invalidateAccessToken()
      redirect.searchParams.set('calendar', 'connected')
    } catch (err) {
      console.error('[scheduler] Google OAuth callback failed:', err)
      redirect.searchParams.set('calendar', 'error')
    }
  }
  const response = NextResponse.redirect(redirect)
  response.cookies.set('sl_scheduler_oauth', '', {
    httpOnly: true, sameSite: 'lax', secure: redirect.protocol === 'https:', maxAge: 0,
    path: '/api/scheduler/admin/google/callback',
  })
  return response
}
