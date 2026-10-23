import { z } from 'zod'

export const rupiahStringSchema = z.string().regex(/^(0|[1-9]\d{0,18})$/).transform(value => BigInt(value)).refine(value => value <= 9_223_372_036_854_775_807n)

export const createGoldPriceSchema = z.object({
  karatId: z.string().uuid(),
  pricePerGram: rupiahStringSchema.refine(value => value > 0n),
  effectiveAt: z.iso.datetime().optional(),
}).strict()

export function calculateLineTotal(weightMg: number, pricePerGram: bigint, laborCost: bigint): bigint {
  if (!Number.isSafeInteger(weightMg) || weightMg < 0) throw new RangeError('weightMg harus berupa bilangan bulat non-negatif.')
  if (pricePerGram < 0n || laborCost < 0n) throw new RangeError('Harga dan ongkos tidak boleh negatif.')
  return (BigInt(weightMg) * pricePerGram + 500n) / 1000n + laborCost
}

export function serializeBigInts<T>(value: T): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(serializeBigInts)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeBigInts(item)]))
  return value
}

export const sharedWorkspace = '@mataprm/shared'

export function sharedMessage(): string {
  return 'shared-ready'
}
