import {afterEach, describe, expect, it, vi} from 'vitest'

vi.mock('./connection', () => ({getRefreshToken: async () => 'refresh-token'}))

import {invalidateAccessToken, updateEvent} from './google'

afterEach(() => {
  vi.unstubAllGlobals()
  invalidateAccessToken()
})

describe('calendar update recovery', () => {
  it('accepts a timed-out patch only when Google reflects the requested state', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client'
    process.env.GOOGLE_CLIENT_SECRET = 'secret'
    const start = new Date('2026-11-02T12:00:00.000Z')
    const end = new Date('2026-11-02T12:30:00.000Z')
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({access_token: 'access', expires_in: 3600}), {status: 200}))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'event-id', description: 'updated',
        start: {dateTime: start.toISOString()}, end: {dateTime: end.toISOString()},
      }), {status: 200}))
    vi.stubGlobal('fetch', fetchMock)

    const event = await updateEvent('event-id', {start, end, timeZone: 'Europe/Berlin', description: 'updated'})
    expect(event.id).toBe('event-id')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
