import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  // Connections are opened lazily on the first query, so the app (and the
  // static-site tests) can boot even if PostgreSQL is temporarily down.
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
