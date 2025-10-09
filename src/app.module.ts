import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

import { PrismaModule } from './prisma.module';                // <<< global prisma
import { QueueModule } from './queue/queue.module';
import { RegisterModule } from './register/register.module';
import { RegisterRequestModule } from './register-request/register-request.module';
import { LegacyModule } from './legacy/legacy.module';

@Module({
  imports: [
    PrismaModule,          // <<< penting: jadikan PrismaService global
    QueueModule,
    RegisterModule,
    RegisterRequestModule,
    LegacyModule,
  ],
  controllers: [AppController],
  providers: [AppService], // PrismaService tak perlu lagi di sini
})
export class AppModule {}
