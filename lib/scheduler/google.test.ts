import {describe, expect, it} from 'vitest'
import {bookingEventId} from './google'

describe('bookingEventId', () => {
  it('turns a UUID into a stable Google-compatible event id', () => {
    expect(bookingEventId('61E1AA67-36D0-4AAC-9150-CB7755FEFCD0')).toBe('61e1aa6736d04aac9150cb7755fefcd0')
  })
})
