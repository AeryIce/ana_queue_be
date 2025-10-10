import { Controller, Post, Query, Param } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller('api')
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  /** Alias untuk call-next: isi slot aktif dari antrian. */
  @Post('promote')
  async promote(@Query('eventId') eventId?: string) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' };
    return this.svc.promote(eventId);
  }

  /** Beberapa FE lama memakai /api/call-next — samakan behavior dengan /promote */
  @Post('call-next')
  async callNext(@Query('eventId') eventId?: string) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' };
    return this.svc.promote(eventId);
  }

  /** Recall dari SKIPPED (atau QUEUED) dengan kode. */
  @Post('recall-by-code/:code')
  async recall(@Param('code') code: string, @Query('eventId') eventId?: string) {
    if (!eventId) return { ok: false, error: 'eventId wajib diisi' };
    if (!code) return { ok: false, error: 'code wajib diisi' };
    return this.svc.recallByCode(eventId, code.toUpperCase());
  }
}
