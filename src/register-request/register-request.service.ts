import { Injectable as NestInjectable, BadRequestException, NotFoundException } from '@nestjs/common'
import { randomUUID } from 'crypto'
import { PrismaService } from '../prisma.service'

type Source = 'MASTER' | 'WALKIN' | 'GIMMICK'

@NestInjectable()
export class RegisterRequestService {
  constructor(private readonly prisma: PrismaService) {}

  private async getPoolRemaining(eventId: string) {
    const donate = await this.prisma.$queryRawUnsafe(
      'SELECT COALESCE(SUM("amount"), 0)::int AS sum FROM "SurplusLedger" WHERE "eventId" = $1 AND "type" = $2;',
      eventId, 'DONATE'
    ) as Array<{ sum: number }>
    const allocate = await this.prisma.$queryRawUnsafe(
      'SELECT COALESCE(SUM("amount"), 0)::int AS sum FROM "SurplusLedger" WHERE "eventId" = $1 AND "type" = $2;',
      eventId, 'ALLOCATE'
    ) as Array<{ sum: number }>
    return (donate?.[0]?.sum ?? 0) - (allocate?.[0]?.sum ?? 0)
  }

  private async getPoolRemainingTx(tx: any, eventId: string) {
    const donate = await tx.$queryRawUnsafe(
      'SELECT COALESCE(SUM("amount"), 0)::int AS sum FROM "SurplusLedger" WHERE "eventId" = $1 AND "type" = $2;',
      eventId, 'DONATE'
    ) as Array<{ sum: number }>
    const allocate = await tx.$queryRawUnsafe(
      'SELECT COALESCE(SUM("amount"), 0)::int AS sum FROM "SurplusLedger" WHERE "eventId" = $1 AND "type" = $2;',
      eventId, 'ALLOCATE'
    ) as Array<{ sum: number }>
    return (donate?.[0]?.sum ?? 0) - (allocate?.[0]?.sum ?? 0)
  }

  async createRequest(input: { eventId: string; email: string; name: string; wa?: string; source?: Source }) {
    const eventId = input.eventId
    const email = input.email.trim().toLowerCase()
    const name = input.name.trim()
    const wa = input.wa?.trim() ?? null
    let source: Source = input.source === 'GIMMICK' ? 'GIMMICK' : 'MASTER'

    const existing = await this.prisma.$queryRawUnsafe(
      `SELECT "id","eventId","email","name","wa","source","status",
              "isMasterMatch","masterQuota","issuedBefore","createdAt"
       FROM "RegistrationRequest"
       WHERE "eventId" = $1 AND "email" = $2 AND "status" = 'PENDING'
       LIMIT 1;`,
      eventId, email
    ) as Array<{
      id: string; eventId: string; email: string; name: string; wa: string | null;
      source: Source; status: 'PENDING' | 'CONFIRMED' | 'CANCELLED';
      isMasterMatch: boolean | null; masterQuota: number | null; issuedBefore: number | null;
      createdAt: Date;
    }>

    const poolRemainingBefore = await this.getPoolRemaining(eventId)

    if (existing.length > 0) {
      const it = existing[0]
      const masterQuota0 = it.masterQuota ?? 0
      const issuedBefore0 = it.issuedBefore ?? 0
      const quotaRemaining0 = Math.max(0, masterQuota0 - issuedBefore0)
      return {
        ok: true,
        dedup: true,
        request: { ...it, quotaRemaining: quotaRemaining0 },
        poolRemaining: poolRemainingBefore
      }
    }

    const mu = await this.prisma.masterUser.findUnique({ where: { email } })
    if (!mu) source = input.source === 'GIMMICK' ? 'GIMMICK' : 'WALKIN'

    const issuedRow = await this.prisma.$queryRawUnsafe(
      'SELECT COUNT(*)::int AS count FROM "Ticket" WHERE "eventId" = $1 AND "email" = $2;',
      eventId, email
    ) as Array<{ count: number }>
    const issuedBefore = issuedRow?.[0]?.count ?? 0
    const masterQuota = mu?.quota ?? 0
    const quotaRemaining = Math.max(0, masterQuota - issuedBefore)

    const id = randomUUID()
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO "RegistrationRequest"
        ("id","eventId","email","name","wa","source","status","isMasterMatch","masterQuota","issuedBefore","createdAt","updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,'PENDING',$7,$8,$9,NOW(),NOW());`,
      id, eventId, email, name, wa, source, !!mu, mu?.quota ?? null, issuedBefore
    )

    return {
      ok: true,
      dedup: false,
      request: {
        id, eventId, email, name, wa, source,
        status: 'PENDING',
        isMasterMatch: !!mu,
        masterQuota,
        issuedBefore,
        quotaRemaining
      },
      poolRemaining: poolRemainingBefore
    }
  }

  async listQueue(params: { eventId: string; status?: 'PENDING'|'CONFIRMED'|'CANCELLED'|'ALL' }) {
  const { eventId } = params
  const status = (params.status ?? 'PENDING') as string

  const args: any[] = [eventId]
  let whereSql = `"eventId" = $1`
  if (status !== 'ALL') {
    args.push(status)
    whereSql += ` AND "status"::text = $2`
  }

  const rows = await this.prisma.$queryRawUnsafe(
    `SELECT "id","eventId","email","name","wa","source","status",
            "isMasterMatch","masterQuota","issuedBefore","createdAt"
     FROM "RegistrationRequest"
     WHERE ${whereSql}
     ORDER BY "createdAt" ASC;`,
    ...args
  ) as Array<{
    id: string; eventId: string; email: string; name: string; wa: string | null;
    source: 'MASTER'|'WALKIN'|'GIMMICK'; status: 'PENDING'|'CONFIRMED'|'CANCELLED';
    isMasterMatch: boolean | null; masterQuota: number | null; issuedBefore: number | null;
    createdAt: Date;
  }>

  const items = rows.map(it => {
    const masterQuota = it.masterQuota ?? 0
    const issuedBefore = it.issuedBefore ?? 0
    const quotaRemaining = Math.max(0, masterQuota - issuedBefore)
    return { ...it, quotaRemaining }
  })

  const poolRemaining = await this.getPoolRemaining(eventId)
  return { ok: true, eventId, status, poolRemaining, items }
}


  async listRegistrants(params: {
  eventId: string
  status?: 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'ALL'
  source?: 'MASTER' | 'WALKIN' | 'GIMMICK' | 'ALL'
  q?: string
  limit?: number
  offset?: number
}) {
  const { eventId } = params
  const status = (params.status ?? 'ALL') as string
  const source = (params.source ?? 'ALL') as string
  const q = params.q?.trim()
  const limit = Math.max(1, Math.min(Number(params.limit ?? 50), 200))
  const offset = Math.max(0, Number(params.offset ?? 0))

  const whereParts: string[] = [`"eventId" = $1`]
  const args: any[] = [eventId]
  let idx = 1

  if (status !== 'ALL') { idx++; whereParts.push(`"status"::text = $${idx}`); args.push(status) }
  if (source !== 'ALL') { idx++; whereParts.push(`"source"::text = $${idx}`); args.push(source) }
  if (q && q.length > 0) {
    const like = `%${q}%`
    idx++; const p = `$${idx}`
    whereParts.push(`("email" ILIKE ${p} OR "name" ILIKE ${p} OR "wa" ILIKE ${p})`)
    args.push(like)
  }

  const whereSql = whereParts.join(' AND ')
  const baseSql = `FROM "RegistrationRequest" WHERE ${whereSql}`

  const cnt = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS count ${baseSql};`, ...args) as Array<{ count: number }>
  const total = cnt?.[0]?.count ?? 0

  idx++; const pLimit = `$${idx}`; args.push(limit)
  idx++; const pOffset = `$${idx}`; args.push(offset)

  const rows = await this.prisma.$queryRawUnsafe(
    `SELECT "id","eventId","email","name","wa","source","status",
            "isMasterMatch","masterQuota","issuedBefore","createdAt","updatedAt"
     ${baseSql}
     ORDER BY "createdAt" ASC
     LIMIT ${pLimit} OFFSET ${pOffset};`,
    ...args
  ) as Array<{
    id: string; eventId: string; email: string; name: string; wa: string | null;
    source: 'MASTER'|'WALKIN'|'GIMMICK'; status: 'PENDING'|'CONFIRMED'|'CANCELLED';
    isMasterMatch: boolean | null; masterQuota: number | null; issuedBefore: number | null;
    createdAt: Date; updatedAt: Date;
  }>

  const items = rows.map(it => {
    const masterQuota = it.masterQuota ?? 0
    const issuedBefore = it.issuedBefore ?? 0
    const quotaRemaining = Math.max(0, masterQuota - issuedBefore)
    return { ...it, quotaRemaining }
  })

  return { ok: true, eventId, total, limit, offset, items }
}

  async listTickets(params: {
  eventId: string
  status?: 'QUEUED'|'CALLED'|'IN_PROCESS'|'DONE'|'DEFERRED'|'NO_SHOW'|'ALL'
  limit?: number
  offset?: number
}) {
  const { eventId } = params
  const status = (params.status ?? 'QUEUED') as string
  const limit = Math.max(1, Math.min(Number(params.limit ?? 100), 500))
  const offset = Math.max(0, Number(params.offset ?? 0))

  const args: any[] = [eventId]
  let whereSql = `"eventId" = $1`
  if (status !== 'ALL') {
    args.push(status)
    whereSql += ` AND "status"::text = $2`
  }

  const rows = await this.prisma.$queryRawUnsafe(
    `SELECT "code","order","status","email","name","wa","createdAt"
     FROM "Ticket"
     WHERE ${whereSql}
     ORDER BY "order" ASC
     LIMIT $${args.length + 1} OFFSET $${args.length + 2};`,
    ...args, limit, offset
  ) as Array<{ code: string; order: number; status: string; email: string | null; name: string | null; wa: string | null; createdAt: Date }>

  const totalRow = await this.prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "Ticket" WHERE ${whereSql};`,
    ...args
  ) as Array<{ count: number }>

  return {
    ok: true,
    eventId,
    status,
    limit,
    offset,
    total: totalRow?.[0]?.count ?? rows.length,
    items: rows
  }
}

  async confirm(input: { requestId: string; useCount: number }) {
    const { requestId } = input
    const useCount = Number(input.useCount ?? 0)
    if (!requestId) throw new BadRequestException('requestId wajib diisi')
    if (!Number.isInteger(useCount) || useCount <= 0) throw new BadRequestException('useCount harus bilangan > 0')

    const result = await this.prisma.$transaction(async (tx: any) => {
      const reqRows = await tx.$queryRawUnsafe(
        `SELECT "id","eventId","email","name","wa","source","status"
         FROM "RegistrationRequest"
         WHERE "id" = $1
         FOR UPDATE;`,
        requestId
      ) as Array<{ id: string; eventId: string; email: string; name: string; wa: string | null; source: Source; status: string }>

      const req = reqRows?.[0]
      if (!req) throw new NotFoundException('RegistrationRequest tidak ditemukan')
      if (req.status !== 'PENDING') throw new BadRequestException('Request sudah diproses')

      const { eventId, email, name, wa, source } = req
      let donated = 0
      let allocated = 0

      if (source === 'MASTER') {
        const mu = await this.prisma.masterUser.findUnique({ where: { email } })
        if (!mu) throw new BadRequestException('Email bukan MASTER saat dikonfirmasi')

        const issuedRow = await tx.$queryRawUnsafe(
          'SELECT COUNT(*)::int AS count FROM "Ticket" WHERE "eventId" = $1 AND "email" = $2;',
          eventId, email
        ) as Array<{ count: number }>
        const issued = issuedRow?.[0]?.count ?? 0
        const remaining = mu.quota - issued
        if (remaining <= 0) throw new BadRequestException('Kuota MASTER sudah habis')
        if (useCount > remaining) throw new BadRequestException(`Maksimal slot yang bisa dipakai: ${remaining}`)

        const updated = await tx.$queryRawUnsafe(
          `UPDATE "queue_counters"
           SET "nextOrder" = "nextOrder" + $1
           WHERE "eventId" = $2
           RETURNING "nextOrder";`,
          useCount, eventId
        ) as Array<{ nextOrder: number }>
        const nextOrder = updated?.[0]?.nextOrder
        if (!nextOrder) throw new Error('QueueCounter belum di-seed untuk event ini')

        const startOrder = nextOrder - useCount
        const endOrder = nextOrder - 1

        for (let order = startOrder; order <= endOrder; order++) {
          const code = `AH-${order.toString().padStart(3, '0')}`
          await tx.$executeRawUnsafe(
            `INSERT INTO "Ticket" ("id","code","name","status","order","eventId","email","wa","createdAt","updatedAt")
             VALUES ($1,$2,$3,'QUEUED',$4,$5,$6,$7,NOW(),NOW())
             ON CONFLICT ("code") DO NOTHING;`,
            randomUUID(), code, name, order, eventId, email, wa
          )
        }

        const leftover = remaining - useCount
        if (leftover > 0) {
          await tx.$executeRawUnsafe(
            `INSERT INTO "SurplusLedger" ("id","eventId","type","email","amount","refRequestId","createdAt")
             VALUES ($1,$2,'DONATE',$3,$4,$5,NOW());`,
            randomUUID(), eventId, email, leftover, requestId
          )
          donated = leftover
        }
      } else {
        const poolBefore = await this.getPoolRemainingTx(tx, eventId)
        if (poolBefore < useCount) throw new BadRequestException(`Pool sisa tidak cukup. Tersedia: ${poolBefore}`)

        await tx.$executeRawUnsafe(
          `INSERT INTO "SurplusLedger" ("id","eventId","type","email","amount","refRequestId","createdAt")
           VALUES ($1,$2,'ALLOCATE',$3,$4,$5,NOW());`,
          randomUUID(), eventId, email, useCount, requestId
        )
        allocated = useCount

        const updated = await tx.$queryRawUnsafe(
          `UPDATE "queue_counters"
           SET "nextOrder" = "nextOrder" + $1
           WHERE "eventId" = $2
           RETURNING "nextOrder";`,
          useCount, eventId
        ) as Array<{ nextOrder: number }>
        const nextOrder = updated?.[0]?.nextOrder
        if (!nextOrder) throw new Error('QueueCounter belum di-seed untuk event ini')

        const startOrder = nextOrder - useCount
        const endOrder = nextOrder - 1

        for (let order = startOrder; order <= endOrder; order++) {
          const code = `AH-${order.toString().padStart(3, '0')}`
          await tx.$executeRawUnsafe(
            `INSERT INTO "Ticket" ("id","code","name","status","order","eventId","email","wa","createdAt","updatedAt")
             VALUES ($1,$2,$3,'QUEUED',$4,$5,$6,$7,NOW(),NOW())
             ON CONFLICT ("code") DO NOTHING;`,
            randomUUID(), code, name, order, eventId, email, wa
          )
        }
      }

      await tx.$executeRawUnsafe(
        `UPDATE "RegistrationRequest" SET "status" = 'CONFIRMED', "updatedAt" = NOW() WHERE "id" = $1;`,
        requestId
      )

      const poolAfter = await this.getPoolRemainingTx(tx, eventId)

      const tickets = await tx.$queryRawUnsafe(
        `SELECT "code","order","status"
         FROM "Ticket"
         WHERE "eventId" = $1 AND "email" = $2
         ORDER BY "order" ASC;`,
        eventId, email
      ) as Array<{ code: string; order: number; status: 'QUEUED' | 'CALLED' | 'IN_PROCESS' | 'DONE' | 'DEFERRED' | 'NO_SHOW' }>

      return { eventId, email, tickets, donated, allocated, poolAfter, requestId }
    })

    return { ok: true, ...result }
  }
}
