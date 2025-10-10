import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { TicketStatus } from '@prisma/client'
import { PrismaService } from '../prisma.service'
import { randomUUID } from 'crypto'

@Injectable()
export class RegisterService {
  constructor(private readonly prisma: PrismaService) {}

  // === Tetap: register master (alokasi semua remaining) ===
  async register(input: { email: string; wa?: string; eventId: string }) {
    const email = input.email.trim().toLowerCase()
    const { wa, eventId } = input

    // 1) Pastikan master user ada
    const mu = await this.prisma.masterUser.findUnique({ where: { email } })
    if (!mu) {
      throw new NotFoundException('Email tidak terdaftar pada master data')
    }
    const name = `${mu.firstName} ${mu.lastName}`.trim()

    // 2) Hitung sudah berapa tiket yang dikeluarkan
    const issued = await this.prisma.ticket.count({ where: { eventId, email } })
    const remaining = mu.quota - issued

    if (remaining <= 0) {
      const tickets = await this.prisma.ticket.findMany({
        where: { eventId, email },
        orderBy: { order: 'asc' },
        select: { code: true, order: true, status: true },
      })
      return {
        message: 'Kuota sudah habis untuk email ini',
        tickets,
        issued,
        quota: mu.quota,
        remaining: 0,
      }
    }

    // 3) Transaksi: ambil blok nomor + create tiket berurutan
    const txResult = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<Array<{ nextOrder: number }>>`
        UPDATE "queue_counters"
        SET "nextOrder" = "nextOrder" + ${remaining}
        WHERE "eventId" = ${eventId}
        RETURNING "nextOrder";
      `
      if (!updated?.[0]?.nextOrder) {
        throw new Error('QueueCounter belum di-seed untuk event ini')
      }

      const nextOrder = updated[0].nextOrder
      const startOrder = nextOrder - remaining
      const endOrder = nextOrder - 1

      const rows = Array.from({ length: remaining }).map((_, i) => {
        const order = startOrder + i
        const code = `AH-${order.toString().padStart(3, '0')}`
        return {
          code,
          name,
          email,
          wa: wa ?? null,
          status: TicketStatus.QUEUED,
          order,
          eventId,
        }
      })

      await tx.ticket.createMany({ data: rows, skipDuplicates: true })

      const created = await tx.ticket.findMany({
        where: { eventId, order: { gte: startOrder, lte: endOrder } },
        orderBy: { order: 'asc' },
        select: { code: true, order: true, status: true },
      })

      return { created, startOrder, endOrder }
    })

    const allForEmail = await this.prisma.ticket.findMany({
      where: { eventId, email },
      orderBy: { order: 'asc' },
      select: { code: true, order: true, status: true },
    })

    return {
      message: `Berhasil alokasikan ${txResult.created.length} tiket`,
      tickets: allForEmail,
      issued: issued + txResult.created.length,
      quota: (await this.prisma.masterUser.findUnique({ where: { email } }))?.quota ?? 0,
      remaining:
        ((await this.prisma.masterUser.findUnique({ where: { email } }))?.quota ?? 0) -
        (issued + txResult.created.length),
      allocatedRange: { from: txResult.startOrder, to: txResult.endOrder },
    }
  }

  // === Approve (ADMIN) — dengan DONATE/ALLOCATE pool & proteksi Walk-in ===
  async confirm(input: {
    eventId?: string
    requestId?: string
    email?: string
    source?: 'MASTER' | 'WALKIN' | 'GIMMICK'
    useCount?: number // 0..10 (0 = donate-all untuk MASTER)
  }) {
    const useCountRaw = Number.isFinite(Number(input.useCount)) ? Number(input.useCount) : 0
    const useCount = Math.max(0, Math.min(10, Math.floor(useCountRaw)))
    const reqId = input.requestId?.trim()
    const emailLower = input.email?.trim().toLowerCase()

    return this.prisma.$transaction(async (tx) => {
      // 1) Ambil PENDING request
      const req = await tx.registrationRequest.findFirst({
        where: {
          status: 'PENDING',
          ...(reqId ? { id: reqId } : {}),
          ...(!reqId && input.eventId && emailLower ? { eventId: input.eventId, email: emailLower } : {}),
        },
        select: {
          id: true,
          eventId: true,
          email: true,
          name: true,
          wa: true,
          source: true,
          masterQuota: true,
          issuedBefore: true,
        },
      })
      if (!req) return { ok: false, error: 'Pending request tidak ditemukan' }

      const eventId = input.eventId ?? req.eventId
      const name = req.name ?? ''
      const email = req.email
      const source = (input.source ?? (req.source as any)) as 'MASTER' | 'WALKIN' | 'GIMMICK' | undefined

      // 2) Hitung quota & remaining (MASTER)
      let quota = 0
      if (source === 'MASTER') {
        if (typeof req.masterQuota === 'number' && Number.isFinite(req.masterQuota)) {
          quota = Math.max(0, req.masterQuota)
        } else {
          const mu = await tx.masterUser.findUnique({ where: { email } })
          quota = Math.max(0, mu?.quota ?? 0)
        }
      }
      const issued = await tx.ticket.count({ where: { eventId, email } })
      const remaining = source === 'MASTER' ? Math.max(0, quota - issued) : 0

      // 3) Hitung pool available (untuk Walk-in/Gimmick)
      let poolAvailable = 0
      if (source && source !== 'MASTER') {
        const r = await tx.$queryRaw<Array<{ balance: number }>>`
          SELECT COALESCE(SUM(CASE 
            WHEN "type" = 'DONATE' THEN "amount"
            WHEN "type" = 'ALLOCATE' THEN - "amount"
            ELSE 0 END), 0)::int AS balance
          FROM "SurplusLedger"
          WHERE "eventId" = ${eventId};
        `
        poolAvailable = Number(r?.[0]?.balance ?? 0)
      }

      // 4) Tentukan penerbitan
      let toIssue = 0
      let leftover = 0
      if (source === 'MASTER') {
        toIssue = Math.max(0, Math.min(remaining, useCount))
        leftover = Math.max(0, remaining - toIssue) // akan DONATE
      } else {
        // WALKIN/GIMMICK: tak boleh melebihi stock pool
        toIssue = Math.max(0, Math.min(useCount, poolAvailable))
      }

      // Proteksi: Walk-in tanpa stok pool → jangan CONFIRM, balikin error ramah
      if (source && source !== 'MASTER' && toIssue === 0) {
        return { ok: false, error: 'Pool kosong / tidak cukup untuk alokasi' }
      }

      // 5) Ambil nomor & buat tiket jika toIssue > 0
      let startOrder = 0
      let endOrder = -1
      const createdCodes: string[] = []

      if (toIssue > 0) {
        const inc = await tx.$queryRaw<Array<{ nextOrder: number }>>`
          UPDATE "queue_counters"
          SET "nextOrder" = "nextOrder" + ${toIssue}
          WHERE "eventId" = ${eventId}
          RETURNING "nextOrder";
        `
        if (!inc?.[0]?.nextOrder) return { ok: false, error: 'QueueCounter belum di-seed untuk event ini' }

        const nextOrder = Number(inc[0].nextOrder)
        startOrder = nextOrder - toIssue
        endOrder = nextOrder - 1

        for (let i = 0; i < toIssue; i++) {
          const order = startOrder + i
          const code = `AH-${order.toString().padStart(3, '0')}`
          createdCodes.push(code)

          const id = randomUUID()
          const now = new Date()

          await tx.$executeRawUnsafe(
            `
            INSERT INTO "Ticket" ("id","eventId","code","name","status","order","createdAt","updatedAt","email","wa")
            SELECT $1,$2,$3,$4,$5::"TicketStatus",$6,$7,$8,$9,$10
            WHERE NOT EXISTS (
              SELECT 1 FROM "Ticket" WHERE "eventId" = $2 AND "code" = $3
            )
            `,
            id, // $1
            eventId, // $2
            code, // $3
            name, // $4
            'QUEUED', // $5
            order, // $6
            now, // $7 createdAt
            now, // $8 updatedAt
            email, // $9
            req.wa ?? null // $10
          )
        }
      }

      // 6) Update status request:
      // - MASTER: selalu CONFIRMED (meski donate-all)
      // - WALKIN/GIMMICK: CONFIRMED hanya jika ada tiket yang diterbitkan
      const shouldConfirm = source === 'MASTER' || toIssue > 0
      if (shouldConfirm) {
        await tx.registrationRequest.update({
          where: { id: req.id },
          data: { status: 'CONFIRMED', updatedAt: new Date() },
        })
      }

      // 7) Ledger pool
      try {
        if (source === 'MASTER' && leftover > 0) {
          await tx.surplusLedger.create({
            data: {
              eventId,
              type: 'DONATE',
              email,
              amount: leftover,
              refRequestId: req.id,
              createdAt: new Date(),
            },
          })
        }
        if (source && source !== 'MASTER' && toIssue > 0) {
          await tx.surplusLedger.create({
            data: {
              eventId,
              type: 'ALLOCATE',
              email,
              amount: toIssue,
              refRequestId: req.id,
              createdAt: new Date(),
            },
          })
        }
      } catch {
        // jangan patahkan flow approve kalau ledger tidak ada
      }

      // 8) Respons (back-compat + array codes)
      const firstCode = createdCodes[0]
      return {
        ok: true,
        ticket: firstCode ? { code: firstCode, status: 'QUEUED', name, email } : undefined,
        codes: createdCodes, // semua kode yang dibuat
        allocatedRange: toIssue > 0 ? { from: startOrder, to: endOrder } : undefined,
        count: toIssue,
        leftover,
        source: source ?? null,
        remainingBefore: source === 'MASTER' ? remaining : null,
        donatedAll: source === 'MASTER' && toIssue === 0 && leftover > 0, // sinyal donate-all
      }
    })
  }
}
