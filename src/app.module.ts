import { Module } from '@nestjs/common'
import { AppController } from './app.controller'
import { PrismaService } from './prisma.service'

// ✅ Modul registrasi request (grid panitia)
import { RegisterRequestModule } from './register-request/register-request.module'

@Module({
  imports: [
    // Module endpoint:
    // - POST /api/register-request
    // - GET  /api/register-queue?eventId=...
    RegisterRequestModule,
  ],
  controllers: [AppController],
  providers: [PrismaService],
})
export class AppModule {}
