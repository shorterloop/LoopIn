import {describe, expect, it} from 'vitest'
import {eventDescription, eventSummary} from './copy'

describe('calendar event copy', () => {
  it('titles the event "<Company> : <Event title>"', () => {
    expect(eventSummary('Acme', {title: 'Scheduler - 2027 Roadmap Bets'})).toBe(
      'Acme : Scheduler - 2027 Roadmap Bets',
    )
  })

  it('puts the answers, then reschedule and cancel links, in the description', () => {
    const text = eventDescription({
      eventType: {
        description: null,
        questions: [{key: 'bets', label: 'Your top 3 bets for 2027', type: 'textarea', required: true}],
      },
      name: 'Ada',
      email: 'ada@acme.io',
      company: 'Acme',
      answers: {bets: 'AI, pricing, EU'},
      token: 'tok',
    })
    expect(text).toContain('Your top 3 bets for 2027\nAI, pricing, EU')
    expect(text).toMatch(/Reschedule: https?:\/\/\S+\/scheduler\/manage\/tok\?action=reschedule/)
    expect(text).toMatch(/Cancel: https?:\/\/\S+\/scheduler\/manage\/tok\?action=cancel/)
    expect(text.indexOf('AI, pricing')).toBeLessThan(text.indexOf('Reschedule:'))
  })
})
