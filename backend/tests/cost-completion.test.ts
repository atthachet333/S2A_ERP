import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 21 — เติมข้อมูลต้นทุน (ฝั่ง backend)
 *
 * แยกให้ชัดสองสถานะ:
 *   MISSING  ยังไม่เคยมีใครใส่ราคา → ต้องเตือน
 *   ZERO     ยืนยันแล้วว่าเป็น 0 จริง → ไม่ต้องเตือนอีก
 *
 * ไม่มีเทสต์ไหนสมมติราคาของวัตถุดิบจริงในฐานผลิต ทุกค่าที่ใช้เป็นของที่สร้างในเทสต์เอง
 */

const TAG = `cc${Date.now().toString().slice(-7)}`;
const num = (v: unknown) => Number(v);

describe.sequential('cost completion', () => {
  let app: FastifyInstance;
  let token = '';
  let viewerToken = '';
  let otherToken = '';
  let companyId = '';
  let otherCompanyId = '';
  let gId = '';
  let kgId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  const mkItem = async (code: string, over: Record<string, unknown> = {}) =>
    (await prisma.item.create({
      data: { companyId, code: `${code}_${TAG}`, name: `ของทดสอบ ${code}`, type: ItemType.RAW_MATERIAL, baseUnitId: gId, ...over },
    })).id;

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;
    otherCompanyId = (await prisma.company.create({ data: { code: `CCB_${TAG}`, nameTh: 'บริษัทอื่น' } })).id;

    const mk = async (username: string, roleId: string, company: string) => {
      const passwordHash = await bcrypt.hash('CostPass123!', 10);
      const user = await prisma.user.upsert({
        where: { username },
        update: { passwordHash, isActive: true, mustChangePassword: false, deletedAt: null },
        create: { username, email: `${username}@s2a.local`, passwordHash, fullName: username, isActive: true, mustChangePassword: false },
      });
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId } }, update: {}, create: { userId: user.id, roleId } });
      await prisma.companyMembership.upsert({
        where: { userId_companyId: { userId: user.id, companyId: company } },
        update: { roleId }, create: { userId: user.id, companyId: company, roleId, isDefault: true },
      });
    };
    await mk(`ccadmin_${TAG}`, superRole.id, companyId);
    await mk(`ccviewer_${TAG}`, viewerRole.id, companyId);
    await mk(`ccother_${TAG}`, superRole.id, otherCompanyId);

    app = await buildApp();
    await app.ready();
    const login = async (u: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: 'CostPass123!' } })).json().data.accessToken as string;
    token = await login(`ccadmin_${TAG}`);
    viewerToken = await login(`ccviewer_${TAG}`);
    otherToken = await login(`ccother_${TAG}`);

    gId = (await prisma.unit.upsert({ where: { code: `CG_${TAG}` }, update: {}, create: { code: `CG_${TAG}`, name: 'กรัม(ทดสอบ)' } })).id;
    kgId = (await prisma.unit.upsert({ where: { code: `CKG_${TAG}` }, update: {}, create: { code: `CKG_${TAG}`, name: 'กิโลกรัม(ทดสอบ)' } })).id;
    await prisma.unitConversion.create({ data: { fromUnitId: kgId, toUnitId: gId, factor: 1000 } });
  });

  afterAll(async () => {
    await prisma.itemPriceHistory.deleteMany({ where: { item: { code: { contains: TAG } } } });
    await prisma.item.deleteMany({ where: { code: { contains: TAG } } });
    await prisma.unitConversion.deleteMany({ where: { fromUnitId: kgId } });
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('P1 รายการที่ยังไม่เคยมีราคา = MISSING และปรากฏในรายการที่ต้องเติม', async () => {
    const id = await mkItem('MISS');
    const res = await app.inject({ method: 'GET', url: '/api/items/cost-completion', headers: auth() });
    expect(res.statusCode).toBe(200);
    const row = (res.json().data.rows as { id: string; costStatus: string }[]).find((r) => r.id === id);
    expect(row?.costStatus).toBe('MISSING');
  });

  it('P2 ยืนยันต้นทุน 0 แล้วต้องกลายเป็น ZERO และหลุดออกจากรายการที่ต้องเติม', async () => {
    const id = await mkItem('ZERO');
    const save = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: auth(),
      payload: { rows: [{ itemId: id, purchasePrice: 0, purchaseQuantity: 1, explicitZero: true, zeroReason: 'น้ำประปา' }] },
    });
    expect(save.statusCode).toBe(200);

    const after = await app.inject({ method: 'GET', url: '/api/items/cost-completion', headers: auth() });
    const rows = after.json().data.rows as { id: string }[];
    expect(rows.map((r) => r.id), 'ยืนยันแล้วต้องไม่ค้างอยู่ในรายการที่ต้องเติมอีก').not.toContain(id);

    // ยังเป็นต้นทุน 0 อยู่ แต่มีหลักฐานว่ามีคนตัดสินใจแล้ว
    const item = await prisma.item.findUniqueOrThrow({ where: { id } });
    expect(num(item.lastCost)).toBe(0);
    const history = await prisma.itemPriceHistory.findFirstOrThrow({ where: { itemId: id } });
    expect(num(history.price)).toBe(0);
    expect(history.source).toBe('EXPLICIT_ZERO');
    expect(String(history.note)).toContain('น้ำประปา');
  });

  it('P3 ใส่ 0 โดยไม่ยืนยัน ต้องถูกปฏิเสธ และไม่มีอะไรถูกเขียน', async () => {
    const id = await mkItem('NOCONF');
    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: auth(),
      payload: { rows: [{ itemId: id, purchasePrice: 0, purchaseQuantity: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('ROW_VALIDATION_FAILED');
    expect(JSON.stringify(res.json().error.details)).toContain('ZERO_NOT_CONFIRMED');
    expect(await prisma.itemPriceHistory.count({ where: { itemId: id } })).toBe(0);
  });

  it('P4 บันทึกหลายรายการพร้อมกันด้วยสูตรเดียวกับทั้งระบบ', async () => {
    const a = await mkItem('BULKA', { purchaseUnitId: kgId, purchaseToBaseFactor: 1000 });
    const b = await mkItem('BULKB', { purchaseUnitId: kgId, purchaseToBaseFactor: 1000 });
    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: auth(),
      payload: { rows: [
        { itemId: a, purchasePrice: 350, purchaseQuantity: 1 },   // 350 ÷ 1 ÷ 1000 = 0.35
        { itemId: b, purchasePrice: 700, purchaseQuantity: 2 },   // 700 ÷ 2 ÷ 1000 = 0.35
      ] },
    });
    expect(res.statusCode).toBe(200);
    expect(num((await prisma.item.findUniqueOrThrow({ where: { id: a } })).lastCost)).toBeCloseTo(0.35, 10);
    expect(num((await prisma.item.findUniqueOrThrow({ where: { id: b } })).lastCost)).toBeCloseTo(0.35, 10);
  });

  it('P5 มีแถวใดผิด = ไม่เขียนเลยแม้แต่แถวเดียว (ไม่สำเร็จบางส่วนเงียบ ๆ)', async () => {
    const good = await mkItem('PARTOK', { purchaseUnitId: kgId, purchaseToBaseFactor: 1000 });
    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: auth(),
      payload: { rows: [
        { itemId: good, purchasePrice: 500, purchaseQuantity: 1 },
        { itemId: 'ไม่มีรายการนี้', purchasePrice: 100, purchaseQuantity: 1 },
      ] },
    });
    expect(res.statusCode).toBe(400);
    expect(num((await prisma.item.findUniqueOrThrow({ where: { id: good } })).lastCost), 'แถวที่ถูกต้องต้องไม่ถูกเขียน').toBe(0);
    expect(await prisma.itemPriceHistory.count({ where: { itemId: good } })).toBe(0);
  });

  it('P6 รายการซ้ำในคำขอเดียวต้องถูกปฏิเสธ', async () => {
    const id = await mkItem('DUP');
    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: auth(),
      payload: { rows: [{ itemId: id, purchasePrice: 10, purchaseQuantity: 1 }, { itemId: id, purchasePrice: 20, purchaseQuantity: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('DUPLICATE_ROW');
  });

  it('P7 ขอบเขตบริษัท — บันทึกราคาให้วัตถุดิบของบริษัทอื่นไม่ได้', async () => {
    const mine = await mkItem('SCOPE');
    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: { authorization: `Bearer ${otherToken}` },
      payload: { rows: [{ itemId: mine, purchasePrice: 99, purchaseQuantity: 1 }] },
    });
    expect(res.statusCode).toBe(400);
    expect(JSON.stringify(res.json().error.details)).toContain('NOT_FOUND');
    expect(num((await prisma.item.findUniqueOrThrow({ where: { id: mine } })).lastCost)).toBe(0);

    // และรายการของบริษัทเราต้องไม่โผล่ในรายการของบริษัทอื่น
    const list = await app.inject({ method: 'GET', url: '/api/items/cost-completion', headers: { authorization: `Bearer ${otherToken}` } });
    expect((list.json().data.rows as { id: string }[]).map((r) => r.id)).not.toContain(mine);
  });

  it('P8 สิทธิ์ — ผู้ใช้ที่ไม่มีสิทธิ์แก้ไขบันทึกไม่ได้', async () => {
    const id = await mkItem('PERM');
    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: { authorization: `Bearer ${viewerToken}` },
      payload: { rows: [{ itemId: id, purchasePrice: 50, purchaseQuantity: 1 }] },
    });
    expect(res.statusCode).toBe(403);
    expect(await prisma.itemPriceHistory.count({ where: { itemId: id } })).toBe(0);
  });

  it('P9 ต้นทุนที่บันทึกยังผ่านการแปลงหน่วยเดิม — 47 บาท/L → 0.047/ML', async () => {
    const ml = (await prisma.unit.upsert({ where: { code: `CML_${TAG}` }, update: {}, create: { code: `CML_${TAG}`, name: 'มล.(ทดสอบ)' } })).id;
    const l = (await prisma.unit.upsert({ where: { code: `CL_${TAG}` }, update: {}, create: { code: `CL_${TAG}`, name: 'ลิตร(ทดสอบ)' } })).id;
    const id = (await prisma.item.create({ data: { companyId, code: `OIL_${TAG}`, name: 'น้ำมัน(ทดสอบ)', type: ItemType.RAW_MATERIAL, baseUnitId: ml, purchaseUnitId: l, purchaseToBaseFactor: 1000 } })).id;

    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: auth(),
      payload: { rows: [{ itemId: id, purchasePrice: 47, purchaseQuantity: 1 }] },
    });
    expect(res.statusCode).toBe(200);
    expect(num((await prisma.item.findUniqueOrThrow({ where: { id } })).lastCost)).toBeCloseTo(0.047, 10);
    await prisma.itemPriceHistory.deleteMany({ where: { itemId: id } });
    await prisma.item.deleteMany({ where: { id } });
    await prisma.unit.deleteMany({ where: { id: { in: [ml, l] } } });
  });

  it('P10 บันทึกราคาแล้วต้องไม่แตะประวัติหรือ snapshot ใด ๆ', async () => {
    const before = {
      ledgers: await prisma.stockLedger.count(),
      receipts: await prisma.goodsReceiptItem.count(),
      recipeCosts: await prisma.recipeCost.count(),
      recipeVersions: await prisma.recipeVersion.count(),
      orderItems: await prisma.salesOrderItem.count(),
    };
    const id = await mkItem('HIST', { purchaseUnitId: kgId, purchaseToBaseFactor: 1000 });
    const res = await app.inject({
      method: 'POST', url: '/api/items/cost-completion', headers: auth(),
      payload: { rows: [{ itemId: id, purchasePrice: 120, purchaseQuantity: 1 }] },
    });
    expect(res.statusCode).toBe(200);

    expect({
      ledgers: await prisma.stockLedger.count(),
      receipts: await prisma.goodsReceiptItem.count(),
      recipeCosts: await prisma.recipeCost.count(),
      recipeVersions: await prisma.recipeVersion.count(),
      orderItems: await prisma.salesOrderItem.count(),
    }, 'ประวัติและ snapshot ต้องไม่ขยับเลย').toEqual(before);
  });

  it('P11 ความครบถ้วนของสูตร — ยืนยันศูนย์นับเป็นครบ ไม่ใช่ขาด', async () => {
    const missing = await mkItem('RCMISS');
    const zero = await mkItem('RCZERO');
    const priced = await mkItem('RCPRICE', { lastCost: 2 });
    await prisma.itemPriceHistory.create({ data: { companyId, itemId: zero, price: 0, source: 'EXPLICIT_ZERO' } });
    await prisma.itemPriceHistory.create({ data: { companyId, itemId: priced, price: 2, source: 'PURCHASE' } });

    const menu = await prisma.item.create({ data: { companyId, code: `RCMENU_${TAG}`, name: 'เมนูทดสอบความครบ', type: ItemType.FINISHED_GOOD, baseUnitId: gId } });
    const recipe = await prisma.recipe.create({ data: { companyId, productId: menu.id, code: `RCP_${TAG}`, name: 'สูตรทดสอบความครบ' } });
    const version = await prisma.recipeVersion.create({ data: { recipeId: recipe.id, versionNo: 1, isActive: true, standardYieldQty: 1, yieldPercent: 100 } });
    for (const itemId of [missing, zero, priced]) {
      await prisma.recipeIngredient.create({ data: { recipeVersionId: version.id, itemId, quantity: 1, unitId: gId } });
    }

    const res = await app.inject({ method: 'GET', url: '/api/costing/completeness', headers: auth() });
    expect(res.statusCode).toBe(200);
    const row = (res.json().data.rows as { recipeVersionId: string; total: number; priced: number; explicitZero: number; missing: number; percent: number; complete: boolean; missingItems: { id: string }[] }[])
      .find((r) => r.recipeVersionId === version.id);
    expect(row).toBeDefined();
    expect(row!.total).toBe(3);
    expect(row!.priced).toBe(1);
    expect(row!.explicitZero).toBe(1);
    expect(row!.missing).toBe(1);
    expect(row!.percent).toBe(67);            // 2 ใน 3 รายการมีข้อมูลแล้ว
    expect(row!.complete).toBe(false);        // ยังมีของที่ไม่รู้ต้นทุน จึงบอกว่าครบไม่ได้
    expect(row!.missingItems.map((m) => m.id)).toEqual([missing]);

    await prisma.recipeIngredient.deleteMany({ where: { recipeVersionId: version.id } });
    await prisma.recipeVersion.deleteMany({ where: { id: version.id } });
    await prisma.recipe.deleteMany({ where: { id: recipe.id } });
  });

  it('P12 ราคา 0 ผ่านเส้นทางบันทึกราคาเดิมก็ต้องยืนยันเหมือนกัน', async () => {
    const id = await mkItem('SINGLE');
    const noConfirm = await app.inject({
      method: 'POST', url: `/api/items/${id}/prices`, headers: auth(),
      payload: { purchasePrice: 0, purchaseQuantity: 1 },
    });
    expect(noConfirm.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.itemPriceHistory.count({ where: { itemId: id } })).toBe(0);

    const confirmed = await app.inject({
      method: 'POST', url: `/api/items/${id}/prices`, headers: auth(),
      payload: { purchasePrice: 0, purchaseQuantity: 1, explicitZero: true, zeroReason: 'ได้รับฟรี' },
    });
    expect(confirmed.statusCode).toBeLessThan(400);
    expect((await prisma.itemPriceHistory.findFirstOrThrow({ where: { itemId: id } })).source).toBe('EXPLICIT_ZERO');
  });
});
