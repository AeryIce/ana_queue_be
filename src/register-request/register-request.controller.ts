import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { RegisterRequestService } from './register-request.service'
import { RegisterRequestDto } from './register-request.dto' // <-- pastikan ini

@Controller('api')
export class RegisterRequestController {
  constructor(private readonly svc: RegisterRequestService) {}

  @Post('register-request') // <-- tambah path biar jadi /api/register-request
  async create(@Body() dto: RegisterRequestDto) {
    // Selalu HTTP 200 supaya FE gampang handle { ok: boolean }
    return this.svc.createRequest(dto)
  }

  @Get('register-queue')
  async list(
    @Query('eventId') eventId?: string,
    @Query('status') status?: 'PENDING'|'CONFIRMED'|'CANCELLED'|'ALL',
  ) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' }
    return this.svc.listQueue({ eventId, status: (status as any) ?? 'PENDING' })
  }

 @Post('register-confirm')
  async confirm(@Body() body: { requestId?: string; useCount?: number }) {
    if (!body?.requestId) return { ok: false, error: 'requestId wajib diisi' }
    // izinkan >= 0
    if (!Number.isInteger(body?.useCount) || (body?.useCount as number) < 0) {
      return { ok: false, error: 'useCount harus bilangan ≥ 0' }
    }
    return this.svc.confirm({ requestId: body.requestId, useCount: Number(body.useCount) })
  }


  @Get('pool')
  async getPool(@Query('eventId') eventId?: string) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' }
    const poolRemaining = await (this.svc as any)['getPoolRemaining'](eventId)
    return { ok: true, eventId, poolRemaining }
  }

  @Get('registrants')
  async registrants(
    @Query('eventId') eventId?: string,
    @Query('status') status?: 'PENDING'|'CONFIRMED'|'CANCELLED'|'ALL',
    @Query('source') source?: 'MASTER'|'WALKIN'|'GIMMICK'|'ALL',
    @Query('q') q?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' }
    return this.svc.listRegistrants({
      eventId,
      status: (status as any) ?? 'ALL',
      source: (source as any) ?? 'ALL',
      q,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }

  @Get('tickets')
async tickets(
  @Query('eventId') eventId?: string,
  @Query('status') status?: 'QUEUED'|'CALLED'|'IN_PROCESS'|'DONE'|'DEFERRED'|'NO_SHOW'|'ALL',
  @Query('limit') limit?: string,
  @Query('offset') offset?: string,
  @Query('email') email?: string, // ← NEW
) {
  if (!eventId) return { ok: false, error: 'eventId wajib diisi' }

  // siapkan filter dasar
  const args: any[] = [eventId]
  let whereSql = `"eventId" = $1`

  if ((status as any) && status !== 'ALL') {
    args.push(status)
    whereSql += ` AND "status"::text = $${args.length}`
  }

  if (email && email.trim()) {
    args.push(email.trim().toLowerCase())
    whereSql += ` AND lower("email") = $${args.length}` // ← filter by email
  }

  const lim = Math.max(1, Math.min(Number(limit ?? 100), 500))
  const off = Math.max(0, Number(offset ?? 0))

  const rows = await (this.svc as any).prisma.$queryRawUnsafe(
    `SELECT "code","order","status","email","name","wa","createdAt"
     FROM "Ticket"
     WHERE ${whereSql}
     ORDER BY "order" ASC
     LIMIT $${args.length + 1} OFFSET $${args.length + 2};`,
    ...args, lim, off
  ) as Array<{ code: string; order: number; status: string; email: string | null; name: string | null; wa: string | null; createdAt: Date }>

  const totalRow = await (this.svc as any).prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS count FROM "Ticket" WHERE ${whereSql};`,
    ...args
  ) as Array<{ count: number }>

  return {
    ok: true,
    eventId,
    status: (status as any) ?? 'QUEUED',
    limit: lim,
    offset: off,
    total: totalRow?.[0]?.count ?? rows.length,
    items: rows
  }
}

}
