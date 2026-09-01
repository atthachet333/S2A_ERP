import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 36 — ต้นทุนหลังกลับรายการใบรับของ
 *
 * บั๊กที่แก้: กลับรายการแล้ว Item.lastCost ยังค้างอยู่ที่ราคาของใบที่ถูกยกเลิกไปแล้ว
 * ทุกสูตรที่ใช้วัตถุดิบนั้นจึงคิดต้นทุนจากเอกสารที่ไม่มีผลแล้ว
 *
 * สิ่งที่ต้องไม่เปลี่ยน: ledger · ประวัติเอกสาร · ประวัติราคา · ยอดคงเหลือ · สิทธิ์
 */

const TAG = `rv${Date.now().toString().slice(-7)}`;
const USERNAME = `rev_${TAG}`;
const PASSWORD = 'RevPass123!';
const n = (v: unknown) => Number(v);

describe.sequential('goods receipt reversal — last cost reconciliation', () => {
  let app: FastifyInstance;
  let token = '';
  let companyId = '';
  let warehouseId = '';
  let kgUnitId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const user = await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash, mustChangePassword: false, isActive: true, deletedAt: null },
      create: { username: USERNAME, email: `${USERNAME}@s2a.local`, passwordHash, fullName: 'ผู้ทดสอบกลับรายการ', isActive: true, mustChangePassword: false },
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
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: USERNAME, password: PASSWORD } });
    token = login.json().data.accessToken;

    const kg = await prisma.unit.upsert({ where: { code: `KG_${TAG}` }, update: {}, create: { code: `KG_${TAG}`, name: 'กิโลกรัม(ทดสอบ)' } });
    kgUnitId = kg.id;
    const wh = await prisma.warehouse.upsert({
      where: { code: `WH_${TAG}` }, update: {},
      create: { companyId, code: `WH_${TAG}`, name: 'คลังทดสอบกลับรายการ', type: 'RAW_MATERIAL', isActive: true },
    });
    warehouseId = wh.id;
  });

  afterAll(async () => { await app?.close(); });

  /** วัตถุดิบใหม่ต่อหนึ่งเคส — หน่วยซื้อ = หน่วยฐาน ให้ตัวเลขอ่านตรงไปตรงมา */
  const newItem = async (label: string) => {
    const item = await prisma.item.create({
      data: {
        companyId, code: `${label}_${TAG}`, name: `วัตถุดิบ ${label}`, type: 'RAW_MATERIAL',
        baseUnitId: kgUnitId, purchaseUnitId: kgUnitId, purchaseToBaseFactor: 1, isActive: true,
      },
    });
    return item.id;
  };

  const receive = async (itemId: string, date: string, unitPrice: number, quantity = 1) => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: {
        warehouseId, confirm: true, receiptDate: date, receiveReason: 'PURCHASE',
        items: [{ itemId, quantity, unitPrice }],
      },
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.id as string;
  };

  const reverse = async (receiptId: string, expectStatus = 200) => {
    const res = await app.inject({ method: 'POST', url: `/api/business/receiving/${receiptId}/reverse`, headers: auth(), payload: { reason: 'ทดสอบ' } });
    expect(res.statusCode).toBe(expectStatus);
    return res;
  };

  const lastCostOf = async (itemId: string) => n((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).lastCost);
  const onHandOf = async (itemId: string) => {
    const rows = await prisma.stockBalance.findMany({ where: { itemId, warehouse: { companyId } } });
    return rows.reduce((sum, b) => sum + n(b.onHand), 0);
  };

  it('20 → 35 แล้วกลับใบ 35 — ต้นทุนล่าสุดกลับเป็น 20', async () => {
    const itemId = await newItem('PORK');
    await receive(itemId, '2026-09-01T02:00:00.000Z', 20);
    const second = await receive(itemId, '2026-09-02T02:00:00.000Z', 35);
    expect(await lastCostOf(itemId)).toBe(35);

    await reverse(second);

    expect(await lastCostOf(itemId)).toBe(20);
    // avgCost เดินตาม lastCost เหมือนทุกจุดที่ระบบเขียนต้นทุน — ไม่แยกจากกัน
    expect(n((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).avgCost)).toBe(20);
    expect(await onHandOf(itemId)).toBe(1);
  });

  it('กลับใบเก่ากว่าในขณะที่ใบใหม่ยังอยู่ — ต้นทุนยังเป็นของใบใหม่', async () => {
    const itemId = await newItem('BEEF');
    const first = await receive(itemId, '2026-09-01T02:00:00.000Z', 20);
    await receive(itemId, '2026-09-02T02:00:00.000Z', 35);
    expect(await lastCostOf(itemId)).toBe(35);

    await reverse(first);

    // ใบล่าสุดที่ยังยืนยันอยู่คือใบ 35 จึงต้องไม่ถูกดึงกลับไปเป็น 20
    expect(await lastCostOf(itemId)).toBe(35);
    expect(await onHandOf(itemId)).toBe(1);
  });

  it('กลับทุกใบ — คงต้นทุนล่าสุดที่รู้ไว้ ไม่เขียนศูนย์ทับ', async () => {
    const itemId = await newItem('FISH');
    const first = await receive(itemId, '2026-09-01T02:00:00.000Z', 20);
    const second = await receive(itemId, '2026-09-02T02:00:00.000Z', 35);

    await reverse(second);
    expect(await lastCostOf(itemId)).toBe(20);
    await reverse(first);

    /* ไม่เหลือใบที่ยืนยันเลย = ไม่มีหลักฐานใหม่ให้ใช้
       ระบบจึงคงค่าเดิมไว้ ไม่เขียน 0 ลงไป เพราะ 0 จะเป็นต้นทุนปลอม
       และยังทำให้ costStatusOf อ่านผลเป็น ZERO ("ยืนยันแล้วว่าเป็นศูนย์จริง") ทั้งที่ไม่มีใครยืนยัน */
    expect(await lastCostOf(itemId)).toBe(20);
    expect(await onHandOf(itemId)).toBe(0);

    // บันทึกตรวจสอบต้องบอกได้ว่าทำไมถึงไม่เขียน
    const audit = await prisma.auditLog.findFirst({
      where: { companyId, action: 'GOODS_RECEIPT_REVERSED', entityId: first },
      orderBy: { createdAt: 'desc' },
    });
    const after = audit?.after as { lastCostReconciliation?: { source: string; next: string | null }[] } | null;
    expect(after?.lastCostReconciliation?.[0]).toMatchObject({ source: 'NO_EVIDENCE_KEPT', next: null });
  });

  it('ประวัติราคาเป็น append-only — กลับรายการไม่ลบและไม่แก้แถวเดิม', async () => {
    const itemId = await newItem('RICE');
    await receive(itemId, '2026-09-01T02:00:00.000Z', 20);
    const second = await receive(itemId, '2026-09-02T02:00:00.000Z', 35);

    const before = await prisma.itemPriceHistory.findMany({ where: { itemId }, orderBy: { createdAt: 'asc' } });
    expect(before.map((r) => n(r.price))).toEqual([20, 35]);

    await reverse(second);

    const after = await prisma.itemPriceHistory.findMany({ where: { itemId }, orderBy: { createdAt: 'asc' } });
    // จำนวนแถวเท่าเดิม · id เดิม · ราคาเดิม — ไม่มีแถวไหนถูกแก้หรือลบ
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => n(r.price))).toEqual([20, 35]);
    expect(after.map((r) => r.note)).toEqual(before.map((r) => r.note));
  });

  it('ประวัติ ledger และเอกสารยังอยู่ครบ — กลับรายการเพิ่มแถว ไม่ลบแถว', async () => {
    const itemId = await newItem('SALT');
    const first = await receive(itemId, '2026-09-01T02:00:00.000Z', 20);
    const second = await receive(itemId, '2026-09-02T02:00:00.000Z', 35);

    await reverse(second);

    const ledger = await prisma.stockLedger.findMany({ where: { itemId }, orderBy: { createdAt: 'asc' } });
    expect(ledger).toHaveLength(3);
    expect(ledger.slice(0, 2).map((l) => n(l.unitCost))).toEqual([20, 35]);
    expect(ledger.slice(0, 2).map((l) => n(l.qtyIn))).toEqual([1, 1]);
    // แถวที่สามคือขากลับ: ออก 1 หน่วย อ้างใบเดิม และทำเครื่องหมายว่าเป็นการกลับรายการ
    expect(ledger[2]).toMatchObject({ reason: 'REVERSAL', refType: 'GOODS_RECEIPT', refId: second });
    expect(n(ledger[2].qtyOut)).toBe(1);

    const docs = await prisma.goodsReceipt.findMany({ where: { id: { in: [first, second] } }, include: { items: true }, orderBy: { receiptDate: 'asc' } });
    expect(docs.map((d) => d.status)).toEqual(['CONFIRMED', 'REVERSED']);
    expect(docs.map((d) => n(d.items[0].unitPrice))).toEqual([20, 35]);
  });

  it('ยอดคงเหลือถูกคืนเท่าที่รับเข้าจริง ไม่มากไม่น้อย', async () => {
    const itemId = await newItem('SUGAR');
    await receive(itemId, '2026-09-01T02:00:00.000Z', 20, 4);
    const second = await receive(itemId, '2026-09-02T02:00:00.000Z', 35, 6);
    expect(await onHandOf(itemId)).toBe(10);

    await reverse(second);

    expect(await onHandOf(itemId)).toBe(4);
    expect(await lastCostOf(itemId)).toBe(20);
  });

  it('กลับรายการซ้ำไม่ได้ และไม่ทำให้ต้นทุนขยับอีกรอบ', async () => {
    const itemId = await newItem('OIL');
    await receive(itemId, '2026-09-01T02:00:00.000Z', 20);
    const second = await receive(itemId, '2026-09-02T02:00:00.000Z', 35);

    await reverse(second);
    expect(await lastCostOf(itemId)).toBe(20);
    await reverse(second, 409);
    expect(await lastCostOf(itemId)).toBe(20);
    expect(await onHandOf(itemId)).toBe(1);
  });

  it('ไม่มีสิทธิ์ = กลับรายการไม่ได้ ทั้งสต็อกและต้นทุนต้องไม่ขยับ', async () => {
    const itemId = await newItem('MILK');
    await receive(itemId, '2026-09-01T02:00:00.000Z', 20);
    const second = await receive(itemId, '2026-09-02T02:00:00.000Z', 35);

    const viewer = await prisma.user.upsert({
      where: { username: `revview_${TAG}` },
      update: {},
      create: { username: `revview_${TAG}`, email: `revview_${TAG}@s2a.local`, passwordHash: await bcrypt.hash(PASSWORD, 10), fullName: 'ผู้ดูอย่างเดียว', isActive: true, mustChangePassword: false },
    });
    const chefRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.CHEF } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: viewer.id, roleId: chefRole.id } }, update: {}, create: { userId: viewer.id, roleId: chefRole.id } });
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: viewer.id, companyId } },
      update: { roleId: chefRole.id }, create: { userId: viewer.id, companyId, roleId: chefRole.id, isDefault: true },
    });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `revview_${TAG}`, password: PASSWORD } });

    const res = await app.inject({
      method: 'POST', url: `/api/business/receiving/${second}/reverse`,
      headers: { authorization: `Bearer ${login.json().data.accessToken}` },
      payload: {},
    });
    expect(res.statusCode).toBe(403);
    expect(await lastCostOf(itemId)).toBe(35);
    expect(await onHandOf(itemId)).toBe(2);
    expect((await prisma.goodsReceipt.findUniqueOrThrow({ where: { id: second } })).status).toBe('CONFIRMED');
  });

  it('อัตราแปลงหน่วยยังถูกใช้ตอนคำนวณต้นทุนย้อนกลับ', async () => {
    // ซื้อเป็นลิตร เก็บเป็นมิลลิลิตร: 1 L = 1000 ML → 47 บาท/L = 0.047 บาท/ML
    const ml = await prisma.unit.upsert({ where: { code: `ML_${TAG}` }, update: {}, create: { code: `ML_${TAG}`, name: 'มิลลิลิตร(ทดสอบ)' } });
    const l = await prisma.unit.upsert({ where: { code: `L_${TAG}` }, update: {}, create: { code: `L_${TAG}`, name: 'ลิตร(ทดสอบ)' } });
    const item = await prisma.item.create({
      data: {
        companyId, code: `SOY_${TAG}`, name: 'ซีอิ๊ว', type: 'RAW_MATERIAL',
        baseUnitId: ml.id, purchaseUnitId: l.id, purchaseToBaseFactor: 1000, isActive: true,
      },
    });
    await receive(item.id, '2026-09-01T02:00:00.000Z', 47);
    const second = await receive(item.id, '2026-09-02T02:00:00.000Z', 60);
    expect(await lastCostOf(item.id)).toBe(0.06);

    await reverse(second);

    expect(await lastCostOf(item.id)).toBe(0.047);
    expect(await onHandOf(item.id)).toBe(1000);
  });
});
