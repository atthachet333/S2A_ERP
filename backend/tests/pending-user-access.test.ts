import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 16 §D/§E — ผู้สมัครที่ยังรออนุมัติ (registrationStatus = PENDING)
 *
 * พฤติกรรมที่ระบบตั้งใจไว้ (อ่านได้จากโค้ดและข้อความบน UI):
 *  - route สมัครตั้ง isActive = true โดยตั้งใจ และตอบ status 'PENDING_WORKSPACE'
 *  - หน้าจอหลังสมัครบอกว่า "บัญชีของคุณยังไม่มีสิทธิ์ในบริษัทใด" พร้อมลิงก์ไปหน้าเข้าสู่ระบบ
 *  - การ "ปฏิเสธ" ต่างหากที่ตั้ง isActive = false เพื่อปิดการเข้าสู่ระบบ
 * ดังนั้น PENDING ที่เข้าสู่ระบบได้คือสิ่งที่ตั้งใจ ไม่ใช่ช่องโหว่
 *
 * ไฟล์นี้จึงไม่เปลี่ยนนโยบาย แต่ตรึงไว้ว่าเข้าสู่ระบบแล้ว "ทำอะไรไม่ได้เลย"
 * และการบังคับต้องเกิดที่ backend ไม่ใช่แค่ frontend ซ่อนปุ่ม
 */

const TAG = `pd${Date.now().toString().slice(-7)}`;

describe.sequential('pending user access', () => {
  let app: FastifyInstance;
  let pendingToken = '';
  let pendingRefreshToken = '';
  let pendingUserId = '';
  let ownerToken = '';
  let companyId = '';
  /** ข้อมูลของบริษัทที่มีอยู่จริง ใช้ทดสอบว่าผู้รออนุมัติเปิดด้วย id ตรง ๆ ไม่ได้ */
  let orderId = '';
  let receiptId = '';
  let itemId = '';
  const pending = () => ({ authorization: `Bearer ${pendingToken}` });

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;

    const passwordHash = await bcrypt.hash('OwnerPass123!', 10);
    const owner = await prisma.user.upsert({
      where: { username: `owner_${TAG}` },
      update: { passwordHash, isActive: true, mustChangePassword: false, deletedAt: null },
      create: { username: `owner_${TAG}`, email: `owner_${TAG}@s2a.local`, passwordHash, fullName: 'เจ้าของข้อมูล', isActive: true, mustChangePassword: false },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: owner.id, roleId: superRole.id } }, update: {}, create: { userId: owner.id, roleId: superRole.id } });
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: owner.id, companyId } },
      update: { roleId: superRole.id }, create: { userId: owner.id, companyId, roleId: superRole.id, isDefault: true },
    });

    app = await buildApp();
    await app.ready();
    ownerToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `owner_${TAG}`, password: 'OwnerPass123!' } })).json().data.accessToken;
    const owns = () => ({ authorization: `Bearer ${ownerToken}` });

    const unit = await prisma.unit.upsert({ where: { code: `PU_${TAG}` }, update: {}, create: { code: `PU_${TAG}`, name: 'หน่วยรออนุมัติ' } });
    const warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `PW_${TAG}`, name: 'คลังรออนุมัติ' } })).id;
    itemId = (await prisma.item.create({ data: { companyId, code: `PI_${TAG}`, name: 'วัตถุดิบรออนุมัติ', type: ItemType.RAW_MATERIAL, baseUnitId: unit.id } })).id;
    const menuId = (await prisma.item.create({ data: { companyId, code: `PM_${TAG}`, name: 'เมนูรออนุมัติ', type: ItemType.FINISHED_GOOD, baseUnitId: unit.id } })).id;
    const customerId = (await prisma.customer.create({ data: { companyId, code: `PC_${TAG}`, name: 'ลูกค้ารออนุมัติ' } })).id;

    orderId = (await app.inject({
      method: 'POST', url: '/api/business/orders', headers: owns(),
      payload: { customerId, deliveryDate: new Date('2026-12-15').toISOString(), items: [{ menuId, menuNameSnapshot: 'เมนูรออนุมัติ', quantity: 1, unit: unit.code, unitPrice: 10 }] },
    })).json().data.id;
    receiptId = (await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: owns(),
      payload: { warehouseId, items: [{ itemId, quantity: 1, unitPrice: 1 }] },
    })).json().data.id;

    // ผู้สมัครใหม่ ผ่าน endpoint จริงเท่านั้น ไม่ปั้นสถานะเอง
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { fullName: 'ผู้รออนุมัติ', username: `waiting_${TAG}`, email: `waiting_${TAG}@s2a.local`, password: 'Waiting#Pass123', termsAccepted: true },
    });
    expect(reg.statusCode).toBe(201);
    pendingUserId = reg.json().data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('P1 เข้าสู่ระบบได้ตามที่ระบบตั้งใจ แต่ได้ศูนย์สิทธิ์และไม่มีบริษัท', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: `waiting_${TAG}`, password: 'Waiting#Pass123' },
    });
    expect(res.statusCode).toBe(200);
    pendingToken = res.json().data.accessToken;
    pendingRefreshToken = res.json().data.refreshToken;

    const me = res.json().data.user;
    expect(me.permissions ?? []).toHaveLength(0);
    expect(me.roles ?? []).toHaveLength(0);
    expect(me.companies ?? []).toHaveLength(0);
    expect(me.activeCompany ?? null).toBeNull();
  });

  it('P2 ต่ออายุเซสชันแล้วยังไม่ได้สิทธิ์เพิ่ม', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: pendingRefreshToken } });
    expect(res.statusCode).toBe(200);
    const user = res.json().data.user;
    expect(user.permissions ?? []).toHaveLength(0);
    expect(user.activeCompany ?? null).toBeNull();
    // token ใหม่ก็ยังเปิดข้อมูลธุรกิจไม่ได้
    const denied = await app.inject({
      method: 'GET', url: '/api/business/inventory',
      headers: { authorization: `Bearer ${res.json().data.accessToken}` },
    });
    expect(denied.statusCode).toBe(403);
  });

  it('P3 อ่านข้อมูลบริษัทไม่ได้เลย', async () => {
    for (const url of [
      '/api/business/orders',
      '/api/business/inventory',
      '/api/business/receiving',
      '/api/business/inventory/adjustments',
      '/api/business/notifications',
    ]) {
      const res = await app.inject({ method: 'GET', url, headers: pending() });
      expect(res.statusCode, url).toBe(403);
    }
  });

  it('P4 สร้างหรือแก้ข้อมูลธุรกิจไม่ได้', async () => {
    const ordersBefore = await prisma.salesOrder.count({ where: { companyId } });
    const attempts: [string, string, Record<string, unknown>][] = [
      ['POST', '/api/business/orders', { customerId: 'x', deliveryDate: new Date().toISOString(), items: [] }],
      ['POST', '/api/business/receiving', { warehouseId: 'x', items: [] }],
      ['POST', '/api/business/inventory/adjustments', { warehouseId: 'x', reason: 'COUNT', items: [] }],
      ['POST', '/api/items', { code: `HACK_${TAG}`, name: 'ไม่ควรถูกสร้าง', type: 'RAW_MATERIAL' }],
      ['POST', '/api/companies', { code: `HACK${TAG}`.slice(0, 20), nameTh: 'บริษัทที่ไม่ควรถูกสร้าง' }],
    ];
    for (const [method, url, payload] of attempts) {
      const res = await app.inject({ method: method as 'POST', url, headers: pending(), payload });
      expect(res.statusCode, url).toBe(403);
    }
    expect(await prisma.salesOrder.count({ where: { companyId } })).toBe(ordersBefore);
    expect(await prisma.item.count({ where: { code: `HACK_${TAG}` } })).toBe(0);
    expect(await prisma.company.count({ where: { code: { startsWith: `HACK${TAG}`.slice(0, 10) } } })).toBe(0);
  });

  it('P5 เปิดเอกสารของบริษัทด้วย id ที่รู้อยู่แล้วไม่ได้', async () => {
    for (const [type, id] of [['ORDER_SLIP', orderId], ['GOODS_RECEIPT_SLIP', receiptId]] as const) {
      const res = await app.inject({ method: 'GET', url: `/api/business/documents/${type}/${id}.pdf`, headers: pending() });
      expect(res.statusCode, type).toBe(403);
      expect(res.headers['content-type']).not.toContain('application/pdf');
    }
    const detail = await app.inject({ method: 'GET', url: `/api/business/orders/${orderId}`, headers: pending() });
    expect(detail.statusCode).toBe(403);
    const price = await app.inject({ method: 'GET', url: `/api/items/${itemId}/prices`, headers: pending() });
    expect([401, 403]).toContain(price.statusCode);
  });

  it('P6 เข้าถึงส่วนผู้ดูแลระบบและการจัดการสิทธิ์ไม่ได้', async () => {
    const reads = ['/api/users', '/api/admin/registrations', '/api/admin/permissions/matrix', '/api/admin/companies', '/api/admin/assignable-roles'];
    for (const url of reads) {
      const res = await app.inject({ method: 'GET', url, headers: pending() });
      expect(res.statusCode, url).toBe(403);
    }

    // ที่สำคัญที่สุด: อนุมัติตัวเองไม่ได้
    const selfApprove = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${pendingUserId}/approve`, headers: pending(),
      payload: { companyId, role: RoleName.SUPER_ADMIN },
    });
    expect(selfApprove.statusCode).toBe(403);
    const stillPending = await prisma.user.findUniqueOrThrow({ where: { id: pendingUserId } });
    expect(stillPending.registrationStatus).toBe('PENDING');
    expect(await prisma.companyMembership.count({ where: { userId: pendingUserId } })).toBe(0);
    expect(await prisma.userRole.count({ where: { userId: pendingUserId } })).toBe(0);
  });

  it('P7 สลับเข้าบริษัทที่รู้ id ไม่ได้', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/auth/select-company', headers: pending(), payload: { companyId } });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('COMPANY_ACCESS_DENIED');

    // แม้แนบ companyId มากับคำขอต่ออายุเซสชันก็ยังเข้าไม่ได้
    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: pendingRefreshToken, companyId } });
    if (refreshed.statusCode === 200) expect(refreshed.json().data.user.activeCompany ?? null).toBeNull();
  });

  it('P8 ถูกปฏิเสธคำขอแล้วต้องเข้าสู่ระบบไม่ได้อีก', async () => {
    const ownerHeaders = { authorization: `Bearer ${ownerToken}` };
    const rejected = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${pendingUserId}/reject`, headers: ownerHeaders,
      payload: { reason: 'ทดสอบนโยบายการเข้าสู่ระบบ' },
    });
    expect(rejected.statusCode).toBe(200);

    /* กลไก "ปิดการเข้าสู่ระบบ" มีอยู่จริงและถูกใช้กับสถานะ REJECTED เท่านั้น
       นี่คือหลักฐานว่าการปล่อยให้ PENDING เข้าสู่ระบบได้เป็นความตั้งใจ ไม่ใช่การหลงลืม */
    const login = await app.inject({
      method: 'POST', url: '/api/auth/login',
      payload: { username: `waiting_${TAG}`, password: 'Waiting#Pass123' },
    });
    expect(login.statusCode).toBe(401);
    expect(login.json().error.code).toBe('INVALID_CREDENTIALS');
  });
});
