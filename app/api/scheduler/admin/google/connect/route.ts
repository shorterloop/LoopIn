import {randomBytes} from 'node:crypto'
import {NextRequest, NextResponse} from 'next/server'
import {schedulerAdminAuthorized} from '@/lib/scheduler/admin'
import {connectionMode} from '@/lib/scheduler/connection'
import {errorResponse} from '@/lib/scheduler/http'

export async function POST(request: NextRequest) {
  if (!schedulerAdminAuthorized(request)) return NextResponse.json({ok: false}, {status: 401})
  try {
    if (await connectionMode() === 'environment') {
      return NextResponse.json({ok: false, error: 'This calendar uses GOOGLE_REFRESH_TOKEN from the server environment.'}, {status: 409})
    }
    const clientId = process.env.GOOGLE_CLIENT_ID
    const missing = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'].filter(name => !process.env[name]?.trim())
    if (missing.length) {
      return NextResponse.json({ok: false, error: `Configure ${missing.join(' and ')} in the Loopin server environment, then restart the app.`}, {status: 503})
    }
    if (!/^[0-9a-f]{64}$/i.test(process.env.SCHEDULER_TOKEN_KEY || '')) {
      return NextResponse.json({ok: false, error: 'SCHEDULER_TOKEN_KEY must be a 64-character hexadecimal encryption key in the Loopin server environment.'}, {status: 503})
    }
    const publicUrl = process.env.SCHEDULER_PUBLIC_URL
    if (!publicUrl) return NextResponse.json({ok: false, error: 'SCHEDULER_PUBLIC_URL is not configured.'}, {status: 503})
    const base = new URL(publicUrl)
    if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(base.hostname))) {
      return NextResponse.json({ok: false, error: 'SCHEDULER_PUBLIC_URL must use HTTPS outside localhost.'}, {status: 503})
    }
    const state = randomBytes(32).toString('hex')
    const redirectUri = new URL('/api/scheduler/admin/google/callback', base).toString()
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
    url.search = new URLSearchParams({
      client_id: clientId!,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.freebusy',
      access_type: 'offline',
      prompt: 'consent',
      state,
    }).toString()
    const response = NextResponse.json({ok: true, url: url.toString()}, {headers: {'Cache-Control': 'no-store'}})
    response.cookies.set('sl_scheduler_oauth', state, {
      httpOnly: true, sameSite: 'lax', secure: base.protocol === 'https:', maxAge: 600,
      path: '/api/scheduler/admin/google/callback',
    })
    return response
  } catch (err) {
    return errorResponse(err, 'scheduler Google connect failed')
  }
}
