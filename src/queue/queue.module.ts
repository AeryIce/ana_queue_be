import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [QueueController],
  providers: [QueueService, PrismaService], // ⬅️ tambahkan PrismaService
})
export class QueueModule {}
