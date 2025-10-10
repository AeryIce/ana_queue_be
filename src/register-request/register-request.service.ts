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
  };
  poolRemaining?: number;
  error?: string;
  message?: string;
}

@Injectable()
export class RegisterRequestService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Buat RegistrationRequest (status PENDING), tanpa membuat Ticket.
   * Menerapkan:
   * - Validasi event
   * - Deteksi master/walkin
   * - Cek alreadyRegistered (sudah punya tiket → dianggap CONFIRMED)
   * - Dedup PENDING untuk email+event yang sama
   */
  async createRequest(input: { eventId: string; email: string; name: string; wa?: string }): Promise<ReqResp> {
    const eventId = String(input.eventId);
    const email = String(input.email).toLowerCase().trim();
    const name = String(input.name).trim();
    const wa = input.wa ? String(input.wa).trim() : null;

    // Pastikan event ada (hindari FK error gelap)
    const ev = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!ev) {
      return { ok: false, message: 'Event tidak ditemukan' };
    }

    // Cek apakah email MASTER (untuk flag isMasterMatch & source)
    const mu = await this.prisma.masterUser.findUnique({
      where: { email: email },
      select: { email: true },
    });
    const isMasterMatch = !!mu;
    const source: Source = isMasterMatch ? 'MASTER' : 'WALKIN';

    // Cek apakah SUDAH CONFIRMED (sudah punya tiket) → dianggap alreadyRegistered
    const alreadyTicket = await this.prisma.ticket.findFirst({
      where: { eventId, email: email },
      select: { id: true },
    });
    if (alreadyTicket) {
      return {
        ok: true,
        alreadyRegistered: true,
        request: {
          id: '', // tidak relevan (sudah confirmed)
          eventId,
          email,
          name,
          wa,
          source,
          status: 'CONFIRMED',
          isMasterMatch,
        },
      };
    }

    // Cek dedup PENDING di RegistrationRequest
    const existingPending = await this.prisma.registrationRequest.findFirst({
      where: { eventId, email, status: 'PENDING' },
      select: {
        id: true,
        name: true,
        wa: true,
        source: true,
        isMasterMatch: true,
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
            typeof existingPending.isMasterMatch === 'boolean' ? existingPending.isMasterMatch : isMasterMatch,
        },
      };
    }

    // Buat PENDING baru di RegistrationRequest (TANPA membuat Ticket)
    const req = await this.prisma.registrationRequest.create({
      data: {
        eventId,
        email,
        name,
        wa,
        source,
        status: 'PENDING',
        isMasterMatch,
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
      },
    };
  }

  /**
   * Listing untuk halaman Admin Approve.
   * Mendukung filter: eventId, status, source, q, limit, offset
   * Mengembalikan format FE: { ok, items, total, limit, offset }
   */
  async listRegistrants(params: {
    eventId: string;
    status: StatusFilter;
    source: SourceFilter;
    limit: number;
    offset: number;
    q?: string;
  }) {
    const { eventId, status, source, limit, offset, q } = params;

    // Bentuk where yang ketat tanpa `any`
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
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    // mapping agar cocok dengan pembacaan FE (approve page)
    const items = rows.map((r) => ({
      id: r.id,
      email: r.email,
      name: r.name ?? null,
      code: null as string | null, // tiket belum ada di tahap ini
      firstName: null as string | null,
      lastName: null as string | null,
      wa: (r.wa as string | null) ?? null,
      source: r.source as Source,
      status: r.status as ReqStatus,
      isMasterMatch: typeof r.isMasterMatch === 'boolean' ? r.isMasterMatch : null,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : null,
      updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : null,
    }));

    return {
      ok: true,
      items,
      total,
      limit,
      offset,
    };
  }
}
