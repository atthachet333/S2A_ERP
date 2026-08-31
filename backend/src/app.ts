import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';
import { env } from './config/env.js';
import requestContext from './plugins/request-context.js';
import errorHandler from './plugins/error-handler.js';
import healthRoutes from './modules/health/health.route.js';
import authRoutes from './modules/auth/auth.route.js';
import userRoutes from './modules/users/user.route.js';
import dashboardRoutes from './modules/dashboard/dashboard.route.js';
import activityRoutes from './modules/activity/activity.route.js';
import unitRoutes from './modules/catalog/unit.route.js';
import categoryRoutes from './modules/catalog/category.route.js';
import itemRoutes from './modules/catalog/item.route.js';
import menuRoutes from './modules/catalog/menu.route.js';
import recipeRoutes from './modules/recipes/recipe.route.js';
import costingRoutes from './modules/costing/costing.route.js';
import uploadRoutes from './modules/uploads/upload.route.js';
import businessRoutes from './modules/business/business.route.js';
import transferRoutes from './modules/business/transfer.route.js';
import receiptAttachmentRoutes from './modules/business/receipt-attachment.route.js';
import documentExtractionRoutes from './modules/business/document-extraction.route.js';
import productionRoutes from './modules/production/production.route.js';
import purchasePlanningRoutes from './modules/purchase-planning/purchase-planning.route.js';
import purchaseOrderRoutes from './modules/purchase-orders/purchase-order.route.js';
  import analyticsRoutes from './modules/analytics/analytics.route.js';
  import costVarianceRoutes from './modules/analytics/cost-variance.route.js';
  import profitSimulatorRoutes from './modules/analytics/profit-simulator.route.js';
import lotRoutes from './modules/inventory/lot.route.js';
import companyRoutes from './modules/companies/company.route.js';
import adminRoutes from './modules/admin/admin.route.js';

/**
 * สร้าง Fastify instance พร้อม plugin และ route ทั้งหมด
 * แยกออกจาก server.ts เพื่อให้ทดสอบด้วย app.inject() ได้
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
          : undefined,
    },
    // ใช้ request-id ของเราเอง (จาก header) แทนการ gen ของ fastify
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  });

  // Cross-cutting plugins
  await app.register(requestContext);
  await app.register(errorHandler);

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // อัปโหลดรูป (จำกัดขนาด/จำนวนไฟล์) — ตรวจ magic bytes ในเลเยอร์ route อีกชั้น
  await app.register(multipart, { limits: { fileSize: env.UPLOAD_MAX_BYTES, files: 1, fields: 10 } });

  // Routes (ทั้งหมดอยู่ใต้ /api)
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(activityRoutes, { prefix: '/activity' });
      await api.register(unitRoutes, { prefix: '/units' });
      await api.register(categoryRoutes, { prefix: '/categories' });
      await api.register(itemRoutes, { prefix: '/items' });
      await api.register(menuRoutes, { prefix: '/menus' });
      await api.register(recipeRoutes, { prefix: '/recipes' });
      await api.register(costingRoutes, { prefix: '/costing' });
      await api.register(uploadRoutes, { prefix: '/uploads' });
      await api.register(businessRoutes, { prefix: '/business' });
      // PHASE 18 — โอนย้ายระหว่างคลัง แยกไฟล์แต่ยังอยู่ใต้ /business เหมือนงาน operations อื่น
      await api.register(transferRoutes, { prefix: '/business' });
      // PHASE 22 — ไฟล์เอกสารต้นฉบับจากผู้ขาย (ส่วนเพิ่มของงานรับของ)
      await api.register(receiptAttachmentRoutes, { prefix: '/business' });
      // PHASE 23 — อ่านไฟล์ต้นฉบับเป็นผลชั้นกลางสำหรับตรวจทานและ apply เข้า DRAFT เท่านั้น
      await api.register(documentExtractionRoutes, { prefix: '/business' });
      // PHASE 24 — ใบผลิตสินค้า: ร่าง → ยืนยันแบบ atomic → กลับรายการ
      await api.register(productionRoutes, { prefix: '/business' });
      // PHASE 26 — แผนความต้องการวัตถุดิบเชิงแนะนำ ไม่จองหรือขยับสต็อก
      await api.register(purchasePlanningRoutes, { prefix: '/business' });
      await api.register(purchaseOrderRoutes, { prefix: '/business' });
        await api.register(analyticsRoutes, { prefix: '/business' });
        await api.register(costVarianceRoutes, { prefix: '/business' });
        await api.register(profitSimulatorRoutes, { prefix: '/business' });
      await api.register(lotRoutes, { prefix: '/business' });
      await api.register(companyRoutes, { prefix: '/companies' });
      await api.register(adminRoutes, { prefix: '/admin' });
    },
    { prefix: '/api' },
  );

  return app;
}
