import { Module } from '@nestjs/common';
import { QueueService } from './queue.service';
import { QueueController } from './queue.controller';
import { PrismaModule } from '../prisma.module';

@Module({
  imports: [PrismaModule],           // pakai Prisma dari Global module
  controllers: [QueueController],
  providers: [QueueService],         // cukup QueueService
  exports: [QueueService],           // <-- PENTING: agar terlihat di LegacyModule
})
export class QueueModule {}
