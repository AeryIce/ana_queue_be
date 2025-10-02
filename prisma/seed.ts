import { PrismaClient, TicketStatus } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Event
  const event = await prisma.event.upsert({
    where: { id: 'seed-event' },
    update: {},
    create: {
      id: 'seed-event',
      name: 'Ana Huang Book Signing',
      startsAt: new Date('2025-11-08T09:00:00+07:00'),
      endsAt: new Date('2025-11-08T17:00:00+07:00'),
    },
  });

  // Counters
  await prisma.counter.upsert({
    where: { name: 'Counter A' }, update: {}, create: { name: 'Counter A' },
  });
  await prisma.counter.upsert({
    where: { name: 'Counter B' }, update: {}, create: { name: 'Counter B' },
  });

  // Tickets AH-101..AH-220
    const ops: Promise<unknown>[] = [];
  for (let i = 101; i <= 220; i++) {
    const code = `AH-${i}`;
    const order = i - 100;
    ops.push(
      prisma.ticket.upsert({
        where: { code },
        update: {},
        create: {
          code,
          name: `Peserta ${order.toString().padStart(3, '0')}`,
          status: TicketStatus.QUEUED,
          order,
          eventId: event.id,
        },
      })
    );
  }
  await Promise.all(ops);

  console.log('✅ Seed completed');
}

main()
  .catch((e) => {
    console.error('❌ Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
