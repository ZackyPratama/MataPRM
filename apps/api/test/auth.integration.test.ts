import { randomBytes } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hashPin, sessionTokenHash, verifyPin } from '../src/auth.js'
import { buildApp } from '../src/app.js'

const directory = await mkdtemp(join(tmpdir(), 'mataprm-auth-'))
const databaseUrl = `file:${join(directory, 'test.db')}`
const env = { ...process.env, DATABASE_URL: databaseUrl }
const prismaRoot = fileURLToPath(new URL('..', import.meta.url))
const args = ['exec', 'prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma']
execFileSync(process.execPath, [process.env.npm_execpath!, ...args], { cwd: prismaRoot, env, stdio: 'pipe' })
const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
let userId: string

beforeAll(async () => {
  const user = await prisma.user.create({ data: { code: 'IT', name: 'Integration', role: 'OWNER', pinHash: hashPin('123456') } })
  userId = user.id
})

afterAll(async () => {
  await prisma.$disconnect()
  await rm(directory, { recursive: true, force: true })
})

describe('authentication SQLite integration', () => {
  it('strictly validates scrypt format and rolls back session when audit insert fails', async () => {
    expect(await verifyPin('123456', `scrypt:${randomBytes(16).toString('hex')}:00`)).toBe(false)
    await prisma.$executeRawUnsafe('CREATE TRIGGER fail_login_audit BEFORE INSERT ON AuditLog BEGIN SELECT RAISE(ABORT, \'audit failure\'); END')
    const app = buildApp(prisma)
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'IT', pin: '123456' } })
    expect(response.statusCode).toBe(500)
    expect(await prisma.session.count()).toBe(0)
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_login_audit')
    await app.close()
  })

  it('logs in, stores only token hash, logs out, and rejects expired, revoked, or inactive sessions', async () => {
    const app = buildApp(prisma)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { code: 'IT', pin: '123456' } })
    expect(login.statusCode).toBe(200)
    const { token } = login.json()
    const stored = await prisma.session.findUniqueOrThrow({ where: { tokenHash: sessionTokenHash(token) } })
    expect(stored.tokenHash).not.toBe(token)
    expect(await prisma.auditLog.count({ where: { action: 'AUTH_LOGIN' } })).toBe(1)
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(204)
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(401)
    const expiredToken = randomBytes(32).toString('base64url')
    await prisma.session.create({ data: { tokenHash: sessionTokenHash(expiredToken), userId, expiresAt: new Date(0) } })
    const revokedToken = randomBytes(32).toString('base64url')
    await prisma.session.create({ data: { tokenHash: sessionTokenHash(revokedToken), userId, expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() } })
    for (const tokenValue of [expiredToken, revokedToken]) expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { authorization: `Bearer ${tokenValue}` } })).statusCode).toBe(401)
    await prisma.user.update({ where: { id: userId }, data: { isActive: false } })
    const inactiveToken = randomBytes(32).toString('base64url')
    await prisma.session.create({ data: { tokenHash: sessionTokenHash(inactiveToken), userId, expiresAt: new Date(Date.now() + 60_000) } })
    expect((await app.inject({ method: 'GET', url: '/api/auth/session', headers: { authorization: `Bearer ${inactiveToken}` } })).statusCode).toBe(401)
    await app.close()
  })
})
