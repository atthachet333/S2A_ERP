import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 17 — ยอดคงเหลือภายใต้คำขอพร้อมกัน
 *
 * เกณฑ์ผ่านไม่ใช่ "ไม่มี error" แต่คือ:
 * การเคลื่อนไหวที่ commit แล้วต้องไม่หาย ไม่ซ้ำ และต้องไม่เขียนทับการเคลื่อนไหวอื่นที่ commit แล้ว
 *
 * ทุกเทสต์จึงตรวจสามอย่างคู่กันเสมอ:
 *  1) ยอดปลายทางตรงเป๊ะตามที่คำนวณด้วยมือ
 *  2) จำนวนแถว ledger เท่ากับจำนวนการเคลื่อนไหวที่สำเร็จ ไม่ขาดไม่เกิน
 *  3) โซ่ beforeQty → balanceAfter ของ ledger ต่อกันสนิทเมื่อเรียงตามเวลา
 *     (ข้อนี้คือหลักฐานตรงว่าไม่มี lost update — ถ้ามีสองใบอ่านยอดเดิมค่าเดียวกัน โซ่จะขาด)
 */

const TAG = `sc${Date.now().toString().slice(-7)}`;
const num = (d: unknown) => Number(d);

describe.sequential('stock balance concurrency', () => {
  let app: FastifyInstance;
  let token = '';
  let companyId = '';
  let warehouseId = '';
  let unitCode = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  /** สินค้าใหม่ต่อหนึ่งเทสต์ เพื่อให้แต่ละเทสต์มีแถวยอดคงเหลือของตัวเองและรันซ้ำได้ */
  const freshItem = async (name: string) =>
    (await prisma.item.create({
      data: { companyId, code: `${name}_${TAG}`, name: `วัตถุดิบ ${name}`, type: ItemType.RAW_MATERIAL, baseUnitId: unitId, lastCost: 1 },
    })).id;
  let unitId = '';

  const receive = (itemId: string, quantity: number, note?: string) => app.inject({
    method: 'POST', url: '/api/business/receiving', headers: auth(),
    payload: { warehouseId, confirm: true, note, items: [{ itemId, quantity, unitPrice: 1 }] },
  });

  const issue = (itemId: string, qty: number, key: string) => app.inject({
    method: 'POST', url: '/api/business/stock-issues', headers: auth(),
    payload: { warehouseId, confirm: true, idempotencyKey: key, items: [{ itemId, issuedQty: qty, unit: unitCode, baseQty: qty }] },
  });

  const adjust = (itemId: string, mode: 'INCREASE' | 'DECREASE' | 'SET', quantity: number) => app.inject({
    method: 'POST', url: '/api/business/inventory/adjustments', headers: auth(),
    payload: { warehouseId, reason: 'COUNT', items: [{ itemId, mode, quantity }] },
  });

  const onHandOf = async (itemId: string) => {
    const row = await prisma.stockBalance.findFirst({ where: { itemId, warehouseId } });
    return row ? num(row.onHand) : 0;
  };

  /** ledger ของสินค้าหนึ่งตัว เรียงตามเวลาเกิดจริง */
  const ledgerOf = (itemId: string) =>
    prisma.stockLedger.findMany({ where: { itemId, warehouseId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  /**
   * โซ่ของ ledger ต้องต่อกันสนิท: balanceAfter ของแถวก่อนหน้า = beforeQty ของแถวถัดไป
   * และแต่ละแถวต้องเป็นจริงว่า before + qtyIn - qtyOut = balanceAfter
   */
  async function expectLedgerChainIsConsistent(itemId: string, expectedRows: number, expectedFinal: number) {
    const rows = await ledgerOf(itemId);
    expect(rows).toHaveLength(expectedRows);

    // เรียงตาม beforeQty ไม่ได้ เพราะยอดขึ้นลงสลับกันได้ จึงตรวจว่าเซตของ (before → after) ต่อกันเป็นสายเดียว
    const byBefore = new Map<number, typeof rows>();
    for (const row of rows) {
      const key = Number(num(row.beforeQty).toFixed(4));
      byBefore.set(key, [...(byBefore.get(key) ?? []), row]);
    }

    let cursor = 0;
    const visited = new Set<string>();
    for (let step = 0; step < rows.length; step += 1) {
      const candidates = (byBefore.get(Number(cursor.toFixed(4))) ?? []).filter((r) => !visited.has(r.id));
      expect(candidates.length, `โซ่ ledger ขาดที่ยอด ${cursor} (ขั้นที่ ${step + 1}/${rows.length})`).toBeGreaterThan(0);
      const row = candidates[0];
      visited.add(row.id);
      const after = num(row.beforeQty) + num(row.qtyIn) - num(row.qtyOut);
      expect(after).toBeCloseTo(num(row.balanceAfter), 4);
      cursor = num(row.balanceAfter);
    }
    expect(visited.size).toBe(rows.length);
    expect(cursor).toBeCloseTo(expectedFinal, 4);
    expect(await onHandOf(itemId)).toBeCloseTo(expectedFinal, 4);
  }

  /** คำขอที่ล้มต้องล้มด้วยเหตุผลทางธุรกิจ ไม่ใช่ 500 จากการชนล็อก */
  const failureCodes = (results: { statusCode: number; json: () => { error?: { code?: string } } }[]) =>
    results.filter((r) => r.statusCode >= 400).map((r) => `${r.statusCode} ${r.json().error?.code ?? ''}`.trim());

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;

    const passwordHash = await bcrypt.hash('StockPass123!', 10);
    const user = await prisma.user.upsert({
      where: { username: `stock_${TAG}` },
      update: { passwordHash, isActive: true, mustChangePassword: false, deletedAt: null },
      create: { username: `stock_${TAG}`, email: `stock_${TAG}@s2a.local`, passwordHash, fullName: 'ผู้ทดสอบสต็อก', isActive: true, mustChangePassword: false },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      update: { roleId: role.id }, create: { userId: user.id, companyId, roleId: role.id, isDefault: true },
    });

    app = await buildApp();
    await app.ready();
    token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `stock_${TAG}`, password: 'StockPass123!' } })).json().data.accessToken;

    const unit = await prisma.unit.upsert({ where: { code: `SU2_${TAG}` }, update: {}, create: { code: `SU2_${TAG}`, name: 'หน่วยสต็อก' } });
    unitId = unit.id; unitCode = unit.code;
    warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `SCW_${TAG}`, name: 'คลังทดสอบพร้อมกัน' } })).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /* ============================ §4 รับของพร้อมกัน ============================ */
  it('S1 รับของ 10 ใบ ใบละ 1 หน่วย พร้อมกัน → ยอดต้องเป็น 10 พอดี', async () => {
    const itemId = await freshItem('RECV');
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => receive(itemId, 1, `ใบที่ ${i}`)));
    expect(failureCodes(results)).toEqual([]);

    await expectLedgerChainIsConsistent(itemId, 10, 10);
    expect(await prisma.goodsReceipt.count({ where: { items: { some: { itemId } } } })).toBe(10);
  });

  /* ============================ §5 เบิกพร้อมกัน ============================ */
  it('S2 มีของ 100 เบิกพร้อมกัน 10 ใบ ใบละ 5 → ยอดต้องเหลือ 50 พอดี', async () => {
    const itemId = await freshItem('ISSUE');
    expect((await receive(itemId, 100)).statusCode).toBe(201);

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => issue(itemId, 5, `${TAG}-s2-${i}`)));
    expect(failureCodes(results)).toEqual([]);

    // 1 แถวจากการรับของ + 10 แถวจากการเบิก
    await expectLedgerChainIsConsistent(itemId, 11, 50);
  });

  /* ==================== §6 ของไม่พอเมื่อแย่งกันเบิก ==================== */
  it('S3 มีของ 10 เบิกพร้อมกัน 10 ใบ ใบละ 2 → สำเร็จ 5 ใบ ยอดเหลือ 0 และห้ามติดลบ', async () => {
    const itemId = await freshItem('SHORT');
    expect((await receive(itemId, 10)).statusCode).toBe(201);

    const results = await Promise.all(Array.from({ length: 10 }, (_, i) => issue(itemId, 2, `${TAG}-s3-${i}`)));
    const okCount = results.filter((r) => r.statusCode < 400).length;
    const failed = results.filter((r) => r.statusCode >= 400);

    expect(okCount).toBe(5);
    expect(failed).toHaveLength(5);
    // ใบที่ล้มต้องล้มเพราะของไม่พอ ไม่ใช่เพราะชนล็อกแล้วหลุดเป็น 500
    for (const res of failed) expect(res.json().error?.code, JSON.stringify(res.json().error)).toBe('INSUFFICIENT_STOCK');

    const finalOnHand = await onHandOf(itemId);
    expect(finalOnHand).toBeCloseTo(0, 4);
    expect(finalOnHand).toBeGreaterThanOrEqual(0);

    // ใบที่ล้มต้องไม่ทิ้งเอกสารหรือ ledger ไว้เลย
    await expectLedgerChainIsConsistent(itemId, 1 + okCount, 0);
    expect(await prisma.stockIssue.count({ where: { items: { some: { itemId } } } })).toBe(okCount);
  });

  /* ==================== §7 รับและเบิกปนกัน (สำคัญที่สุด) ==================== */
  it('S4 เริ่มที่ 100 รับ 5 ใบ ใบละ +10 และเบิก 5 ใบ ใบละ -5 พร้อมกัน → 125 พอดี', async () => {
    const itemId = await freshItem('MIXED');
    expect((await receive(itemId, 100)).statusCode).toBe(201);

    const work = [
      ...Array.from({ length: 5 }, (_, i) => () => receive(itemId, 10, `เข้า ${i}`)),
      ...Array.from({ length: 5 }, (_, i) => () => issue(itemId, 5, `${TAG}-s4-${i}`)),
    ];
    const results = await Promise.all(work.map((run) => run()));
    expect(failureCodes(results)).toEqual([]);

    // 1 (ตั้งต้น) + 5 (รับ) + 5 (เบิก) = 11 แถว, ยอด 100 + 50 - 25 = 125
    await expectLedgerChainIsConsistent(itemId, 11, 125);
  });

  /* ============================ §8 ปรับปรุงสต็อกพร้อมกัน ============================ */
  it('S5 เพิ่ม + เพิ่ม พร้อมกัน → บวกสะสมครบทุกใบ', async () => {
    const itemId = await freshItem('ADJADD');
    expect((await receive(itemId, 20)).statusCode).toBe(201);

    const results = await Promise.all(Array.from({ length: 6 }, () => adjust(itemId, 'INCREASE', 3)));
    expect(failureCodes(results)).toEqual([]);
    await expectLedgerChainIsConsistent(itemId, 7, 20 + 18);
  });

  it('S6 เพิ่ม + ลด พร้อมกัน → ผลรวมสุทธิถูกต้อง', async () => {
    const itemId = await freshItem('ADJMIX');
    expect((await receive(itemId, 50)).statusCode).toBe(201);

    const work = [
      ...Array.from({ length: 4 }, () => () => adjust(itemId, 'INCREASE', 5)),
      ...Array.from({ length: 4 }, () => () => adjust(itemId, 'DECREASE', 2)),
    ];
    const results = await Promise.all(work.map((run) => run()));
    expect(failureCodes(results)).toEqual([]);
    await expectLedgerChainIsConsistent(itemId, 9, 50 + 20 - 8);
  });

  it('S7 SET พร้อมกับการเคลื่อนไหวอื่น → SET ต้องคิดจากยอดที่ล็อกไว้ ไม่ทับของคนอื่นแบบเงียบ', async () => {
    const itemId = await freshItem('ADJSET');
    expect((await receive(itemId, 30)).statusCode).toBe(201);

    /* SET = "นับจริงได้เท่านี้" ระบบจึงเขียน movement เท่ากับส่วนต่างจากยอดปัจจุบัน (ไม่ใช่เขียนทับยอด)
       ภายใต้การล็อกแถว ใบที่ทำทีหลังจะเห็นยอดหลังใบแรกเสมอ ผลลัพธ์จึงขึ้นกับลำดับที่ commit จริง
       แต่ไม่ว่าลำดับใด โซ่ ledger ต้องต่อกันสนิทและยอดสุดท้ายต้องตรงกับ movement ทั้งหมดรวมกัน */
    const results = await Promise.all([
      adjust(itemId, 'SET', 100),
      adjust(itemId, 'INCREASE', 7),
    ]);
    expect(failureCodes(results)).toEqual([]);

    const rows = await ledgerOf(itemId);
    const net = rows.reduce((sum, r) => sum + num(r.qtyIn) - num(r.qtyOut), 0);
    const finalOnHand = await onHandOf(itemId);
    expect(finalOnHand).toBeCloseTo(net, 4);

    // ผลลัพธ์ที่ถูกต้องมีได้สองแบบตามลำดับที่ commit และต้องเป็นหนึ่งในนั้นเสมอ
    //   SET ก่อน แล้วบวก 7 → 107   ·   บวก 7 ก่อน แล้ว SET → 100
    expect([100, 107]).toContain(Number(finalOnHand.toFixed(4)));
    await expectLedgerChainIsConsistent(itemId, rows.length, finalOnHand);

    // ใบ SET ต้องบันทึกยอดระบบที่ใช้คิดส่วนต่างไว้จริง และส่วนต่างต้องสอดคล้องกัน
    const setLine = await prisma.stockAdjustmentItem.findFirstOrThrow({
      where: { itemId, countedQty: 100 },
    });
    expect(num(setLine.systemQty) + num(setLine.diffQty)).toBeCloseTo(num(setLine.countedQty), 4);
  });

  /* ============================ §9 กลับรายการพร้อมกัน ============================ */
  it('S8 สั่งกลับรายการใบเดียวกันพร้อมกัน 5 ครั้ง → คืนสต็อกครั้งเดียวเท่านั้น', async () => {
    const itemId = await freshItem('REVERSE');
    expect((await receive(itemId, 40)).statusCode).toBe(201);

    const created = await issue(itemId, 15, `${TAG}-s8`);
    expect(created.statusCode).toBe(201);
    const issueId = created.json().data.id as string;
    expect(await onHandOf(itemId)).toBeCloseTo(25, 4);

    const results = await Promise.all(Array.from({ length: 5 }, () => app.inject({
      method: 'POST', url: `/api/business/stock-issues/${issueId}/reverse`, headers: auth(), payload: { reason: 'ทดสอบกลับรายการซ้ำ' },
    })));

    // สัญญาเดิมของ backend: ใบที่กลับไปแล้วจะถูกปฏิเสธ ไม่ใช่ทำซ้ำเงียบ ๆ
    const okCount = results.filter((r) => r.statusCode < 400).length;
    expect(okCount).toBe(1);
    for (const res of results.filter((r) => r.statusCode >= 400)) {
      expect(res.json().error?.code, JSON.stringify(res.json().error)).toBe('ALREADY_REVERSED');
    }

    // คืนของครั้งเดียว: 40 - 15 + 15 = 40 และมี ledger ขากลับแถวเดียว
    expect(await onHandOf(itemId)).toBeCloseTo(40, 4);
    const reversals = await prisma.stockLedger.findMany({ where: { itemId, reason: 'REVERSAL' } });
    expect(reversals).toHaveLength(1);
    await expectLedgerChainIsConsistent(itemId, 3, 40);
  });

  /* ==================== §12 ล็อกหลายบรรทัดตามลำดับเดียวกัน ==================== */
  it('S9 ใบหลายบรรทัดที่เรียงสินค้าสลับกัน ต้องไม่ล็อกวนตาย และยอดต้องครบทุกตัว', async () => {
    const a = await freshItem('MLA');
    const b = await freshItem('MLB');
    const c = await freshItem('MLC');
    for (const id of [a, b, c]) expect((await receive(id, 100)).statusCode).toBe(201);

    const multi = (order: string[], key: string) => app.inject({
      method: 'POST', url: '/api/business/stock-issues', headers: auth(),
      payload: {
        warehouseId, confirm: true, idempotencyKey: key,
        items: order.map((itemId) => ({ itemId, issuedQty: 1, unit: unitCode, baseQty: 1 })),
      },
    });

    // ใบที่แตะสินค้าชุดเดียวกันแต่คนละลำดับ — เคสคลาสสิกที่ทำให้เกิด deadlock
    const results = await Promise.all([
      multi([a, b, c], `${TAG}-s9-1`), multi([c, b, a], `${TAG}-s9-2`),
      multi([b, a, c], `${TAG}-s9-3`), multi([c, a, b], `${TAG}-s9-4`),
      multi([a, c, b], `${TAG}-s9-5`), multi([b, c, a], `${TAG}-s9-6`),
    ]);
    expect(failureCodes(results)).toEqual([]);

    for (const id of [a, b, c]) await expectLedgerChainIsConsistent(id, 7, 94);
  });
});
