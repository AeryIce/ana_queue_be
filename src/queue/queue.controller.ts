import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QueueService } from './queue.service';

function errMessage(e: unknown) {
  if (!e) return 'Unknown error';
  if (typeof e === 'string') return e;
  if (typeof (e as any).message === 'string') return (e as any).message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

@Controller('api')
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  @Get('board')
  async board(@Query('eventId') eventId: string) {
    try {
      return await this.svc.board(eventId);
    } catch (e) {
      // log lengkap ke console server
      // @ts-ignore
      console.error('[GET /api/board] ERROR:', e?.stack || e);
      return { ok: false, error: errMessage(e) };
    }
  }

  @Get('pool')
  async pool(@Query('eventId') eventId: string) {
    try {
      return await this.svc.getPoolSafe(eventId);
    } catch (e) {
      // @ts-ignore
      console.error('[GET /api/pool] ERROR:', e?.stack || e);
      return { ok: false, error: errMessage(e) };
    }
  }

  @Get('diag-pool')
  async diagPool(@Query('eventId') eventId: string) {
    try {
      return await this.svc.diagPool(eventId);
    } catch (e) {
      // @ts-ignore
      console.error('[GET /api/diag-pool] ERROR:', e?.stack || e);
      return { ok: false, error: errMessage(e) };
    }
  }

  @Post('promote')
  async promote(@Query('eventId') eventId: string) {
    try {
      return await this.svc.promoteQueueToActive(eventId);
    } catch (e) {
      // @ts-ignore
      console.error('[POST /api/promote] ERROR:', e?.stack || e);
      return { ok: false, error: errMessage(e) };
    }
  }

  @Post('skip/:idOrCode')
  async skip(@Query('eventId') eventId: string, @Param('idOrCode') idOrCode: string) {
    try {
      return await this.svc.skipActive(eventId, idOrCode);
    } catch (e) {
      // @ts-ignore
      console.error('[POST /api/skip/:idOrCode] ERROR:', e?.stack || e, { idOrCode, eventId });
      return { ok: false, error: errMessage(e) };
    }
  }

  @Post('recall/:idOrCode')
  async recall(@Query('eventId') eventId: string, @Param('idOrCode') idOrCode: string) {
    try {
      return await this.svc.recall(eventId, idOrCode);
    } catch (e) {
      // @ts-ignore
      console.error('[POST /api/recall/:idOrCode] ERROR:', e?.stack || e, { idOrCode, eventId });
      return { ok: false, error: errMessage(e) };
    }
  }

  @Post('recall-by-code/:code')
  async recallByCode(@Query('eventId') eventId: string, @Param('code') code: string) {
    try {
      return await this.svc.recallByCode(eventId, code.toUpperCase());
    } catch (e) {
      // @ts-ignore
      console.error('[POST /api/recall-by-code/:code] ERROR:', e?.stack || e, { code, eventId });
      return { ok: false, error: errMessage(e) };
    }
  }

  @Post('done/:idOrCode')
  async done(@Query('eventId') eventId: string, @Param('idOrCode') idOrCode: string) {
    try {
      return await this.svc.done(eventId, idOrCode);
    } catch (e) {
      // @ts-ignore
      console.error('[POST /api/done/:idOrCode] ERROR:', e?.stack || e, { idOrCode, eventId });
      return { ok: false, error: errMessage(e) };
    }
  }

  // Endpoint kecil buat ngecek env & versi cepat
  @Get('_debug_env')
  env() {
    return {
      ok: true,
      ACTIVE_SLOTS: Number(process.env.ACTIVE_SLOT_SIZE) || Number(process.env.NEXT_PUBLIC_ACTIVE_SLOT_SIZE) || 6,
      NODE_ENV: process.env.NODE_ENV,
      TS: new Date().toISOString(),
    };
  }
}
