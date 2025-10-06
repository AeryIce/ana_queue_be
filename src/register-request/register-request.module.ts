import { Module } from '@nestjs/common'
import { RegisterRequestController } from './register-request.controller'
import { RegisterRequestService } from './register-request.service'
import { PrismaService } from '../prisma.service'

@Module({
  imports: [],
  controllers: [RegisterRequestController],
  providers: [RegisterRequestService, PrismaService],
  exports: [],
})
export class RegisterRequestModule {}
