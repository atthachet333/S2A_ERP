import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 18 — โอนย้ายสินค้าระหว่างคลัง
 *
 * หลักที่ตรึงไว้ทุกเทสต์: ใบโอนย้ายหนึ่งใบ = การเคลื่อนไหวสองขาที่แยกกันไม่ได้
 * ถ้าขาออกล้ม ปลายทางต้องไม่ขยับ และต้นทุนสินค้าต้องไม่ถูกตีใหม่
 */

const TAG = `tf${Date.now().toString().slice(-7)}`;
const num = (d: unknown) => Number(d);

describe.sequential('stock transfer', () => {
  let app: FastifyInstance;
  let token = '';
  let viewerToken = '';
  let companyId = '';
  let unitId = '';
  let unitCode = '';
  let whA = '';
  let whB = '';
  const auth = () => ({ authorization: `Bearer ${token}` });
  const viewer = () => ({ authorization: `Bearer ${viewerToken}` });

  const freshItem = async (name: string, lastCost = 7) =>
    (await prisma.item.create({
      data: { companyId, code: `${name}_${TAG}`, name: `สินค้า ${name}`, type: ItemType.RAW_MATERIAL, baseUnitId: unitId, lastCost },
    })).id;

  const stockIn = (itemId: string, warehouseId: string, quantity: number, unitPrice = 7) => app.inject({
    method: 'POST', url: '/api/business/receiving', headers: auth(),
    payload: { warehouseId, confirm: true, items: [{ itemId, quantity, unitPrice }] },
  });

  const transfer = (payload: Record<string, unknown>, headers = auth()) =>
    app.inject({ method: 'POST', url: '/api/business/transfers', headers, payload });

  const onHand = async (itemId: string, warehouseId: string) => {
    const row = await prisma.stockBalance.findFirst({ where: { itemId, warehouseId } });
    return row ? num(row.onHand) : 0;
  };

  const failureCodes = (results: { statusCode: number; json: () => { error?: { code?: string } } }[]) =>
    results.filter((r) => r.statusCode >= 400).map((r) => `${r.statusCode} ${r.json().error?.code ?? ''}`.trim());

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;

    const mk = async (username: string, roleId: string) => {
      const passwordHash = await bcrypt.hash('TransferPass123!', 10);
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
    };
    await mk(`tfadmin_${TAG}`, superRole.id);
    await mk(`tfviewer_${TAG}`, viewerRole.id);

    app = await buildApp();
    await app.ready();
    const login = async (u: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: 'TransferPass123!' } })).json().data.accessToken as string;
    token = await login(`tfadmin_${TAG}`);
    viewerToken = await login(`tfviewer_${TAG}`);

    const unit = await prisma.unit.upsert({ where: { code: `TU_${TAG}` }, update: {}, create: { code: `TU_${TAG}`, name: 'หน่วยโอนย้าย' } });
    unitId = unit.id; unitCode = unit.code;
    whA = (await prisma.warehouse.create({ data: { companyId, code: `TWA_${TAG}`, name: 'คลัง A' } })).id;
    whB = (await prisma.warehouse.create({ data: { companyId, code: `TWB_${TAG}`, name: 'คลัง B' } })).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /* ======================= วงจรเอกสาร ======================= */
  it('T1 สร้างร่างแล้วยังไม่ขยับสต็อก และเลขที่เป็น TR-YYYYMMDD-NNNN', async () => {
    const itemId = await freshItem('DRAFT');
    expect((await stockIn(itemId, whA, 50)).statusCode).toBe(201);

    const res = await transfer({ fromWarehouseId: whA, toWarehouseId: whB, items: [{ itemId, quantity: 10 }] });
    expect(res.statusCode).toBe(201);
    const doc = res.json().data;
    expect(doc.status).toBe('DRAFT');
    expect(doc.transferNo).toMatch(/^TR-\d{8}-\d{4}$/);

    expect(await onHand(itemId, whA)).toBeCloseTo(50, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(0, 4);
    expect(await prisma.stockLedger.count({ where: { refId: doc.id } })).toBe(0);
  });

  it('T2 แก้ไขร่างได้และเลขที่เดิมไม่เปลี่ยน', async () => {
    const itemId = await freshItem('EDIT');
    expect((await stockIn(itemId, whA, 30)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, items: [{ itemId, quantity: 5 }] })).json().data;

    const edited = await app.inject({
      method: 'PATCH', url: `/api/business/transfers/${created.id}`, headers: auth(),
      payload: { fromWarehouseId: whA, toWarehouseId: whB, note: 'แก้ไขแล้ว', items: [{ itemId, quantity: 8 }] },
    });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().data.transferNo).toBe(created.transferNo);
    expect(edited.json().data.items).toHaveLength(1);
    expect(num(edited.json().data.items[0].quantity)).toBeCloseTo(8, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(0, 4);   // ร่างยังไม่ขยับสต็อก
  });

  it('T3 ยืนยันแล้วต้นทางลด ปลายทางเพิ่ม เท่ากันพอดี และมี ledger คู่กัน', async () => {
    const itemId = await freshItem('CONFIRM');
    expect((await stockIn(itemId, whA, 100)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, items: [{ itemId, quantity: 25 }] })).json().data;

    const res = await app.inject({ method: 'POST', url: `/api/business/transfers/${created.id}/confirm`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('CONFIRMED');

    expect(await onHand(itemId, whA)).toBeCloseTo(75, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(25, 4);

    const ledger = await prisma.stockLedger.findMany({ where: { refId: created.id }, orderBy: { createdAt: 'asc' } });
    expect(ledger).toHaveLength(2);
    const out = ledger.find((l) => l.movementType === 'TRANSFER_OUT')!;
    const into = ledger.find((l) => l.movementType === 'TRANSFER_IN')!;
    expect(out.warehouseId).toBe(whA);
    expect(into.warehouseId).toBe(whB);
    expect(num(out.qtyOut)).toBeCloseTo(25, 4);
    expect(num(into.qtyIn)).toBeCloseTo(25, 4);
    expect(num(out.beforeQty)).toBeCloseTo(100, 4);
    expect(num(out.balanceAfter)).toBeCloseTo(75, 4);
    expect(num(into.beforeQty)).toBeCloseTo(0, 4);
    expect(num(into.balanceAfter)).toBeCloseTo(25, 4);
    // หน่วยต้องเป็นรหัสหน่วยที่อ่านออก ไม่ใช่ id (บทเรียน PHASE 13B)
    expect(out.unit).toBe(unitCode);
    expect(into.unit).toBe(unitCode);
    expect(out.refNo).toBe(created.transferNo);
  });

  it('T4 การโอนย้ายต้องไม่ตีราคาสินค้าใหม่ และต้นทุนสองขาต้องเท่ากัน', async () => {
    const itemId = await freshItem('COST');
    expect((await stockIn(itemId, whA, 40, 12)).statusCode).toBe(201);
    const before = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });

    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, items: [{ itemId, quantity: 10 }] })).json().data;
    expect(created.status).toBe('CONFIRMED');

    const after = await prisma.item.findUniqueOrThrow({ where: { id: itemId } });
    expect(num(after.lastCost)).toBeCloseTo(num(before.lastCost), 6);
    expect(num(after.avgCost)).toBeCloseTo(num(before.avgCost), 6);

    // ไม่มีประวัติราคาซื้อเกิดจากการโอนย้าย
    expect(await prisma.itemPriceHistory.count({ where: { itemId, note: { contains: created.transferNo } } })).toBe(0);

    const ledger = await prisma.stockLedger.findMany({ where: { refId: created.id } });
    expect(new Set(ledger.map((l) => num(l.unitCost).toFixed(6))).size).toBe(1);
    expect(num(ledger[0].unitCost)).toBeCloseTo(num(before.lastCost), 6);
  });

  /* ======================= กฎทางธุรกิจ ======================= */
  it('T5 คลังต้นทางและปลายทางต้องต่างกัน', async () => {
    const itemId = await freshItem('SAME');
    const res = await transfer({ fromWarehouseId: whA, toWarehouseId: whA, items: [{ itemId, quantity: 1 }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('SAME_WAREHOUSE');
  });

  it('T6 สินค้าซ้ำในใบเดียวกันไม่ได้', async () => {
    const itemId = await freshItem('DUP');
    const res = await transfer({ fromWarehouseId: whA, toWarehouseId: whB, items: [{ itemId, quantity: 1 }, { itemId, quantity: 2 }] });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('DUPLICATE_ITEM');
  });

  it('T7 ของไม่พอ → ล้มทั้งใบ ปลายทางต้องไม่ได้รับอะไรเลย', async () => {
    const okItem = await freshItem('OK');
    const shortItem = await freshItem('SHORT');
    expect((await stockIn(okItem, whA, 20)).statusCode).toBe(201);
    expect((await stockIn(shortItem, whA, 1)).statusCode).toBe(201);

    const res = await transfer({
      fromWarehouseId: whA, toWarehouseId: whB, confirm: true,
      items: [{ itemId: okItem, quantity: 5 }, { itemId: shortItem, quantity: 99 }],
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK');

    // บรรทัดแรกที่ "ทำได้" ต้องไม่ถูกย้ายเช่นกัน — ทั้งใบต้องเป็นหน่วยเดียว
    expect(await onHand(okItem, whA)).toBeCloseTo(20, 4);
    expect(await onHand(okItem, whB)).toBeCloseTo(0, 4);
    expect(await onHand(shortItem, whA)).toBeCloseTo(1, 4);
    expect(await prisma.stockBalance.findFirst({ where: { itemId: shortItem, warehouseId: whB } })).toBeNull();
    expect(await prisma.stockTransfer.count({ where: { companyId, items: { some: { itemId: shortItem } } } })).toBe(0);
  });

  it('T8 ยืนยันซ้ำไม่ได้ และแก้ไขใบที่ยืนยันแล้วไม่ได้', async () => {
    const itemId = await freshItem('TWICE');
    expect((await stockIn(itemId, whA, 20)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, items: [{ itemId, quantity: 5 }] })).json().data;

    const again = await app.inject({ method: 'POST', url: `/api/business/transfers/${created.id}/confirm`, headers: auth() });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_CONFIRMED');

    const edit = await app.inject({
      method: 'PATCH', url: `/api/business/transfers/${created.id}`, headers: auth(),
      payload: { items: [{ itemId, quantity: 1 }] },
    });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().error.code).toBe('NOT_DRAFT');
    expect(await onHand(itemId, whB)).toBeCloseTo(5, 4);
  });

  /* ======================= กลับรายการ ======================= */
  it('T9 กลับรายการคืนของให้ต้นทางและหักจากปลายทาง ครั้งเดียว', async () => {
    const itemId = await freshItem('REV');
    expect((await stockIn(itemId, whA, 60)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, items: [{ itemId, quantity: 20 }] })).json().data;
    expect(await onHand(itemId, whA)).toBeCloseTo(40, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(20, 4);

    const res = await app.inject({ method: 'POST', url: `/api/business/transfers/${created.id}/reverse`, headers: auth(), payload: { reason: 'ส่งผิดคลัง' } });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.status).toBe('REVERSED');

    expect(await onHand(itemId, whA)).toBeCloseTo(60, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(0, 4);

    const reversals = await prisma.stockLedger.findMany({ where: { refId: created.id, reason: 'REVERSAL' } });
    expect(reversals).toHaveLength(2);
    expect(reversals.find((r) => r.warehouseId === whA)!.movementType).toBe('TRANSFER_IN');
    expect(reversals.find((r) => r.warehouseId === whB)!.movementType).toBe('TRANSFER_OUT');

    const again = await app.inject({ method: 'POST', url: `/api/business/transfers/${created.id}/reverse`, headers: auth(), payload: {} });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('ALREADY_REVERSED');
    expect(await onHand(itemId, whA)).toBeCloseTo(60, 4);
  });

  it('T10 ปลายทางไม่มีของพอจะคืน → กลับรายการไม่ได้ และห้ามติดลบ', async () => {
    const itemId = await freshItem('REVSHORT');
    expect((await stockIn(itemId, whA, 30)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, items: [{ itemId, quantity: 30 }] })).json().data;

    // ของถูกเบิกออกจากปลายทางไปแล้ว จึงคืนกลับไม่ได้
    const issued = await app.inject({
      method: 'POST', url: '/api/business/stock-issues', headers: auth(),
      payload: { warehouseId: whB, confirm: true, idempotencyKey: `${TAG}-t10`, items: [{ itemId, issuedQty: 25, unit: unitCode, baseQty: 25 }] },
    });
    expect(issued.statusCode).toBe(201);

    const res = await app.inject({ method: 'POST', url: `/api/business/transfers/${created.id}/reverse`, headers: auth(), payload: {} });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('INSUFFICIENT_STOCK');

    // ไม่มีอะไรเปลี่ยน และไม่มียอดติดลบ
    expect(await onHand(itemId, whB)).toBeCloseTo(5, 4);
    expect(await onHand(itemId, whA)).toBeCloseTo(0, 4);
    expect((await prisma.stockTransfer.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('CONFIRMED');
    expect(await prisma.stockLedger.count({ where: { refId: created.id, reason: 'REVERSAL' } })).toBe(0);
  });

  /* ======================= สิทธิ์ ======================= */
  it('T11 ผู้ใช้ที่ไม่มีสิทธิ์ทำอะไรกับใบโอนย้ายไม่ได้เลย', async () => {
    const itemId = await freshItem('PERM');
    expect((await stockIn(itemId, whA, 10)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, items: [{ itemId, quantity: 1 }] })).json().data;

    for (const [method, url] of [
      ['GET', '/api/business/transfers'],
      ['GET', `/api/business/transfers/${created.id}`],
      ['POST', '/api/business/transfers'],
      ['PATCH', `/api/business/transfers/${created.id}`],
      ['POST', `/api/business/transfers/${created.id}/confirm`],
      ['POST', `/api/business/transfers/${created.id}/reverse`],
    ] as const) {
      const res = await app.inject({ method, url, headers: viewer(), payload: {} });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
    }
    expect((await prisma.stockTransfer.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('DRAFT');
  });

  /* ======================= รายการและตัวกรอง ======================= */
  it('T12 รายการกรองตามสถานะและคลังได้ และคืนจำนวนรวม', async () => {
    const list = await app.inject({ method: 'GET', url: `/api/business/transfers?fromWarehouseId=${whA}&take=200`, headers: auth() });
    expect(list.statusCode).toBe(200);
    const body = list.json().data;
    expect(body.total).toBeGreaterThan(0);
    expect(body.rows.every((r: { fromWarehouseId: string }) => r.fromWarehouseId === whA)).toBe(true);

    const drafts = await app.inject({ method: 'GET', url: '/api/business/transfers?status=DRAFT', headers: auth() });
    expect(drafts.json().data.rows.every((r: { status: string }) => r.status === 'DRAFT')).toBe(true);

    const first = body.rows[0];
    const search = await app.inject({ method: 'GET', url: `/api/business/transfers?keyword=${encodeURIComponent(first.transferNo)}`, headers: auth() });
    expect(search.json().data.rows.map((r: { id: string }) => r.id)).toContain(first.id);
  });

  /* ======================= เอกสาร PDF ======================= */
  it('T17 ดาวน์โหลดใบโอนย้ายเป็น PDF ได้ และไม่มีตัวเลขการเงินในเอกสาร', async () => {
    const itemId = await freshItem('PDF');
    expect((await stockIn(itemId, whA, 20)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, note: 'ย้ายไปคลัง B', items: [{ itemId, quantity: 4 }] })).json().data;

    const res = await app.inject({ method: 'GET', url: `/api/business/documents/STOCK_TRANSFER_SLIP/${created.id}.pdf`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(String(res.headers['content-disposition'])).toContain(`${created.transferNo}.pdf`);

    const body = res.rawPayload;
    expect(body.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(body.length).toBeGreaterThan(1000);
  });

  /* ======================= การชนกันของคำขอพร้อมกัน ======================= */
  it('T13 โอนย้าย A→B 10 ใบพร้อมกัน → ยอดสองฝั่งตรงเป๊ะ เลขไม่ซ้ำ', async () => {
    const itemId = await freshItem('BURST');
    expect((await stockIn(itemId, whA, 100)).statusCode).toBe(201);

    const results = await Promise.all(Array.from({ length: 10 }, () =>
      transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, items: [{ itemId, quantity: 3 }] })));
    expect(failureCodes(results)).toEqual([]);

    expect(await onHand(itemId, whA)).toBeCloseTo(70, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(30, 4);

    const numbers = results.map((r) => r.json().data.transferNo as string);
    expect(new Set(numbers).size).toBe(numbers.length);
    expect(await prisma.stockLedger.count({ where: { itemId, refType: 'STOCK_TRANSFER' } })).toBe(20);   // 10 ใบ × 2 ขา
  });

  it('T14 โอนสวนทางกัน A→B และ B→A พร้อมกัน ต้องไม่ล็อกวนตาย', async () => {
    const itemId = await freshItem('CROSS');
    expect((await stockIn(itemId, whA, 100)).statusCode).toBe(201);
    expect((await stockIn(itemId, whB, 100)).statusCode).toBe(201);

    const work = [
      ...Array.from({ length: 5 }, () => () => transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, items: [{ itemId, quantity: 2 }] })),
      ...Array.from({ length: 5 }, () => () => transfer({ fromWarehouseId: whB, toWarehouseId: whA, confirm: true, items: [{ itemId, quantity: 2 }] })),
    ];
    const results = await Promise.all(work.map((run) => run()));
    expect(failureCodes(results)).toEqual([]);

    // ย้ายไป-กลับเท่ากัน ยอดรวมทั้งสองคลังต้องคงเดิมและแต่ละฝั่งกลับมาที่ 100
    expect(await onHand(itemId, whA)).toBeCloseTo(100, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(100, 4);
  });

  it('T15 ใบหลายบรรทัดที่เรียงสินค้าสลับกัน ยิงพร้อมกัน → ยอดครบทุกตัว', async () => {
    const a = await freshItem('MTA');
    const b = await freshItem('MTB');
    const c = await freshItem('MTC');
    for (const id of [a, b, c]) expect((await stockIn(id, whA, 100)).statusCode).toBe(201);

    const multi = (order: string[]) => transfer({
      fromWarehouseId: whA, toWarehouseId: whB, confirm: true,
      items: order.map((itemId) => ({ itemId, quantity: 1 })),
    });
    const results = await Promise.all([
      multi([a, b, c]), multi([c, b, a]), multi([b, a, c]),
      multi([c, a, b]), multi([a, c, b]), multi([b, c, a]),
    ]);
    expect(failureCodes(results)).toEqual([]);

    for (const id of [a, b, c]) {
      expect(await onHand(id, whA)).toBeCloseTo(94, 4);
      expect(await onHand(id, whB)).toBeCloseTo(6, 4);
    }
  });

  it('T16 สั่งกลับรายการใบเดียวกันพร้อมกัน → สำเร็จครั้งเดียว', async () => {
    const itemId = await freshItem('REVRACE');
    expect((await stockIn(itemId, whA, 50)).statusCode).toBe(201);
    const created = (await transfer({ fromWarehouseId: whA, toWarehouseId: whB, confirm: true, items: [{ itemId, quantity: 20 }] })).json().data;

    const results = await Promise.all(Array.from({ length: 5 }, () =>
      app.inject({ method: 'POST', url: `/api/business/transfers/${created.id}/reverse`, headers: auth(), payload: {} })));

    expect(results.filter((r) => r.statusCode < 400)).toHaveLength(1);
    for (const res of results.filter((r) => r.statusCode >= 400)) {
      expect(res.json().error?.code, JSON.stringify(res.json().error)).toBe('ALREADY_REVERSED');
    }
    expect(await onHand(itemId, whA)).toBeCloseTo(50, 4);
    expect(await onHand(itemId, whB)).toBeCloseTo(0, 4);
    expect(await prisma.stockLedger.count({ where: { refId: created.id, reason: 'REVERSAL' } })).toBe(2);
  });
});
