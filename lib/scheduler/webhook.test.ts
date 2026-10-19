import {describe, expect, it} from 'vitest'
import {webhookSignature} from './webhook'

describe('webhookSignature', () => {
  it('signs the timestamp and exact payload bytes', () => {
    expect(webhookSignature('secret', '123', '{}')).toBe('4468c5e304ca107335ae2982d764fdf304214175c7dc3ad06921848d275abb92')
    expect(webhookSignature('secret', '124', '{}')).not.toBe(webhookSignature('secret', '123', '{}'))
  })
})
