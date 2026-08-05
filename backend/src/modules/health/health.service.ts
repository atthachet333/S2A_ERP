import { prisma } from '../../lib/prisma.js';

export interface HealthStatus {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  db: 'up' | 'down';
  version: string;
}

/**
 * ตรวจสถานะระบบ + ทดสอบการเชื่อมต่อฐานข้อมูลด้วย query เบา ๆ
 */
export async function getHealth(): Promise<HealthStatus> {
  let db: 'up' | 'down' = 'down';
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = 'up';
  } catch {
    db = 'down';
  }

  return {
    status: db === 'up' ? 'ok' : 'degraded',
    uptime: Number(process.uptime().toFixed(2)),
    timestamp: new Date().toISOString(),
    db,
    version: process.env.npm_package_version ?? '0.1.0',
  };
}
