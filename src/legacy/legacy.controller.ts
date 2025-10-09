import { Controller, Get, Post, Query, Param } from '@nestjs/common';
import { QueueService } from '../queue/queue.service';

@Controller('api')
export class LegacyController {
  constructor(private readonly queue: QueueService) {}

  // alias lama -> baru
  @Get('pool')
  board(@Query('eventId') eventId: string) {
    return this.queue.board(eventId);
  }

  @Post('call-next')
  callNext(@Query('eventId') eventId: string) {
    return this.queue.callNextBatch(eventId);
  }

  @Post('promote')
  promote(@Query('eventId') eventId: string) {
    return this.queue.promoteQueueToActive(eventId);
  }

  @Post('skip/:id')
  skip(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.queue.skipActive(eventId, id);
  }

  @Post('recall/:id')
  recall(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.queue.recall(eventId, id);
  }

  @Post('done/:id')
  done(@Query('eventId') eventId: string, @Param('id') id: string) {
    return this.queue.done(eventId, id);
  }
}
