import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller('api')
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  @Get('board')
  async board(@Query('eventId') eventId = 'seed-event') {
    try {
      return await this.svc.board(eventId);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'board failed' };
    }
  }

  @Get('pool')
  async pool(@Query('eventId') eventId = 'seed-event') {
    try {
      return await this.svc.getPoolSafe(eventId);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'pool failed' };
    }
  }

  @Get('pool/diag')
  async diag(@Query('eventId') eventId = 'seed-event') {
    try {
      return await this.svc.diagPool(eventId);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'diag failed' };
    }
  }

  // === TEAM B controls ===

  // Call Next (promote queued -> in_process) — POST!
  // Call Next (promote queued -> in_process)
@Post('promote')
async promote(@Query('eventId') eventId = 'seed-event') {
  try {
    // hasil dari service sudah mengandung { ok: true, promoted, codes, reason }
    return await this.svc.promoteQueueToActive(eventId);
  } catch (e: any) {
    return { ok: false, error: e?.message || 'promote failed' };
  }
}


  // Skip active -> deferred
  @Post('skip/:id')
  async skip(@Param('id') id: string, @Query('eventId') eventId = 'seed-event') {
    try {
      return await this.svc.skipActive(eventId, id);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'skip failed' };
    }
  }

  // Recall by code or id (support legacy route name)
  @Post('recall/:id')
  async recall(@Param('id') id: string, @Query('eventId') eventId = 'seed-event') {
    try {
      return await this.svc.recall(eventId, id);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'recall failed' };
    }
  }

  // Legacy alias used by FE: /api/recall-by-code/:code
  @Post('recall-by-code/:code')
  async recallByCode(@Param('code') code: string, @Query('eventId') eventId = 'seed-event') {
    try {
      return await this.svc.recall(eventId, code.toUpperCase());
    } catch (e: any) {
      return { ok: false, error: e?.message || 'recall-by-code failed' };
    }
  }

  // Done (finish)
  @Post('done/:id')
  async done(@Param('id') id: string, @Query('eventId') eventId = 'seed-event') {
    try {
      return await this.svc.done(eventId, id);
    } catch (e: any) {
      return { ok: false, error: e?.message || 'done failed' };
    }
  }
}
