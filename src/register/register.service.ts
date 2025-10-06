import { Injectable, NotFoundException } from '@nestjs/common'
import { TicketStatus } from '@prisma/client'
import { PrismaService } from '../prisma.service' // <= pakai PrismaService kamu

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
        where: {
          // hindari error types: tetap filter eventId via prisma,
          // filter email via SQL kalau perlu ketat, tapi di sini cukup tampilkan semua milik event + post-filter ringan.
          eventId,
        },
        orderBy: { order: 'asc' },
        select: { code: true, order: true, status: true, /* email: true */ },
      })

      // (opsional) filter di memory kalau ingin pastikan hanya email ini:
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
      // UPDATE counter via SQL (RETURNING nextOrder). Aman walau model QueueCounter belum ter-generate.
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
          // kolom email/wa sudah nullable di schema, jadi aman di DB lama
          email,
          wa: wa ?? null,
          status: TicketStatus.QUEUED,
          order,
          eventId,
        }
      })

      await tx.ticket.createMany({ data: rows, skipDuplicates: true })

      // Ambil tiket yang baru dibuat (pakai rentang order)
      const created = await tx.ticket.findMany({
        where: {
          eventId,
          // types aman karena hanya field known
          order: { gte: startOrder, lte: endOrder },
        },
        orderBy: { order: 'asc' },
        select: { code: true, order: true, status: true },
      })

      return { created, startOrder, endOrder }
    })

    // Ambil semua tiket milik email ini (pakai SQL agar aman di types lama)
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
}
