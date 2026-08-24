import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 15B — วงจรออเดอร์เต็มรูปแบบ · การสมัคร/อนุมัติ · เลขเอกสาร · การย้อนธุรกรรม
 */

const TAG = `lc${Date.now().toString().slice(-7)}`;
const num = (d: unknown) => Number(d);

describe.sequential('order lifecycle + registration + counters', () => {
  let app: FastifyInstance;
  let adminToken = '';
  let viewerToken = '';
  let companyId = '';
  let customerId = '';
  let menuId = '';
  let warehouseId = '';
  let itemAId = '';
  let itemBId = '';
  let unitCode = '';
  const admin = () => ({ authorization: `Bearer ${adminToken}` });
  const viewer = () => ({ authorization: `Bearer ${viewerToken}` });

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } });
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } });
    companyId = company.id;

    const mk = async (username: string, roleId: string) => {
      const passwordHash = await bcrypt.hash('LifePass123!', 10);
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
    await mk(`lcadmin_${TAG}`, superRole.id);
    await mk(`lcviewer_${TAG}`, viewerRole.id);

    app = await buildApp();
    await app.ready();
    const login = async (u: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: 'LifePass123!' } })).json().data.accessToken as string;
    adminToken = await login(`lcadmin_${TAG}`);
    viewerToken = await login(`lcviewer_${TAG}`);

    const unit = await prisma.unit.upsert({ where: { code: `U_${TAG}` }, update: {}, create: { code: `U_${TAG}`, name: 'หน่วย(ทดสอบ)' } });
    unitCode = unit.code;
    const cust = await prisma.customer.create({ data: { companyId, code: `C_${TAG}`, name: 'ลูกค้าวงจร' } });
    customerId = cust.id;
    const menu = await prisma.item.create({
      data: { companyId, code: `M_${TAG}`, name: 'เมนูวงจร', type: ItemType.FINISHED_GOOD, baseUnitId: unit.id },
    });
    menuId = menu.id;
    const wh = await prisma.warehouse.create({ data: { companyId, code: `W_${TAG}`, name: 'คลังวงจร' } });
    warehouseId = wh.id;
    itemAId = (await prisma.item.create({ data: { companyId, code: `IA_${TAG}`, name: 'วัตถุดิบ A', type: ItemType.RAW_MATERIAL, baseUnitId: unit.id } })).id;
    itemBId = (await prisma.item.create({ data: { companyId, code: `IB_${TAG}`, name: 'วัตถุดิบ B', type: ItemType.RAW_MATERIAL, baseUnitId: unit.id } })).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /* ============================================================
     §4 วงจรออเดอร์เต็มรูปแบบ
     ============================================================ */
  let orderId = '';
  let orderNo = '';

  const move = (status: string) =>
    app.inject({ method: 'POST', url: `/api/business/orders/${orderId}/transition`, headers: admin(), payload: { status } });

  it('L1 สร้างออเดอร์ร่าง', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/orders', headers: admin(),
      payload: {
        customerId, deliveryDate: new Date('2026-10-01').toISOString(), priceTier: 'WHOLESALE',
        items: [{ menuId, menuNameSnapshot: 'เมนูวงจร', quantity: 4, unit: unitCode, unitPrice: 25 }],
      },
    });
    expect(res.statusCode).toBe(201);
    orderId = res.json().data.id; orderNo = res.json().data.orderNo;
    expect(res.json().data.status).toBe('DRAFT');
  });

  it('L2 เดินครบทุกสถานะตามที่ backend อนุญาตจริง', async () => {
    const path = ['CONFIRMED', 'SENT_TO_PREP', 'PICKING', 'ISSUED', 'READY', 'DELIVERED'];
    for (const status of path) {
      const res = await move(status);
      expect(res.statusCode, `เปลี่ยนเป็น ${status}`).toBe(200);
      const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(status);
    }
  });

  it('L3 ราคาที่บันทึกไว้ไม่เปลี่ยนตลอดวงจร และเลขที่ออเดอร์คงเดิม', async () => {
    const line = await prisma.salesOrderItem.findFirstOrThrow({ where: { orderId } });
    expect(num(line.unitPrice)).toBeCloseTo(25, 2);
    expect(num(line.lineTotal)).toBeCloseTo(100, 2);
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.orderNo).toBe(orderNo);
    expect(order.priceTier).toBe('WHOLESALE');
  });

  it('L4 ส่งสถานะเดิมซ้ำ = idempotent ไม่เกิด audit ซ้ำ', async () => {
    const before = await prisma.auditLog.count({ where: { entityId: orderId, action: 'STATUS_CHANGE' } });
    const res = await move('DELIVERED');
    expect(res.statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { entityId: orderId, action: 'STATUS_CHANGE' } })).toBe(before);
  });

  it('L5 สถานะปลายทางไปต่อไม่ได้แล้ว', async () => {
    const res = await move('CANCELLED');
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INVALID_TRANSITION');
  });

  it('L6 ยกเลิกออเดอร์ต้องระบุเหตุผล', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/business/orders', headers: admin(),
      payload: {
        customerId, deliveryDate: new Date('2026-10-02').toISOString(),
        items: [{ menuId, menuNameSnapshot: 'เมนูวงจร', quantity: 1, unit: unitCode, unitPrice: 10 }],
      },
    });
    const id = created.json().data.id;

    const noReason = await app.inject({
      method: 'POST', url: `/api/business/orders/${id}/transition`, headers: admin(), payload: { status: 'CANCELLED' },
    });
    expect(noReason.statusCode).toBe(400);
    expect(noReason.json().error.code).toBe('CANCELLATION_REASON_REQUIRED');

    const withReason = await app.inject({
      method: 'POST', url: `/api/business/orders/${id}/transition`, headers: admin(),
      payload: { status: 'CANCELLED', cancellationReason: 'ลูกค้าขอยกเลิก' },
    });
    expect(withReason.statusCode).toBe(200);
    const order = await prisma.salesOrder.findUniqueOrThrow({ where: { id } });
    expect(order.status).toBe('CANCELLED');
    expect(order.cancellationReason).toBe('ลูกค้าขอยกเลิก');
  });

  /* ============================================================
     §7 การแจ้งเตือน — ทดสอบเฉพาะพฤติกรรมที่มีอยู่จริง (SENT_TO_PREP)
     ============================================================ */
  it('N1 ส่งออเดอร์ให้ครัวแล้วสมาชิกฝ่ายปฏิบัติการได้รับแจ้งเตือน', async () => {
    const opsRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.OPERATIONS } });
    const opsUser = await prisma.user.create({
      data: { username: `ops_${TAG}`, email: `ops_${TAG}@s2a.local`, passwordHash: 'x', fullName: 'Ops', isActive: true, mustChangePassword: false },
    });
    await prisma.companyMembership.create({ data: { userId: opsUser.id, companyId, roleId: opsRole.id, isActive: true } });

    const created = await app.inject({
      method: 'POST', url: '/api/business/orders', headers: admin(),
      payload: {
        customerId, deliveryDate: new Date('2026-10-03').toISOString(),
        items: [{ menuId, menuNameSnapshot: 'เมนูวงจร', quantity: 2, unit: unitCode, unitPrice: 15 }],
      },
    });
    const id = created.json().data.id;
    await app.inject({ method: 'POST', url: `/api/business/orders/${id}/transition`, headers: admin(), payload: { status: 'CONFIRMED' } });

    const before = await prisma.notification.count({ where: { userId: opsUser.id } });
    const res = await app.inject({ method: 'POST', url: `/api/business/orders/${id}/transition`, headers: admin(), payload: { status: 'SENT_TO_PREP' } });
    expect(res.statusCode).toBe(200);

    const after = await prisma.notification.findMany({ where: { userId: opsUser.id } });
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ type: 'ORDER_SENT_TO_PREP', entityType: 'SalesOrder', entityId: id });
  });

  /* ============================================================
     §5 การสมัครและอนุมัติ
     ============================================================ */
  let pendingUserId = '';

  it('G1 สมัครใช้งานแล้วสถานะเป็น PENDING และยังใช้งานไม่ได้', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { fullName: 'ผู้สมัครทดสอบ', username: `newbie_${TAG}`, email: `newbie_${TAG}@s2a.local`, password: 'Newbie#Pass123', termsAccepted: true },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe('PENDING_WORKSPACE');

    const user = await prisma.user.findUniqueOrThrow({ where: { username: `newbie_${TAG}` } });
    pendingUserId = user.id;
    expect(user.registrationStatus).toBe('PENDING');
    // ยังไม่ถูกผูกกับบริษัทหรือบทบาทใด ๆ จนกว่าจะมีคนอนุมัติ
    expect(await prisma.companyMembership.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { entityId: user.id, action: 'USER_SELF_REGISTERED' } })).toBe(1);
  });

  it('G1b ผู้สมัครที่ยังรออนุมัติเข้าสู่ระบบได้แต่ไม่มีสิทธิ์และไม่มีบริษัทที่ใช้งาน', async () => {
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: `newbie_${TAG}`, password: 'Newbie#Pass123' },
    });
    expect(login.statusCode).toBe(200);
    const me = login.json().data.user;
    expect(me.permissions ?? []).toHaveLength(0);
    expect(me.roles ?? []).toHaveLength(0);
    expect(me.activeCompany ?? null).toBeNull();

    // ไม่มีสิทธิ์จริง — เรียก endpoint ธุรกิจต้องถูกปฏิเสธ
    const denied = await app.inject({
      method: 'GET', url: '/api/business/orders',
      headers: { authorization: `Bearer ${login.json().data.accessToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('G2 ผู้ไม่มีสิทธิ์อนุมัติไม่ได้', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${pendingUserId}/approve`, headers: viewer(),
      payload: { companyId, role: RoleName.CHEF },
    });
    expect(res.statusCode).toBe(403);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: pendingUserId } });
    expect(user.registrationStatus).toBe('PENDING');   // ต้องไม่ถูกเปลี่ยน
  });

  it('G3 อนุมัติให้บทบาทผู้ดูแลระบบไม่ได้', async () => {
    for (const role of [RoleName.SUPER_ADMIN, RoleName.ADMIN]) {
      const res = await app.inject({
        method: 'POST', url: `/api/admin/registrations/${pendingUserId}/approve`, headers: admin(),
        payload: { companyId, role },
      });
      expect(res.statusCode, role).toBe(403);
      expect(res.json().error.code).toBe('ROLE_NOT_ALLOWED');
    }
    const user = await prisma.user.findUniqueOrThrow({ where: { id: pendingUserId } });
    expect(user.registrationStatus).toBe('PENDING');
  });

  it('G4 อนุมัติด้วยบทบาทปกติ → เปิดใช้งานและได้สิทธิ์ตามที่กำหนด', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${pendingUserId}/approve`, headers: admin(),
      payload: { companyId, role: RoleName.CHEF },
    });
    expect(res.statusCode).toBe(200);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: pendingUserId } });
    expect(user.registrationStatus).toBe('APPROVED');
    expect(user.isActive).toBe(true);
    expect(user.approvedAt).not.toBeNull();

    const chefRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.CHEF } });
    expect(await prisma.userRole.count({ where: { userId: pendingUserId, roleId: chefRole.id } })).toBe(1);
    expect(await prisma.companyMembership.count({ where: { userId: pendingUserId, companyId } })).toBe(1);
  });

  it('G5 อนุมัติซ้ำต้องถูกปฏิเสธ', async () => {
    const res = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${pendingUserId}/approve`, headers: admin(),
      payload: { companyId, role: RoleName.CHEF },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('NOT_PENDING');
  });

  it('G6 ปฏิเสธคำขอพร้อมเหตุผล → ปิดใช้งานแต่ไม่ลบผู้ใช้', async () => {
    await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { fullName: 'ผู้สมัครถูกปฏิเสธ', username: `deny_${TAG}`, email: `deny_${TAG}@s2a.local`, password: 'Deny#Pass123', termsAccepted: true },
    });
    const target = await prisma.user.findUniqueOrThrow({ where: { username: `deny_${TAG}` } });

    const res = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${target.id}/reject`, headers: admin(),
      payload: { reason: 'ข้อมูลไม่ครบ' },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
    expect(after.registrationStatus).toBe('REJECTED');
    expect(after.isActive).toBe(false);
    expect(after.rejectionReason).toBe('ข้อมูลไม่ครบ');
    expect(after.deletedAt).toBeNull();               // ไม่ลบทิ้ง
  });

  /* ============================================================
     §10 เลขเอกสาร
     ============================================================ */
  it('T1 ใบรับของหลายใบต้องได้เลขไม่ซ้ำ และแก้ร่างแล้วเลขไม่เปลี่ยน', async () => {
    const mk = async () => {
      const res = await app.inject({
        method: 'POST', url: '/api/business/receiving', headers: admin(),
        payload: { warehouseId, items: [{ itemId: itemAId, quantity: 1, unitPrice: 5 }] },
      });
      expect(res.statusCode).toBe(201);
      return res.json().data as { id: string; receiptNo: string };
    };

    const docs = [];
    for (let i = 0; i < 5; i += 1) docs.push(await mk());
    const numbers = docs.map((d) => d.receiptNo);
    expect(new Set(numbers).size).toBe(numbers.length);   // ไม่ซ้ำเลย

    const edited = await app.inject({
      method: 'PATCH', url: `/api/business/receiving/${docs[0].id}`, headers: admin(),
      payload: { warehouseId, items: [{ itemId: itemAId, quantity: 9, unitPrice: 5 }] },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.receiptNo).toBe(docs[0].receiptNo);
  });

  it('T2 ธุรกรรมที่ล้มต้องไม่ทำให้เลขเอกสารซ้ำในภายหลัง', async () => {
    const bad = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: admin(),
      payload: { warehouseId, items: [{ itemId: 'ไม่มีสินค้านี้', quantity: 1, unitPrice: 5 }] },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);

    const good = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: admin(),
      payload: { warehouseId, items: [{ itemId: itemAId, quantity: 1, unitPrice: 5 }] },
    });
    expect(good.statusCode).toBe(201);
    const all = await prisma.goodsReceipt.findMany({ where: { companyId }, select: { receiptNo: true } });
    const nos = all.map((r) => r.receiptNo);
    expect(new Set(nos).size).toBe(nos.length);
  });

  /* ============================================================
     §9 การย้อนธุรกรรม
     ============================================================ */
  it('X1 ใบเบิกหลายบรรทัด ถ้ามีบรรทัดเดียวผิด ต้องไม่ตัดสต็อกบรรทัดไหนเลย', async () => {
    /* เติมสต็อกให้ A อย่างเดียว ส่วน B ไม่มีของ */
    const receipt = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: admin(),
      payload: { warehouseId, confirm: true, items: [{ itemId: itemAId, quantity: 100, unitPrice: 1 }] },
    });
    expect(receipt.statusCode).toBe(201);

    const beforeA = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: itemAId, warehouseId } })).onHand);
    const ledgerBefore = await prisma.stockLedger.count();

    const res = await app.inject({
      method: 'POST', url: '/api/business/stock-issues', headers: admin(),
      payload: {
        warehouseId, idempotencyKey: `mix-${TAG}`, confirm: true,
        items: [
          { itemId: itemAId, issuedQty: 10, unit: unitCode, baseQty: 10 },   // บรรทัดนี้ทำได้
          { itemId: itemBId, issuedQty: 10, unit: unitCode, baseQty: 10 },   // บรรทัดนี้ของไม่พอ
        ],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const afterA = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: itemAId, warehouseId } })).onHand);
    expect(afterA).toBeCloseTo(beforeA, 4);                       // A ต้องไม่ถูกตัด
    expect(await prisma.stockLedger.count()).toBe(ledgerBefore);  // ไม่มี ledger ค้าง
    expect(await prisma.stockBalance.findFirst({ where: { itemId: itemBId, warehouseId } })).toBeNull();
  });

  it('X2 ปรับปรุงสต็อกที่มีบรรทัดผิด ต้องไม่เปลี่ยนยอดใด ๆ', async () => {
    const beforeA = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: itemAId, warehouseId } })).onHand);
    const adjBefore = await prisma.stockAdjustment.count({ where: { companyId } });

    const res = await app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: admin(),
      payload: {
        warehouseId, reason: 'COUNT',
        items: [
          { itemId: itemAId, mode: 'SET', quantity: 55 },
          { itemId: 'ไม่มีสินค้านี้', mode: 'SET', quantity: 1 },
        ],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const afterA = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: itemAId, warehouseId } })).onHand);
    expect(afterA).toBeCloseTo(beforeA, 4);
    expect(await prisma.stockAdjustment.count({ where: { companyId } })).toBe(adjBefore);
  });

  it('X3 แก้ไขร่างออเดอร์ด้วยบรรทัดที่ผิด ต้องไม่ทำให้ออเดอร์เดิมเสียหาย', async () => {
    const created = await app.inject({
      method: 'POST', url: '/api/business/orders', headers: admin(),
      payload: {
        customerId, deliveryDate: new Date('2026-10-05').toISOString(),
        items: [{ menuId, menuNameSnapshot: 'เมนูวงจร', quantity: 3, unit: unitCode, unitPrice: 20 }],
      },
    });
    const id = created.json().data.id;
    const before = await prisma.salesOrderItem.findMany({ where: { orderId: id } });

    const bad = await app.inject({
      method: 'PATCH', url: `/api/business/orders/${id}`, headers: admin(),
      payload: {
        customerId, deliveryDate: new Date('2026-10-05').toISOString(),
        items: [{ menuId, menuNameSnapshot: 'x', quantity: -5, unit: unitCode, unitPrice: 20 }],
      },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);

    const after = await prisma.salesOrderItem.findMany({ where: { orderId: id } });
    expect(after).toHaveLength(before.length);
    expect(num(after[0].quantity)).toBeCloseTo(3, 4);
    expect(num(after[0].unitPrice)).toBeCloseTo(20, 4);
  });
});
