import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 35 — นำเข้าสต็อกจากหน้าวัตถุดิบ
 *
 * โจทย์ที่ต้องพิสูจน์: รับหมูสด 2 ครั้งคนละราคา แล้วหลักฐานของครั้งแรกต้องไม่ถูกเขียนทับ
 *   1 ก.ย. 1 KG @ 20  → คงเหลือ 1 KG · lastCost 20
 *   2 ก.ย. 1 KG @ 35  → คงเหลือ 2 KG · lastCost 35 · เฉลี่ยถ่วงน้ำหนัก 27.50 · มูลค่าเฉลี่ย 55
 *   กลับรายการใบที่ 2 → สต็อกคืน 1 KG · ประวัติทั้งสองใบยังอยู่ครบ ไม่มีแถวไหนถูกลบ
 *
 * ยิงผ่าน HTTP จริงเหมือนที่ frontend เรียก แล้วตรวจผลที่ฐานข้อมูลทดสอบเท่านั้น
 */

const TAG = `rc${Date.now().toString().slice(-7)}`;
const USERNAME = `recv_${TAG}`;
const PASSWORD = 'RecvPass123!';
const n = (v: unknown) => Number(v);

describe.sequential('item stock receiving — multiple costs, remark, reversal', () => {
  let app: FastifyInstance;
  let token = '';
  let companyId = '';
  let warehouseId = '';
  let supplierAId = '';
  let supplierBId = '';
  let porkId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  const receipts: string[] = [];

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const passwordHash = await bcrypt.hash(PASSWORD, 10);
    const user = await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash, mustChangePassword: false, isActive: true, deletedAt: null },
      create: { username: USERNAME, email: `${USERNAME}@s2a.local`, passwordHash, fullName: 'ผู้ทดสอบรับเข้า', isActive: true, mustChangePassword: false },
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

    // หน่วยฐาน = หน่วยซื้อ = KG (อัตราแปลง 1) ให้ตัวเลขในโจทย์อ่านตรงไปตรงมา
    const kg = await prisma.unit.upsert({ where: { code: `KG_${TAG}` }, update: {}, create: { code: `KG_${TAG}`, name: 'กิโลกรัม(ทดสอบ)' } });
    const wh = await prisma.warehouse.upsert({
      where: { code: `WH_${TAG}` }, update: {},
      create: { companyId, code: `WH_${TAG}`, name: 'คลังทดสอบรับเข้า', type: 'RAW_MATERIAL', isActive: true },
    });
    warehouseId = wh.id;
    const supA = await prisma.supplier.upsert({ where: { code: `SUPA_${TAG}` }, update: {}, create: { companyId, code: `SUPA_${TAG}`, name: 'ABC Supplier', isActive: true } });
    const supB = await prisma.supplier.upsert({ where: { code: `SUPB_${TAG}` }, update: {}, create: { companyId, code: `SUPB_${TAG}`, name: 'XYZ Supplier', isActive: true } });
    supplierAId = supA.id; supplierBId = supB.id;

    const pork = await prisma.item.create({
      data: {
        companyId, code: `PORK_${TAG}`, name: 'หมูสด', type: 'RAW_MATERIAL',
        baseUnitId: kg.id, purchaseUnitId: kg.id, purchaseToBaseFactor: 1,
        isActive: true, createdById: user.id, updatedById: user.id,
      },
    });
    porkId = pork.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  const onHandOf = async () => {
    const balances = await prisma.stockBalance.findMany({ where: { itemId: porkId, warehouse: { companyId } } });
    return balances.reduce((sum, b) => sum + n(b.onHand), 0);
  };

  it('เริ่มต้นยังไม่มีสต็อกและยังไม่มีประวัติรับเข้า', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/items/${porkId}/stock`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    // "ยังไม่มีสต็อก" ต่างจาก "สต็อกเป็นศูนย์" — หน้าจอต้องแยกสองอย่างนี้ได้
    expect(data.hasStockHistory).toBe(false);
    expect(data.onHand).toBe(0);
    expect(data.lastReceivedAt).toBeNull();
    expect(data.weightedAverageCost).toBeNull();

    const history = await app.inject({ method: 'GET', url: `/api/items/${porkId}/receipts`, headers: auth() });
    expect(history.json().data.receipts).toHaveLength(0);
  });

  it('ใบที่ 1 — 1 ก.ย. 1 KG @ 20 พร้อมหมายเหตุ', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: {
        warehouseId, supplierId: supplierAId, confirm: true,
        receiptDate: '2026-09-01T02:32:00.000Z', // 09:32 น. เวลาไทย
        receiveReason: 'PURCHASE',
        items: [{ itemId: porkId, quantity: 1, unitPrice: 20, note: 'รับรอบเช้า' }],
      },
    });
    expect(res.statusCode).toBe(201);
    receipts.push(res.json().data.id);

    expect(await onHandOf()).toBe(1);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: porkId } });
    expect(n(item.lastCost)).toBe(20);

    const stock = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/stock`, headers: auth() })).json().data;
    expect(stock.onHand).toBe(1);
    expect(stock.lastCost).toBe(20);
    expect(stock.weightedAverageCost).toBe(20);
    expect(stock.stockValue).toBe(20);

    const history = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/receipts`, headers: auth() })).json().data;
    expect(history.receipts).toHaveLength(1);
    expect(history.receipts[0]).toMatchObject({
      quantity: 1, unitPrice: 20, totalValue: 20, baseUnitCost: 20,
      reason: 'PURCHASE', remark: 'รับรอบเช้า', supplierName: 'ABC Supplier', status: 'CONFIRMED',
    });
    // สรุปอ่านรู้เรื่องต้องมีทั้งวันเวลาไทย ปริมาณ ราคา และหมายเหตุ
    expect(history.receipts[0].summary).toContain('1 ก.ย. 2569 09:32');
    expect(history.receipts[0].summary).toContain('รับรอบเช้า');
    // ยังมีตัวอย่างเดียว จึงยังไม่เรียกว่าแนวโน้ม
    expect(history.trend).toBeNull();

    const prices = await prisma.itemPriceHistory.findMany({ where: { itemId: porkId }, orderBy: { createdAt: 'asc' } });
    expect(prices.map((p) => n(p.price))).toEqual([20]);
  });

  it('ใบที่ 2 — 2 ก.ย. 1 KG @ 35 ไม่เขียนทับใบแรก', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: {
        warehouseId, supplierId: supplierBId, confirm: true,
        receiptDate: '2026-09-02T03:15:00.000Z', // 10:15 น. เวลาไทย
        receiveReason: 'PURCHASE',
        items: [{ itemId: porkId, quantity: 1, unitPrice: 35, note: 'Supplier ปรับราคา' }],
      },
    });
    expect(res.statusCode).toBe(201);
    receipts.push(res.json().data.id);

    expect(await onHandOf()).toBe(2);
    const item = await prisma.item.findUniqueOrThrow({ where: { id: porkId } });
    expect(n(item.lastCost)).toBe(35);

    const stock = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/stock`, headers: auth() })).json().data;
    expect(stock.onHand).toBe(2);
    expect(stock.lastCost).toBe(35);
    // ต้นทุนเฉลี่ยถ่วงน้ำหนัก (20 + 35) / 2 = 27.50 · มูลค่าตามค่าเฉลี่ย = 55
    expect(stock.weightedAverageCost).toBe(27.5);
    expect(stock.weightedAverageValue).toBe(55);
    // มูลค่าตามนโยบายของระบบยังเป็น onHand x lastCost เหมือนทุกหน้าจอเดิม
    expect(stock.stockValueBasis).toBe('LAST_COST');
    expect(stock.stockValue).toBe(70);

    const history = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/receipts`, headers: auth() })).json().data;
    expect(history.receipts).toHaveLength(2);
    // ใหม่สุดขึ้นก่อน และหลักฐานของใบแรกยังเป็น 20 บาทเหมือนเดิมทุกช่อง
    expect(history.receipts[0]).toMatchObject({ unitPrice: 35, totalValue: 35, remark: 'Supplier ปรับราคา', supplierName: 'XYZ Supplier' });
    expect(history.receipts[1]).toMatchObject({ unitPrice: 20, totalValue: 20, remark: 'รับรอบเช้า', supplierName: 'ABC Supplier' });
    expect(history.trend).toMatchObject({ sampleCount: 2, firstCost: 20, lastCost: 35, changeAmount: 15, changePercent: 75 });

    // ประวัติราคาเป็นการเพิ่มแถว ไม่ใช่การแก้แถวเดิม
    const prices = await prisma.itemPriceHistory.findMany({ where: { itemId: porkId }, orderBy: { createdAt: 'asc' } });
    expect(prices.map((p) => n(p.price))).toEqual([20, 35]);

    // ledger มีสองการเคลื่อนไหวแยกกัน ไม่ใช่แถวเดียวที่ถูกอัปเดต
    const ledger = await prisma.stockLedger.findMany({ where: { itemId: porkId }, orderBy: { createdAt: 'asc' } });
    expect(ledger).toHaveLength(2);
    expect(ledger.map((l) => n(l.qtyIn))).toEqual([1, 1]);
    expect(ledger.map((l) => n(l.unitCost))).toEqual([20, 35]);
    expect(ledger.every((l) => l.reason === 'PURCHASE')).toBe(true);
  });

  it('ตัวกรองเดือนและ Supplier ตอบคำถามย้อนหลังได้', async () => {
    const byMonth = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/receipts?month=2026-09`, headers: auth() })).json().data;
    expect(byMonth.receipts).toHaveLength(2);
    expect(byMonth.months).toEqual(['2026-09']);

    const bySupplier = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/receipts?supplierId=${supplierAId}`, headers: auth() })).json().data;
    expect(bySupplier.receipts).toHaveLength(1);
    expect(bySupplier.receipts[0].unitPrice).toBe(20);

    const otherMonth = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/receipts?month=2026-08`, headers: auth() })).json().data;
    expect(otherMonth.receipts).toHaveLength(0);
  });

  it('ยอดตั้งต้นเป็นการรับเข้าที่แยกประเภทได้ และมีหลักฐานครบ', async () => {
    const kg = await prisma.unit.findUniqueOrThrow({ where: { code: `KG_${TAG}` } });
    const opening = await prisma.item.create({
      data: { companyId, code: `RICE_${TAG}`, name: 'ข้าวสาร', type: 'RAW_MATERIAL', baseUnitId: kg.id, purchaseUnitId: kg.id, purchaseToBaseFactor: 1, isActive: true },
    });
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving', headers: auth(),
      payload: {
        warehouseId, confirm: true, receiveReason: 'OPENING',
        receiptDate: '2026-08-31T01:00:00.000Z',
        items: [{ itemId: opening.id, quantity: 10, unitPrice: 30, note: 'ยอดตั้งต้น ณ วันที่เริ่มใช้งานระบบ' }],
      },
    });
    expect(res.statusCode).toBe(201);

    const history = (await app.inject({ method: 'GET', url: `/api/items/${opening.id}/receipts`, headers: auth() })).json().data;
    expect(history.receipts[0]).toMatchObject({ reason: 'OPENING', reasonLabel: 'ยอดตั้งต้น', quantity: 10, unitPrice: 30 });

    // ยอดตั้งต้นต้องเดินผ่าน ledger เหมือนการรับเข้าปกติ ไม่ได้เขียน StockBalance ตรง ๆ
    const ledger = await prisma.stockLedger.findMany({ where: { itemId: opening.id } });
    expect(ledger).toHaveLength(1);
    expect(ledger[0].reason).toBe('OPENING');
    expect(ledger[0].refType).toBe('GOODS_RECEIPT');

    // กรองเฉพาะการซื้อต้องไม่ติดใบยอดตั้งต้นมาด้วย
    const purchaseOnly = (await app.inject({ method: 'GET', url: `/api/items/${opening.id}/receipts?reason=PURCHASE`, headers: auth() })).json().data;
    expect(purchaseOnly.receipts).toHaveLength(0);
  });

  it('กลับรายการใบที่ 2 — สต็อกคืน แต่ประวัติไม่ถูกลบ', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipts[1]}/reverse`, headers: auth(), payload: { reason: 'ทดสอบกลับรายการ' } });
    expect(res.statusCode).toBe(200);

    expect(await onHandOf()).toBe(1);

    // ledger เพิ่มแถวขากลับ ไม่ได้ลบแถวเดิม
    const ledger = await prisma.stockLedger.findMany({ where: { itemId: porkId }, orderBy: { createdAt: 'asc' } });
    expect(ledger).toHaveLength(3);
    expect(ledger.filter((l) => l.reason === 'REVERSAL')).toHaveLength(1);
    expect(n(ledger[2].qtyOut)).toBe(1);
    // แถวเดิมสองแถวยังคงราคาเดิมทุกประการ
    expect(ledger.slice(0, 2).map((l) => n(l.unitCost))).toEqual([20, 35]);

    // ใบรับของทั้งสองใบยังอยู่ครบ ใบที่ 2 เปลี่ยนเป็น REVERSED เท่านั้น
    const docs = await prisma.goodsReceipt.findMany({ where: { id: { in: receipts } }, include: { items: true }, orderBy: { receiptDate: 'asc' } });
    expect(docs).toHaveLength(2);
    expect(docs[0].status).toBe('CONFIRMED');
    expect(docs[1].status).toBe('REVERSED');
    expect(docs[1].reversedAt).not.toBeNull();
    expect(n(docs[0].items[0].unitPrice)).toBe(20);
    expect(n(docs[1].items[0].unitPrice)).toBe(35);
    expect(docs[0].items[0].note).toBe('รับรอบเช้า');
    expect(docs[1].items[0].note).toBe('Supplier ปรับราคา');

    // ประวัติราคายังมีสองแถวเหมือนเดิม — การกลับรายการไม่ลบหลักฐานต้นทุน
    const prices = await prisma.itemPriceHistory.findMany({ where: { itemId: porkId }, orderBy: { createdAt: 'asc' } });
    expect(prices.map((p) => n(p.price))).toEqual([20, 35]);

    const history = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/receipts`, headers: auth() })).json().data;
    expect(history.receipts).toHaveLength(2);
    expect(history.receipts[0].status).toBe('REVERSED');
    expect(history.receipts[1]).toMatchObject({ status: 'CONFIRMED', unitPrice: 20 });

    /* PHASE 36 — ทั้งค่าเฉลี่ยถ่วงน้ำหนักและต้นทุนล่าสุดนับเฉพาะใบที่ยังยืนยันอยู่
       ใบ 35 ถูกกลับรายการแล้ว ต้นทุนจึงกลับไปอ้างอิงใบ 20 ที่ยังมีผลจริง */
    const stock = (await app.inject({ method: 'GET', url: `/api/items/${porkId}/stock`, headers: auth() })).json().data;
    expect(stock.onHand).toBe(1);
    expect(stock.weightedAverageCost).toBe(20);
    expect(stock.lastCost).toBe(20);
    expect(stock.stockValue).toBe(20);
  });

  it('ไม่มีสิทธิ์รับเข้า = ยืนยันไม่ได้ (backend เป็นผู้ตัดสิน)', async () => {
    const viewer = await prisma.user.upsert({
      where: { username: `view_${TAG}` },
      update: {}, create: { username: `view_${TAG}`, email: `view_${TAG}@s2a.local`, passwordHash: await bcrypt.hash(PASSWORD, 10), fullName: 'ผู้ดูอย่างเดียว', isActive: true, mustChangePassword: false },
    });
    const chefRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.CHEF } });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: viewer.id, roleId: chefRole.id } }, update: {}, create: { userId: viewer.id, roleId: chefRole.id } });
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: viewer.id, companyId } },
      update: { roleId: chefRole.id }, create: { userId: viewer.id, companyId, roleId: chefRole.id, isDefault: true },
    });
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `view_${TAG}`, password: PASSWORD } });
    const viewerToken = login.json().data.accessToken;

    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { warehouseId, confirm: true, items: [{ itemId: porkId, quantity: 1, unitPrice: 99 }] },
    });
    expect(res.statusCode).toBe(403);
    // สต็อกต้องไม่ขยับแม้แต่นิดเดียว
    expect(await onHandOf()).toBe(1);
  });
});
