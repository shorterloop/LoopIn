import {afterEach, describe, expect, it} from 'vitest'
import {decryptRefreshToken, encryptRefreshToken} from './connection'

const previousKey = process.env.SCHEDULER_TOKEN_KEY

afterEach(() => {
  if (previousKey === undefined) delete process.env.SCHEDULER_TOKEN_KEY
  else process.env.SCHEDULER_TOKEN_KEY = previousKey
})

describe('calendar connection encryption', () => {
  it('round-trips a refresh token without storing plaintext', () => {
    process.env.SCHEDULER_TOKEN_KEY = '11'.repeat(32)
    const stored = encryptRefreshToken('refresh-secret')
    expect(stored).not.toContain('refresh-secret')
    expect(decryptRefreshToken(stored)).toBe('refresh-secret')
  })

  it('rejects tampering and a missing key', () => {
    process.env.SCHEDULER_TOKEN_KEY = '22'.repeat(32)
    const stored = encryptRefreshToken('refresh-secret')
    const tampered = `${stored[0] === 'A' ? 'B' : 'A'}${stored.slice(1)}`
    expect(() => decryptRefreshToken(tampered)).toThrow()
    delete process.env.SCHEDULER_TOKEN_KEY
    expect(() => encryptRefreshToken('x')).toThrow(/SCHEDULER_TOKEN_KEY/)
  })
})
