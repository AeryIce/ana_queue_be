import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
    constructor() {
    super({
      log: [
        { emit: 'stdout', level: 'error' },
        // kalau mau lebih verbos, aktifkan juga:
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'query' },
      ],
    });
  }
  async onModuleInit() {
    await this.$connect();
  }
  async onModuleDestroy() {
    await this.$disconnect();
  }
}
