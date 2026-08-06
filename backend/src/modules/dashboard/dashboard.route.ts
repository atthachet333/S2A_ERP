import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { ok } from '../../lib/response.js';
import { requirePasswordChanged } from '../auth/auth.guard.js';

/**
 * GET /api/dashboard/summary — ตัวเลขสรุปจากฐานข้อมูลจริง (read-only)
 * ใช้กับ Dashboard: System Overview และ Setup Progress
 * ตรวจ auth + ต้องเปลี่ยนรหัสผ่านแล้ว ตาม guard เดิม (ไม่แก้ auth flow)
 */
export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/summary', { preHandler: requirePasswordChanged }, async () => {
    const [users, activeUsers, units, warehouses, items, recipes] = await Promise.all([
      prisma.user.count({ where: { deletedAt: null } }),
      prisma.user.count({ where: { deletedAt: null, isActive: true } }),
      prisma.unit.count({ where: { deletedAt: null } }),
      prisma.warehouse.count({ where: { deletedAt: null } }),
      prisma.item.count({ where: { deletedAt: null } }),
      prisma.recipe.count({ where: { deletedAt: null } }),
    ]);
    return ok({ users, activeUsers, units, warehouses, items, recipes });
  });
}
