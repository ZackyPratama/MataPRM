import assert from 'node:assert/strict'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
try {
  const users = await prisma.user.findMany()
  assert.equal(users.length, 2)
  assert.deepEqual(users.map(user => user.role).sort(), ['ASSISTANT', 'OWNER'])
  assert(users.every(user => /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(user.pinHash)))
  assert.equal(await prisma.karat.count(), 4)
  const items = await prisma.item.findMany({
    where: { code: { startsWith: 'SAMPLE-' } },
    include: { movements: true },
  })
  assert.equal(items.length, 3)
  for (const item of items) {
    assert.equal(item.movements.filter(movement => movement.type === 'RECEIVED').length, 1)
    assert.equal(await prisma.auditLog.count({ where: { entity: 'Item', entityId: item.id, action: 'ITEM_CREATE' } }), 1)
  }
} finally {
  await prisma.$disconnect()
}
