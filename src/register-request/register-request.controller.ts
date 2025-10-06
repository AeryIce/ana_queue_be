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
  async list(@Query('eventId') eventId?: string) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' }
    return this.svc.listPending(eventId)
  }
}
