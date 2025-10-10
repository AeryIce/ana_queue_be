import { Module } from '@nestjs/common';
import { RegisterRequestController } from './register-request.controller';
import { RegisterRequestService } from './register-request.service';
import { PrismaService } from '../prisma.service'; // ⬅️ perbaiki path, naik 1 folder
import { RegisterModule } from '../register/register.module'; // ⬅️ perbaiki path, naik 1 folder

@Module({
  imports: [RegisterModule], // untuk akses RegisterService
  controllers: [RegisterRequestController],
  providers: [RegisterRequestService, PrismaService], // tambahkan PrismaService
  exports: [RegisterRequestService],
})
export class RegisterRequestModule {}
