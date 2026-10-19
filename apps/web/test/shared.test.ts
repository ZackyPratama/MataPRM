import { describe, expect, it } from 'vitest'
import { sharedMessage } from '@mataprm/shared'

describe('web workspace', () => {
  it('uses shared package', () => {
    expect(sharedMessage()).toBe('shared-ready')
  })
})
