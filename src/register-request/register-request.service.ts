import { Injectable as NestInjectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma.service'

type Source = 'MASTER' | 'WALKIN' | 'GIMMICK'

@NestInjectable()
export class RegisterRequestService {
  constructor(private readonly prisma: PrismaService) {}

  // ===== Utils: pool sisa (DONATE - ALLOCATE)
  private async getPoolRemaining(eventId: string) {
    const donate = await this.prisma.$queryRaw<Array<{ sum: number }>>`
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'DONATE';
    `
    const allocate = await this.prisma.$queryRaw<Array<{ sum: number }>>`
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'ALLOCATE';
    `
    return (donate?.[0]?.sum ?? 0) - (allocate?.[0]?.sum ?? 0)
  }

  private async getPoolRemainingTx(tx: any, eventId: string) {
    const donate = await tx.$queryRaw<Array<{ sum: number }>>`
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'DONATE';
    `
    const allocate = await tx.$queryRaw<Array<{ sum: number }>>`
      SELECT COALESCE(SUM("amount"), 0)::int AS sum
      FROM "SurplusLedger"
      WHERE "eventId" = ${eventId} AND "type" = 'ALLOCATE';
    `
    return (donate?.[0]?.sum ?? 0) - (allocate?.[0]?.sum ?? 0)
  }

  // ===== POST /api/register-request
  // POST /api/register-request (IDEMPOTENT BY eventId+email on PENDING)
async createRequest(input: { eventId: string; email: string; name: string; wa?: string; source?: Source }) {
  const eventId = input.eventId
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  const wa = input.wa?.trim() ?? null
  let source: Source = input.source === 'GIMMICK' ? 'GIMMICK' : 'MASTER'

  // 0) Cek apakah sudah ada PENDING untuk (eventId,email)
  const existing = await this.prisma.$queryRaw<Array<{
    id: string; eventId: string; email: string; name: string; wa: string | null;
    source: Source; status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
    isMasterMatch: boolean | null; masterQuota: number | null; issuedBefore: number | null;
    createdAt: Date;
  }>>`
    SELECT "id","eventId","email","name","wa","source","status",
           "isMasterMatch","masterQuota","issuedBefore","createdAt"
    FROM "RegistrationRequest"
    WHERE "eventId" = ${eventId} AND "email" = ${email} AND "status" = 'PENDING'
    LIMIT 1;
  `

  // ambil pool untuk response
  const poolRemainingBefore = await this.getPoolRemaining(eventId)

  if (existing.length > 0) {
    const it = existing[0]
    const masterQuota0 = it.masterQuota ?? 0
    const issuedBefore0 = it.issuedBefore ?? 0
    const quotaRemaining0 = Math.max(0, masterQuota0 - issuedBefore0)
    return {
      ok: true,
      dedup: true,                       // <— flag info: ini hasil dedup
      request: { ...it, quotaRemaining: quotaRemaining0 },
      poolRemaining: poolRemainingBefore
    }
  }

  // 1) Cek master user (untuk metadata)
  const mu = await this.prisma.masterUser.findUnique({ where: { email } })
  if (!mu) source = input.source === 'GIMMICK' ? 'GIMMICK' : 'WALKIN'

  // 2) Hitung tiket yang sudah ada untuk email-event (kolom email baru → raw SQL)
  const issuedRow = await this.prisma.$queryRaw<Array<{ count: number }>>`
    SELECT COUNT(*)::int AS count
    FROM "Ticket"
    WHERE "eventId" = ${eventId} AND "email" = ${email};
  `
  const issuedBefore = issuedRow?.[0]?.count ?? 0
  const masterQuota = mu?.quota ?? 0
  const quotaRemaining = Math.max(0, masterQuota - issuedBefore)

  // 3) Simpan request baru (PENDING)
  const id = randomUUID()
  await this.prisma.$executeRaw`
    INSERT INTO "RegistrationRequest"
      ("id","eventId","email","name","wa","source","status","isMasterMatch","masterQuota","issuedBefore","createdAt","updatedAt")
    VALUES
      (${id}, ${eventId}, ${email}, ${name}, ${wa}, ${source}, 'PENDING', ${!!mu}, ${mu?.quota ?? null}, ${issuedBefore}, NOW(), NOW());
  `

  return {
    ok: true,
    dedup: false,
    request: {
      id,
      eventId,
      email,
      name,
      wa,
      source,
      status: 'PENDING',
      isMasterMatch: !!mu,
      masterQuota,
      issuedBefore,
      quotaRemaining,
    },
  poolRemaining: poolRemainingBefore
  }
}


  // ===== GET /api/register-queue?eventId=...
  async listPending(eventId: string) {
    const rows = await this.prisma.$queryRaw<Array<{
      id: string; eventId: string; email: string; name: string; wa: string | null;
      source: Source; status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
      isMasterMatch: boolean | null; masterQuota: number | null; issuedBefore: number | null;
      createdAt: Date;
    }>>`
      SELECT "id","eventId","email","name","wa","source","status",
             "isMasterMatch","masterQuota","issuedBefore","createdAt"
      FROM "RegistrationRequest"
      WHERE "eventId" = ${eventId} AND "status" = 'PENDING'
      ORDER BY "createdAt" ASC;
    `

    const pending = rows.map(it => {
      const masterQuota = it.masterQuota ?? 0
      const issuedBefore = it.issuedBefore ?? 0
      const quotaRemaining = Math.max(0, masterQuota - issuedBefore)
      return { ...it, quotaRemaining }
    })

    const poolRemaining = await this.getPoolRemaining(eventId)
    return { ok: true, eventId, poolRemaining, pending }
  }
  // GET /api/registrants?eventId=...&status=...&source=...&q=...&limit=...&offset=...
async listRegistrants(params: {
  eventId: string
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'ALL'
  source?: 'MASTER' | 'WALKIN' | 'GIMMICK' | 'ALL'
  q?: string
  limit?: number
  offset?: number
}) {
  const { eventId } = params
  const status = (params.status ?? 'ALL') as any
  const source = (params.source ?? 'ALL') as any
  const q = params.q?.trim()
  const limit = Math.max(1, Math.min(Number(params.limit ?? 50), 200))
  const offset = Math.max(0, Number(params.offset ?? 0))

  // build WHERE dinamis (pakai $queryRawUnsafe untuk binding parameter)
  const whereParts: string[] = [`"eventId" = $1`]
  const args: any[] = [eventId]
  let argIdx = 1

  if (status !== 'ALL') {
    argIdx++; whereParts.push(`"status" = $${argIdx}`); args.push(status)
  }
  if (source !== 'ALL') {
    argIdx++; whereParts.push(`"source" = $${argIdx}`); args.push(source)
  }
  if (q && q.length > 0) {
    const like = `%${q}%`
    argIdx++; const p = `$${argIdx}`
    whereParts.push(`("email" ILIKE ${p} OR "name" ILIKE ${p} OR "wa" ILIKE ${p})`)
    args.push(like)
  }

  const whereSql = whereParts.join(' AND ')
  const baseSql = `FROM "RegistrationRequest" WHERE ${whereSql}`

  // total count
  const countRow = await this.prisma.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT COUNT(*)::int AS count ${baseSql};`, ...args
  )
  const total = countRow?.[0]?.count ?? 0

  // ambil rows
  argIdx++; const pLimit = `$${argIdx}`; args.push(limit)
  argIdx++; const pOffset = `$${argIdx}`; args.push(offset)

  const rows = await this.prisma.$queryRawUnsafe<Array<{
    id: string; eventId: string; email: string; name: string; wa: string | null;
    source: 'MASTER'|'WALKIN'|'GIMMICK'; status: 'PENDING'|'CONFIRMED'|'CANCELLED';
    isMasterMatch: boolean | null; masterQuota: number | null; issuedBefore: number | null;
    createdAt: Date; updatedAt: Date;
  }>>(
    `SELECT "id","eventId","email","name","wa","source","status",
            "isMasterMatch","masterQuota","issuedBefore","createdAt","updatedAt"
     ${baseSql}
     ORDER BY "createdAt" ASC
     LIMIT ${pLimit} OFFSET ${pOffset};`,
    ...args
  )

  // hitung quotaRemaining untuk yang MASTER
  const items = rows.map(it => {
    const masterQuota = it.masterQuota ?? 0
    const issuedBefore = it.issuedBefore ?? 0
    const quotaRemaining = Math.max(0, masterQuota - issuedBefore)
    return { ...it, quotaRemaining }
  })

  return {
    ok: true,
    eventId,
    total,
    limit,
    offset,
    items
  }
}


  // ===== POST /api/register-confirm
  async confirm(input: { requestId: string; useCount: number }) {
    const { requestId } = input
    const useCount = Number(input.useCount ?? 0)
    if (!requestId) throw new BadRequestException('requestId wajib diisi')
    if (!Number.isInteger(useCount) || useCount <= 0) throw new BadRequestException('useCount harus bilangan > 0')

    const result = await this.prisma.$transaction(async (tx: any) => {
      // lock request
      const reqRows = await tx.$queryRaw<Array<{
        id: string; eventId: string; email: string; name: string; wa: string | null; source: Source; status: string;
      }>>`
        SELECT "id","eventId","email","name","wa","source","status"
        FROM "RegistrationRequest"
        WHERE "id" = ${requestId}
        FOR UPDATE;
      `
      const req = reqRows?.[0]
      if (!req) throw new NotFoundException('RegistrationRequest tidak ditemukan')
      if (req.status !== 'PENDING') throw new BadRequestException('Request sudah diproses')

      const { eventId, email, name, wa, source } = req

      let donated = 0
      let allocated = 0

      if (source === 'MASTER') {
        // cek master & quota
        const mu = await this.prisma.masterUser.findUnique({ where: { email } })
        if (!mu) throw new BadRequestException('Email bukan MASTER saat dikonfirmasi')

        const issuedRow = await tx.$queryRaw<Array<{ count: number }>>`
          SELECT COUNT(*)::int AS count
          FROM "Ticket"
          WHERE "eventId" = ${eventId} AND "email" = ${email};
        `
        const issued = issuedRow?.[0]?.count ?? 0
        const remaining = mu.quota - issued
        if (remaining <= 0) throw new BadRequestException('Kuota MASTER sudah habis')
        if (useCount > remaining) throw new BadRequestException(`Maksimal slot yang bisa dipakai: ${remaining}`)

        // ambil blok nomor via counter
        const updated = await tx.$queryRaw<Array<{ nextOrder: number }>>`
          UPDATE "queue_counters"
          SET "nextOrder" = "nextOrder" + ${useCount}
          WHERE "eventId" = ${eventId}
          RETURNING "nextOrder";
        `
        const nextOrder = updated?.[0]?.nextOrder
        if (!nextOrder) throw new Error('QueueCounter belum di-seed untuk event ini')

        const startOrder = nextOrder - useCount
        const endOrder = nextOrder - 1

        for (let order = startOrder; order <= endOrder; order++) {
          const code = `AH-${order.toString().padStart(3, '0')}`
          await tx.$executeRaw`
            INSERT INTO "Ticket" ("id","code","name","status","order","eventId","email","wa","createdAt","updatedAt")
            VALUES (${randomUUID()}, ${code}, ${name}, 'QUEUED', ${order}, ${eventId}, ${email}, ${wa}, NOW(), NOW())
            ON CONFLICT ("code") DO NOTHING;
          `
        }

        const leftover = remaining - useCount
        if (leftover > 0) {
          await tx.$executeRaw`
            INSERT INTO "SurplusLedger" ("id","eventId","type","email","amount","refRequestId","createdAt")
            VALUES (${randomUUID()}, ${eventId}, 'DONATE', ${email}, ${leftover}, ${requestId}, NOW());
          `
          donated = leftover
        }
      } else {
        // WALKIN / GIMMICK → pakai pool sisa
        const poolBefore = await this.getPoolRemainingTx(tx, eventId)
        if (poolBefore < useCount) throw new BadRequestException(`Pool sisa tidak cukup. Tersedia: ${poolBefore}`)

        await tx.$executeRaw`
          INSERT INTO "SurplusLedger" ("id","eventId","type","email","amount","refRequestId","createdAt")
          VALUES (${randomUUID()}, ${eventId}, 'ALLOCATE', ${email}, ${useCount}, ${requestId}, NOW());
        `
        allocated = useCount

        const updated = await tx.$queryRaw<Array<{ nextOrder: number }>>`
          UPDATE "queue_counters"
          SET "nextOrder" = "nextOrder" + ${useCount}
          WHERE "eventId" = ${eventId}
          RETURNING "nextOrder";
        `
        const nextOrder = updated?.[0]?.nextOrder
        if (!nextOrder) throw new Error('QueueCounter belum di-seed untuk event ini')

        const startOrder = nextOrder - useCount
        const endOrder = nextOrder - 1

        for (let order = startOrder; order <= endOrder; order++) {
          const code = `AH-${order.toString().padStart(3, '0')}`
          await tx.$executeRaw`
            INSERT INTO "Ticket" ("id","code","name","status","order","eventId","email","wa","createdAt","updatedAt")
            VALUES (${randomUUID()}, ${code}, ${name}, 'QUEUED', ${order}, ${eventId}, ${email}, ${wa}, NOW(), NOW())
            ON CONFLICT ("code") DO NOTHING;
          `
        }
      }

      await tx.$executeRaw`
        UPDATE "RegistrationRequest"
        SET "status" = 'CONFIRMED', "updatedAt" = NOW()
        WHERE "id" = ${requestId};
      `

      const poolAfter = await this.getPoolRemainingTx(tx, eventId)

      const tickets = await tx.$queryRaw<Array<{ code: string; order: number; status: 'QUEUED' | 'CALLED' | 'IN_PROCESS' | 'DONE' | 'DEFERRED' | 'NO_SHOW' }>>`
        SELECT "code","order","status"
        FROM "Ticket"
        WHERE "eventId" = ${eventId} AND "email" = ${email}
        ORDER BY "order" ASC;
      `

      return { eventId, email, tickets, donated, allocated, poolAfter, requestId }
    })

    return { ok: true, ...result }
  }
}
