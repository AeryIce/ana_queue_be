import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type Source = 'MASTER' | 'WALKIN' | 'GIMMICK';
type ReqStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';
type StatusFilter = ReqStatus | 'ALL';
type SourceFilter = Source | 'ALL';

export interface ReqResp {
  ok?: boolean;
  dedup?: boolean;
  alreadyRegistered?: boolean;
  request?: {
    id: string;
    eventId: string;
    email: string;
    name: string;
    wa: string | null;
    source: Source;
    status: ReqStatus;
    isMasterMatch?: boolean | null;
    masterQuota?: number | null;
    issuedBefore?: number | null;
  };
  poolRemaining?: number;
  error?: string;
  message?: string;
}

@Injectable()
export class RegisterRequestService {
  constructor(private readonly prisma: PrismaService) {}

  /** Utility kecil untuk baca angka dari object dinamis */
  private readNumericField(obj: unknown, keys: string[]): number | null {
    if (!obj || typeof obj !== 'object') return null;
    const rec = obj as Record<string, unknown>;
    for (const k of keys) {
      const v = rec[k];
      if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.floor(v));
      if (typeof v === 'string' && v.trim().length > 0 && !Number.isNaN(Number(v))) {
        return Math.max(0, Math.floor(Number(v)));
      }
    }
    return null;
  }

  /**
   * Buat RegistrationRequest (status PENDING), tanpa membuat Ticket.
   * - Validasi event
   * - Deteksi master/walkin
   * - Ambil masterQuota dari MasterUser.* (toleran nama kolom)
   * - Hitung issuedBefore = jumlah tiket yang sudah terbit
   * - Cek alreadyRegistered → CONFIRMED
   * - Dedup PENDING
   */
  async createRequest(input: { eventId: string; email: string; name: string; wa?: string }): Promise<ReqResp> {
    const eventId = String(input.eventId);
    const email = String(input.email).toLowerCase().trim();
    const name = String(input.name).trim();
    const wa = input.wa ? String(input.wa).trim() : null;

    // pastikan event ada
    const ev = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!ev) return { ok: false, message: 'Event tidak ditemukan' };

    // cek master user & baca quota dengan nama kolom fleksibel
    const muRaw = await this.prisma.masterUser.findUnique({ where: { email } });
    const isMasterMatch = !!muRaw;
    const source: Source = isMasterMatch ? 'MASTER' : 'WALKIN';

    // coba beberapa kemungkinan nama kolom quota
    // (silakan tambah kalau di DB kamu beda lagi)
    const masterQuotaFromDB =
      this.readNumericField(muRaw, ['quota', 'masterQuota', 'maxQuota', 'slots', 'allowance']);
    // fallback kebijakan event (ubah ke 1 jika perlu)
    const masterQuota: number | null = isMasterMatch ? (masterQuotaFromDB ?? 2) : null;

    // tiket yang sudah pernah terbit untuk email+event
    const issuedBefore = await this.prisma.ticket.count({ where: { eventId, email } });

    // jika sudah ada tiket → sudah confirmed
    if (issuedBefore > 0) {
      return {
        ok: true,
        alreadyRegistered: true,
        request: {
          id: '',
          eventId,
          email,
          name,
          wa,
          source,
          status: 'CONFIRMED',
          isMasterMatch,
          masterQuota,
          issuedBefore,
        },
      };
    }

    // dedup PENDING
    const existingPending = await this.prisma.registrationRequest.findFirst({
      where: { eventId, email, status: 'PENDING' },
      select: {
        id: true,
        name: true,
        wa: true,
        source: true,
        isMasterMatch: true,
        masterQuota: true,
        issuedBefore: true,
        createdAt: true,
      },
    });

    if (existingPending) {
      return {
        ok: true,
        dedup: true,
        request: {
          id: existingPending.id,
          eventId,
          email,
          name: existingPending.name ?? name,
          wa: (existingPending.wa as string | null) ?? wa,
          source: (existingPending.source as Source) ?? source,
          status: 'PENDING',
          isMasterMatch:
            typeof existingPending.isMasterMatch === 'boolean'
              ? existingPending.isMasterMatch
              : isMasterMatch,
          masterQuota:
            typeof existingPending.masterQuota === 'number'
              ? existingPending.masterQuota
              : masterQuota,
          issuedBefore:
            typeof existingPending.issuedBefore === 'number'
              ? existingPending.issuedBefore
              : issuedBefore,
        },
      };
    }

    // buat PENDING baru
    const req = await this.prisma.registrationRequest.create({
      data: {
        eventId,
        email,
        name,
        wa,
        source,
        status: 'PENDING',
        isMasterMatch,
        masterQuota,   // ⬅️ simpan quota
        issuedBefore,  // ⬅️ simpan pemakaian sebelumnya
      },
      select: {
        id: true,
        eventId: true,
        email: true,
        name: true,
        wa: true,
        source: true,
        status: true,
        isMasterMatch: true,
        masterQuota: true,
        issuedBefore: true,
        createdAt: true,
      },
    });

    return {
      ok: true,
      dedup: false,
      request: {
        id: req.id,
        eventId: req.eventId,
        email: req.email,
        name: req.name ?? name,
        wa: (req.wa as string | null) ?? wa,
        source: req.source as Source,
        status: req.status as ReqStatus,
        isMasterMatch: typeof req.isMasterMatch === 'boolean' ? req.isMasterMatch : isMasterMatch,
        masterQuota: typeof req.masterQuota === 'number' ? req.masterQuota : masterQuota,
        issuedBefore: typeof req.issuedBefore === 'number' ? req.issuedBefore : issuedBefore,
      },
    };
  }

  /** Listing untuk Admin Approve */
  async listRegistrants(params: {
    eventId: string;
    status: StatusFilter;
    source: SourceFilter;
    limit: number;
    offset: number;
    q?: string;
  }) {
    const { eventId, status, source, limit, offset, q } = params;

    const where: {
      eventId: string;
      status?: ReqStatus;
      source?: Source;
      OR?: Array<
        | { email: { contains: string; mode: 'insensitive' } }
        | { name: { contains: string; mode: 'insensitive' } }
        | { wa: { contains: string; mode: 'insensitive' } }
      >;
    } = { eventId };

    if (status && status !== 'ALL') where.status = status;
    if (source && source !== 'ALL') where.source = source;

    if (q && q.trim().length > 0) {
      const term = q.trim();
      where.OR = [
        { email: { contains: term, mode: 'insensitive' } },
        { name: { contains: term, mode: 'insensitive' } },
        { wa: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.registrationRequest.count({ where }),
      this.prisma.registrationRequest.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          eventId: true,
          email: true,
          name: true,
          wa: true,
          source: true,
          status: true,
          isMasterMatch: true,
          masterQuota: true,
          issuedBefore: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    const items = rows.map((r) => {
      const quota = typeof r.masterQuota === 'number' ? r.masterQuota : 0;
      const used = typeof r.issuedBefore === 'number' ? r.issuedBefore : 0;
      const quotaRemaining = Math.max(0, quota - used);

      return {
        id: r.id,
        email: r.email,
        name: r.name ?? null,
        code: null as string | null,
        firstName: null as string | null,
        lastName: null as string | null,
        wa: (r.wa as string | null) ?? null,
        source: r.source as Source,
        status: r.status as ReqStatus,
        isMasterMatch: typeof r.isMasterMatch === 'boolean' ? r.isMasterMatch : null,
        createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : null,
        updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : null,
        masterQuota: typeof r.masterQuota === 'number' ? r.masterQuota : null,
        issuedBefore: typeof r.issuedBefore === 'number' ? r.issuedBefore : null,
        quotaRemaining,
      };
    });

    return { ok: true, items, total, limit, offset };
  }
}
