// src/queue/queue.controller.ts — REPLACE ALL

import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller('api')
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  // === BASIC MONITORING ===

  @Get('board')
  async board(@Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.board(eventId);
      return { ok: true, ...r };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'board failed' };
    }
  }

  @Get('pool')
  async pool(@Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.getPoolSafe(eventId);
      return { ok: true, ...r };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'pool failed' };
    }
  }

  @Get('pool/diag')
  async diag(@Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.diagPool(eventId);
      return { ok: true, ...r };
    } catch (e: any) {
      return { ok: false, error: e?.message || 'diag failed' };
    }
  }

  // === TEAM B CONTROLS ===

  // Call Next (promote queued → in_process)
  @Post('promote')
  async promote(@Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.promoteQueueToActive(eventId);
      return r; // service sudah mengandung { ok, promoted, codes, reason }
    } catch (e: any) {
      return { ok: false, error: e?.message || 'promote failed' };
    }
  }

  // Skip (in_process → deferred)
  @Post('skip/:id')
  async skip(@Param('id') id: string, @Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.skipActive(eventId, id);
      return r;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'skip failed' };
    }
  }

  // Recall by id (deferred/queued → in_process)
  @Post('recall/:id')
  async recall(@Param('id') id: string, @Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.recall(eventId, id);
      return r;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'recall failed' };
    }
  }

  // Legacy alias used by FE: /api/recall-by-code/:code
  @Post('recall-by-code/:code')
  async recallByCode(@Param('code') code: string, @Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.recall(eventId, code.toUpperCase());
      return r;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'recall-by-code failed' };
    }
  }

  // Done (finish process)
  @Post('done/:id')
  async done(@Param('id') id: string, @Query('eventId') eventId = 'seed-event') {
    try {
      const r = await this.svc.done(eventId, id);
      return r;
    } catch (e: any) {
      return { ok: false, error: e?.message || 'done failed' };
    }
  }
}
