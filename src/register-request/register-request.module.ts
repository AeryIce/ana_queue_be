import { Module } from '@nestjs/common'
import { RegisterRequestController } from './register-request.controller'
import { RegisterRequestService } from './register-request.service'
import { PrismaClient } from '@prisma/client'

@Module({
  controllers: [RegisterRequestController],
  providers: [RegisterRequestService, PrismaClient],
})
export class RegisterRequestModule {}
