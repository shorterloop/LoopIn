import {describe, expect, it} from 'vitest'
import {cleanTimeZone, cleanUtm, isFreeEmail, splitName, validateBookingFields} from './validate'
import type {EventType} from './types'

const eventType = {
  requireWorkEmail: true,
  questions: [
    {key: 'bets', label: 'Your top 3 bets for 2027', type: 'textarea', required: true},
    {key: 'role', label: 'Your role', type: 'select', required: false, options: ['Founder', 'Product']},
  ],
} as unknown as EventType

const base = {name: 'Ada Lovelace', email: 'Ada@Acme.io', company: 'Acme', answers: {bets: 'One, two, three'}}

describe('validateBookingFields', () => {
  it('accepts a complete booking and normalises the email', () => {
    const result = validateBookingFields(eventType, base)
    expect(result).toEqual({
      ok: true,
      value: {name: 'Ada Lovelace', email: 'ada@acme.io', company: 'Acme', answers: {bets: 'One, two, three'}},
    })
  })

  it('always requires a company', () => {
    expect(validateBookingFields(eventType, {...base, company: '  '})).toMatchObject({ok: false})
  })

  it('rejects free email domains when a work email is required', () => {
    expect(validateBookingFields(eventType, {...base, email: 'ada@gmail.com'})).toEqual({
      ok: false,
      error: 'Please use your work email address.',
    })
    const relaxed = {...eventType, requireWorkEmail: false} as EventType
    expect(validateBookingFields(relaxed, {...base, email: 'ada@gmail.com'}).ok).toBe(true)
  })

  it('enforces required questions by their label', () => {
    expect(validateBookingFields(eventType, {...base, answers: {}})).toEqual({
      ok: false,
      error: 'Please answer: Your top 3 bets for 2027',
    })
  })

  it('drops answers to questions the event type does not ask', () => {
    const result = validateBookingFields(eventType, {...base, answers: {bets: 'x', injected: 'y'}})
    expect(result.ok && result.value.answers).toEqual({bets: 'x'})
  })

  it('accepts configured select answers and rejects injected options', () => {
    expect(validateBookingFields(eventType, {...base, answers: {bets: 'x', role: 'Product'}})).toMatchObject({
      ok: true,
      value: {answers: {bets: 'x', role: 'Product'}},
    })
    expect(validateBookingFields(eventType, {...base, answers: {bets: 'x', role: 'Root'}})).toEqual({
      ok: false,
      error: 'Please choose a valid option for: Your role',
    })
  })
})

describe('helpers', () => {
  it('isFreeEmail', () => {
    expect(isFreeEmail('a@outlook.com')).toBe(true)
    expect(isFreeEmail('a@example.org')).toBe(false)
  })

  it('cleanTimeZone accepts IANA zones only', () => {
    expect(cleanTimeZone('Europe/Amsterdam')).toBe('Europe/Amsterdam')
    expect(cleanTimeZone('Mars/Olympus')).toBeNull()
    expect(cleanTimeZone(42)).toBeNull()
  })

  it('cleanUtm keeps only utm_* keys', () => {
    expect(cleanUtm({utm_source: 'li', utm_campaign: ' q4 ', evil: 'x'})).toEqual({utm_source: 'li', utm_campaign: 'q4'})
  })

  it('splitName', () => {
    expect(splitName('Ada')).toEqual({firstName: 'Ada'})
    expect(splitName('Ada King Lovelace')).toEqual({firstName: 'Ada King', lastName: 'Lovelace'})
  })
})
