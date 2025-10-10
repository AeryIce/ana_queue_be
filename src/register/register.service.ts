import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { TicketStatus } from '@prisma/client'
import { PrismaService } from '../prisma.service'

@Injectable()
export class RegisterService {
  constructor(private readonly prisma: PrismaService) {}

  async register(input: { email: string; wa?: string; eventId: string }) {
    const email = input.email.trim().toLowerCase()
    const { wa, eventId } = input

    // 1) Pastikan master user ada
    const mu = await this.prisma.masterUser.findUnique({ where: { email } })
    if (!mu) {
      throw new NotFoundException('Email tidak terdaftar pada master data')
    }
    const name = `${mu.firstName} ${mu.lastName}`.trim()

    // 2) Hitung sudah berapa tiket yang dikeluarkan (pakai SQL agar aman walau types lama)
    const issuedRow = await this.prisma.$queryRaw<
      Array<{ count: number }>
    >`SELECT COUNT(*)::int AS count FROM "Ticket" WHERE "eventId" = ${eventId} AND "email" = ${email};`
    const issued = issuedRow?.[0]?.count ?? 0
    const remaining = mu.quota - issued

    if (remaining <= 0) {
      const tickets = await this.prisma.ticket.findMany({
        where: { eventId },
        orderBy: { order: 'asc' },
        select: { code: true, order: true, status: true },
      })
      const filtered = tickets.filter((t: any) => (t as any).email === email)

      return {
        message: 'Kuota sudah habis untuk email ini',
        tickets: filtered,
        issued,
        quota: mu.quota,
        remaining: 0,
      }
    }

    // 3) Transaksi: ambil blok nomor + create tiket berurutan
    const txResult = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.$queryRaw<
        Array<{ nextOrder: number }>
      >`UPDATE "queue_counters" SET "nextOrder" = "nextOrder" + ${remaining} WHERE "eventId" = ${eventId} RETURNING "nextOrder";`

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

    const allForEmail = await this.prisma.$queryRaw<
      Array<{ code: string; order: number; status: TicketStatus }>
    >`SELECT "code", "order", "status" FROM "Ticket" WHERE "eventId" = ${eventId} AND "email" = ${email} ORDER BY "order" ASC;`

    return {
      message: `Berhasil alokasikan ${txResult.created.length} tiket`,
      tickets: allForEmail,
      issued: issued + txResult.created.length,
      quota: mu.quota,
      remaining: mu.quota - (issued + txResult.created.length),
      allocatedRange: { from: txResult.startOrder, to: txResult.endOrder },
    }
  }

  // === LEGACY-COMPAT: Approve → keluarkan tiket tanpa sentuh kolom batch ===
  async confirm(input: {
    eventId?: string;                 // optional: fallback ke eventId milik request PENDING
    requestId?: string;
    email?: string;                   // fallback kalau tak pakai requestId
    source?: 'MASTER'|'WALKIN'|'GIMMICK';
    useCount?: number;                // legacy support; default 1
  }) {
    const useCount = Math.max(1, Math.min(Number(input.useCount ?? 1), 10)) // batasi 1..10
    const reqId = input.requestId?.trim()
    const emailLower = input.email?.trim().toLowerCase()

    return this.prisma.$transaction(async (tx) => {
      // 1) Ambil PENDING request (prioritas by requestId; kalau tidak ada, pakai email+eventId)
      const req = await tx.registrationRequest.findFirst({
        where: {
          status: 'PENDING',
          ...(reqId ? { id: reqId } : {}),
          ...(!reqId && input.eventId && emailLower ? { eventId: input.eventId, email: emailLower } : {}),
        },
      })
      if (!req) throw new NotFoundException('Pending request not found')

      const eventId = input.eventId ?? req.eventId
      const name = req.name ?? ''
      const email = req.email

      // 2) Cek sudah punya tiket aktif/berjalan? (RAW supaya tidak menyentuh kolom batch)
      const existRows = await tx.$queryRaw<Array<{ code: string; status: string }>>`
        SELECT "code", "status"::text AS status
        FROM "Ticket"
        WHERE "eventId" = ${eventId}
          AND "email" = ${email}
          AND "status"::text IN ('QUEUED','CALLED','IN_PROCESS','ACTIVE','CONFIRMED')
        ORDER BY "order" ASC
        LIMIT 1;
      `
      if (existRows.length > 0) {
        const ex = existRows[0]
        return { ok: true, ticket: { code: ex.code, status: ex.status, name, email }, note: 'already_has_ticket' }
      }

      // 3) Ambil blok nomor dari counter (RAW)
      const inc = await tx.$queryRaw<Array<{ nextOrder: number }>>`
        UPDATE "queue_counters"
        SET "nextOrder" = "nextOrder" + ${useCount}
        WHERE "eventId" = ${eventId}
        RETURNING "nextOrder";
      `
      if (!inc?.[0]?.nextOrder) throw new BadRequestException('QueueCounter belum di-seed untuk event ini')

      const nextOrder = Number(inc[0].nextOrder)
      const startOrder = nextOrder - useCount
      const endOrder = nextOrder - 1

      // 4) Insert tiket (RAW, tanpa kolom batch/slot). Status aman: 'QUEUED'.
      const createdCodes: string[] = []
      for (let i = 0; i < useCount; i++) {
        const order = startOrder + i
        const code = `AH-${order.toString().padStart(3,'0')}`
        createdCodes.push(code)

        await tx.$executeRawUnsafe(
          `
          INSERT INTO "Ticket" ("eventId","code","order","status","name","email")
          VALUES ($1,$2,$3,$4,$5,$6)
          ON CONFLICT ("eventId","code") DO NOTHING
          `,
          eventId, code, order, 'QUEUED', name, email
        )
      }

      // 5) Update request -> CONFIRMED
      await tx.registrationRequest.update({
        where: { id: req.id },
        data: { status: 'CONFIRMED' },
      })

      // 6) Ledger pool (opsional) — aman kalau tabel ada; di-skip jika error
      try {
        if (input.source && input.source !== 'MASTER') {
          await tx.$executeRawUnsafe(
            `INSERT INTO "SurplusLedger" ("eventId","type","amount") VALUES ($1,$2,$3)`,
            eventId, 'ALLOCATE', useCount
          )
        }
      } catch {
        // jangan hentikan flow approve kalau ledger tidak ada
      }

      const firstCode = createdCodes[0]
      return {
        ok: true,
        ticket: { code: firstCode, status: 'QUEUED', name, email },
        allocatedRange: { from: startOrder, to: endOrder },
        count: createdCodes.length,
      }
    })
  }
}
