import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import type { Prisma, Ticket } from '@prisma/client';
import { TicketStatus } from '@prisma/client';

const ACTIVE_SLOT_SIZE = Number(process.env.ACTIVE_SLOT_SIZE ?? 6);
const BATCH_SIZE = 6;

@Injectable()
export class QueueService {
  constructor(private prisma: PrismaService) {}

  // === NEW: Pool selalu 200; fallback pool:0 agar FE tidak 500 ===
  async getPoolSafe(eventId: string) {
    if (!eventId) return { ok: false, pool: 0, reason: 'missing_eventId' };
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ pool: number }[]>(
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
      const pool = rows?.[0]?.pool ?? 0;
      return { ok: true, eventId, pool };
    } catch {
      // kalau tabel ledger belum ada / enum beda → jangan 500
      return { ok: false, eventId, pool: 0, reason: 'query_error' };
    }
  }

  // Ambil kepala Queue (batch-1) FIFO
  private async popFromQueueHead(tx: Prisma.TransactionClient, eventId: string) {
    const head = await tx.ticket.findFirst({
      where: { eventId, status: TicketStatus.QUEUED },
      orderBy: [{ batchNo: 'asc' as const }, { posInBatch: 'asc' as const }],
    });
    if (!head) return null;

    await tx.$executeRawUnsafe(
      `
      UPDATE "Ticket"
      SET "posInBatch" = "posInBatch" - 1
      WHERE "eventId" = $1 AND "status" = 'QUEUED' AND "batchNo" = $2
      `,
      eventId,
      head.batchNo
    );
    return head;
  }

  private async pushToQueueEnd(
    tx: Prisma.TransactionClient,
    t: { id: string; eventId: string; isSkipped?: boolean | null }
  ) {
    const last = await tx.ticket.findFirst({
      where: { eventId: t.eventId, status: TicketStatus.QUEUED },
      orderBy: [{ batchNo: 'desc' as const }, { posInBatch: 'desc' as const }],
    });

    let nextBatch = 1;
    let nextPos = 1;
    if (last?.batchNo) {
      nextBatch = last.batchNo;
      nextPos = (last.posInBatch ?? 0) + 1;
      if (nextPos > BATCH_SIZE) {
        nextBatch = last.batchNo + 1;
        nextPos = 1;
      }
    }

    return tx.ticket.update({
      where: { id: t.id },
      data: {
        status: TicketStatus.QUEUED,
        batchNo: nextBatch,
        posInBatch: nextPos,
        slotNo: null,
        isSkipped: t.isSkipped ?? false,
      },
    });
  }

  private async fillOneActiveSlot(
    tx: Prisma.TransactionClient,
    eventId: string,
    slotNo: number
  ) {
    const next = await this.popFromQueueHead(tx, eventId);
    if (!next) return null;

    return tx.ticket.update({
      where: { id: next.id },
      data: {
        status: TicketStatus.ACTIVE,
        slotNo,
        batchNo: null,
        posInBatch: null,
        inProcess: true,
        inProcessAt: new Date(),
        isSkipped: false,
      },
    });
  }

  async callNextBatch(eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const next6 = await tx.ticket.findMany({
        where: { eventId, status: TicketStatus.CONFIRMED },
        orderBy: [{ confirmedAt: 'asc' as const }],
        take: BATCH_SIZE,
      });
      if (next6.length === 0) return { added: 0 };

      const last = await tx.ticket.findFirst({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: [{ batchNo: 'desc' as const }, { posInBatch: 'desc' as const }],
      });
      const lastNo = last?.batchNo ?? 0;
      const newBatchNo = lastNo + 1;

      await Promise.all(
        next6.map((t, i) =>
          tx.ticket.update({
            where: { id: t.id },
            data: {
              status: TicketStatus.QUEUED,
              batchNo: newBatchNo,
              posInBatch: i + 1,
            },
          })
        )
      );

      return { added: next6.length, batchNo: newBatchNo };
    });
  }

  async promoteQueueToActive(eventId: string) {
    return this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.ticket.count({
        where: { eventId, status: TicketStatus.ACTIVE },
      });
      if (activeCount > 0) {
        throw new BadRequestException('Active must be empty to promote.');
      }

      const results: Ticket[] = [];
      for (let slot = 1; slot <= ACTIVE_SLOT_SIZE; slot++) {
        const filled = await this.fillOneActiveSlot(tx, eventId, slot);
        if (!filled) break;
        results.push(filled);
      }
      return { filled: results.length, active: results };
    });
  }

  async skipActive(eventId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id, eventId } });
      if (!t || t.status !== TicketStatus.ACTIVE) {
        throw new BadRequestException('Not ACTIVE');
      }

      const slot = t.slotNo!;
      await tx.ticket.update({
        where: { id },
        data: {
          isSkipped: true,
          skippedAt: new Date(),
          inProcess: false,
          inProcessAt: null,
          status: TicketStatus.QUEUED,
          slotNo: null,
        },
      });
      await this.pushToQueueEnd(tx, { id, eventId, isSkipped: true });

      const replacement = await this.fillOneActiveSlot(tx, eventId, slot);
      return { replacedBy: replacement?.id ?? null };
    });
  }

  async recall(eventId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id, eventId } });
      if (!t) throw new BadRequestException('Not found');

      const used = await tx.ticket.findMany({
        where: { eventId, status: TicketStatus.ACTIVE },
        select: { slotNo: true },
      });
      const taken = new Set(used.map((s) => s.slotNo!));
      const free = Array.from({ length: ACTIVE_SLOT_SIZE }, (_, i) => i + 1).find(
        (s) => !taken.has(s)
      );

      if (free) {
        return tx.ticket.update({
          where: { id },
          data: {
            status: TicketStatus.ACTIVE,
            slotNo: free,
            batchNo: null,
            posInBatch: null,
            isSkipped: false,
            inProcess: true,
            inProcessAt: new Date(),
          },
        });
      }

      const preemptSlot = ACTIVE_SLOT_SIZE;
      const kicked = await tx.ticket.findFirst({
        where: { eventId, status: TicketStatus.ACTIVE, slotNo: preemptSlot },
      });
      if (!kicked) throw new BadRequestException('No slot to preempt');

      await tx.ticket.update({
        where: { id: kicked.id },
        data: {
          status: TicketStatus.QUEUED,
          batchNo: 1,
          posInBatch: 1,
          slotNo: null,
          inProcess: false,
          inProcessAt: null,
        },
      });
      await tx.$executeRawUnsafe(
        `
        UPDATE "Ticket"
        SET "posInBatch" = "posInBatch" + 1
        WHERE "eventId" = $1 AND "status" = 'QUEUED' AND "batchNo" = 1 AND "id" <> $2
        `,
        eventId,
        kicked.id
      );

      return tx.ticket.update({
        where: { id },
        data: {
          status: TicketStatus.ACTIVE,
          slotNo: preemptSlot,
          batchNo: null,
          posInBatch: null,
          isSkipped: false,
          inProcess: true,
          inProcessAt: new Date(),
        },
      });
    });
  }

  async done(eventId: string, id: string) {
    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.findFirst({ where: { id, eventId } });
      if (!t || t.status !== TicketStatus.ACTIVE) {
        throw new BadRequestException('Not ACTIVE');
      }

      const ms = t.inProcessAt
        ? Date.now() - new Date(t.inProcessAt).getTime()
        : null;

      await tx.ticket.update({
        where: { id },
        data: {
          status: TicketStatus.DONE,
          slotNo: null,
          inProcess: false,
          inProcessAt: null,
          processingMs: ms ? BigInt(ms) : null,
        },
      });

      return { ok: true };
    });
  }

  // Snapshot untuk FE/TV
  async board(eventId: string) {
    const [active, queued, next, skip] = await Promise.all([
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.ACTIVE },
        orderBy: [{ slotNo: 'asc' as const }],
      }),
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: [{ batchNo: 'asc' as const }, { posInBatch: 'asc' as const }],
      }),
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.CONFIRMED },
        orderBy: [{ confirmedAt: 'asc' as const }],
      }),
      this.prisma.ticket.findMany({
        where: {
          eventId,
          isSkipped: true,
          status: { in: [TicketStatus.QUEUED, TicketStatus.ACTIVE] },
        },
        orderBy: [{ skippedAt: 'asc' as const }],
      }),
    ]);

    const batches = queued.reduce<Record<number, Ticket[]>>((acc, t) => {
      if (!t.batchNo) return acc;
      acc[t.batchNo] = acc[t.batchNo] ?? [];
      acc[t.batchNo].push(t);
      return acc;
    }, {});

    return {
      active,
      queue: Object.entries(batches).map(([no, items]) => ({
        batchNo: Number(no),
        items,
      })),
      nextCount: next.length,
      next: next.slice(0, 10),
      skipGrid: skip,
      totals: {
        active: active.length,
        queueBatches: Object.keys(batches).length,
        next: next.length,
        skip: skip.length,
        siapAntri: active.length + queued.length + next.length + skip.length,
      },
    };
  }
}
