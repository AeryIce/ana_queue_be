import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type TicketStatus = 'QUEUED' | 'IN_PROCESS' | 'SKIPPED' | 'DONE';

function getActiveSize(): number {
  const raw =
    process.env.ACTIVE_SLOT_SIZE ||
    process.env.NEXT_PUBLIC_ACTIVE_SLOT_SIZE ||
    '6';
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 6;
}

@Injectable()
export class QueueService {
  constructor(private readonly prisma: PrismaService) {}

  private async getUsedSlots(tx: PrismaService, eventId: string): Promise<number[]> {
    const rows = await tx.ticket.findMany({
      where: { eventId, status: 'IN_PROCESS' as TicketStatus },
      select: { slotNo: true },
    });
    return rows
      .map((r) => (typeof (r as any).slotNo === 'number' ? (r as any).slotNo : null))
      .filter((x): x is number => x !== null && Number.isFinite(x));
  }

  private freeSlots(used: number[], N: number): number[] {
    const set = new Set(used);
    const frees: number[] = [];
    for (let i = 1; i <= N; i++) {
      if (!set.has(i)) frees.push(i);
    }
    return frees;
  }

  /** Promosikan tiket QUEUED tertua ke slot aktif yang kosong (status → IN_PROCESS). */
  async promote(eventId: string) {
    const N = getActiveSize();
    return this.prisma.$transaction(async (tx) => {
      const used = await this.getUsedSlots(tx, eventId);
      const frees = this.freeSlots(used, N);
      if (frees.length === 0) {
        return { ok: true, promoted: 0, message: 'Tidak ada slot kosong' };
      }

      // Ambil kandidat dari QUEUED paling tua sesuai order
      const candidates = await tx.ticket.findMany({
        where: { eventId, status: 'QUEUED' as TicketStatus },
        orderBy: { order: 'asc' },
        take: frees.length,
        select: { id: true, code: true, order: true },
      });

      if (candidates.length === 0) {
        return { ok: true, promoted: 0, message: 'Tidak ada tiket dalam antrian' };
      }

      // Assign slot berurutan ke kandidat
      const updates = await Promise.all(
        candidates.map((t, idx) =>
          tx.ticket.update({
            where: { id: t.id },
            data: {
              status: 'IN_PROCESS',
              slotNo: frees[idx],
              updatedAt: new Date(),
            },
            select: { code: true, slotNo: true, order: true },
          }),
        ),
      );

      return {
        ok: true,
        promoted: updates.length,
        slotsUsed: updates.map((u) => u.slotNo),
        codes: updates.map((u) => u.code),
      };
    });
  }

  /** Recall kode dari SKIPPED → IN_PROCESS kalau ada slot; kalau penuh → QUEUED. */
  async recallByCode(eventId: string, code: string) {
    const N = getActiveSize();

    return this.prisma.$transaction(async (tx) => {
      const t = await tx.ticket.findFirst({
        where: { eventId, code },
        select: { id: true, status: true },
      });
      if (!t) return { ok: false, error: 'Ticket tidak ditemukan' };

      const status = t.status as TicketStatus;
      if (status !== 'SKIPPED' && status !== 'QUEUED') {
        // Kalau sudah IN_PROCESS/DONE, anggap no-op
        return { ok: true, message: 'Ticket bukan SKIPPED/QUEUED, abaikan' };
      }

      const used = await this.getUsedSlots(tx, eventId);
      const frees = this.freeSlots(used, N);

      if (frees.length > 0) {
        const slot = frees[0];
        await tx.ticket.update({
          where: { id: t.id },
          data: { status: 'IN_PROCESS', slotNo: slot, updatedAt: new Date() },
        });
        return { ok: true, recalled: 'IN_PROCESS', slot };
      }

      // Penuh: dorong ke QUEUED agar ikut siklus promote berikutnya
      await tx.ticket.update({
        where: { id: t.id },
        data: { status: 'QUEUED', slotNo: null, updatedAt: new Date() },
      });
      return { ok: true, recalled: 'QUEUED' };
    });
  }
}
