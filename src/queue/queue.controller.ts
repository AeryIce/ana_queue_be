import { Body, Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller()
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  // === FE aliases ===
  @Get('api/board')
  apiBoard(@Query('eventId') eventId: string) {
    return this.svc.board(eventId);
  }
  @Get('api/pool')
  apiPool(@Query('eventId') eventId: string) {
    return this.svc.getPoolSafe(eventId);
  }

  // === Ops (legacy, tanpa batch) ===
  @Post('api/promote')
  promote(@Query('eventId') eventId: string) {
    return this.svc.promoteQueueToActive(eventId);
  }

  @Post('api/skip/:id')
  skip(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.svc.skipActive(eventId, id);
  }

  @Post('api/recall/:id')
  recall(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.svc.recall(eventId, id);
  }

  @Post('api/done/:id')
  done(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.svc.done(eventId, id);
  }

  // === Diagnostic
  @Get('api/_diag/pool')
  diagPool(@Query('eventId') eventId: string) {
    return this.svc.diagPool(eventId);
  }

  // === Pool donate (admin)
  @Post('api/pool-donate')
  async donatePool(@Body() body: { eventId?: string; amount?: number }) {
    const eventId = body?.eventId || 'seed-event';
    const amount = Math.max(1, Math.min(Number(body?.amount ?? 1), 100));
    return this.svc.donate(eventId, amount);
  }
}
