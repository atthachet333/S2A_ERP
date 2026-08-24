import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 15 — ออเดอร์ + ขอบเขตบริษัท + การบังคับสิทธิ์ที่ backend
 *
 * จุดสำคัญ: การซ่อนปุ่มที่ frontend ไม่นับเป็นการรักษาความปลอดภัย
 * backend ต้องปฏิเสธเองทุกครั้ง เทสต์ชุดนี้จึงยิงตรงไปที่ API
 */

const TAG = `os${Date.now().toString().slice(-7)}`;
const num = (d: unknown) => Number(d);

describe.sequential('orders + company scope + permissions', () => {
  let app: FastifyInstance;
  let adminToken = '';
  let limitedToken = '';
  let companyAId = '';
  let companyBId = '';
  /** ทรัพยากรของบริษัท B ใช้ทดสอบว่าบริษัท A เข้าถึงไม่ได้ */
  let customerBId = '';
  let warehouseBId = '';
  let customerAId = '';
  let menuAId = '';
  const admin = () => ({ authorization: `Bearer ${adminToken}` });
  const limited = () => ({ authorization: `Bearer ${limitedToken}` });

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    /* ผู้ใช้สิทธิ์จำกัด: ต้องเป็นบทบาทที่ "ไม่มีสิทธิ์ใด ๆ" จริง ๆ
       (MANAGER มี 47 สิทธิ์ จึงใช้ทดสอบการปฏิเสธไม่ได้) */
    const limitedRole = await prisma.role.findFirstOrThrow({
      where: { name: RoleName.VIEWER },
      include: { rolePermissions: true },
    });
    expect(limitedRole.rolePermissions).toHaveLength(0);

    const companyA = await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } });
    companyAId = companyA.id;
    const companyB = await prisma.company.upsert({
      where: { code: `CO_B_${TAG}` }, update: {},
      create: { code: `CO_B_${TAG}`, nameTh: 'บริษัท ทดสอบขอบเขต จำกัด' },
    });
    companyBId = companyB.id;

    const mk = async (username: string, roleId: string, companyId: string) => {
      const passwordHash = await bcrypt.hash('ScopePass123!', 10);
      const user = await prisma.user.upsert({
        where: { username },
        update: { passwordHash, mustChangePassword: false, isActive: true, deletedAt: null },
        create: { username, email: `${username}@s2a.local`, passwordHash, fullName: username, isActive: true, mustChangePassword: false },
      });
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId } }, update: {}, create: { userId: user.id, roleId } });
      await prisma.companyMembership.upsert({
        where: { userId_companyId: { userId: user.id, companyId } },
        update: { roleId }, create: { userId: user.id, companyId, roleId, isDefault: true },
      });
      return user;
    };

    await mk(`admin_${TAG}`, superRole.id, companyAId);
    await mk(`limited_${TAG}`, limitedRole.id, companyAId);

    app = await buildApp();
    await app.ready();
    const login = async (username: string) => {
      const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'ScopePass123!' } });
      return res.json().data.accessToken as string;
    };
    adminToken = await login(`admin_${TAG}`);
    limitedToken = await login(`limited_${TAG}`);

    /* ทรัพยากรของบริษัท B — สร้างตรงในฐานข้อมูล ไม่ผ่าน API */
    const custB = await prisma.customer.create({ data: { companyId: companyBId, code: `CUST_B_${TAG}`, name: 'ลูกค้าบริษัทบี' } });
    customerBId = custB.id;
    const whB = await prisma.warehouse.create({ data: { companyId: companyBId, code: `WH_B_${TAG}`, name: 'คลังบริษัทบี' } });
    warehouseBId = whB.id;

    /* ทรัพยากรของบริษัท A สำหรับสร้างออเดอร์จริง */
    const custA = await prisma.customer.create({ data: { companyId: companyAId, code: `CUST_A_${TAG}`, name: 'ลูกค้าบริษัทเอ' } });
    customerAId = custA.id;
    const unit = await prisma.unit.upsert({ where: { code: `BAG_${TAG}` }, update: {}, create: { code: `BAG_${TAG}`, name: 'ถุง(ทดสอบ)' } });
    const menu = await prisma.item.create({
      data: { companyId: companyAId, code: `MENU_${TAG}`, name: 'ข้าวกล่องทดสอบ', type: ItemType.FINISHED_GOOD, baseUnitId: unit.id },
    });
    menuAId = menu.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /* ============================================================
     D. ออเดอร์ — ร่าง → แก้ไข → ยืนยัน → ราคาที่บันทึกไว้ต้องไม่เปลี่ยน
     ============================================================ */
  let orderId = '';
  let orderNo = '';

  it('D1 สร้างออเดอร์หลายบรรทัดเป็นร่าง พร้อมบันทึกระดับราคา', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/orders', headers: admin(),
      payload: {
        customerId: customerAId, deliveryDate: new Date('2026-09-01').toISOString(), priceTier: 'RETAIL',
        items: [
          { menuId: menuAId, menuNameSnapshot: 'ข้าวกล่องทดสอบ', quantity: 5, unit: `BAG_${TAG}`, unitPrice: 28 },
          { menuId: menuAId, menuNameSnapshot: 'ข้าวกล่องทดสอบ (พิเศษ)', quantity: 2, unit: `BAG_${TAG}`, unitPrice: 35 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    const order = res.json().data;
    orderId = order.id; orderNo = order.orderNo;
    expect(order.status).toBe('DRAFT');
    expect(order.priceTier).toBe('RETAIL');
    // 5×28 + 2×35 = 210
    expect(num(order.totalAmount)).toBeCloseTo(210, 2);
  });

  it('D2 แก้ไขร่างได้ และเลขที่ออเดอร์ต้องไม่เปลี่ยน', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/business/orders/${orderId}`, headers: admin(),
      payload: {
        customerId: customerAId, deliveryDate: new Date('2026-09-02').toISOString(), priceTier: 'RETAIL',
        items: [{ menuId: menuAId, menuNameSnapshot: 'ข้าวกล่องทดสอบ', quantity: 5, unit: `BAG_${TAG}`, unitPrice: 28 }],
      },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.orderNo).toBe(orderNo);
    expect(num(res.json().data.totalAmount)).toBeCloseTo(140, 2);
  });

  it('D3 ยืนยันออเดอร์แล้วราคาที่บันทึกไว้ต้องคงเดิมแม้ราคาปัจจุบันเปลี่ยน', async () => {
    const confirm = await app.inject({
      method: 'POST', url: `/api/business/orders/${orderId}/transition`, headers: admin(),
      payload: { status: 'CONFIRMED' },
    });
    expect(confirm.statusCode).toBe(200);

    const before = await prisma.salesOrderItem.findFirstOrThrow({ where: { orderId } });
    expect(num(before.unitPrice)).toBeCloseTo(28, 2);
    expect(num(before.lineTotal)).toBeCloseTo(140, 2);

    /* เปลี่ยนราคาขายปัจจุบันของเมนู — ออเดอร์เก่าต้องไม่ขยับ */
    await prisma.sellingPrice.create({
      data: { companyId: companyAId, itemId: menuAId, priceType: 'RETAIL', price: 99 },
    });

    const after = await prisma.salesOrderItem.findFirstOrThrow({ where: { orderId } });
    expect(num(after.unitPrice)).toBeCloseTo(28, 2);      // snapshot ไม่เปลี่ยน
    expect(num(after.lineTotal)).toBeCloseTo(140, 2);
    expect(after.menuNameSnapshot).toBe('ข้าวกล่องทดสอบ');

    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.priceTier).toBe('RETAIL');              // ระดับราคายังถูกเก็บไว้
  });

  it('D4 ยืนยันซ้ำเป็น idempotent — ไม่เกิดผลข้างเคียงซ้ำ', async () => {
    /* backend ตั้งใจให้ซ้ำแล้วไม่เป็นไร (order.status === status → คืนค่าเดิม)
       สิ่งที่ต้องกันคือ "ผลข้างเคียงซ้ำ" เช่น audit เปลี่ยนสถานะซ้ำหรือแจ้งเตือนซ้ำ */
    const auditBefore = await prisma.auditLog.count({ where: { entityId: orderId, action: 'STATUS_CHANGE' } });

    const res = await app.inject({
      method: 'POST', url: `/api/business/orders/${orderId}/transition`, headers: admin(),
      payload: { status: 'CONFIRMED' },
    });
    expect(res.statusCode).toBe(200);

    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('CONFIRMED');
    const auditAfter = await prisma.auditLog.count({ where: { entityId: orderId, action: 'STATUS_CHANGE' } });
    expect(auditAfter).toBe(auditBefore);     // ไม่บันทึกซ้ำ
  });

  it('D5 ข้ามสถานะที่ไม่อนุญาตต้องถูกปฏิเสธ', async () => {
    // CONFIRMED ไปได้แค่ SENT_TO_PREP หรือ CANCELLED — ข้ามไป DELIVERED ไม่ได้
    const res = await app.inject({
      method: 'POST', url: `/api/business/orders/${orderId}/transition`, headers: admin(),
      payload: { status: 'DELIVERED' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_TRANSITION');
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('CONFIRMED');
  });

  /* ============================================================
     §9 ขอบเขตบริษัท — บริษัท A ต้องมองไม่เห็น/แก้ไขของบริษัท B ไม่ได้
     ============================================================ */
  it('S1 สร้างออเดอร์ให้ลูกค้าของบริษัทอื่นไม่ได้', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/orders', headers: admin(),
      payload: {
        customerId: customerBId, deliveryDate: new Date('2026-09-01').toISOString(),
        items: [{ menuId: menuAId, menuNameSnapshot: 'x', quantity: 1, unit: `BAG_${TAG}`, unitPrice: 10 }],
      },
    });
    expect([403, 404]).toContain(res.statusCode);
    expect(await prisma.salesOrder.count({ where: { customerId: customerBId } })).toBe(0);
  });

  it('S2 รายชื่อลูกค้าต้องไม่มีข้อมูลของบริษัทอื่น', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business/customers', headers: admin() });
    expect(res.statusCode).toBe(200);
    const ids = res.json().data.map((c: { id: string }) => c.id);
    expect(ids).toContain(customerAId);
    expect(ids).not.toContain(customerBId);
  });

  it('S3 รับของเข้าคลังของบริษัทอื่นไม่ได้', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: admin(),
      payload: { warehouseId: warehouseBId, items: [{ itemId: menuAId, quantity: 1, unitPrice: 10 }] },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.goodsReceipt.count({ where: { warehouseId: warehouseBId } })).toBe(0);
  });

  it('S4 เปิดเอกสารของบริษัทอื่นไม่ได้', async () => {
    const anyUser = await prisma.user.findFirstOrThrow();
    const orderB = await prisma.salesOrder.create({
      data: {
        companyId: companyBId, orderNo: `SO-B-${TAG}`, customerId: customerBId,
        deliveryDate: new Date('2026-09-01'),
        subtotal: 100, discount: 0, tax: 0, totalAmount: 100,
        createdByUserId: anyUser.id,
      },
    });
    const res = await app.inject({
      method: 'GET', url: `/api/business/documents/ORDER_SLIP/${orderB.id}.pdf`, headers: admin(),
    });
    expect([403, 404]).toContain(res.statusCode);
  });

  /* ============================================================
     §10 สิทธิ์ — backend ต้องบังคับเอง ไม่พึ่งการซ่อนปุ่มที่ frontend
     ============================================================ */
  it('P1 ผู้ใช้ที่ไม่มีสิทธิ์ยืนยันรับของ ต้องถูกปฏิเสธ', async () => {
    const wh = await prisma.warehouse.findFirstOrThrow({ where: { companyId: companyAId } });
    const item = await prisma.item.findFirstOrThrow({ where: { companyId: companyAId, type: ItemType.RAW_MATERIAL } });
    const created = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: admin(),
      payload: { warehouseId: wh.id, items: [{ itemId: item.id, quantity: 1, unitPrice: 5 }] },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id;

    const res = await app.inject({ method: 'POST', url: `/api/business/receiving/${id}/confirm`, headers: limited() });
    expect(res.statusCode).toBe(403);
    const doc = await prisma.goodsReceipt.findUniqueOrThrow({ where: { id } });
    expect(doc.status).toBe('DRAFT');              // ต้องไม่ถูกยืนยัน
    expect(await prisma.stockLedger.count({ where: { refId: id } })).toBe(0);
  });

  it('P2 ผู้ใช้ที่ไม่มีสิทธิ์ปรับสต็อก ต้องถูกปฏิเสธ', async () => {
    const wh = await prisma.warehouse.findFirstOrThrow({ where: { companyId: companyAId } });
    const item = await prisma.item.findFirstOrThrow({ where: { companyId: companyAId, type: ItemType.RAW_MATERIAL } });
    const before = await prisma.stockAdjustment.count({ where: { companyId: companyAId } });

    const res = await app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: limited(),
      payload: { warehouseId: wh.id, reason: 'COUNT', items: [{ itemId: item.id, mode: 'SET', quantity: 1 }] },
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.stockAdjustment.count({ where: { companyId: companyAId } })).toBe(before);
  });

  it('P3 ผู้ใช้ทั่วไปจัดการสิทธิ์ของบทบาทไม่ได้', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/roles', headers: limited() });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('P4 คำขอที่ไม่มี token ต้องถูกปฏิเสธเสมอ', async () => {
    for (const url of ['/api/business/orders', '/api/business/company', '/api/business/receiving']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });

  it('P5 SUPER_ADMIN ยังผ่านได้ตามปกติ', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business/company', headers: admin() });
    expect(res.statusCode).toBe(200);
  });
});
