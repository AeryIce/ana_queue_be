import { PrismaClient } from '@prisma/client'
const prisma = new PrismaClient()

async function main() {
  const eventId = 'seed-event' // ganti kalau eventId kamu berbeda

  // Pastikan event ada
  await prisma.event.upsert({
    where: { id: eventId },
    update: {},
    create: { id: eventId, name: 'Seed Event' },
  })

  // Siapkan counter nomor urut
  await prisma.queueCounter.upsert({
    where: { eventId },
    update: {},
    create: { eventId, nextOrder: 1 },
  })

  console.log('✅ QueueCounter ready for', eventId)
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
