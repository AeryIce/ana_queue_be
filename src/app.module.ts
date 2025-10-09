import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';

// >>> Team B queue module
import { QueueModule } from './queue/queue.module';

// (opsional) kalau kamu sudah punya module lain, import di sini juga
// import { RegisterModule } from './register/register.module';
// import { RegisterRequestModule } from './register-request/register-request.module';

@Module({
  imports: [
    QueueModule,
    // RegisterModule,
    // RegisterRequestModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
