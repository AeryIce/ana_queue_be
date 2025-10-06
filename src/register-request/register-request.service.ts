import { Injectable } from '@nestjs/common'
import { PrismaClient } from '@prisma/client'

type Source = 'MASTER' | 'WALKIN' | 'GIMMICK'

@Injectable()
export class RegisterRequestService {
  constructor(private readonly prisma: PrismaClient) {}

  private async getPoolRemaining(eventId: string) {
    const donate = await this.prisma.surplusLedger.aggregate({
      _sum: { amount: true },
      where: { eventId, type: 'DONATE' },
    })
    const allocate = await this.prisma.surplusLedger.aggregate({
      _sum: { amount: true },
      where: { eventId, type: 'ALLOCATE' },
    })
    const d = donate._sum.amount ?? 0
    const a = allocate._sum.amount ?? 0
    return d - a
  }

  async createRequest(input: { eventId: string; email: string; name: string; wa?: string; source?: Source }) {
    const eventId = input.eventId
    const email = input.email.trim().toLowerCase()
    const name = input.name.trim()
    const wa = input.wa?.trim()
    let source: Source = input.source === 'GIMMICK' ? 'GIMMICK' : 'MASTER'

    // cek master
    const mu = await this.prisma.masterUser.findUnique({ where: { email } })
    if (!mu) source = input.source === 'GIMMICK' ? 'GIMMICK' : 'WALKIN'

    // issued tiket sebelumnya (untuk email ini pada event ini)
    const issuedBefore = await this.prisma.ticket.count({ where: { eventId, email } })
    const masterQuota = mu?.quota ?? 0
    const quotaRemaining = masterQuota - issuedBefore

    // simpan request (PENDING)
    const req = await this.prisma.registrationRequest.create({
      data: {
        eventId,
        email,
        name,
        wa,
        source,
        // metadata
        isMasterMatch: !!mu,
        masterQuota: mu?.quota ?? null,
        issuedBefore: issuedBefore ?? null,
      },
    })

    // pool sisa global (untuk badge UI)
    const poolRemaining = await this.getPoolRemaining(eventId)

    return {
      ok: true,
      request: {
        id: req.id,
        eventId,
        email,
        name,
        wa,
        source,
        status: req.status,
        createdAt: req.createdAt,
        // info cepat untuk UI
        isMasterMatch: !!mu,
        masterQuota,
        issuedBefore,
        quotaRemaining: Math.max(0, quotaRemaining),
      },
      poolRemaining,
    }
  }

  async listPending(eventId: string) {
    const items = await this.prisma.registrationRequest.findMany({
      where: { eventId, status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, eventId: true, email: true, name: true, wa: true, source: true, status: true, createdAt: true,
        isMasterMatch: true, masterQuota: true, issuedBefore: true,
      },
    })

    // hitung quotaRemaining per item (kalau MASTER)
    const pending = items.map(it => {
      const masterQuota = it.masterQuota ?? 0
      const issuedBefore = it.issuedBefore ?? 0
      const quotaRemaining = Math.max(0, masterQuota - issuedBefore)
      return { ...it, quotaRemaining }
    })

    const poolRemaining = await this.getPoolRemaining(eventId)

    return { ok: true, eventId, poolRemaining, pending }
  }
}
