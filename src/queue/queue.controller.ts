import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller()
export class QueueController {
  constructor(private readonly svc: QueueService) {}

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
}
