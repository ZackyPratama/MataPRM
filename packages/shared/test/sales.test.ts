import { describe, expect, it } from 'vitest'
import { createSaleSchema, voidSaleSchema } from '../src/index.js'

describe('sale schemas', () => {
  const id = '00000000-0000-4000-8000-000000000001'
  it('parses BigInt payments and device-qualified receipt', () => {
    const result = createSaleSchema.safeParse({ opId: id, saleId: '00000000-0000-4000-8000-000000000002', receiptNo: 'A-20261019-HP1-003', soldAt: '2026-10-19T12:00:00.000Z', itemIds: [id], discount: '0', payments: [{ id: '00000000-0000-4000-8000-000000000003', method: 'CASH', amount: '1500000' }] })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.payments[0]!.amount).toBe(1_500_000n)
  })

  it('rejects duplicate items, malformed receipts, and unsafe voids', () => {
    expect(createSaleSchema.safeParse({ opId: id, saleId: id, receiptNo: 'A-003', soldAt: '2026-10-19T12:00:00.000Z', itemIds: [id, id], discount: '0', payments: [] }).success).toBe(false)
    expect(voidSaleSchema.safeParse({ opId: id, reason: 'x', ownerPin: '123' }).success).toBe(false)
  })
})
