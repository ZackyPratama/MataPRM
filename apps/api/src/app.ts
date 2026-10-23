import Fastify from 'fastify'
import type { PrismaClient } from '@prisma/client'
import { createGoldPriceSchema, serializeBigInts, sharedMessage } from '@mataprm/shared'
import { createSession, requestUser, requireRole, sessionTokenHash, verifyPin } from './auth.js'
import { prisma as defaultPrisma } from './database.js'

const attemptLimit = 5
const attemptWindowMs = 15 * 60 * 1000

export function buildApp(prisma: PrismaClient = defaultPrisma) {
  const app = Fastify()
  const ipAttempts = new Map<string, { count: number; resetAt: number }>()
  const accountAttempts = new Map<string, { count: number; resetAt: number }>()
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

  app.addHook('onClose', async () => prisma.$disconnect())

  return app
}
