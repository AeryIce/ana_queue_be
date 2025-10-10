import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller()
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  // === NEW: alias buat FE ===
  @Get('api/board')
  apiBoard(@Query('eventId') eventId: string) {
    return this.svc.board(eventId);
  }
  @Get('api/pool')
  apiPool(@Query('eventId') eventId: string) {
    return this.svc.getPoolSafe(eventId);
  }

  // === existing ops ===
  @Get('ops/board')
  board(@Query('eventId') eventId: string) {
    return this.svc.board(eventId);
  }

  @Post('ops/call-next-batch')
  callNext(@Query('eventId') eventId: string) {
    return this.svc.callNextBatch(eventId);
  }

  @Post('ops/promote-queue-to-active')
  promote(@Query('eventId') eventId: string) {
    return this.svc.promoteQueueToActive(eventId);
  }

  @Post('ops/skip/:id')
  skip(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.svc.skipActive(eventId, id);
  }

  @Post('ops/recall/:id')
  recall(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.svc.recall(eventId, id);
  }

  @Post('ops/done/:id')
  done(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.svc.done(eventId, id);
  }
  
  // === NEW: Diagnostic endpoint ===
  @Get('api/_diag/pool')
  diagPool(@Query('eventId') eventId: string) {
    return this.svc.diagPool(eventId);
  }
}
