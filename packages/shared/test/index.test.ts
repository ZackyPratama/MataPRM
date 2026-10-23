import { describe, expect, it } from 'vitest'
import { calculateLineTotal, createGoldPriceSchema, serializeBigInts, sharedMessage } from '../src/index.js'

describe('shared workspace', () => {
  it('exports shared utility', () => {
    expect(sharedMessage()).toBe('shared-ready')
  })

  it('calculates line total with integer half-up rounding', () => {
    expect(calculateLineTotal(1, 500n, 0n)).toBe(1n)
    expect(calculateLineTotal(1, 499n, 0n)).toBe(0n)
    expect(calculateLineTotal(5250, 1_500_000n, 75_000n)).toBe(7_950_000n)
  })

  it('rejects invalid price inputs and serializes BigInt', () => {
    expect(() => calculateLineTotal(-1, 1n, 0n)).toThrow(RangeError)
    expect(createGoldPriceSchema.safeParse({ karatId: '00000000-0000-4000-8000-000000000001', pricePerGram: '0' }).success).toBe(false)
    expect(serializeBigInts({ total: 2_000_000_001n })).toEqual({ total: '2000000001' })
  })
})
