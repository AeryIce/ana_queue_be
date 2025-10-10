import { Body, Controller, Post, BadRequestException, Get, Query } from '@nestjs/common';
import { RegisterRequestService } from './register-request.service';

export class RegisterRequestDto {
  eventId!: string;
  email!: string;
  name!: string;
  wa?: string;
}

// optional: tipe bantu agar konsisten dengan FE
type ReqStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'ALL';
type Source = 'MASTER' | 'WALKIN' | 'GIMMICK' | 'ALL';

@Controller('api')
export class RegisterRequestController {
  constructor(private readonly svc: RegisterRequestService) {}

  // ─────────────────────────────────────────────────────────
  // POST /api/register-request  → simpan permintaan (PENDING)
  // ─────────────────────────────────────────────────────────
  @Post('register-request')
  async create(@Body() dto: RegisterRequestDto) {
    if (!dto?.eventId || !dto?.email || !dto?.name) {
      throw new BadRequestException('eventId, email, name wajib diisi');
    }
    return this.svc.createRequest(dto);
  }

  // ─────────────────────────────────────────────────────────
  // GET /api/registrants → LIST untuk halaman Admin Approve
  // mendukung filter: eventId, status, source, q, limit, offset
  // RESPON: { ok, items, total, limit, offset }
  // ─────────────────────────────────────────────────────────
  @Get('registrants')
  async list(
    @Query('eventId') eventId: string,
    @Query('status') status: ReqStatus = 'PENDING',
    @Query('source') source: Source = 'MASTER',
    @Query('limit') limitStr = '10',
    @Query('offset') offsetStr = '0',
    @Query('q') q?: string,
  ) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');

    // sanitasi & batas wajar
    const limitNum = Number.isFinite(Number(limitStr))
      ? Math.max(0, Math.min(100, parseInt(String(limitStr), 10)))
      : 10;
    const offsetNum = Number.isFinite(Number(offsetStr))
      ? Math.max(0, parseInt(String(offsetStr), 10))
      : 0;

    return this.svc.listRegistrants({
      eventId,
      status,
      source,
      limit: limitNum,
      offset: offsetNum,
      q: q?.trim() || undefined,
    });
  }

  // ─────────────────────────────────────────────────────────
  // POST /api/register-confirm
  // IZINKAN useCount = 0 (donate-all), larang nilai negatif/bukan bilangan bulat
  // ─────────────────────────────────────────────────────────
  @Post('register-confirm')
  async confirm(@Body() body: { requestId?: string; useCount?: number }) {
    const reqId = body?.requestId;
    const num = Number(body?.useCount ?? 0);

    if (!reqId) {
      return { ok: false, error: 'requestId wajib diisi' };
    }
    if (!Number.isInteger(num) || num < 0) {
      return { ok: false, error: 'useCount harus bilangan >= 0' };
    }

    return this.svc.confirm({ requestId: reqId, useCount: num });
  }
}
