// src/queue/queue.controller.ts — REPLACE ALL
import { Controller, Get, Post, Param, Query } from '@nestjs/common';
import { QueueService } from './queue.service';

@Controller('api')
export class QueueController {
  constructor(private readonly svc: QueueService) {}

  // TV/Admin board snapshot
  @Get('board')
  board(@Query('eventId') eventId: string) {
    return this.svc.board(eventId);
  }

  // Pool saldo (DONATE - ALLOCATE)
  @Get('pool')
  pool(@Query('eventId') eventId: string) {
    return this.svc.getPoolSafe(eventId);
  }

  // Promote queue → active (isi slot kosong; alias "Call Next")
  @Post('promote')
  promote(@Query('eventId') eventId: string) {
    return this.svc.promoteQueueToActive(eventId);
  }

  // Opsi endpoint lain utk kompatibilitas
  @Post('call-next')
  callNext(@Query('eventId') eventId: string) {
    return this.svc.promoteQueueToActive(eventId);
  }

  // Skip ticket IN_PROCESS → DEFERRED
  @Post('skip/:idOrCode')
  skip(@Param('idOrCode') idOrCode: string, @Query('eventId') eventId: string) {
    return this.svc.skipActive(eventId, idOrCode);
  }

  // Recall: DEFERRED/QUEUED → IN_PROCESS (jika ada slot)
  @Post('recall/:idOrCode')
  recall(@Param('idOrCode') idOrCode: string, @Query('eventId') eventId: string) {
    return this.svc.recall(eventId, idOrCode);
  }

  // Kompat: recall-by-code/AH-001
  @Post('recall-by-code/:code')
  recallByCode(@Param('code') code: string, @Query('eventId') eventId: string) {
    return this.svc.recall(eventId, (code || '').toUpperCase());
  }

  // Selesaikan tiket → DONE
  @Post('done/:idOrCode')
  done(@Param('idOrCode') idOrCode: string, @Query('eventId') eventId: string) {
    return this.svc.done(eventId, idOrCode);
  }
}
