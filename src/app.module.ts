import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// Team B
import { QueueModule } from './queue/queue.module';

// >>> Tambahkan dua module ini supaya route lama aktif lagi
import { RegisterModule } from './register/register.module';
import { RegisterRequestModule } from './register-request/register-request.module';

// Prisma dipakai AppController (dan aman kalau dibutuhkan module lain)
import { PrismaService } from './prisma.service';

@Module({
  imports: [
    QueueModule,
    RegisterModule,           // <<< penting
    RegisterRequestModule,    // <<< penting
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})
export class AppModule {}
