import {describe, expect, it} from 'vitest'
import {validateAvailabilityOverride, validateEventTypeAdminCreate, validateEventTypeAdminUpdate} from './admin'

const valid = {
  title: 'Scheduler Demo',
  description: 'A useful demo.',
  durationMin: 30,
  slotStepMin: 30,
  bufferBeforeMin: 0,
  bufferAfterMin: 10,
  minNoticeHours: 12,
  maxDaysAhead: 30,
  maxBookingsPerDay: null,
  hours: {mon: [['09:00', '12:00'], ['13:00', '17:00']]},
  hostTz: 'Europe/Amsterdam',
  questions: [
    {key: 'role', label: 'Your role', type: 'select', required: true, options: ['Founder', 'Product'], leadField: 'role'},
    {key: 'use_case', label: 'Use case', type: 'textarea', required: false},
  ],
  requireWorkEmail: true,
  conferenceProvider: 'google_meet',
  active: true,
}

describe('validateEventTypeAdminUpdate', () => {
  it('accepts a complete editable event type', () => {
    expect(validateEventTypeAdminUpdate(valid)).toMatchObject({
      ok: true,
      value: {
        title: 'Scheduler Demo',
        durationMin: 30,
        questions: valid.questions,
      },
    })
  })

  it('rejects invalid weekly hours', () => {
    expect(validateEventTypeAdminUpdate({...valid, hours: {monday: [['09:00', '17:00']]}})).toEqual({
      ok: false,
      error: 'Unknown weekday: monday.',
    })
    expect(validateEventTypeAdminUpdate({...valid, hours: {mon: [['17:00', '09:00']]}})).toEqual({
      ok: false,
      error: 'Invalid mon range: 17:00-09:00.',
    })
  })

  it('rejects invalid question metadata', () => {
    expect(validateEventTypeAdminUpdate({...valid, questions: [{key: 'Role', label: 'Role', type: 'text'}]})).toEqual({
      ok: false,
      error: 'Invalid question key: Role.',
    })
    expect(validateEventTypeAdminUpdate({...valid, questions: [{key: 'role', label: 'Role', type: 'select'}]})).toEqual({
      ok: false,
      error: 'Select question role needs options.',
    })
  })

  it('rejects unsupported lead field mappings', () => {
    expect(validateEventTypeAdminUpdate({...valid, questions: [{key: 'company', label: 'Company', type: 'text', leadField: 'company'}]})).toEqual({
      ok: false,
      error: 'Question company has an unsupported leadField.',
    })
  })
})

describe('validateAvailabilityOverride', () => {
  it('accepts a closed date and alternate hours', () => {
    expect(validateAvailabilityOverride({date: '2026-10-15', hours: []})).toMatchObject({ok: true, value: {hours: []}})
    expect(validateAvailabilityOverride({date: '2026-10-15', hours: [['10:00', '12:00']]})).toMatchObject({ok: true})
  })
  it('rejects impossible dates and reversed hours', () => {
    expect(validateAvailabilityOverride({date: '2026-02-30', hours: []}).ok).toBe(false)
    expect(validateAvailabilityOverride({date: '2026-10-15', hours: [['13:00', '09:00']]}).ok).toBe(false)
  })
})

describe('validateEventTypeAdminCreate', () => {
  it('accepts a shareable slug with validated settings', () => {
    expect(validateEventTypeAdminCreate({...valid, slug: 'product-demo'})).toMatchObject({
      ok: true,
      value: {slug: 'product-demo', title: valid.title},
    })
  })

  it.each(['Product-Demo', 'product--demo', 'admin', 'manage', ''])('rejects invalid or reserved slug %s', (slug) => {
    expect(validateEventTypeAdminCreate({...valid, slug}).ok).toBe(false)
  })

  it('still validates booking rules', () => {
    expect(validateEventTypeAdminCreate({...valid, slug: 'demo-2', durationMin: 0})).toEqual({
      ok: false,
      error: 'Duration must be a whole number between 5 and 480.',
    })
  })
})
