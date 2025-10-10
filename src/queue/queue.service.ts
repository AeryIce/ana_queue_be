import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TicketStatus } from '@prisma/client';

const ACTIVE_SLOT_SIZE = Number(process.env.ACTIVE_SLOT_SIZE ?? 6);

@Injectable()
export class QueueService {
  constructor(private prisma: PrismaService) {}

  // === Pool aman (selalu 200) ===
  async getPoolSafe(eventId: string) {
    if (!eventId) return { ok: false, pool: 0, reason: 'missing_eventId' };
    try {
      // Coba via Prisma model surplusLedger jika ada
      // @ts-ignore
      const rows = await (this.prisma as any)?.surplusLedger?.findMany?.({
        where: { eventId },
        select: { type: true, amount: true },
      });
      if (Array.isArray(rows)) {
        let pool = 0;
        for (const r of rows) {
          const t = String(r.type).toUpperCase();
          if (t === 'DONATE') pool += Number(r.amount || 0);
          else if (t === 'ALLOCATE') pool -= Number(r.amount || 0);
        }
        return { ok: true, eventId, pool, method: 'prisma' };
      }
    } catch {}

    // Fallback ke raw (PascalCase)
    try {
      const rowsB = await this.prisma.$queryRawUnsafe<{ pool: number }[]>(
        `
        SELECT COALESCE(SUM(
          CASE
            WHEN "type"::text = 'DONATE'   THEN amount
            WHEN "type"::text = 'ALLOCATE' THEN -amount
            ELSE 0
          END
        ), 0) AS pool
        FROM "SurplusLedger"
        WHERE "eventId" = $1
        `,
        eventId,
      );
      const pool = rowsB?.[0]?.pool ?? 0;
      return { ok: true, eventId, pool, method: 'raw_Pascal' };
    } catch {}

    return { ok: false, eventId, pool: 0, reason: 'no_ledger_table' };
  }

  // Diagnostic pool
  async diagPool(eventId: string) {
    const out: any = { eventId, tables: {}, tries: [] };
    try {
      const t1 = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public'`
      );
      out.tables.public = t1.map(r => r.table_name);
    } catch (e) {
      out.tables.error = e instanceof Error ? e.message : String(e);
    }
    try {
      const rowsB = await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT * FROM "SurplusLedger" WHERE "eventId" = $1 LIMIT 5`, eventId
      );
      out.tries.push({ method: 'raw_Pascal', ok: true, sample: rowsB });
    } catch (eB) {
      out.tries.push({ method: 'raw_Pascal', ok: false, error: eB instanceof Error ? eB.message : eB });
    }
    return out;
  }

  // Donate ke pool
  async donate(eventId: string, amount: number) {
    if (!eventId) throw new Error('eventId required');
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "SurplusLedger" ("eventId","type","amount") VALUES ($1,$2,$3)`,
      eventId, 'DONATE', amount
    );
    return this.getPoolSafe(eventId);
  }

  // ==== Ops tanpa batch ====

  // Promosikan tiket QUEUED ke ACTIVE (maks ACTIVE_SLOT_SIZE)
  async promoteQueueToActive(eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.ticket.findMany({
        where: { eventId, status: TicketStatus.ACTIVE },
        select: { id: true },
      });
      const free = Math.max(0, ACTIVE_SLOT_SIZE - active.length);
      if (free <= 0) return { filled: 0, active: active.length };

      const heads = await tx.ticket.findMany({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: [{ order: 'asc' }],
        take: free,
      });
      for (const h of heads) {
        await tx.ticket.update({
          where: { id: h.id },
          data: { status: TicketStatus.ACTIVE },
        });
      }
      const afterActive = await tx.ticket.findMany({
        where: { eventId, status: TicketStatus.ACTIVE },
      });
      return { filled: heads.length, active: afterActive };
    });
  }

  // === KOMPAT LEGACY: dipanggil oleh legacy.controller.ts ===
  async callNextBatch(eventId: string) {
    // untuk schema lama, cukup promosikan head of queue ke ACTIVE
    return this.promoteQueueToActive(eventId);
  }

  // Skip ACTIVE -> balik QUEUED (ke ekor: kita pakai order besar saja biar di akhir)
  async skipActive(eventId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id, eventId } });
      if (!t || t.status !== TicketStatus.ACTIVE) {
        throw new BadRequestException('Not ACTIVE');
      }
      // Dorong ke ekor: set order = max(order)+1
      const maxRow = await tx.$queryRawUnsafe<{ max: number }[]>(
        `SELECT COALESCE(MAX("order"),0)::int AS max FROM "Ticket" WHERE "eventId" = $1`,
        eventId,
      );
      const nextOrder = (maxRow?.[0]?.max ?? 0) + 1;

      await tx.ticket.update({
        where: { id },
        data: { status: TicketStatus.QUEUED, ...(Number.isFinite(nextOrder) ? { order: nextOrder } : {}) },
      });

      return { ok: true, movedToOrder: nextOrder };
    });
  }

  // Recall tiket QUEUED ke ACTIVE (jika ada slot)
  async recall(eventId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id, eventId } });
      if (!t) throw new BadRequestException('Not found');

      const activeCount = await tx.ticket.count({ where: { eventId, status: TicketStatus.ACTIVE } });
      if (activeCount >= ACTIVE_SLOT_SIZE) throw new BadRequestException('No free active slot');

      return tx.ticket.update({ where: { id }, data: { status: TicketStatus.ACTIVE } });
    });
  }

  // Selesaikan ACTIVE -> DONE
  async done(eventId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id, eventId } });
      if (!t || t.status !== TicketStatus.ACTIVE) {
        throw new BadRequestException('Not ACTIVE');
      }
      await tx.ticket.update({
        where: { id },
        data: { status: TicketStatus.DONE },
      });
      return { ok: true };
    });
  }

  // Snapshot sederhana untuk Board/TV (tanpa batch)
  async board(eventId: string) {
    const [active, queued] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.ACTIVE },
        orderBy: [{ order: 'asc' }],
        select: { id: true, code: true, name: true, status: true, order: true },
      }),
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: [{ order: 'asc' }],
        select: { id: true, code: true, name: true, status: true, order: true },
      }),
    ]);

    return {
      active,
      queue: queued,
      next: [],
      skipGrid: [],
      nextCount: 0,
      totals: {
        active: active.length,
        queued: queued.length,
      },
    };
  }
}
