import { Body, Controller, Get, Post, Query } from '@nestjs/common'
import { RegisterRequestService } from './register-request.service'
import { RegisterRequestDto } from './register-request.dto'

@Controller('api')
export class RegisterRequestController {
  constructor(private readonly svc: RegisterRequestService) {}

  @Post('register-request')
  async create(@Body() dto: RegisterRequestDto) {
    if (!dto?.eventId || !dto?.email || !dto?.name) {
      return { ok: false, error: 'eventId, email, name wajib diisi' }
    }
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
    if (!Number.isInteger(body?.useCount) || (body?.useCount as number) <= 0) {
      return { ok: false, error: 'useCount harus bilangan > 0' }
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
  ) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' }
    return this.svc.listTickets({
      eventId,
      status: (status as any) ?? 'QUEUED',
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
  }
}
