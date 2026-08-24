import type { FastifyInstance } from 'fastify';
import { ItemType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ok } from '../../lib/response.js';
import { requireCompany } from '../auth/auth.guard.js';

/**
 * GET /api/dashboard/summary — ตัวเลขสรุปจากฐานข้อมูลจริง (read-only)
 * ใช้กับ Dashboard: System Overview และ Setup Progress
 * ตรวจ auth + ต้องเปลี่ยนรหัสผ่านแล้ว ตาม guard เดิม (ไม่แก้ auth flow)
 */
export default async function dashboardRoutes(app: FastifyInstance) {
  app.get('/summary', { preHandler: requireCompany }, async (req) => {
    const [users, activeUsers, units, warehouses, items, recipes, rawMaterials, menus, activeRecipes, itemsWithoutPrice] = await Promise.all([
      prisma.companyMembership.count({ where: { companyId: req.user.companyId!, user: { deletedAt: null } } }),
      prisma.companyMembership.count({ where: { companyId: req.user.companyId!, isActive: true, user: { deletedAt: null, isActive: true } } }),
      prisma.unit.count({ where: { deletedAt: null } }),
      prisma.warehouse.count({ where: { deletedAt: null, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, companyId: req.user.companyId! } }),
      prisma.recipe.count({ where: { deletedAt: null, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, type: ItemType.RAW_MATERIAL, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, type: ItemType.FINISHED_GOOD, companyId: req.user.companyId! } }),
      prisma.recipe.count({ where: { deletedAt: null, isActive: true, companyId: req.user.companyId!, versions: { some: { isActive: true } } } }),
      /* PHASE 21 — นับเฉพาะที่ "ยังไม่มีข้อมูลต้นทุน" จริง ๆ
         รายการที่ยืนยันแล้วว่าต้นทุนเป็น 0 (เช่น น้ำประปา) จะมีแถวประวัติราคาอยู่
         จึงหลุดออกจากคำเตือนนี้เอง ไม่ต้องเตือนซ้ำทั้งที่จัดการเรียบร้อยแล้ว
         เพิ่ม isActive เพราะของที่ปิดใช้งานแล้วไม่กระทบต้นทุนสูตรที่ใช้อยู่ */
      prisma.item.count({ where: { deletedAt: null, isActive: true, companyId: req.user.companyId!, type: { not: ItemType.FINISHED_GOOD }, priceHistory: { none: {} } } }),
    ]);
    return ok({ users, activeUsers, units, warehouses, items, recipes, rawMaterials, menus, activeRecipes, itemsWithoutPrice });
  });
}
