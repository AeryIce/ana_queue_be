import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

type Source = 'MASTER' | 'WALKIN' | 'GIMMICK';
type ReqStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED';

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
      select: { id: true, name: true, wa: true, source: true, isMasterMatch: true, createdAt: true },
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
          isMasterMatch: typeof existingPending.isMasterMatch === 'boolean' ? existingPending.isMasterMatch : isMasterMatch,
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
}
