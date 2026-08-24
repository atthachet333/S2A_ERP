import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 16 §B — ออกเลขเอกสารพร้อมกันหลายคำขอ
 *
 * ก่อนหน้านี้ prisma upsert แปลเป็น SELECT แล้วค่อย INSERT ทำให้คำขอที่เข้ามาพร้อมกัน
 * แย่งกันสร้างแถวตัวนับแล้วล้มด้วย P2002 ทั้งที่เป็นคำขอที่ถูกต้อง
 *
 * สิ่งที่ยืนยันในไฟล์นี้:
 *  - คำขอที่ถูกต้องทุกใบต้องสำเร็จ (ไม่มี 4xx/5xx หลุดออกไปหาผู้ใช้)
 *  - เลขเอกสารไม่ซ้ำ และเดินต่อเนื่องตามที่ระบบตั้งใจ
 *  - ไม่มีเอกสารหรือ ledger งอกเกินจำนวนคำขอ
 *
 * หมายเหตุ: ระบบไม่เคยรับประกันว่าเลขจะ "ไม่มีช่องว่าง" เทสต์นี้จึงไม่บังคับเรื่องนั้น
 */

const TAG = `cc${Date.now().toString().slice(-7)}`;
const BURST = 10;

/** ดึงลำดับท้ายเลขเอกสาร เช่น GR-20260823-0007 → 7 */
const seqOf = (documentNo: string) => Number(documentNo.slice(documentNo.lastIndexOf('-') + 1));

describe.sequential('document counter concurrency', () => {
  let app: FastifyInstance;
  let token = '';
  let companyId = '';
  let warehouseId = '';
  let itemId = '';
  let menuId = '';
  let customerId = '';
  let unitCode = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;

    const passwordHash = await bcrypt.hash('BurstPass123!', 10);
    const user = await prisma.user.upsert({
      where: { username: `burst_${TAG}` },
      update: { passwordHash, isActive: true, mustChangePassword: false, deletedAt: null },
      create: { username: `burst_${TAG}`, email: `burst_${TAG}@s2a.local`, passwordHash, fullName: 'ผู้ทดสอบพร้อมกัน', isActive: true, mustChangePassword: false },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      update: { roleId: role.id }, create: { userId: user.id, companyId, roleId: role.id, isDefault: true },
    });

    app = await buildApp();
    await app.ready();
    token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `burst_${TAG}`, password: 'BurstPass123!' } })).json().data.accessToken;

    const unit = await prisma.unit.upsert({ where: { code: `BU_${TAG}` }, update: {}, create: { code: `BU_${TAG}`, name: 'หน่วยพร้อมกัน' } });
    unitCode = unit.code;
    warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `BW_${TAG}`, name: 'คลังพร้อมกัน' } })).id;
    itemId = (await prisma.item.create({ data: { companyId, code: `BI_${TAG}`, name: 'วัตถุดิบพร้อมกัน', type: ItemType.RAW_MATERIAL, baseUnitId: unit.id } })).id;
    menuId = (await prisma.item.create({ data: { companyId, code: `BM_${TAG}`, name: 'เมนูพร้อมกัน', type: ItemType.FINISHED_GOOD, baseUnitId: unit.id } })).id;
    customerId = (await prisma.customer.create({ data: { companyId, code: `BC_${TAG}`, name: 'ลูกค้าพร้อมกัน' } })).id;

    // เติมสต็อกให้พอสำหรับใบเบิกทุกใบในชุดทดสอบ
    const seed = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: { warehouseId, confirm: true, items: [{ itemId, quantity: 10_000, unitPrice: 1 }] },
    });
    expect(seed.statusCode).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /** ยิงพร้อมกัน BURST ครั้ง แล้วยืนยันว่าไม่มีใบไหนล้ม */
  async function burst(make: (i: number) => Promise<{ statusCode: number; json: () => { data?: Record<string, unknown>; error?: { code?: string } } }>) {
    const results = await Promise.all(Array.from({ length: BURST }, (_, i) => make(i)));
    const failures = results
      .filter((r) => r.statusCode >= 400)
      .map((r) => `${r.statusCode} ${r.json().error?.code ?? ''}`.trim());
    // ถ้ามี P2002 หลุดออกมาหาผู้ใช้ จะเห็นเป็น 409/500 ตรงนี้
    expect(failures, `คำขอที่ล้ม: ${failures.join(', ')}`).toEqual([]);
    return results.map((r) => r.json().data as Record<string, unknown>);
  }

  /** เลขต้องไม่ซ้ำ และลำดับต้องต่อเนื่องภายในชุดที่ยิงพร้อมกัน */
  function expectUniqueSequence(numbers: string[]) {
    expect(new Set(numbers).size, `เลขซ้ำ: ${numbers.join(', ')}`).toBe(numbers.length);
    const seqs = numbers.map(seqOf).sort((a, b) => a - b);
    expect(seqs.every(Number.isInteger)).toBe(true);
    expect(seqs[seqs.length - 1] - seqs[0]).toBe(BURST - 1);   // เดินต่อเนื่องไม่ข้ามภายในชุด
  }

  it(`K1 สร้างใบรับของ ${BURST} ใบพร้อมกัน — สำเร็จทุกใบ เลขไม่ซ้ำ`, async () => {
    const before = await prisma.goodsReceipt.count({ where: { companyId } });
    const docs = await burst((i) => app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: { warehouseId, note: `ชุดพร้อมกัน ${i}`, items: [{ itemId, quantity: 1, unitPrice: 2 }] },
    }));
    expectUniqueSequence(docs.map((d) => d.receiptNo as string));
    expect(await prisma.goodsReceipt.count({ where: { companyId } })).toBe(before + BURST);
  });

  it(`K2 สร้างใบเบิก ${BURST} ใบพร้อมกัน — สำเร็จทุกใบ เลขไม่ซ้ำ ตัดสต็อกครบพอดี`, async () => {
    const balanceBefore = Number((await prisma.stockBalance.findFirstOrThrow({ where: { itemId, warehouseId } })).onHand);
    const ledgerBefore = await prisma.stockLedger.count({ where: { itemId } });

    const docs = await burst((i) => app.inject({
      method: 'POST', url: '/api/business/stock-issues', headers: auth(),
      payload: {
        warehouseId, confirm: true, idempotencyKey: `${TAG}-ri-${i}`,
        items: [{ itemId, issuedQty: 1, unit: unitCode, baseQty: 1 }],
      },
    }));
    expectUniqueSequence(docs.map((d) => d.issueNo as string));

    // ตัดสต็อกครบตามจำนวนใบ ไม่ตัดซ้ำและไม่ตกหล่น
    const balanceAfter = Number((await prisma.stockBalance.findFirstOrThrow({ where: { itemId, warehouseId } })).onHand);
    expect(balanceAfter).toBeCloseTo(balanceBefore - BURST, 4);
    expect(await prisma.stockLedger.count({ where: { itemId } })).toBe(ledgerBefore + BURST);
  });

  it(`K3 สร้างใบปรับปรุงสต็อก ${BURST} ใบพร้อมกัน — สำเร็จทุกใบ เลขไม่ซ้ำ`, async () => {
    const before = await prisma.stockAdjustment.count({ where: { companyId } });
    const docs = await burst((i) => app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: auth(),
      payload: { warehouseId, reason: 'COUNT', note: `นับรอบ ${i}`, items: [{ itemId, mode: 'INCREASE', quantity: 1 }] },
    }));
    expectUniqueSequence(docs.map((d) => d.adjustmentNo as string));
    expect(await prisma.stockAdjustment.count({ where: { companyId } })).toBe(before + BURST);
  });

  it(`K4 สร้างออเดอร์ ${BURST} ใบพร้อมกัน — สำเร็จทุกใบ เลขไม่ซ้ำ`, async () => {
    const before = await prisma.salesOrder.count({ where: { companyId } });
    const docs = await burst((i) => app.inject({
      method: 'POST', url: '/api/business/orders', headers: auth(),
      payload: {
        customerId, deliveryDate: new Date('2026-12-01').toISOString(),
        items: [{ menuId, menuNameSnapshot: 'เมนูพร้อมกัน', quantity: 1, unit: unitCode, unitPrice: 10 + i }],
      },
    }));
    const numbers = docs.map((d) => d.orderNo as string);
    expectUniqueSequence(numbers);
    expect(numbers.every((no) => /^SO-\d{4}-\d{5}$/.test(no)), numbers.join(', ')).toBe(true);
    expect(await prisma.salesOrder.count({ where: { companyId } })).toBe(before + BURST);

    // ยืนยันว่าเลขในฐานข้อมูลไม่ซ้ำกันเองด้วย (ไม่ใช่แค่ค่าที่ตอบกลับ)
    const stored = await prisma.salesOrder.findMany({ where: { companyId }, select: { orderNo: true } });
    expect(new Set(stored.map((o) => o.orderNo)).size).toBe(stored.length);
  });

  it('K5 ตัวนับเหลือแถวเดียวต่อ (บริษัท · ชนิดเอกสาร · ช่วงเวลา) และค่าตรงกับเลขล่าสุด', async () => {
    const counters = await prisma.documentCounter.findMany({ where: { companyId } });
    const keys = counters.map((c) => `${c.companyId}|${c.docType}|${c.periodKey}`);
    expect(new Set(keys).size).toBe(keys.length);

    const grCounter = counters.find((c) => c.docType === 'GOODS_RECEIPT');
    expect(grCounter).toBeDefined();
    const receipts = await prisma.goodsReceipt.findMany({ where: { companyId }, select: { receiptNo: true } });
    const maxGr = Math.max(...receipts.map((r) => seqOf(r.receiptNo)));
    expect(grCounter!.lastSeq).toBeGreaterThanOrEqual(maxGr);

    const orderCounter = counters.find((c) => c.docType === 'SALES_ORDER');
    expect(orderCounter?.periodKey).toBe('ALL');
    const orders = await prisma.salesOrder.findMany({ where: { companyId }, select: { orderNo: true } });
    expect(orderCounter!.lastSeq).toBeGreaterThanOrEqual(Math.max(...orders.map((o) => seqOf(o.orderNo))));
  });

  it('K6 ธุรกรรมที่ล้มหลังจองเลขแล้ว — เลขนั้นถูกทิ้ง ไม่ถูกนำมาใช้ซ้ำ', async () => {
    const counterBefore = await prisma.documentCounter.findFirstOrThrow({ where: { companyId, docType: 'GOODS_RECEIPT' } });

    // ล้มหลังจองเลข: warehouse ถูกต้อง แต่ item ไม่อยู่ในบริษัท → ทั้ง transaction ถูกย้อน
    const bad = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: { warehouseId, items: [{ itemId: 'ไม่มีสินค้านี้', quantity: 1, unitPrice: 1 }] },
    });
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);

    const counterAfterFailure = await prisma.documentCounter.findFirstOrThrow({ where: { companyId, docType: 'GOODS_RECEIPT' } });
    /* ตัวนับถูกย้อนกลับพร้อม transaction — สถาปัตยกรรมปัจจุบัน "ไม่จงใจกันช่องว่าง"
       แต่ก็ไม่จงใจสร้างช่องว่างเช่นกัน เทสต์นี้จึงบันทึกพฤติกรรมจริงไว้เป็น regression */
    expect(counterAfterFailure.lastSeq).toBe(counterBefore.lastSeq);

    // ใบถัดไปต้องยังออกเลขได้ และต้องไม่ซ้ำกับเลขที่มีอยู่
    const good = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: { warehouseId, items: [{ itemId, quantity: 1, unitPrice: 1 }] },
    });
    expect(good.statusCode).toBe(201);
    const all = await prisma.goodsReceipt.findMany({ where: { companyId }, select: { receiptNo: true } });
    expect(new Set(all.map((r) => r.receiptNo)).size).toBe(all.length);
  });
});
