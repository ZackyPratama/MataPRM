import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { FastifyReply, FastifyRequest } from 'fastify'
import type { PrismaClient, User } from '@prisma/client'

const scryptAsync = promisify(scrypt)
const sessionDurationMs = 8 * 60 * 60 * 1000

type AuthenticatedRequest = FastifyRequest & { user: User }

export function hashPin(pin: string): string {
  const salt = randomBytes(16).toString('hex')
  return `scrypt:${salt}:${scryptSync(pin, salt, 64).toString('hex')}`
}

export async function verifyPin(pin: string, encoded: string): Promise<boolean> {
  const match = /^scrypt:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(encoded)
  if (!match) return false
  const salt = match[1]!
  const hash = match[2]!
  const expected = Buffer.from(hash, 'hex')
  const actual = (await scryptAsync(pin, salt, 64)) as Buffer
  return timingSafeEqual(expected, actual)
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export async function createSession(prisma: PrismaClient, userId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url')
  await prisma.$transaction(async tx => {
    await tx.session.create({ data: { tokenHash: tokenHash(token), userId, expiresAt: new Date(Date.now() + sessionDurationMs) } })
    await tx.auditLog.create({ data: { userId, action: 'AUTH_LOGIN', entity: 'Session' } })
  })
  return token
}

export async function authenticate(request: FastifyRequest, prisma: PrismaClient): Promise<User | null> {
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) return null
  const token = authorization.slice(7)
  if (!token) return null
  const session = await prisma.session.findUnique({ where: { tokenHash: tokenHash(token) }, include: { user: true } })
  if (!session || session.revokedAt || session.expiresAt <= new Date() || !session.user.isActive) return null
  return session.user
}

export function requireRole(prisma: PrismaClient, roles: string[]) {
  return async function roleGuard(request: FastifyRequest, reply: FastifyReply) {
    const user = await authenticate(request, prisma)
    if (!user) return reply.code(401).send({ error: 'UNAUTHORIZED', message: 'Silakan login kembali.' })
    if (!roles.includes(user.role)) return reply.code(403).send({ error: 'FORBIDDEN', message: 'Anda tidak memiliki akses.' })
    ;(request as AuthenticatedRequest).user = user
  }
}

export function requestUser(request: FastifyRequest): User {
  return (request as AuthenticatedRequest).user
}

export function sessionTokenHash(token: string): string {
  return tokenHash(token)
}
