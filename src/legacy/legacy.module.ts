import { Module } from '@nestjs/common';
import { LegacyController } from './legacy.controller';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [QueueModule],
  controllers: [LegacyController],
})
export class LegacyModule {}
