import { z } from 'zod'

const money = z.string().regex(/^(0|[1-9]\d{0,18})$/).transform(value => BigInt(value)).refine(value => value <= 9_223_372_036_854_775_807n)
export const createSaleSchema = z.object({
  opId: z.string().uuid(), saleId: z.string().uuid(), receiptNo: z.string().regex(/^[A-Z0-9]{1,12}-\d{8}-[A-Z0-9]{1,12}-\d{3,}$/), soldAt: z.iso.datetime(),
  itemIds: z.array(z.string().uuid()).min(1).max(100).refine(ids => new Set(ids).size === ids.length), discount: money,
  payments: z.array(z.object({ id: z.string().uuid(), method: z.enum(['CASH', 'TRANSFER']), amount: money.refine(value => value > 0n), reference: z.string().max(160).optional() }).strict()).min(1).max(2), note: z.string().max(1000).optional(),
}).strict()
export const voidSaleSchema = z.object({ opId: z.string().uuid(), reason: z.string().trim().min(3).max(500), ownerPin: z.string().regex(/^\d{6,12}$/) }).strict()
