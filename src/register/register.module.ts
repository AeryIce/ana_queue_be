import { Module } from '@nestjs/common';
import { RegisterController } from './register.controller';
import { RegisterService } from './register.service';
import { PrismaService } from '../prisma.service'; // naik 1 folder juga

@Module({
  controllers: [RegisterController],
  providers: [RegisterService, PrismaService],
  exports: [RegisterService],
})
export class RegisterModule {}
