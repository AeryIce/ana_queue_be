import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

@Injectable()
export class RegisterRequestService {
  constructor(private readonly prisma: PrismaService) {}

  // Ambil satu request berdasarkan id
  async findById(id: string) {
    // Jika tabel RegistrationRequest ada:
    try {
      return await this.prisma.registrationRequest.findUnique({
        where: { id },
        select: {
          id: true,
          email: true,
          name: true,
          eventId: true,
          status: true,
          createdAt: true,
          source: true,
        },
      });
    } catch {
      // Fallback: kalau tabel belum ada, treat id sebagai email dan cek masterUser
      const mu = await this.prisma.masterUser.findUnique({
        where: { email: id },
        select: { email: true, firstName: true, lastName: true },
      });
      return mu
        ? {
            id,
            email: mu.email,
            name: `${mu.firstName ?? ''} ${mu.lastName ?? ''}`.trim(),
            eventId: '',
            status: 'PENDING',
            createdAt: new Date(),
            source: 'MASTER',
          }
        : null;
    }
  }

  // List request pending (support filter dasar)
  async list(params: {
    eventId?: string;
    status?: string;
    limit?: number;
    offset?: number;
    q?: string;
    source?: string;
  }) {
    const {
      eventId,
      status = 'PENDING',
      limit = 20,
      offset = 0,
      q = '',
      source = '',
    } = params;

    // Coba pakai tabel RegistrationRequest
    try {
      const where: Record<string, unknown> = {};
      if (eventId) (where as any).eventId = eventId;
      if (status && status !== 'ALL') (where as any).status = status;
      if (source && source !== 'ALL') (where as any).source = source;
      if (q) {
        (where as any).OR = [
          { email: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
        ];
      }

      const [items, total] = await Promise.all([
        this.prisma.registrationRequest.findMany({
          where,
          skip: offset,
          take: limit,
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            email: true,
            name: true,
            eventId: true,
            status: true,
            createdAt: true,
            source: true,
            masterQuota: true,
            issuedBefore: true,
          },
        }),
        this.prisma.registrationRequest.count({ where }),
      ]);

      return { ok: true, items, total };
    } catch {
      // Fallback: kalau tabel belum ada → gunakan masterUser sebagai dummy PENDING
      const users = await this.prisma.masterUser.findMany({
        skip: offset,
        take: limit,
        select: {
          email: true,
          firstName: true,
          lastName: true,
          quota: true,
        },
      });

      const items = users.map((u) => ({
        id: u.email, // pakai email sebagai requestId sementara
        email: u.email,
        name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim(),
        eventId: eventId ?? '',
        status,
        createdAt: new Date().toISOString(),
        source: 'MASTER',
        masterQuota: u.quota,
        issuedBefore: 0,
      }));

      return { ok: true, items, total: items.length };
    }
  }

  // Tandai CONFIRMED (no-op jika tabel belum ada)
  async markConfirmed(id: string) {
    try {
      await this.prisma.registrationRequest.update({
        where: { id },
        data: { status: 'CONFIRMED' },
      });
    } catch {
      // ignore; fallback mode
    }
  }
}
