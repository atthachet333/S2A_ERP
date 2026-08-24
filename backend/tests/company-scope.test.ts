import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 15B §8 — ขอบเขตบริษัท (multi-tenant isolation)
 *
 * มุมมองของเทสต์ชุดนี้: ผู้ดูแลของ "บริษัท B" ถือ token ที่ถูกต้องทุกประการ
 * และรู้ id ของข้อมูลบริษัท A ครบถ้วน — backend ต้องปฏิเสธเองทุกเส้นทาง
 * ไม่ใช่พึ่งการที่ frontend ไม่แสดงลิงก์
 */

const TAG = `cs${Date.now().toString().slice(-7)}`;

describe.sequential('company scope isolation', () => {
  let app: FastifyInstance;
  let tokenA = '';
  let tokenB = '';
  let companyAId = '';
  let companyBId = '';
  /** ข้อมูลของบริษัท A ที่บริษัท B จะพยายามเข้าถึง */
  let orderAId = '';
  let itemAId = '';
  let warehouseAId = '';
  let receiptAId = '';
  let adjustmentAId = '';
  const A = () => ({ authorization: `Bearer ${tokenA}` });
  const B = () => ({ authorization: `Bearer ${tokenB}` });

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    /* ผู้ดูแลบริษัท B ใช้ MANAGER — มี USER_MANAGE จริง (บทบาท ADMIN ถูกตัด USER_MANAGE ออกตั้งแต่ seed)
       และไม่ใช่ SUPER_ADMIN จึงต้องถูกกั้นด้วยขอบเขตบริษัท */
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.MANAGER } });

    companyAId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;
    companyBId = (await prisma.company.create({
      data: { code: `SCOPE_B_${TAG}`, nameTh: 'บริษัท ขอบเขตบี จำกัด' },
    })).id;

    const mk = async (username: string, roleId: string, companyId: string) => {
      const passwordHash = await bcrypt.hash('ScopeIso123!', 10);
      const user = await prisma.user.upsert({
        where: { username },
        update: { passwordHash, isActive: true, mustChangePassword: false, deletedAt: null },
        create: { username, email: `${username}@s2a.local`, passwordHash, fullName: username, isActive: true, mustChangePassword: false },
      });
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId } }, update: {}, create: { userId: user.id, roleId } });
      await prisma.companyMembership.upsert({
        where: { userId_companyId: { userId: user.id, companyId } },
        update: { roleId }, create: { userId: user.id, companyId, roleId, isDefault: true },
      });
      return user;
    };
    await mk(`scopea_${TAG}`, superRole.id, companyAId);
    await mk(`scopeb_${TAG}`, managerRole.id, companyBId);

    app = await buildApp();
    await app.ready();
    const login = async (u: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: 'ScopeIso123!' } })).json().data.accessToken as string;
    tokenA = await login(`scopea_${TAG}`);
    tokenB = await login(`scopeb_${TAG}`);

    /* ---- ข้อมูลของบริษัท A ---- */
    const unit = await prisma.unit.upsert({ where: { code: `SU_${TAG}` }, update: {}, create: { code: `SU_${TAG}`, name: 'หน่วยขอบเขต' } });
    const customerA = await prisma.customer.create({ data: { companyId: companyAId, code: `SC_${TAG}`, name: 'ลูกค้าบริษัทเอ' } });
    const menuA = await prisma.item.create({ data: { companyId: companyAId, code: `SM_${TAG}`, name: 'เมนูบริษัทเอ', type: ItemType.FINISHED_GOOD, baseUnitId: unit.id } });
    itemAId = (await prisma.item.create({ data: { companyId: companyAId, code: `SI_${TAG}`, name: 'วัตถุดิบบริษัทเอ', type: ItemType.RAW_MATERIAL, baseUnitId: unit.id } })).id;
    warehouseAId = (await prisma.warehouse.create({ data: { companyId: companyAId, code: `SW_${TAG}`, name: 'คลังบริษัทเอ' } })).id;

    const order = await app.inject({
      method: 'POST', url: '/api/business/orders', headers: A(),
      payload: {
        customerId: customerA.id, deliveryDate: new Date('2026-11-01').toISOString(),
        items: [{ menuId: menuA.id, menuNameSnapshot: 'เมนูบริษัทเอ', quantity: 2, unit: unit.code, unitPrice: 30 }],
      },
    });
    expect(order.statusCode).toBe(201);
    orderAId = order.json().data.id;

    const receipt = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: A(),
      payload: { warehouseId: warehouseAId, confirm: true, items: [{ itemId: itemAId, quantity: 20, unitPrice: 3 }] },
    });
    expect(receipt.statusCode).toBe(201);
    receiptAId = receipt.json().data.id;

    const adjustment = await app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: A(),
      payload: { warehouseId: warehouseAId, reason: 'COUNT', items: [{ itemId: itemAId, mode: 'SET', quantity: 18 }] },
    });
    expect(adjustment.statusCode).toBeLessThan(300);
    adjustmentAId = adjustment.json().data.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  const denied = (statusCode: number) => expect([403, 404]).toContain(statusCode);

  it('C1 อ่านออเดอร์ของอีกบริษัทไม่ได้', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/business/orders/${orderAId}`, headers: B() });
    denied(res.statusCode);
  });

  it('C2 แก้ไขออเดอร์ของอีกบริษัทไม่ได้ และข้อมูลเดิมต้องไม่เปลี่ยน', async () => {
    const before = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderAId }, include: { items: true } });
    const res = await app.inject({
      method: 'PATCH', url: `/api/business/orders/${orderAId}`, headers: B(),
      payload: { items: [{ menuId: before.items[0].menuId, menuNameSnapshot: 'ถูกแก้', quantity: 99, unit: before.items[0].unit, unitPrice: 1 }] },
    });
    denied(res.statusCode);
    const after = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderAId }, include: { items: true } });
    expect(after.items).toHaveLength(before.items.length);
    expect(Number(after.totalAmount)).toBeCloseTo(Number(before.totalAmount), 4);
  });

  it('C3 เปลี่ยนสถานะออเดอร์ของอีกบริษัทไม่ได้', async () => {
    const before = await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderAId } });
    const res = await app.inject({
      method: 'POST', url: `/api/business/orders/${orderAId}/transition`, headers: B(), payload: { status: 'CONFIRMED' },
    });
    denied(res.statusCode);
    expect((await prisma.salesOrder.findUniqueOrThrow({ where: { id: orderAId } })).status).toBe(before.status);
  });

  it('C4 ดาวน์โหลด PDF เอกสารของอีกบริษัทไม่ได้', async () => {
    for (const [type, id] of [['ORDER_SLIP', orderAId], ['GOODS_RECEIPT_SLIP', receiptAId], ['STOCK_ADJUSTMENT_SLIP', adjustmentAId]] as const) {
      const res = await app.inject({ method: 'GET', url: `/api/business/documents/${type}/${id}.pdf`, headers: B() });
      denied(res.statusCode);
      expect(res.headers['content-type']).not.toContain('application/pdf');
    }
    // เจ้าของยังโหลดได้ตามปกติ — พิสูจน์ว่าไม่ได้พังทั้งเส้นทาง
    const own = await app.inject({ method: 'GET', url: `/api/business/documents/ORDER_SLIP/${orderAId}.pdf`, headers: A() });
    expect(own.statusCode).toBe(200);
    expect(own.headers['content-type']).toContain('application/pdf');
  });

  it('C5 ประวัติราคาวัตถุดิบของอีกบริษัทอ่านไม่ได้และบันทึกทับไม่ได้', async () => {
    const read = await app.inject({ method: 'GET', url: `/api/items/${itemAId}/prices`, headers: B() });
    denied(read.statusCode);

    const before = await prisma.itemPriceHistory.count({ where: { itemId: itemAId } });
    const write = await app.inject({
      method: 'POST', url: `/api/items/${itemAId}/prices`, headers: B(),
      payload: { purchasePrice: 999, purchaseQuantity: 1 },
    });
    denied(write.statusCode);
    expect(await prisma.itemPriceHistory.count({ where: { itemId: itemAId } })).toBe(before);
  });

  it('C6 รายการสต็อกและใบปรับปรุงต้องไม่รั่วข้ามบริษัท', async () => {
    const inventory = await app.inject({ method: 'GET', url: '/api/business/inventory', headers: B() });
    expect(inventory.statusCode).toBe(200);
    expect(JSON.stringify(inventory.json().data)).not.toContain(itemAId);

    const adjustments = await app.inject({ method: 'GET', url: '/api/business/inventory/adjustments', headers: B() });
    expect(adjustments.statusCode).toBe(200);
    expect(JSON.stringify(adjustments.json().data)).not.toContain(adjustmentAId);

    const receipts = await app.inject({ method: 'GET', url: '/api/business/receiving', headers: B() });
    expect(receipts.statusCode).toBe(200);
    expect(JSON.stringify(receipts.json().data)).not.toContain(receiptAId);
  });

  it('C7 กลับรายการปรับปรุงสต็อกของอีกบริษัทไม่ได้ และยอดคงเหลือไม่ขยับ', async () => {
    const before = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: itemAId, warehouseId: warehouseAId } });
    const ledgerBefore = await prisma.stockLedger.count({ where: { itemId: itemAId } });

    const res = await app.inject({
      method: 'POST', url: `/api/business/inventory/adjustments/${adjustmentAId}/reverse`, headers: B(), payload: { reason: 'ทดสอบข้ามบริษัท' },
    });
    denied(res.statusCode);

    const after = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: itemAId, warehouseId: warehouseAId } });
    expect(Number(after.onHand)).toBeCloseTo(Number(before.onHand), 4);
    expect(await prisma.stockLedger.count({ where: { itemId: itemAId } })).toBe(ledgerBefore);
  });

  it('C8 รับของเข้าคลังของอีกบริษัทไม่ได้', async () => {
    const before = await prisma.goodsReceipt.count({ where: { warehouseId: warehouseAId } });
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: B(),
      payload: { warehouseId: warehouseAId, items: [{ itemId: itemAId, quantity: 1, unitPrice: 1 }] },
    });
    denied(res.statusCode);
    expect(await prisma.goodsReceipt.count({ where: { warehouseId: warehouseAId } })).toBe(before);
  });

  it('C9 ผู้ดูแลที่ไม่ใช่ SUPER_ADMIN อนุมัติผู้สมัครเข้าบริษัทอื่นไม่ได้', async () => {
    const reg = await app.inject({
      method: 'POST', url: '/api/auth/register',
      payload: { fullName: 'ผู้สมัครข้ามบริษัท', username: `cross_${TAG}`, email: `cross_${TAG}@s2a.local`, password: 'Cross#Pass123', termsAccepted: true },
    });
    expect(reg.statusCode).toBe(201);
    const pendingId = reg.json().data.id as string;

    const res = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${pendingId}/approve`, headers: B(),
      payload: { companyId: companyAId, role: RoleName.CHEF },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('COMPANY_SCOPE_DENIED');
    expect(await prisma.companyMembership.count({ where: { userId: pendingId } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: pendingId } })).registrationStatus).toBe('PENDING');

    // อนุมัติเข้าบริษัทของตนเองได้ตามปกติ
    const own = await app.inject({
      method: 'POST', url: `/api/admin/registrations/${pendingId}/approve`, headers: B(),
      payload: { companyId: companyBId, role: RoleName.CHEF },
    });
    expect(own.statusCode).toBe(200);
    expect(await prisma.companyMembership.count({ where: { userId: pendingId, companyId: companyBId } })).toBe(1);
  });

  it('C11 ใบโอนย้ายของอีกบริษัทเข้าถึง แก้ไข ยืนยัน หรือกลับรายการไม่ได้', async () => {
    // ใบโอนย้ายของบริษัท A (ต้องมีคลังที่สองในบริษัท A)
    const whA2 = (await prisma.warehouse.create({ data: { companyId: companyAId, code: `SW2_${TAG}`, name: 'คลังที่สองบริษัทเอ' } })).id;
    const created = await app.inject({
      method: 'POST', url: '/api/business/transfers', headers: A(),
      payload: { fromWarehouseId: warehouseAId, toWarehouseId: whA2, items: [{ itemId: itemAId, quantity: 2 }] },
    });
    expect(created.statusCode).toBe(201);
    const transferId = created.json().data.id as string;

    for (const [method, url] of [
      ['GET', `/api/business/transfers/${transferId}`],
      ['PATCH', `/api/business/transfers/${transferId}`],
      ['POST', `/api/business/transfers/${transferId}/confirm`],
      ['POST', `/api/business/transfers/${transferId}/reverse`],
    ] as const) {
      const res = await app.inject({ method, url, headers: B(), payload: { note: 'ไม่ควรแก้ได้' } });
      denied(res.statusCode);
    }
    expect((await prisma.stockTransfer.findUniqueOrThrow({ where: { id: transferId } })).status).toBe('DRAFT');

    // รายการของบริษัท B ต้องไม่มีใบของบริษัท A ปน
    const list = await app.inject({ method: 'GET', url: '/api/business/transfers', headers: B() });
    expect(list.statusCode).toBe(200);
    expect(JSON.stringify(list.json().data.rows)).not.toContain(transferId);

    // โอนเข้า/ออกคลังของอีกบริษัทไม่ได้ แม้จะรู้ id
    const cross = await app.inject({
      method: 'POST', url: '/api/business/transfers', headers: B(),
      payload: { fromWarehouseId: warehouseAId, toWarehouseId: whA2, items: [{ itemId: itemAId, quantity: 1 }] },
    });
    denied(cross.statusCode);

    // เอกสาร PDF ของใบโอนย้ายก็ต้องไม่รั่วข้ามบริษัท
    const pdf = await app.inject({ method: 'GET', url: `/api/business/documents/STOCK_TRANSFER_SLIP/${transferId}.pdf`, headers: B() });
    denied(pdf.statusCode);
    expect(pdf.headers['content-type']).not.toContain('application/pdf');
  });

  it('C10 สูตรอาหารของอีกบริษัทเข้าถึงไม่ได้ผ่าน id ตรง ๆ', async () => {
    const recipe = await prisma.recipe.findFirst({ where: { companyId: companyAId }, select: { id: true } });
    if (!recipe) return;   // ไม่มีสูตรของบริษัท A ในรอบนี้ — ไม่บังคับ
    const res = await app.inject({ method: 'GET', url: `/api/recipes/${recipe.id}`, headers: B() });
    denied(res.statusCode);
  });
});
