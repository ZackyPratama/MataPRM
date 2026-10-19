import type { PrismaClient } from '@prisma/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashPin, requireRole } from '../src/auth.js'
import { buildApp } from '../src/app.js'

function mockPrisma() {
  const users = [
    { id: 'owner-id', code: 'A', name: 'Pemilik', role: 'OWNER', pinHash: hashPin('123456'), isActive: true },
    { id: 'assistant-id', code: 'B', name: 'Asisten', role: 'ASSISTANT', pinHash: hashPin('654321'), isActive: true },
  ]
  const sessions = new Map<string, { tokenHash: string; userId: string; expiresAt: Date; revokedAt: Date | null }>()
  const auditLog = { create: vi.fn(async () => ({})) }
  const client = {
    auditLog,
    user: { findUnique: vi.fn(async ({ where }: { where: { code?: string; id?: string } }) => users.find(user => user.code === where.code || user.id === where.id) ?? null) },
    session: {
      create: vi.fn(async ({ data }: { data: { tokenHash: string; userId: string; expiresAt: Date } }) => { sessions.set(data.tokenHash, { ...data, revokedAt: null }); return data }),
      findUnique: vi.fn(async ({ where }: { where: { tokenHash: string } }) => { const session = sessions.get(where.tokenHash); const user = users.find(item => item.id === session?.userId); return session && user ? { ...session, user } : null }),
      update: vi.fn(async ({ where, data }: { where: { tokenHash: string }; data: { revokedAt: Date } }) => { const session = sessions.get(where.tokenHash); if (!session) throw new Error('not found'); session.revokedAt = data.revokedAt; return session }),
    },
    $transaction: vi.fn(async (operations: ((tx: unknown) => Promise<unknown>) | Promise<unknown>[]) => typeof operations === 'function' ? operations(client) : Promise.all(operations)),
    $disconnect: vi.fn(async () => undefined),
  }
  return client as unknown as PrismaClient & { auditLog: typeof auditLog }
}

afterEach(() => vi.restoreAllMocks())

describe('authentication and authorization', () => {
  it('logs in with PIN and returns session', async () => {
    const prisma = mockPrisma()
    const app = buildApp(prisma)
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'A', pin: '123456' } })
    expect(response.statusCode).toBe(200)
    expect(response.json().user.role).toBe('OWNER')
    expect(response.json().token).toEqual(expect.any(String))
    expect(prisma.auditLog.create).toHaveBeenCalledWith({ data: { userId: 'owner-id', action: 'AUTH_LOGIN', entity: 'Session' } })
    await app.close()
  })

  it('rejects invalid PIN and malformed input', async () => {
    const app = buildApp(mockPrisma())
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'A', pin: '000000' } })).statusCode).toBe(401)
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 1, pin: 123456 } })).statusCode).toBe(400)
    await app.close()
  })

  it('enforces session and owner role', async () => {
    const prisma = mockPrisma()
    const app = buildApp(prisma)
    app.get('/test-owner', { preHandler: requireRole(prisma, ['OWNER']) }, async () => ({}))
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'B', pin: '654321' } })
    const token = login.json().token
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/test-owner', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'GET', url: '/api/auth/session' })).statusCode).toBe(401)
    await app.close()
  })

  it('reserves concurrent attempts before database lookup and limits accounts across IPs', async () => {
    const prisma = mockPrisma()
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    const findUser = prisma.user.findUnique.bind(prisma.user)
    vi.spyOn(prisma.user, 'findUnique').mockImplementation((args) => (barrier.then(() => findUser(args)) as never))
    const app = buildApp(prisma)
    const requests = Array.from({ length: 6 }, (_, index) => app.inject({ method: 'POST', url: '/api/auth/login', remoteAddress: `10.0.0.${index + 1}`, payload: { code: 'A', pin: '000000' } }))
    await new Promise(resolve => setTimeout(resolve, 20))
    release()
    const responses = await Promise.all(requests)
    expect(responses.filter(response => response.statusCode === 429)).toHaveLength(1)
    await app.close()
  })

  it('revokes session on logout and rate limits failed PINs', async () => {
    const prisma = mockPrisma()
    const app = buildApp(prisma)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'A', pin: '123456' } })
    const token = login.json().token
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    const blockedApp = buildApp(mockPrisma())
    for (let i = 0; i < 5; i += 1) await blockedApp.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'A', pin: '000000' } })
    expect((await blockedApp.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'A', pin: '000000' } })).statusCode).toBe(429)
    await app.close()
    await blockedApp.close()
  })
})
