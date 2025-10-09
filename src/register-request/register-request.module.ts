import { Module } from '@nestjs/common';
import { RegisterRequestController } from './register-request.controller';
import { RegisterRequestService } from './register-request.service';
import { RegisterService } from '../register/register.service';
import { PrismaService } from '../prisma.service';

@Module({
  controllers: [RegisterRequestController],
  providers: [RegisterRequestService, RegisterService, PrismaService],
  exports: [RegisterRequestService],
})
export class RegisterRequestModule {}
