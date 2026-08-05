import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';

/**
 * Prisma Client แบบ singleton
 * ป้องกันการสร้าง connection ซ้ำตอน hot-reload ใน dev
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
