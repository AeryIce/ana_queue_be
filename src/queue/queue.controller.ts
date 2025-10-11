import { Controller, Get, Post, Query, Param, Body, BadRequestException } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller('api')
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  @Get('board')
  async board(@Query('eventId') eventId: string) {
    return this.svc.board(eventId);
  }

  @Get('pool')
  async pool(@Query('eventId') eventId: string) {
    return this.svc.getPoolSafe(eventId);
  }

  @Get('diag-pool')
  async diag(@Query('eventId') eventId: string) {
    return this.svc.diagPool(eventId);
  }

  // Call next = promote queued → in_process (hingga kapasitas slot aktif)
  @Post('promote')
  async promote(@Query('eventId') eventId: string) {
    return this.svc.promoteQueueToActive(eventId);
  }

  // Alias kalau FE masih pakai endpoint lama
  @Post('call-next')
  async callNext(@Query('eventId') eventId: string) {
    return this.svc.promoteQueueToActive(eventId);
  }

  @Post('skip/:id')
  async skip(@Param('id') id: string, @Query('eventId') eventId: string) {
    return this.svc.skipActive(eventId, id);
  }

  @Post('recall/:id')
  async recall(@Param('id') id: string, @Query('eventId') eventId: string) {
    return this.svc.recall(eventId, id);
  }

  // FE kamu manggil /recall-by-code/AH-001 → arahkan ke recall() dengan code
  @Post('recall-by-code/:code')
  async recallByCode(@Param('code') code: string, @Query('eventId') eventId: string) {
    return this.svc.recall(eventId, code.toUpperCase());
  }

  @Post('done/:id')
  async done(@Param('id') id: string, @Query('eventId') eventId: string) {
    return this.svc.done(eventId, id);
  }

  @Post('donate')
  async donate(@Query('eventId') eventId: string, @Body('amount') amount?: number) {
    if (!eventId) throw new BadRequestException('eventId wajib diisi');
    const amt = Number.isFinite(Number(amount)) ? Number(amount) : 0;
    return this.svc.donate(eventId, amt);
  }
}
