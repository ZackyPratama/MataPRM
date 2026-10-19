import { describe, expect, it } from 'vitest'
import { sharedMessage } from '../src/index.js'

describe('shared workspace', () => {
  it('exports shared utility', () => {
    expect(sharedMessage()).toBe('shared-ready')
  })
})
