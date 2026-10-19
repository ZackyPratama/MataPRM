import { PrismaClient } from '@prisma/client'
import { hashPin } from '../src/auth.js'

const prisma = new PrismaClient()

async function main() {
  const users = [
    { code: 'A', name: 'Pemilik', role: 'OWNER', pin: process.env.SEED_OWNER_PIN ?? '123456' },
    { code: 'B', name: 'Asisten', role: 'ASSISTANT', pin: process.env.SEED_ASSISTANT_PIN ?? '654321' },
  ]

  if (process.env.NODE_ENV === 'production' && (!process.env.SEED_OWNER_PIN || !process.env.SEED_ASSISTANT_PIN)) {
    throw new Error('SEED_OWNER_PIN and SEED_ASSISTANT_PIN are required in production')
  }
  if (users.some(({ pin }) => !/^\d{6,}$/.test(pin))) {
    throw new Error('Seed PINs must contain at least six digits')
  }

  await prisma.$transaction(async (tx) => {
    for (const { code, name, role, pin } of users) {
      await tx.user.upsert({
        where: { code },
        update: {},
        create: { code, name, role, pinHash: hashPin(pin) },
      })
    }

    const karats = ['24K', '22K', '18K', '17K']
    for (const [sortOrder, label] of karats.entries()) {
      await tx.karat.upsert({ where: { label }, update: {}, create: { label, sortOrder } })
    }

    const owner = await tx.user.findUniqueOrThrow({ where: { code: 'A' } })
    const items = [
      { code: 'SAMPLE-001', category: 'CINCIN', name: 'Cincin contoh', karat: '24K', weightMg: 2500, laborCost: 100000n },
      { code: 'SAMPLE-002', category: 'KALUNG', name: 'Kalung contoh', karat: '22K', weightMg: 5000, laborCost: 150000n },
      { code: 'SAMPLE-003', category: 'GELANG', name: 'Gelang contoh', karat: '18K', weightMg: 4000, laborCost: 125000n },
    ]
    for (const { karat, ...item } of items) {
      const existing = await tx.item.findUnique({ where: { code: item.code } })
      if (!existing) {
        const created = await tx.item.create({
          data: { ...item, karat: { connect: { label: karat } } },
        })
        await tx.stockMovement.create({ data: { itemId: created.id, userId: owner.id, type: 'RECEIVED', toStatus: 'IN_STORE', refType: 'MANUAL' } })
        await tx.auditLog.create({ data: { userId: owner.id, action: 'ITEM_CREATE', entity: 'Item', entityId: created.id } })
      }
    }
  })
}

main().finally(() => prisma.$disconnect()).catch(() => {
  console.error('Seed failed')
  process.exitCode = 1
})
