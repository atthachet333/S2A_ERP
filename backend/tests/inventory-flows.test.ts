import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 15 — integration ของกระแสงานคลังจริง
 *   รับของ → เบิก → ปรับปรุงสต็อก → เอกสาร
 * ทุกเคสยิงผ่าน HTTP จริงเหมือนที่ frontend เรียก และตรวจผลที่ฐานข้อมูลจริง
 */

const TAG = `fl${Date.now().toString().slice(-7)}`;
const USERNAME = `flow_${TAG}`;
const num = (d: unknown) => Number(d);

describe.sequential('inventory flows integration', () => {
  let app: FastifyInstance;
  let token = '';
  let companyId = '';
  let warehouseId = '';
  let supplierId = '';
  /** วัตถุดิบเคสหลัก: ซื้อเป็นลิตร เก็บสต็อกเป็นมิลลิลิตร (1 L = 1000 ML) */
  let oilId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const passwordHash = await bcrypt.hash('FlowPass123!', 10);
    const user = await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash, mustChangePassword: false, isActive: true, deletedAt: null },
      create: { username: USERNAME, email: `${USERNAME}@s2a.local`, passwordHash, fullName: 'Flow Tester', isActive: true, mustChangePassword: false },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } });
    companyId = company.id;
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      update: { roleId: role.id }, create: { userId: user.id, companyId, roleId: role.id, isDefault: true },
    });

    app = await buildApp();
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: USERNAME, password: 'FlowPass123!' } });
    token = login.json().data.accessToken;

    /* หน่วย: ลิตร (ซื้อ) และมิลลิลิตร (ฐาน) พร้อมอัตราแปลง 1 L = 1000 ML */
    const ml = await prisma.unit.upsert({ where: { code: `ML_${TAG}` }, update: {}, create: { code: `ML_${TAG}`, name: 'มิลลิลิตร(ทดสอบ)' } });
    const l = await prisma.unit.upsert({ where: { code: `L_${TAG}` }, update: {}, create: { code: `L_${TAG}`, name: 'ลิตร(ทดสอบ)' } });
    await prisma.unitConversion.create({ data: { fromUnitId: l.id, toUnitId: ml.id, factor: 1000 } });

    const wh = await prisma.warehouse.upsert({
      where: { code: `WH_${TAG}` }, update: {},
      create: { companyId, code: `WH_${TAG}`, name: 'คลังทดสอบ', type: 'RAW_MATERIAL', isActive: true },
    });
    warehouseId = wh.id;
    const sup = await prisma.supplier.upsert({
      where: { code: `SUP_${TAG}` }, update: {},
      create: { companyId, code: `SUP_${TAG}`, name: 'ผู้ขายทดสอบ', isActive: true },
    });
    supplierId = sup.id;

    const oil = await prisma.item.create({
      data: {
        companyId, code: `OIL_${TAG}`, name: 'น้ำมันพืช(ทดสอบ)', type: ItemType.RAW_MATERIAL,
        baseUnitId: ml.id, purchaseUnitId: l.id, purchaseToBaseFactor: 1000,
      },
    });
    oilId = oil.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /* ============================================================
     A. รับของ — เคสสำคัญ 47 บาท/ลิตร → 0.047 บาท/มิลลิลิตร
     ============================================================ */
  let receiptId = '';
  let receiptNo = '';

  it('A1 สร้างใบรับของเป็นร่าง — ยังไม่กระทบสต็อก', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: { warehouseId, supplierId, items: [{ itemId: oilId, quantity: 1, unitPrice: 47 }] },
    });
    expect(res.statusCode).toBe(201);
    const doc = res.json().data;
    receiptId = doc.id; receiptNo = doc.receiptNo;
    expect(doc.status).toBe('DRAFT');
    expect(receiptNo).toBeTruthy();

    // ร่างต้องยังไม่เขียน ledger และยังไม่มียอดคงเหลือ
    expect(await prisma.stockLedger.count({ where: { refId: receiptId } })).toBe(0);
    expect(await prisma.stockBalance.findFirst({ where: { itemId: oilId, warehouseId } })).toBeNull();
  });

  it('A2 แก้ไขร่างได้ และเลขที่เอกสารต้องไม่เปลี่ยน', async () => {
    const res = await app.inject({
      method: 'PATCH', url: `/api/business/receiving/${receiptId}`, headers: auth(),
      payload: { warehouseId, supplierId, items: [{ itemId: oilId, quantity: 47, unitPrice: 47 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.receiptNo).toBe(receiptNo);   // เลขเดิมเสมอ
    expect(res.json().data.status).toBe('DRAFT');
  });

  it('A3 ยืนยันแล้วต้องแปลงหน่วยถูก: 47 ลิตร → 47,000 ML และต้นทุนฐาน 0.047/ML', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/business/receiving/${receiptId}/confirm`, headers: auth() });
    expect(res.statusCode).toBe(200);

    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } });
    expect(num(balance.onHand)).toBeCloseTo(47_000, 4);   // 47 L × 1000

    const item = await prisma.item.findUniqueOrThrow({ where: { id: oilId } });
    // ⭐ เคสหลักของเฟส: 47 บาท/ลิตร ÷ 1000 = 0.047 บาท/มิลลิลิตร
    expect(num(item.lastCost)).toBeCloseTo(0.047, 6);

    const ledger = await prisma.stockLedger.findMany({ where: { refId: receiptId } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].movementType).toBe('PURCHASE_RECEIPT');
    expect(num(ledger[0].qtyIn)).toBeCloseTo(47_000, 4);
    expect(num(ledger[0].balanceAfter)).toBeCloseTo(47_000, 4);
    expect(num(ledger[0].unitCost)).toBeCloseTo(0.047, 6);
    // PHASE 13B: ต้องเก็บ "รหัสหน่วย" ไม่ใช่ id ของหน่วย
    expect(ledger[0].unit).not.toMatch(/^c[a-z0-9]{20,}$/);
  });

  it('A4 ยืนยันซ้ำต้องไม่เพิ่มสต็อกอีก (idempotency)', async () => {
    const before = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand);
    const res = await app.inject({ method: 'POST', url: `/api/business/receiving/${receiptId}/confirm`, headers: auth() });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const after = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand);
    expect(after).toBeCloseTo(before, 4);
    expect(await prisma.stockLedger.count({ where: { refId: receiptId } })).toBe(1);
  });

  /* ============================================================
     B. เบิกสินค้า
     ============================================================ */
  let issueId = '';

  it('B1 เบิกแล้วสต็อกต้องลดลงตามจริง', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/stock-issues', headers: auth(),
      payload: {
        warehouseId, idempotencyKey: `issue-${TAG}-1`, confirm: true,
        items: [{ itemId: oilId, issuedQty: 2_000, unit: `ML_${TAG}`, baseQty: 2_000 }],
      },
    });
    expect(res.statusCode).toBe(201);
    issueId = res.json().data.id;

    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } });
    expect(num(balance.onHand)).toBeCloseTo(45_000, 4);   // 47,000 − 2,000
  });

  it('B2 เบิกเกินยอดคงเหลือต้องถูกปฏิเสธ และสต็อกต้องไม่เปลี่ยน', async () => {
    const before = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand);
    const res = await app.inject({
      method: 'POST', url: '/api/business/stock-issues', headers: auth(),
      payload: {
        warehouseId, idempotencyKey: `issue-${TAG}-over`, confirm: true,
        items: [{ itemId: oilId, issuedQty: 999_999, unit: `ML_${TAG}`, baseQty: 999_999 }],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const after = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand);
    expect(after).toBeCloseTo(before, 4);   // ธุรกรรมล้มต้องไม่ทิ้งผลบางส่วน
  });

  it('B3 กลับรายการเบิก แล้วสต็อกต้องคืนกลับ', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/business/stock-issues/${issueId}/reverse`, headers: auth() });
    expect(res.statusCode).toBe(200);

    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } });
    expect(num(balance.onHand)).toBeCloseTo(47_000, 4);   // กลับไปเท่าเดิม
  });

  it('B4 กลับรายการซ้ำต้องไม่คืนสต็อกซ้ำอีก', async () => {
    const before = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand);
    const res = await app.inject({ method: 'POST', url: `/api/business/stock-issues/${issueId}/reverse`, headers: auth() });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);

    const after = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand);
    expect(after).toBeCloseTo(before, 4);
  });

  /* ============================================================
     C. ปรับปรุงสต็อก — เพิ่ม / ลด / กำหนดยอดจริง
     ============================================================ */
  it('C1 INCREASE เพิ่มยอดตามจำนวนที่ระบุ', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: auth(),
      payload: { warehouseId, reason: 'COUNT', items: [{ itemId: oilId, mode: 'INCREASE', quantity: 1_000 }] },
    });
    expect(res.statusCode).toBe(201);
    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } });
    expect(num(balance.onHand)).toBeCloseTo(48_000, 4);
  });

  it('C2 DECREASE ลดยอดตามจำนวนที่ระบุ', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: auth(),
      payload: { warehouseId, reason: 'DAMAGED', items: [{ itemId: oilId, mode: 'DECREASE', quantity: 3_000 }] },
    });
    expect(res.statusCode).toBe(201);
    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } });
    expect(num(balance.onHand)).toBeCloseTo(45_000, 4);
  });

  it('C3 SET ตั้งยอดเป็นค่าที่นับได้จริง และบันทึกก่อน/เปลี่ยน/หลังถูกต้อง', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: auth(),
      payload: { warehouseId, reason: 'COUNT', note: 'นับสต็อกประจำเดือน', items: [{ itemId: oilId, mode: 'SET', quantity: 10_000 }] },
    });
    expect(res.statusCode).toBe(201);
    const adjustmentId = res.json().data.id;

    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } });
    expect(num(balance.onHand)).toBeCloseTo(10_000, 4);

    const line = await prisma.stockAdjustmentItem.findFirstOrThrow({ where: { stockAdjustmentId: adjustmentId } });
    expect(num(line.systemQty)).toBeCloseTo(45_000, 4);    // ก่อนปรับ
    expect(num(line.countedQty)).toBeCloseTo(10_000, 4);   // หลังปรับ
    expect(num(line.diffQty)).toBeCloseTo(-35_000, 4);     // ส่วนต่าง
    expect(num(line.systemQty) + num(line.diffQty)).toBeCloseTo(num(line.countedQty), 4);
  });

  it('C4 กลับรายการใบปรับปรุงสต็อกได้จริง และคืนยอดกลับครบ', async () => {
    /* PHASE 18 — เดิม enum ของคอลัมน์ status ในตาราง stock_adjustments ไม่มีค่า REVERSED
       ทั้งที่โค้ดเขียนค่านี้ลงไป การกลับรายการจึงล้มด้วย MySQL 1265 มาตลอดโดยไม่มีเทสต์จับ */
    const created = await app.inject({
      method: 'POST', url: '/api/business/inventory/adjustments', headers: auth(),
      payload: { warehouseId, reason: 'COUNT', items: [{ itemId: oilId, mode: 'INCREASE', quantity: 500 }] },
    });
    expect(created.statusCode).toBe(201);
    const adjustmentId = created.json().data.id;
    const afterAdjust = num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand);

    const res = await app.inject({
      method: 'POST', url: `/api/business/inventory/adjustments/${adjustmentId}/reverse`, headers: auth(),
      payload: { reason: 'นับผิด' },
    });
    expect(res.statusCode).toBe(200);
    expect((await prisma.stockAdjustment.findUniqueOrThrow({ where: { id: adjustmentId } })).status).toBe('REVERSED');
    expect(num((await prisma.stockBalance.findFirstOrThrow({ where: { itemId: oilId, warehouseId } })).onHand)).toBeCloseTo(afterAdjust - 500, 4);

    const again = await app.inject({ method: 'POST', url: `/api/business/inventory/adjustments/${adjustmentId}/reverse`, headers: auth(), payload: {} });
    expect(again.statusCode).toBe(409);
  });

  /* ============================================================
     E. ข้อมูลหลัก — ปิดใช้งานแล้วเอกสารเก่าต้องยังอ่านชื่อได้
     ============================================================ */
  it('E1 ปิดใช้งานผู้ขาย/คลัง แล้วใบรับของเดิมยังแสดงชื่อได้', async () => {
    await prisma.supplier.update({ where: { id: supplierId }, data: { isActive: false } });
    await prisma.warehouse.update({ where: { id: warehouseId }, data: { isActive: false } });

    const detail = await app.inject({ method: 'GET', url: `/api/business/receiving/${receiptId}`, headers: auth() });
    expect(detail.statusCode).toBe(200);
    const doc = detail.json().data;
    expect(doc.supplier?.name ?? doc.supplierName).toBeTruthy();
    expect(doc.warehouse?.name ?? doc.warehouseName).toBeTruthy();

    // คืนสถานะไว้ใช้กับเทสต์อื่น
    await prisma.supplier.update({ where: { id: supplierId }, data: { isActive: true } });
    await prisma.warehouse.update({ where: { id: warehouseId }, data: { isActive: true } });
  });

  /* ============================================================
     §11 เอกสาร PDF / Excel จากข้อมูลในฐานทดสอบ
     ============================================================ */
  it('F1 ใบรับของออกเป็น PDF ครึ่ง A4 ได้', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/business/documents/GOODS_RECEIPT_SLIP/${receiptId}.pdf`, headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    const buf = res.rawPayload;
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('/MediaBox [0 0 419.53 595.28]');
    expect(String(res.headers['content-disposition'])).toContain(`GR-${receiptNo}.pdf`);
  });

  it('F2 ใบปรับปรุงสต็อกออกเป็น PDF ได้', async () => {
    const adj = await prisma.stockAdjustment.findFirstOrThrow({ where: { companyId }, orderBy: { createdAt: 'desc' } });
    const res = await app.inject({
      method: 'GET', url: `/api/business/documents/STOCK_ADJUSTMENT_SLIP/${adj.id}.pdf`, headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('F3 ส่งออก Excel ได้ไฟล์ XLSX จริงที่เปิดกลับได้', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/business/receiving/export.xlsx', headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('spreadsheetml.sheet');

    const buf = res.rawPayload;
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');   // ZIP/OOXML

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const ws = wb.getWorksheet('รับของเข้า');
    expect(ws).toBeTruthy();

    // หน่วยต้องเป็นรหัสหน่วย ไม่ใช่ cuid
    const unitCell = String(ws!.getCell('I5').value ?? '');
    expect(unitCell).not.toMatch(/^c[a-z0-9]{20,}$/);
  });
});
