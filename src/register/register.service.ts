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

  // === NEW: Approve → terbitkan 1 tiket CONFIRMED + code AH-xxx ===
 // === REPLACE WHOLE confirm() METHOD ===
async confirm(input: { eventId: string; requestId?: string; email?: string; source: 'MASTER'|'WALKIN'|'GIMMICK' }) {
  const { eventId, requestId, email, source } = input
  if (!eventId) throw new BadRequestException('eventId required')
  if (!requestId && !email) throw new BadRequestException('requestId or email required')

  return this.prisma.$transaction(async (tx) => {
    // 1) Cari PENDING
    const req = await tx.registrationRequest.findFirst({
      where: {
        eventId,
        status: 'PENDING',
        ...(requestId ? { id: requestId } : {}),
        ...(email ? { email: email.toLowerCase() } : {}),
      },
    })
    if (!req) throw new NotFoundException('Pending request not found')

    // 2) Idempotensi: sudah punya tiket aktif?
    const existing = await tx.ticket.findFirst({
      where: { eventId, email: req.email, status: { in: ['QUEUED','ACTIVE','CONFIRMED'] } },
    })
    if (existing) {
      return {
        ok: true,
        ticket: { code: existing.code, status: existing.status, name: existing.name, email: existing.email },
        note: 'already_has_ticket',
      }
    }

    // 3) Ambil 1 nomor dari queue_counters
    const inc = await tx.$queryRaw<Array<{ nextOrder: number }>>`
      UPDATE "queue_counters"
      SET "nextOrder" = "nextOrder" + 1
      WHERE "eventId" = ${eventId}
      RETURNING "nextOrder";
    `
    if (!inc?.[0]?.nextOrder) throw new Error('QueueCounter belum di-seed untuk event ini')

    const order = inc[0].nextOrder - 1
    const code = `AH-${order.toString().padStart(3,'0')}`

    // 4) Buat tiket (tanpa field 'source' & 'confirmedAt' jika memang tidak ada di schema)
    const t = await tx.ticket.create({
      data: {
        eventId,
        code,
        order,
        status: 'CONFIRMED',     // jika enum ini tidak ada di schema, ganti ke status yang ada (mis. 'QUEUED')
        name: req.name ?? '',
        email: req.email,
        // HAPUS: source, confirmedAt (tidak ada di schema kamu)
      } as any, // <-- jaga-jaga perbedaan tipe enum Prisma; boleh dihapus kalau sudah nyocok
    })

    // 5) Update request → CONFIRMED
    await tx.registrationRequest.update({
      where: { id: req.id },
      data: { status: 'CONFIRMED' },
    })

    // 6) Ledger pool (opsional): ALLOCATE 1 untuk non-MASTER
    try {
      if (source !== 'MASTER') {
        await tx.surplusLedger.create({
          data: {
            eventId,
            type: 'ALLOCATE',
            amount: 1,
            // HAPUS: note (tidak ada di schema kamu)
          } as any,
        })
      }
    } catch {
      // kalau tabel ledger belum ada / enum beda → jangan bikin 500
    }

    return { ok: true, ticket: { code, status: t.status, name: t.name, email: t.email } }
  })
}

}
