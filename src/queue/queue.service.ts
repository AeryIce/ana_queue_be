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

  // ─────────────────────────────────────────────────────────
  // Helpers
  // ─────────────────────────────────────────────────────────

  /** Ambil slot yang sedang terpakai (IN_PROCESS) di event */
  private async getUsedSlots(
    tx: Prisma.TransactionClient,
    eventId: string,
  ): Promise<number[]> {
    const rows = await tx.ticket.findMany({
      where: { eventId, status: TicketStatus.IN_PROCESS, slotNo: { not: null } },
      select: { slotNo: true },
    });
    return rows
      .map((r) => (typeof r.slotNo === 'number' ? r.slotNo : -1))
      .filter((n) => n > 0)
      .sort((a, b) => a - b);
    }

  /** Ambil slot kosong (1..N) berdasarkan slot terpakai  */
  private async getFreeSlots(
    tx: Prisma.TransactionClient,
    eventId: string,
    N = ACTIVE_SLOTS,
  ): Promise<number[]> {
    const used = await this.getUsedSlots(tx, eventId);
    const all = Array.from({ length: N }, (_, i) => i + 1);
    return all.filter((s) => !used.includes(s));
  }

  /** Resolve tiket by id / code (di event tertentu) */
  private async findTicketByIdOrCode(
    tx: Prisma.TransactionClient,
    eventId: string,
    idOrCode: IdOrCode,
  ) {
    const { id, code } = idOrCode;
    if (!id && !code) throw new BadRequestException('id atau code wajib diisi');
    const t = await tx.ticket.findFirst({
      where: {
        eventId,
        ...(id ? { id } : {}),
        ...(code ? { code } : {}),
      },
    });
    if (!t) throw new NotFoundException('Ticket tidak ditemukan');
    return t;
  }

  private parseIdOrCode(v: string): IdOrCode {
    const s = String(v || '').trim();
    if (!s) return {};
    if (s.includes('-')) return { code: s };
    if (s.length > 20) return { id: s };
    return { code: s };
  }

  // ─────────────────────────────────────────────────────────
  // BOARD + POOL
  // ─────────────────────────────────────────────────────────

  /** Snapshot untuk TV/Queue/Admin */
  async board(eventId: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');

    // ambil list dengan transaksi (semua PrismaPromise)
    const [active, queued, deferred, next12] = await this.prisma.$transaction([
      this.prisma.ticket.findMany({
        where: { eventId, status: TicketStatus.IN_PROCESS },
        orderBy: [{ slotNo: 'asc' }, { order: 'asc' }],
        select: { id: true, code: true, name: true, status: true, order: true, slotNo: true },
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
        take: 12,
        select: { id: true, code: true, name: true, status: true, order: true },
      }),
    ]);

    // hitung totals DI LUAR $transaction (bukan PrismaPromise)
    const [a, q, c, d, dn] = await Promise.all([
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.IN_PROCESS } }),
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.QUEUED } }),
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.CALLED } }), // jika tidak dipakai akan 0
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.DEFERRED } }),
      this.prisma.ticket.count({ where: { eventId, status: TicketStatus.DONE } }),
    ]);

    const totals = {
      active: a,
      queue: q,
      called: c,
      skip: d, // skip grid = DEFERRED
      done: dn,
      queueBatches: Math.ceil(q / ACTIVE_SLOTS),
    };

    return {
      ok: true,
      active,
      queue: queued,
      skipGrid: deferred,
      next: next12,
      nextCount: next12.length,
      totals,
    };
  }

  /** Hitung saldo pool (DONATE - ALLOCATE) */
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

  /** Diagnostik pool + sample 5 baris */
  async diagPool(eventId: string) {
    const s = await this.getPoolSafe(eventId);
    const last = await this.prisma.surplusLedger.findMany({
      where: { eventId },
      orderBy: { createdAt: 'desc' },
      take: 5,
    });
    return { ...s, last };
  }

  /** Donasi manual (opsional) */
  async donate(eventId: string, amount: number) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    const amt = Math.max(0, Math.floor(Number(amount || 0)));
    if (amt <= 0) return { ok: false, error: 'amount harus > 0' };
    await this.prisma.surplusLedger.create({
      data: { eventId, type: 'DONATE', amount: amt, email: 'system', refRequestId: null },
    });
    return this.getPoolSafe(eventId);
  }

  // ─────────────────────────────────────────────────────────
  // PROMOTE / SKIP / RECALL / DONE
  // ─────────────────────────────────────────────────────────

  /** Naikkan QUEUED → IN_PROCESS untuk slot kosong, FIFO */
  async promoteQueueToActive(eventId: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');

    return this.prisma.$transaction(async (tx) => {
      const free = await this.getFreeSlots(tx, eventId, ACTIVE_SLOTS);
      if (free.length === 0) {
        return { ok: true, promoted: 0, codes: [], reason: 'no-free-slot' };
      }

      const pick = await tx.ticket.findMany({
        where: { eventId, status: TicketStatus.QUEUED },
        orderBy: { order: 'asc' },
        take: free.length,
        select: { id: true, code: true },
      });

      if (pick.length === 0) {
        return { ok: true, promoted: 0, codes: [], reason: 'queue-empty' };
      }

      // pasangkan tiket ke slot kosong terendah
      const toUpdate = pick.map((t, i) => ({ id: t.id, slotNo: free[i] }));

      for (const u of toUpdate) {
        await tx.ticket.update({
          where: { id: u.id },
          data: { status: TicketStatus.IN_PROCESS, slotNo: u.slotNo, updatedAt: new Date() },
        });
      }

      const codes = pick.map((p) => p.code).filter(Boolean) as string[];
      return { ok: true, promoted: pick.length, codes };
    });
  }

  /** Alias legacy: Call Next 6 */
  async callNextBatch(eventId: string) {
    return this.promoteQueueToActive(eventId);
  }

  /** Skip  IN_PROCESS → DEFERRED (bebaskan slot) */
  async skipActive(eventId: string, idOrCode: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    return this.prisma.$transaction(async (tx) => {
      const t = await this.findTicketByIdOrCode(tx, eventId, this.parseIdOrCode(idOrCode));
      if (t.status !== TicketStatus.IN_PROCESS) {
        return { ok: false, error: 'Ticket bukan IN_PROCESS' };
      }
      await tx.ticket.update({
        where: { id: t.id },
        data: { status: TicketStatus.DEFERRED, slotNo: null, updatedAt: new Date() },
      });
      return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.DEFERRED };
    });
  }

  /** Recall DEFERRED/QUEUED → IN_PROCESS bila ada slot kosong; jika penuh dan status DEFERRED → kembalikan ke QUEUED */
  async recall(eventId: string, idOrCode: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    return this.prisma.$transaction(async (tx) => {
      const t = await this.findTicketByIdOrCode(tx, eventId, this.parseIdOrCode(idOrCode));

      const free = await this.getFreeSlots(tx, eventId, ACTIVE_SLOTS);
      if (free.length === 0) {
        // tidak ada slot: kalau DEFERRED → antrikan lagi
        if (t.status === TicketStatus.DEFERRED) {
          await tx.ticket.update({
            where: { id: t.id },
            data: { status: TicketStatus.QUEUED, slotNo: null, updatedAt: new Date() },
          });
          return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.QUEUED, reason: 'no-free-slot' };
        }
        return { ok: false, error: 'Tidak ada slot kosong' };
      }

      const slot = free[0];
      await tx.ticket.update({
        where: { id: t.id },
        data: { status: TicketStatus.IN_PROCESS, slotNo: slot, updatedAt: new Date() },
      });
      return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.IN_PROCESS, slotNo: slot };
    });
  }

  /** Selesaikan → DONE (bebaskan slot) */
  async done(eventId: string, idOrCode: string) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    return this.prisma.$transaction(async (tx) => {
      const t = await this.findTicketByIdOrCode(tx, eventId, this.parseIdOrCode(idOrCode));
      await tx.ticket.update({
        where: { id: t.id },
        data: { status: TicketStatus.DONE, slotNo: null, updatedAt: new Date() },
      });
      return { ok: true, id: t.id, code: t.code, newStatus: TicketStatus.DONE };
    });
  }
}
