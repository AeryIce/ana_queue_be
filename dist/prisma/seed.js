"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
async function main() {
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
    await prisma.counter.upsert({
        where: { name: 'Counter A' }, update: {}, create: { name: 'Counter A' },
    });
    await prisma.counter.upsert({
        where: { name: 'Counter B' }, update: {}, create: { name: 'Counter B' },
    });
    const ops = [];
    for (let i = 101; i <= 220; i++) {
        const code = `AH-${i}`;
        const order = i - 100;
        ops.push(prisma.ticket.upsert({
            where: { code },
            update: {},
            create: {
                code,
                name: `Peserta ${order.toString().padStart(3, '0')}`,
                status: client_1.TicketStatus.QUEUED,
                order,
                eventId: event.id,
            },
        }));
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
//# sourceMappingURL=seed.js.map