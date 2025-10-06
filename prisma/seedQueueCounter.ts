import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const eventId = 'seed-event' // ubah kalau eventId kamu berbeda
  const counterTable = 'queue_counters'

  // Pastikan Event ada
  await prisma.$executeRawUnsafe(`
    INSERT INTO "Event" ("id","name","createdAt","updatedAt")
    VALUES ($1, 'Seed Event', NOW(), NOW())
    ON CONFLICT ("id") DO NOTHING;
  `, eventId)

  // Pastikan QueueCounter ada
  await prisma.$executeRawUnsafe(`
    INSERT INTO "${counterTable}" ("id","eventId","name","nextOrder","createdAt","updatedAt")
    VALUES (gen_random_uuid(), $1, 'Default Counter', 1, NOW(), NOW())
    ON CONFLICT ("eventId") DO NOTHING;
  `, eventId)

  console.log('✅ QueueCounter seeded successfully for', eventId)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
