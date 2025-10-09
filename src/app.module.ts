import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Team B queue module
import { QueueModule } from './queue/queue.module';

// PrismaService dipakai oleh AppController & QueueService
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    QueueModule,
    // kalau ada module lain tinggal tambahkan di sini
  ],
  controllers: [AppController],
  providers: [
    AppService,
    PrismaService, // <<< penting: supaya AppController bisa resolve PrismaService
  ],
})
export class AppModule {}
