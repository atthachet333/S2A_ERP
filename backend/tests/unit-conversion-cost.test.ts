import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 20 — อัตราแปลงหน่วยและต้นทุนต่อหน่วยฐาน (ฝั่ง backend)
 *
 * ความหมายที่ระบบยึด: purchaseToBaseFactor = "หนึ่งหน่วยซื้อ มีกี่หน่วยฐาน"
 *   1 KG = 1,000 G → factor = 1000
 *   ต้นทุน = ราคา ÷ จำนวนที่ซื้อ ÷ factor
 *
 * บั๊กที่แก้ในเฟสนี้อยู่ฝั่งหน้าจอ แต่ backend ต้องกันค่าผิดทิศไว้ด้วย
 * เพราะการตรวจที่หน้าจออย่างเดียวไม่ใช่การป้องกัน
 */

const TAG = `uc${Date.now().toString().slice(-7)}`;
const num = (v: unknown) => Number(v);

describe.sequential('unit conversion + cost', () => {
  let app: FastifyInstance;
  let token = '';
  let companyId = '';
  let kgId = '';
  let gId = '';
  let lId = '';
  let mlId = '';
  let sackId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  const createItem = (payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/api/items', headers: auth(), payload });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;

    const passwordHash = await bcrypt.hash('ConvPass123!', 10);
    const user = await prisma.user.upsert({
      where: { username: `conv_${TAG}` },
      update: { passwordHash, isActive: true, mustChangePassword: false, deletedAt: null },
      create: { username: `conv_${TAG}`, email: `conv_${TAG}@s2a.local`, passwordHash, fullName: 'Conversion Tester', isActive: true, mustChangePassword: false },
    });
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    await prisma.companyMembership.upsert({
      where: { userId_companyId: { userId: user.id, companyId } },
      update: { roleId: role.id }, create: { userId: user.id, companyId, roleId: role.id, isDefault: true },
    });

    app = await buildApp();
    await app.ready();
    token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `conv_${TAG}`, password: 'ConvPass123!' } })).json().data.accessToken;

    const unit = async (code: string, name: string) =>
      (await prisma.unit.upsert({ where: { code: `${code}_${TAG}` }, update: {}, create: { code: `${code}_${TAG}`, name } })).id;
    kgId = await unit('KG', 'กิโลกรัม(ทดสอบ)');
    gId = await unit('G', 'กรัม(ทดสอบ)');
    lId = await unit('L', 'ลิตร(ทดสอบ)');
    mlId = await unit('ML', 'มิลลิลิตร(ทดสอบ)');
    sackId = await unit('SACK', 'กระสอบ(ทดสอบ)');

    // เก็บแถวเดียวต่อคู่หน่วย ทิศกลับระบบสร้างเอง — ตรงกับข้อมูลจริงในฐานผลิต
    await prisma.unitConversion.create({ data: { fromUnitId: kgId, toUnitId: gId, factor: 1000 } });
    await prisma.unitConversion.create({ data: { fromUnitId: lId, toUnitId: mlId, factor: 1000 } });
  });

  afterAll(async () => {
    await prisma.itemPriceHistory.deleteMany({ where: { item: { code: { startsWith: `UC-${TAG}` } } } });
    await prisma.auditLog.deleteMany({ where: { entity: 'Item', after: { path: '$.code', string_starts_with: `UC-${TAG}` } } }).catch(() => undefined);
    await prisma.item.deleteMany({ where: { code: { startsWith: `UC-${TAG}` } } });
    await prisma.unitConversion.deleteMany({ where: { OR: [{ fromUnitId: kgId }, { fromUnitId: lId }] } });
    if (app) await app.close();
    await prisma.$disconnect();
  });

  it('A · 350 บาท ซื้อ 1 KG สูตรใช้ G → 0.35 บาท/G', async () => {
    const res = await createItem({
      code: `UC-${TAG}-A`, name: 'พริกไทย(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 1000,
      purchasePrice: 350, purchaseQuantity: 1,
    });
    expect(res.statusCode).toBe(201);
    expect(num(res.json().data.lastCost)).toBeCloseTo(0.35, 10);
    // อาการเดิมที่ต้องไม่กลับมา
    expect(num(res.json().data.lastCost)).not.toBeCloseTo(350_000, 0);
  });

  it('B · 700 บาท ซื้อ 2 KG สูตรใช้ G → ยัง 0.35 บาท/G และอัตรายังเป็น 1000', async () => {
    const res = await createItem({
      code: `UC-${TAG}-B`, name: 'พริกไทยถุงใหญ่(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 1000,
      purchasePrice: 700, purchaseQuantity: 2,
    });
    expect(res.statusCode).toBe(201);
    expect(num(res.json().data.lastCost)).toBeCloseTo(0.35, 10);
    // จำนวนที่ซื้อต้องไม่ถูกกลืนเข้าไปในอัตราแปลง
    expect(num(res.json().data.purchaseToBaseFactor)).toBe(1000);
  });

  it('C · 47 บาท ซื้อ 1 L สูตรใช้ ML → 0.047 บาท/ML', async () => {
    const res = await createItem({
      code: `UC-${TAG}-C`, name: 'น้ำมันพืช(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: mlId, purchaseUnitId: lId, purchaseToBaseFactor: 1000,
      purchasePrice: 47, purchaseQuantity: 1,
    });
    expect(res.statusCode).toBe(201);
    expect(num(res.json().data.lastCost)).toBeCloseTo(0.047, 10);
  });

  it('H · อัตราเฉพาะวัตถุดิบยังบันทึกได้ 1 กระสอบ = 25 KG', async () => {
    const res = await createItem({
      code: `UC-${TAG}-H`, name: 'ข้าวสารกระสอบ(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: kgId, purchaseUnitId: sackId, purchaseToBaseFactor: 25,
      purchasePrice: 750, purchaseQuantity: 1,
    });
    expect(res.statusCode).toBe(201);
    expect(num(res.json().data.purchaseToBaseFactor)).toBe(25);
    expect(num(res.json().data.lastCost)).toBeCloseTo(30, 10);   // 750 ÷ 1 ÷ 25
  });

  it('I · หน่วยซื้อเดียวกับหน่วยฐาน → อัตรา 1 และต้นทุนเท่าราคา', async () => {
    const res = await createItem({
      code: `UC-${TAG}-I`, name: 'ของชั่งกิโล(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: kgId, purchaseUnitId: kgId, purchaseToBaseFactor: 1,
      purchasePrice: 120, purchaseQuantity: 1,
    });
    expect(res.statusCode).toBe(201);
    expect(num(res.json().data.lastCost)).toBeCloseTo(120, 10);
  });

  /* ---------- J: backend ต้องปฏิเสธอัตราที่ขัดกับมาตรฐาน ---------- */

  it('J · สร้างวัตถุดิบ KG→G ด้วยอัตรา 0.001 ต้องถูกปฏิเสธ', async () => {
    const res = await createItem({
      code: `UC-${TAG}-J`, name: 'อัตราผิดทิศ(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 0.001,
      purchasePrice: 350, purchaseQuantity: 1,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONVERSION_FACTOR_CONFLICT');
    expect(res.json().error.message).toContain('1,000');
    // ต้องไม่มีรายการค้างไว้ในฐานข้อมูล
    expect(await prisma.item.count({ where: { code: `UC-${TAG}-J` } })).toBe(0);
  });

  it('J2 · อัตราที่ไม่ตรงมาตรฐานแบบอื่นก็ต้องถูกปฏิเสธเช่นกัน', async () => {
    for (const factor of [500, 1, 1_000_000]) {
      const res = await createItem({
        code: `UC-${TAG}-J2-${factor}`, name: 'อัตราเพี้ยน(ทดสอบ)', type: ItemType.RAW_MATERIAL,
        baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: factor,
      });
      expect(res.statusCode, `factor ${factor}`).toBe(400);
      expect(res.json().error.code).toBe('CONVERSION_FACTOR_CONFLICT');
    }
  });

  it('J3 · ค่าที่ไม่ใช่จำนวนบวกต้องถูกปฏิเสธตั้งแต่ schema', async () => {
    for (const factor of [0, -5]) {
      const res = await createItem({
        code: `UC-${TAG}-J3`, name: 'อัตราติดลบ(ทดสอบ)', type: ItemType.RAW_MATERIAL,
        baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: factor,
      });
      expect(res.statusCode, `factor ${factor}`).toBeGreaterThanOrEqual(400);
    }
    // จำนวนที่ซื้อต้องมากกว่า 0 เสมอ
    const badQty = await createItem({
      code: `UC-${TAG}-J3b`, name: 'จำนวนศูนย์(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 1000,
      purchasePrice: 350, purchaseQuantity: 0,
    });
    expect(badQty.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('J4 · อัตราเฉพาะวัตถุดิบที่ไม่มีมาตรฐานให้เทียบ ต้องไม่ถูกปฏิเสธ', async () => {
    // KG → ML ขึ้นกับความหนาแน่น จงใจไม่มีในตารางมาตรฐาน
    const res = await createItem({
      code: `UC-${TAG}-J4`, name: 'ซอสหนืด(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: mlId, purchaseUnitId: kgId, purchaseToBaseFactor: 900,
      purchasePrice: 90, purchaseQuantity: 1,
    });
    expect(res.statusCode).toBe(201);
    expect(num(res.json().data.lastCost)).toBeCloseTo(0.1, 10);
  });

  /* ---------- K: หน้าแก้ไขต้องใช้กติกาเดียวกับหน้าสร้าง ---------- */

  it('K · แก้ไขวัตถุดิบเดิมด้วยอัตราผิดทิศ ต้องถูกปฏิเสธและค่าเดิมไม่เปลี่ยน', async () => {
    const created = await createItem({
      code: `UC-${TAG}-K`, name: 'แก้ไขอัตรา(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 1000,
      purchasePrice: 350, purchaseQuantity: 1,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    const bad = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`, headers: auth(),
      payload: { purchaseToBaseFactor: 0.001 },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('CONVERSION_FACTOR_CONFLICT');

    const after = await prisma.item.findUniqueOrThrow({ where: { id } });
    expect(num(after.purchaseToBaseFactor)).toBe(1000);
    expect(num(after.lastCost)).toBeCloseTo(0.35, 10);

    // แก้ด้วยอัตราที่ถูกต้องยังทำได้ตามปกติ
    const good = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`, headers: auth(),
      payload: { purchaseToBaseFactor: 1000, name: 'แก้ไขอัตรา(ทดสอบ) แก้แล้ว' },
    });
    expect(good.statusCode).toBe(200);
  });

  it('K2 · เปลี่ยนหน่วยฐานแล้วอัตราเดิมขัดกับมาตรฐานใหม่ ต้องถูกจับได้', async () => {
    const created = await createItem({
      code: `UC-${TAG}-K2`, name: 'เปลี่ยนหน่วย(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: mlId, purchaseUnitId: kgId, purchaseToBaseFactor: 900,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;

    // ย้ายหน่วยฐานจาก ML ไป G โดยไม่แก้อัตรา → 900 ขัดกับมาตรฐาน 1000
    const res = await app.inject({
      method: 'PATCH', url: `/api/items/${id}`, headers: auth(), payload: { baseUnitId: gId },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONVERSION_FACTOR_CONFLICT');
    expect((await prisma.item.findUniqueOrThrow({ where: { id } })).baseUnitId).toBe(mlId);
  });

  /* ---------- PHASE 20B: ไม่มีเส้นทางไหนเลี่ยงด่านตรวจได้ ---------- */

  it('BP1 · สร้างสินค้าจากหน้ารับของด้วยอัตราผิดทิศ ต้องถูกปฏิเสธเหมือนกัน', async () => {
    /* POST /business/receiving-items เคยเขียนอัตราลงฐานโดยไม่ตรวจอะไรเลย
       จึงเป็นช่องที่ค่า 0.001 เล็ดลอดเข้าไปได้ ทั้งที่หน้าวัตถุดิบกันไว้แล้ว */
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving-items', headers: auth(),
      payload: { name: 'ของจากหน้ารับของ(ทดสอบ)', code: `UC-${TAG}-BP1`, baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 0.001 },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('CONVERSION_FACTOR_CONFLICT');
    expect(await prisma.item.count({ where: { code: `UC-${TAG}-BP1` } })).toBe(0);
  });

  it('BP2 · อัตราที่ถูกต้องยังสร้างจากหน้ารับของได้ตามปกติ', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving-items', headers: auth(),
      payload: { name: 'ของถูกต้อง(ทดสอบ)', code: `UC-${TAG}-BP2`, baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 1000 },
    });
    expect(res.statusCode).toBe(201);
    const saved = await prisma.item.findFirstOrThrow({ where: { code: `UC-${TAG}-BP2` } });
    expect(num(saved.purchaseToBaseFactor)).toBe(1000);
  });

  it('BP3 · อัตราเฉพาะรายการยังสร้างจากหน้ารับของได้ (ไม่มีมาตรฐานให้เทียบ)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/business/receiving-items', headers: auth(),
      payload: { name: 'ข้าวกระสอบ(ทดสอบ)', code: `UC-${TAG}-BP3`, baseUnitId: kgId, purchaseUnitId: sackId, purchaseToBaseFactor: 25 },
    });
    expect(res.statusCode).toBe(201);
    expect(num((await prisma.item.findFirstOrThrow({ where: { code: `UC-${TAG}-BP3` } })).purchaseToBaseFactor)).toBe(25);
  });

  /* ---------- §14: ต้นทุนสูตรอาหารต้องยังถูกต้อง ---------- */

  it('R · วัตถุดิบ 0.35/G ใช้ในสูตร 100 G → ต้นทุนวัตถุดิบ 35 บาท', async () => {
    const ingredient = await createItem({
      code: `UC-${TAG}-R`, name: 'วัตถุดิบสูตร(ทดสอบ)', type: ItemType.RAW_MATERIAL,
      baseUnitId: gId, purchaseUnitId: kgId, purchaseToBaseFactor: 1000,
      purchasePrice: 350, purchaseQuantity: 1,
    });
    expect(ingredient.statusCode).toBe(201);
    const ingredientId = ingredient.json().data.id as string;
    expect(num(ingredient.json().data.lastCost)).toBeCloseTo(0.35, 10);

    const menu = await createItem({
      code: `UC-${TAG}-MENU`, name: 'เมนูทดสอบต้นทุน', type: ItemType.FINISHED_GOOD, baseUnitId: gId,
    });
    expect(menu.statusCode).toBe(201);
    const menuId = menu.json().data.id as string;

    const recipe = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: {
        productId: menuId,
        version: {
          standardYieldQty: 1, yieldPercent: 100,
          overhead: { mode: 'TOTAL', total: 0 },
          components: [{ componentType: 'ITEM', itemId: ingredientId, quantity: 100, unitId: gId, wastePercent: 0 }],
        },
      },
    });
    expect(recipe.statusCode).toBe(201);
    // 100 G × 0.35 บาท/G = 35 บาท
    expect(num(recipe.json().data.cost.ingredientCost)).toBeCloseTo(35, 6);

    await prisma.recipeVersion.deleteMany({ where: { recipe: { productId: menuId } } });
    await prisma.recipe.deleteMany({ where: { productId: menuId } });
  });
});
