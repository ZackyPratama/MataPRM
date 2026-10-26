import Fastify from 'fastify'
import type { Prisma, PrismaClient } from '@prisma/client'
import { calculateLineTotal, createGoldPriceSchema, createSaleSchema, serializeBigInts, sharedMessage, voidSaleSchema } from '@mataprm/shared'
import { createSession, requestUser, requireRole, sessionTokenHash, verifyPin } from './auth.js'
import { prisma as defaultPrisma } from './database.js'
import { createItemSchema, itemQuerySchema, updateItemSchema } from '@mataprm/shared'

const attemptLimit = 5
const attemptWindowMs = 15 * 60 * 1000

export function buildApp(prisma: PrismaClient = defaultPrisma) {
  const app = Fastify()
  const ipAttempts = new Map<string, { count: number; resetAt: number }>()
  const accountAttempts = new Map<string, { count: number; resetAt: number }>()
  const ownerPinAttempts = new Map<string, { count: number; resetAt: number }>()
  const reserveAttempt = (map: Map<string, { count: number; resetAt: number }>, key: string, now: number) => {
    const attempt = map.get(key)
    if (!attempt || attempt.resetAt <= now) {
      if (!attempt && map.size >= 1000) return false
      map.set(key, { count: 1, resetAt: now + attemptWindowMs })
      return true
    }
    if (attempt.count >= attemptLimit) return false
    attempt.count += 1
    return true
  }

  app.setErrorHandler((error: { statusCode?: number }, _request, reply) => {
    const status = error.statusCode && error.statusCode >= 400 && error.statusCode < 500 ? error.statusCode : 500
    return reply.code(status).send({ error: status === 500 ? 'INTERNAL_ERROR' : 'INVALID_INPUT', message: status === 500 ? 'Terjadi kesalahan server.' : 'Permintaan tidak valid.' })
  })
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'NOT_FOUND', message: 'Halaman tidak ditemukan.' }))

  app.get('/', async () => ({ status: sharedMessage() }))

  app.post<{ Body: unknown }>('/api/auth/login', async (request, reply) => {
    if (!request.body || typeof request.body !== 'object') return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Data login tidak valid.' })
    const { code, pin } = request.body as Record<string, unknown>
    if (typeof code !== 'string' || !/^[A-Z0-9]{1,12}$/.test(code) || typeof pin !== 'string' || !/^\d{6,12}$/.test(pin)) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Kode atau PIN tidak valid.' })
    const now = Date.now()
    for (const map of [ipAttempts, accountAttempts]) for (const [key, attempt] of map) if (attempt.resetAt <= now) map.delete(key)
    if (!reserveAttempt(ipAttempts, request.ip, now) || !reserveAttempt(accountAttempts, code, now)) return reply.code(429).send({ error: 'TOO_MANY_ATTEMPTS', message: 'Terlalu banyak percobaan. Coba lagi nanti.' })
    const user = await prisma.user.findUnique({ where: { code } })
    if (!user || !user.isActive || !(await verifyPin(pin, user.pinHash))) return reply.code(401).send({ error: 'INVALID_CREDENTIALS', message: 'Kode atau PIN salah.' })
    const token = await createSession(prisma, user.id)
    return { token, user: { id: user.id, code: user.code, name: user.name, role: user.role } }
  })

  app.get('/api/auth/session', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async request => {
    const user = requestUser(request)
    return { user: { id: user.id, code: user.code, name: user.name, role: user.role } }
  })

  app.post('/api/auth/logout', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const user = requestUser(request)
    const token = request.headers.authorization?.slice(7)
    if (!token) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Silakan login kembali.' })
    await prisma.$transaction([
      prisma.session.update({ where: { tokenHash: sessionTokenHash(token) }, data: { revokedAt: new Date() } }),
      prisma.auditLog.create({ data: { userId: user.id, action: 'AUTH_LOGOUT', entity: 'Session' } }),
    ])
    return reply.code(204).send()
  })

  app.post<{ Body: unknown }>('/api/gold-prices', { preHandler: requireRole(prisma, ['OWNER']) }, async (request, reply) => {
    const parsed = createGoldPriceSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Data harga emas tidak valid.' })
    const { karatId, pricePerGram, effectiveAt } = parsed.data
    const karat = await prisma.karat.findUnique({ where: { id: karatId } })
    if (!karat) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Kadar emas tidak ditemukan.' })
    const user = requestUser(request)
    const price = await prisma.$transaction(async tx => {
      const created = await tx.goldPrice.create({ data: { karatId, pricePerGram, effectiveAt: effectiveAt ? new Date(effectiveAt) : new Date(), createdById: user.id } })
      await tx.auditLog.create({ data: { userId: user.id, action: 'PRICE_SET', entity: 'GoldPrice', entityId: created.id, detail: JSON.stringify({ karatId, pricePerGram: pricePerGram.toString() }) } })
      return created
    })
    return reply.code(201).send(serializeBigInts(price))
  })

  app.get<{ Params: { karatId: string } }>('/api/gold-prices/:karatId/current', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const { karatId } = request.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(karatId)) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Kadar emas tidak valid.' })
    const price = await prisma.goldPrice.findFirst({ where: { karatId, effectiveAt: { lte: new Date() } }, orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] })
    if (!price) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Harga emas belum tersedia.' })
    return serializeBigInts(price)
  })

  app.get<{ Params: { karatId: string }; Querystring: { skip?: string; take?: string } }>('/api/gold-prices/:karatId', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const { karatId } = request.params
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(karatId)) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Kadar emas tidak valid.' })
    const skip = request.query.skip ?? '0'
    const take = request.query.take ?? '50'
    if (!/^(0|[1-9]\d{0,6})$/.test(skip) || !/^[1-9]\d?$|^100$/.test(take)) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Halaman tidak valid.' })
    const prices = await prisma.goldPrice.findMany({ where: { karatId }, orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], skip: Number(skip), take: Number(take) })
    return serializeBigInts(prices)
  })

  app.get('/api/karats', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async () => prisma.karat.findMany({ orderBy: { sortOrder: 'asc' } }))

  app.get<{ Querystring: unknown }>('/api/items', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const parsed = itemQuerySchema.safeParse(request.query)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Filter stok tidak valid.' })
    const { query, status, skip, take } = parsed.data
    const where = { ...(status ? { status } : {}), ...(query ? { OR: [{ code: { contains: query } }, { name: { contains: query } }] } : {}) }
    const [items, total] = await prisma.$transaction([
      prisma.item.findMany({ where, include: { karat: true }, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.item.count({ where }),
    ])
    return { items: serializeBigInts(items), total }
  })

  app.get<{ Params: { id: string } }>('/api/items/:id', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const item = await prisma.item.findUnique({ where: { id: request.params.id }, include: { karat: true, movements: { orderBy: { createdAt: 'desc' } } } })
    if (!item) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Item tidak ditemukan.' })
    return serializeBigInts(item)
  })

  app.post<{ Body: unknown }>('/api/items', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const user = requestUser(request)
    const raw = request.body
    if (user.role === 'ASSISTANT' && raw && typeof raw === 'object' && 'laborCost' in raw) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Asisten tidak dapat mengatur ongkos.' })
    const parsed = createItemSchema.safeParse(raw)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Data item tidak valid.' })
    const { laborCost, ...data } = parsed.data
    try {
      const item = await prisma.$transaction(async tx => {
        const created = await tx.item.create({ data: { code: data.code, category: data.category, name: data.name, karatId: data.karatId, weightMg: data.weightMg, laborCost, photoPath: data.photoPath ?? null, note: data.note ?? null } })
        await tx.stockMovement.create({ data: { itemId: created.id, userId: user.id, type: 'RECEIVED', toStatus: 'IN_STORE', refType: 'MANUAL' } })
        await tx.auditLog.create({ data: { userId: user.id, action: 'ITEM_CREATE', entity: 'Item', entityId: created.id } })
        return created
      })
      return reply.code(201).send(serializeBigInts(item))
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') return reply.code(409).send({ error: 'DUPLICATE', message: 'Kode item sudah digunakan.' })
      throw error
    }
  })

  app.patch<{ Params: { id: string }; Body: unknown }>('/api/items/:id', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const user = requestUser(request)
    const parsed = updateItemSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Data item tidak valid.' })
    const { version, laborCost, ...data } = parsed.data
    const updateData: Prisma.ItemUncheckedUpdateManyInput = { version: { increment: 1 } }
    if (data.code !== undefined) updateData.code = data.code
    if (data.category !== undefined) updateData.category = data.category
    if (data.name !== undefined) updateData.name = data.name
    if (data.karatId !== undefined) updateData.karatId = data.karatId
    if (data.weightMg !== undefined) updateData.weightMg = data.weightMg
    if (data.photoPath !== undefined) updateData.photoPath = data.photoPath
    if (data.note !== undefined) updateData.note = data.note
    if (laborCost !== undefined) updateData.laborCost = laborCost
    if (user.role === 'ASSISTANT' && laborCost !== undefined) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Asisten tidak dapat mengubah ongkos.' })
    const current = await prisma.item.findUnique({ where: { id: request.params.id } })
    if (!current) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Item tidak ditemukan.' })
    if (current.version !== version) return reply.code(409).send({ error: 'CONFLICT', message: 'Item sudah berubah. Muat ulang data.' })
    const updated = await prisma.$transaction(async tx => {
      const result = await tx.item.updateMany({ where: { id: request.params.id, version }, data: updateData })
      if (result.count !== 1) throw Object.assign(new Error('CONFLICT'), { code: 'CONFLICT' })
      const item = await tx.item.findUniqueOrThrow({ where: { id: request.params.id } })
      await tx.auditLog.create({ data: { userId: user.id, action: 'ITEM_UPDATE', entity: 'Item', entityId: item.id } })
      return item
    })
    return serializeBigInts(updated)
  })

  app.delete<{ Params: { id: string } }>('/api/items/:id', { preHandler: requireRole(prisma, ['OWNER']) }, async (request, reply) => {
    const item = await prisma.item.findUnique({ where: { id: request.params.id } })
    if (!item) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Item tidak ditemukan.' })
    return reply.code(409).send({ error: 'ITEM_HISTORY_PRESERVED', message: 'Item tidak dapat dihapus karena riwayat stok harus dipertahankan.' })
  })

  app.post<{ Body: unknown }>('/api/sales', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const parsed = createSaleSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Data penjualan tidak valid.' })
    const input = parsed.data
    const user = requestUser(request)
    const receiptPrefix = new RegExp(`^${user.code}-([0-9]{8})-([A-Z0-9]{1,12})-([0-9]{3,})$`)
    const receiptParts = receiptPrefix.exec(input.receiptNo)
    const soldDate = new Date(input.soldAt)
    const expectedDate = `${soldDate.getUTCFullYear()}${String(soldDate.getUTCMonth() + 1).padStart(2, '0')}${String(soldDate.getUTCDate()).padStart(2, '0')}`
    if (!receiptParts || receiptParts[1] !== expectedDate || soldDate.getTime() > Date.now() + 5 * 60_000) return reply.code(400).send({ error: 'INVALID_RECEIPT', message: 'Nomor nota atau waktu transaksi tidak valid.' })
    if (input.payments.reduce((sum, payment) => sum + payment.amount, 0n) > 9_223_372_036_854_775_807n) return reply.code(400).send({ error: 'INVALID_PAYMENT', message: 'Jumlah pembayaran melebihi batas.' })
    try {
      const sale = await prisma.$transaction(async tx => {
        const processed = await tx.processedOp.findUnique({ where: { id: input.opId } })
        if (processed) {
          if (processed.userId !== user.id || processed.type !== 'CREATE_SALE') throw Object.assign(new Error(), { code: 'OP_CONFLICT' })
          return tx.sale.findUniqueOrThrow({ where: { id: input.saleId }, include: { items: true, payments: true } })
        }
        const soldAt = new Date(input.soldAt)
        const items = await tx.item.findMany({ where: { id: { in: input.itemIds } }, include: { karat: true } })
        if (items.length !== input.itemIds.length || items.some(item => item.status !== 'IN_STORE')) throw Object.assign(new Error(), { code: 'ITEM_NOT_AVAILABLE' })
        const lines = await Promise.all(items.map(async item => {
          const price = await tx.goldPrice.findFirst({ where: { karatId: item.karatId, effectiveAt: { lte: soldAt } }, orderBy: [{ effectiveAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }] })
          if (!price) throw Object.assign(new Error(), { code: 'MISSING_PRICE' })
          return { item, price, lineTotal: calculateLineTotal(item.weightMg, price.pricePerGram, item.laborCost) }
        }))
        const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0n)
        if (subtotal > 9_223_372_036_854_775_807n) throw Object.assign(new Error(), { code: 'INVALID_AMOUNT' })
        if (input.discount > subtotal) throw Object.assign(new Error(), { code: 'INVALID_DISCOUNT' })
        const total = subtotal - input.discount
        if (input.payments.reduce((sum, payment) => sum + payment.amount, 0n) !== total) throw Object.assign(new Error(), { code: 'PAYMENT_MISMATCH' })
        const sale = await tx.sale.create({ data: { id: input.saleId, receiptNo: input.receiptNo, cashierId: user.id, subtotal, discount: input.discount, total, soldAt, note: input.note ?? null } })
        for (const line of lines) {
          const updated = await tx.item.updateMany({ where: { id: line.item.id, status: 'IN_STORE', version: line.item.version }, data: { status: 'SOLD', version: { increment: 1 } } })
          if (updated.count !== 1) throw Object.assign(new Error(), { code: 'ITEM_NOT_AVAILABLE' })
          await tx.saleItem.create({ data: { saleId: sale.id, itemId: line.item.id, itemCode: line.item.code, itemName: line.item.name, karatLabel: line.item.karat.label, weightMg: line.item.weightMg, pricePerGram: line.price.pricePerGram, laborCost: line.item.laborCost, lineTotal: line.lineTotal } })
          await tx.stockMovement.create({ data: { itemId: line.item.id, userId: user.id, type: 'SOLD', fromStatus: 'IN_STORE', toStatus: 'SOLD', refType: 'SALE', refId: sale.id } })
          await tx.auditLog.create({ data: { userId: user.id, action: 'ITEM_SOLD', entity: 'Item', entityId: line.item.id, detail: JSON.stringify({ saleId: sale.id, fromStatus: 'IN_STORE', toStatus: 'SOLD' }) } })
        }
        for (const payment of input.payments) await tx.payment.create({ data: { id: payment.id, saleId: sale.id, method: payment.method, amount: payment.amount, reference: payment.reference ?? null, paidAt: soldAt } })
        await tx.auditLog.create({ data: { userId: user.id, action: 'SALE_CREATE', entity: 'Sale', entityId: sale.id } })
        await tx.processedOp.create({ data: { id: input.opId, userId: user.id, type: 'CREATE_SALE' } })
        return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: { items: true, payments: true } })
      })
      return reply.code(201).send(serializeBigInts(sale))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const messages: Record<string, string> = { ITEM_NOT_AVAILABLE: 'Salah satu item tidak tersedia.', MISSING_PRICE: 'Harga emas belum tersedia.', PAYMENT_MISMATCH: 'Jumlah pembayaran harus sama dengan total.', INVALID_DISCOUNT: 'Diskon melebihi subtotal.', OP_CONFLICT: 'ID operasi sudah digunakan.' }
      if (messages[code]) return reply.code(409).send({ error: code, message: messages[code] })
      throw error
    }
  })

  app.get<{ Params: { id: string } }>('/api/sales/:id', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const sale = await prisma.sale.findUnique({ where: { id: request.params.id }, include: { items: true, payments: true, cashier: { select: { code: true, name: true } } } })
    if (!sale) return reply.code(404).send({ error: 'NOT_FOUND', message: 'Penjualan tidak ditemukan.' })
    return serializeBigInts(sale)
  })

  app.get('/api/sales', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async () => serializeBigInts(await prisma.sale.findMany({ include: { items: true, payments: true }, orderBy: { soldAt: 'desc' }, take: 100 })))

  app.post<{ Params: { id: string }; Body: unknown }>('/api/sales/:id/void', { preHandler: requireRole(prisma, ['OWNER', 'ASSISTANT']) }, async (request, reply) => {
    const parsed = voidSaleSchema.safeParse(request.body)
    if (!parsed.success) return reply.code(400).send({ error: 'INVALID_INPUT', message: 'Data pembatalan tidak valid.' })
    const actor = requestUser(request)
    const now = Date.now()
    for (const [key, attempt] of ownerPinAttempts) if (attempt.resetAt <= now) ownerPinAttempts.delete(key)
    if (!reserveAttempt(ownerPinAttempts, request.ip, now) || !reserveAttempt(ownerPinAttempts, `account:${actor.id}`, now)) return reply.code(429).send({ error: 'TOO_MANY_ATTEMPTS', message: 'Terlalu banyak percobaan PIN pemilik. Coba lagi nanti.' })
    const owner = await prisma.user.findFirst({ where: { role: 'OWNER', isActive: true } })
    if (!owner || !(await verifyPin(parsed.data.ownerPin, owner.pinHash))) return reply.code(403).send({ error: 'INVALID_OWNER_PIN', message: 'PIN pemilik salah.' })
    try {
      const sale = await prisma.$transaction(async tx => {
        const processed = await tx.processedOp.findUnique({ where: { id: parsed.data.opId } })
        if (processed) return tx.sale.findUniqueOrThrow({ where: { id: request.params.id }, include: { items: true, payments: true } })
        const current = await tx.sale.findUnique({ where: { id: request.params.id }, include: { items: true } })
        if (!current || current.status !== 'COMPLETED') throw Object.assign(new Error(), { code: 'SALE_NOT_VOIDABLE' })
        for (const line of current.items) {
          const changed = await tx.item.updateMany({ where: { id: line.itemId, status: 'SOLD' }, data: { status: 'IN_STORE', version: { increment: 1 } } })
          if (changed.count !== 1) throw Object.assign(new Error(), { code: 'ITEM_CONFLICT' })
          await tx.stockMovement.create({ data: { itemId: line.itemId, userId: owner.id, type: 'SALE_VOIDED', fromStatus: 'SOLD', toStatus: 'IN_STORE', refType: 'SALE', refId: current.id } })
        }
        await tx.sale.update({ where: { id: current.id }, data: { status: 'VOIDED', voidReason: parsed.data.reason, voidedAt: new Date(), voidedById: owner.id } })
        await tx.auditLog.create({ data: { userId: actor.id, action: 'SALE_VOID', entity: 'Sale', entityId: current.id, detail: JSON.stringify({ authorizedBy: owner.id, reason: parsed.data.reason }) } })
        await tx.processedOp.create({ data: { id: parsed.data.opId, userId: actor.id, type: 'VOID_SALE' } })
        return tx.sale.findUniqueOrThrow({ where: { id: current.id }, include: { items: true, payments: true } })
      })
      return serializeBigInts(sale)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'SALE_NOT_VOIDABLE' || code === 'ITEM_CONFLICT') return reply.code(409).send({ error: code, message: 'Penjualan tidak dapat dibatalkan.' })
      throw error
    }
  })

  app.addHook('onClose', async () => prisma.$disconnect())

  return app
}
