// src/queue/queue.service.ts — REPLACE ALL

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma, TicketStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';

type IdOrCode = { id?: string; code?: string };

const ACTIVE_SLOTS =
  Number(process.env.ACTIVE_SLOT_SIZE) ||
  Number(process.env.NEXT_PUBLIC_ACTIVE_SLOT_SIZE) ||
  6;

@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  private parseIdOrCode(v: string): IdOrCode {
    const s = String(v || '').trim();
    if (!s) return {};
    if (s.includes('-')) return { code: s };
    if (s.length > 20) return { id: s };
    return { code: s };
  }

  private async findTicketByIdOrCode(
    tx: Prisma.TransactionClient,
    eventId: string,
    idOrCode: IdOrCode,
  ) {
    const { id, code } = idOrCode;
    if (!id && !code) throw new BadRequestException('id atau code wajib diisi');
    const t = await tx.ticket.findFirst({
      where: { eventId, ...(id ? { id } : {}), ...(code ? { code } : {}) },
    });
    if (!t) throw new NotFoundException('Ticket tidak ditemukan');
    return t;
  }

  // ─── BOARD & POOL ───────────────────────────────────────
  async board(eventId: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');

    const [active, queued, deferred, nextN] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.IN_PROCESS },
        orderBy: [{ order: 'asc' }],
        select: { id: true, code: true, name: true, status: true, order: true },
      }),
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: [{ order: 'asc' }],
        select: { id: true, code: true, name: true, status: true, order: true },
      }),
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.DEFERRED },
        orderBy: [{ updatedAt: 'desc' }],
        select: { id: true, code: true, name: true, status: true, order: true },
      }),
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: [{ order: 'asc' }],
        take: 60, // tampilkan banyak agar Next nggak mentok 5
        select: { id: true, code: true, name: true, status: true, order: true },
      }),
    ]);

    const [a, q, c, d, dn] = await Promise.all([
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.IN_PROCESS } }),
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.QUEUED } }),
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.CALLED } }),
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.DEFERRED } }),
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.DONE } }),
    ]);

    return {
      ok: true,
      active,
      queue: queued,
      skipGrid: deferred,
      next: nextN,
      nextCount: nextN.length,
      totals: {
        active: a,
        queue: q,
        called: c,
        skip: d,
        done: dn,
        queueBatches: Math.ceil(q / ACTIVE_SLOTS),
      },
    };
  }

  async getPoolSafe(eventId: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    const r = await this.prisma.$queryRaw<Array<{ balance: number }>>`
      SELECT COALESCE(SUM(CASE
        WHEN "type" = 'DONATE' THEN "amount"
        WHEN "type" = 'ALLOCATE' THEN - "amount"
        ELSE 0 END), 0)::int AS balance
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId};
    `;
    return { ok: true, eventId, pool: Number(r?.[0]?.balance ?? 0), method: 'getPoolSafe' };
  }

  async diagPool(eventId: string) {
    const s = await this.getPoolSafe(eventId);
    const last = await this.prisma.surplusLedger.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return { ...s, last };
  }

  async donate(eventId: string, amount: number) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    const amt = Math.max(0, Math.floor(Number(amount || 0)));
    if (amt <= 0) return { ok: false, error: 'amount harus > 0' };
    await this.prisma.surplusLedger.create({
      data: { eventId, type: 'DONATE', amount: amt, email: 'system', refRequestId: null },
    });
    return this.getPoolSafe(eventId);
  }

  // ─── PROMOTE / SKIP / RECALL / DONE (tanpa slotNo) ─────
  async promoteQueueToActive(eventId: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');

    return this.prisma.$transaction(async (tx) => {
      const activeCount = await tx.ticket.count({
        where: { eventId, status: TicketStatus.IN_PROCESS },
      });
      const capacity = Math.max(0, ACTIVE_SLOTS - activeCount);
      if (capacity <= 0) return { ok: true, promoted: 0, codes: [], reason: 'no-free-slot' };

      const pick = await tx.ticket.findMany({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: { order: 'asc' },
        take: capacity,
        select: { id: true, code: true },
      });
      if (pick.length === 0) return { ok: true, promoted: 0, codes: [], reason: 'queue-empty' };

      for (const t of pick) {
        await tx.ticket.update({
          where: { id: t.id },
          data: { status: TicketStatus.IN_PROCESS, updatedAt: new Date() },
        });
      }
      const codes = pick.map((p) => p.code).filter(Boolean) as string[];
      return { ok: true, promoted: pick.length, codes };
    });
  }

  async callNextBatch(eventId: string) {
    return this.promoteQueueToActive(eventId);
  }

  async skipActive(eventId: string, idOrCode: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    return this.prisma.$transaction(async (tx) => {
      const t = await this.findTicketByIdOrCode(tx, eventId, this.parseIdOrCode(idOrCode));
      if (t.status !== TicketStatus.IN_PROCESS) return { ok: false, error: 'Ticket bukan IN_PROCESS' };
      await tx.ticket.update({
        where: { id: t.id },
        data: { status: TicketStatus.DEFERRED, updatedAt: new Date() },
      });
      return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.DEFERRED };
    });
  }

  async recall(eventId: string, idOrCode: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    return this.prisma.$transaction(async (tx) => {
      const t = await this.findTicketByIdOrCode(tx, eventId, this.parseIdOrCode(idOrCode));

      const activeCount = await tx.ticket.count({
        where: { eventId, status: TicketStatus.IN_PROCESS },
      });
      const capacity = Math.max(0, ACTIVE_SLOTS - activeCount);

      if (capacity <= 0) {
        if (t.status === TicketStatus.DEFERRED) {
          await tx.ticket.update({
            where: { id: t.id },
            data: { status: TicketStatus.QUEUED, updatedAt: new Date() },
          });
          return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.QUEUED, reason: 'no-free-slot' };
        }
        return { ok: false, error: 'Tidak ada slot kosong' };
      }

      await tx.ticket.update({
        where: { id: t.id },
        data: { status: TicketStatus.IN_PROCESS, updatedAt: new Date() },
      });
      return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.IN_PROCESS };
    });
  }

  async done(eventId: string, idOrCode: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    return this.prisma.$transaction(async (tx) => {
      const t = await this.findTicketByIdOrCode(tx, eventId, this.parseIdOrCode(idOrCode));
      await tx.ticket.update({
        where: { id: t.id },
        data: { status: TicketStatus.DONE, updatedAt: new Date() },
      });
      return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.DONE };
    });
  }
}
