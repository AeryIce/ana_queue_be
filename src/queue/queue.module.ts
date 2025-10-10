import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { QueueController } from './queue.controller';
import { QueueService } from './queue.service';

@Module({
  controllers: [QueueController],
  providers: [QueueService, PrismaService],
  exports: [QueueService],
})
export class QueueModule {}
