import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RegisterRequestService } from './register-request.service';
import { RegisterService } from '../register/register.service';

@Controller('api')
export class RegisterRequestController {
  constructor(
    private readonly reqSvc: RegisterRequestService,
    private readonly registerSvc: RegisterService,
  ) {}

  // FE: GET /api/register-queue?eventId=...&status=PENDING&limit=&offset=&q=&source=
  @Get('register-queue')
  async getQueue(
    @Query('eventId') eventId: string,
    @Query('status') status = 'PENDING',
    @Query('limit') limit = '20',
    @Query('offset') offset = '0',
    @Query('q') q = '',
    @Query('source') source = '',
  ) {
    return this.reqSvc.list({
      eventId,
      status,
      limit: parseInt(String(limit), 10) || 20,
      offset: parseInt(String(offset), 10) || 0,
      q,
      source,
    });
  }

  // FE: POST /api/register-confirm  body: { requestId, useCount?, eventId }
  @Post('register-confirm')
  async confirm(
    @Body() body: { requestId?: string; useCount?: number; eventId?: string },
  ) {
    const requestId = (body?.requestId ?? '').trim();
    const eventId = (body?.eventId ?? '').trim();

    if (!requestId || !eventId) {
      return { ok: false, error: 'requestId & eventId wajib diisi' };
    }

    // Ambil request pendaftaran
    const req = await this.reqSvc.findById(requestId);
    if (!req) {
      return { ok: false, error: 'Request tidak ditemukan' };
    }

    // Asumsi request menyimpan email (fallback: pakai requestId sebagai email)
    const email = (req.email ?? requestId).toLowerCase();

    // Alokasikan tiket via service register yang sudah ada
    const result = await this.registerSvc.register({ email, eventId });

    // Tandai request CONFIRMED (no-op kalau tabel belum ada)
    await this.reqSvc.markConfirmed(requestId);

    return { ok: true, ...result };
  }
}
