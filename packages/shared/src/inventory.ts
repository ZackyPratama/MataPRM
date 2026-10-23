import { z } from 'zod'

const uuid = z.string().uuid()
const money = z.string().regex(/^(0|[1-9]\d{0,18})$/).transform(value => BigInt(value)).refine(value => value <= 9_223_372_036_854_775_807n)

export const createItemSchema = z.object({
  code: z.string().trim().min(1).max(64),
  category: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(160),
  karatId: uuid,
  weightMg: z.number().int().positive().max(2_147_483_647),
  laborCost: money.default(0n),
  photoPath: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
}).strict()

export const updateItemSchema = createItemSchema.partial().extend({ version: z.number().int().positive() }).strict()

export const itemQuerySchema = z.object({
  query: z.string().trim().max(100).optional(),
  status: z.enum(['IN_STORE', 'SOLD', 'ON_TRIP', 'ORDERED']).optional(),
  skip: z.string().regex(/^(0|[1-9]\d{0,6})$/).default('0').transform(Number),
  take: z.string().regex(/^[1-9]\d?$|^100$/).default('50').transform(Number),
}).strict()

export const karatIdSchema = uuid
