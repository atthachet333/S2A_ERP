import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/**
 * PHASE 15B — สูตรอาหาร: ส่วนประกอบ / สูตรย่อย / โหมดผลผลิต / การอ้างอิงวน
 * ไม่แตะสูตรคำนวณต้นทุน — ตรวจว่าผลลัพธ์ที่ engine ให้มาถูกต้องเท่านั้น
 */

const TAG = `rc${Date.now().toString().slice(-7)}`;

describe.sequential('recipe lifecycle integration', () => {
  let app: FastifyInstance;
  let token = '';
  let companyId = '';
  let gramId = '';
  let bagId = '';
  let riceId = '';
  let sauceMenuId = '';
  let dishMenuId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const passwordHash = await bcrypt.hash('RecipePass123!', 10);
    const user = await prisma.user.upsert({
      where: { username: `recipe_${TAG}` },
      update: { passwordHash, mustChangePassword: false, isActive: true, deletedAt: null },
      create: { username: `recipe_${TAG}`, email: `recipe_${TAG}@s2a.local`, passwordHash, fullName: 'Recipe Tester', isActive: true, mustChangePassword: false },
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
    token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: `recipe_${TAG}`, password: 'RecipePass123!' } })).json().data.accessToken;

    const g = await prisma.unit.upsert({ where: { code: `G_${TAG}` }, update: {}, create: { code: `G_${TAG}`, name: 'กรัม(ทดสอบ)' } });
    const kg = await prisma.unit.upsert({ where: { code: `KG_${TAG}` }, update: {}, create: { code: `KG_${TAG}`, name: 'กิโลกรัม(ทดสอบ)' } });
    const bag = await prisma.unit.upsert({ where: { code: `BAG_${TAG}` }, update: {}, create: { code: `BAG_${TAG}`, name: 'ถุง(ทดสอบ)' } });
    gramId = g.id; bagId = bag.id;
    await prisma.unitConversion.create({ data: { fromUnitId: kg.id, toUnitId: g.id, factor: 1000 } });

    const rice = await prisma.item.create({
      data: { companyId, code: `RICE_${TAG}`, name: 'ข้าวสาร(ทดสอบ)', type: ItemType.RAW_MATERIAL, baseUnitId: g.id, lastCost: 0.05 },
    });
    riceId = rice.id;
    const sauceMenu = await prisma.item.create({
      data: { companyId, code: `SAUCE_${TAG}`, name: 'ซอสสูตรพิเศษ(ทดสอบ)', type: ItemType.FINISHED_GOOD, baseUnitId: g.id },
    });
    sauceMenuId = sauceMenu.id;
    const dishMenu = await prisma.item.create({
      data: { companyId, code: `DISH_${TAG}`, name: 'ข้าวราดซอส(ทดสอบ)', type: ItemType.FINISHED_GOOD, baseUnitId: bag.id },
    });
    dishMenuId = dishMenu.id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  let sauceRecipeId = '';
  let dishRecipeId = '';

  it('R1 สูตรจากวัตถุดิบล้วน (โหมด ACTUAL) คำนวณต้นทุนต่อหน่วยถูกต้อง', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: {
        productId: sauceMenuId,
        version: {
          standardYieldQty: 500, yieldPercent: 100, yieldMode: 'ACTUAL', yieldUnitId: gramId,
          components: [{ componentType: 'ITEM', itemId: riceId, quantity: 1000, wastePercent: 0 }],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    sauceRecipeId = res.json().data.id;
    const cost = res.json().data.cost;
    // 1000 g × 0.05 = 50 · ผลผลิต 500 g → 0.10 ต่อกรัม
    expect(cost.ingredientCost).toBeCloseTo(50, 4);
    expect(cost.effectiveYield).toBeCloseTo(500, 4);
    expect(cost.costPerYieldUnit).toBeCloseTo(0.1, 6);
  });

  it('R2 yieldPercent ลดผลผลิตที่ใช้ได้จริง และดันต้นทุนต่อหน่วยขึ้น', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/costing/calculate', headers: auth(),
      payload: {
        ingredients: [{ itemId: riceId, quantityBase: 1000, wastePercent: 0 }],
        yieldQty: 500, yieldPercent: 50,
      },
    });
    expect(res.statusCode).toBe(200);
    // ผลผลิตใช้ได้จริง 250 → 50 / 250 = 0.20
    expect(res.json().data.breakdown.unitCost).toBeCloseTo(0.2, 6);
  });

  it('R3 สูตรย่อย: ต้นทุนไหลจากสูตรลูกขึ้นมาที่สูตรแม่', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: {
        productId: dishMenuId,
        version: {
          standardYieldQty: 10, yieldPercent: 100, yieldMode: 'BATCH',
          components: [
            { componentType: 'ITEM', itemId: riceId, quantity: 2000, wastePercent: 0 },
            /* ใช้ซอส 100 กรัม จากสูตรลูกที่ต้นทุน 0.10/กรัม = 10 บาท */
            { componentType: 'SUB_RECIPE', childRecipeId: sauceRecipeId, quantity: 100, unitId: gramId, wastePercent: 0 },
          ],
        },
      },
    });
    expect(res.statusCode).toBe(201);
    dishRecipeId = res.json().data.id;
    const cost = res.json().data.cost;
    expect(cost.ingredientCost).toBeCloseTo(100, 4);   // 2000 g × 0.05
    expect(cost.subRecipeCost).toBeCloseTo(10, 4);     // 100 g × 0.10
    expect(cost.totalCost).toBeCloseTo(110, 4);
    expect(cost.costPerYieldUnit).toBeCloseTo(11, 4);  // BATCH 10 หน่วย
  });

  it('R4 ต้นทุนสูตรแม่ขยับตามเมื่อราคาวัตถุดิบของสูตรลูกเปลี่ยน', async () => {
    await prisma.item.update({ where: { id: riceId }, data: { lastCost: 0.1 } });
    const res = await app.inject({
      method: 'POST', url: '/api/costing/calculate', headers: auth(),
      payload: { recipeVersionId: (await activeVersionId(dishRecipeId)) },
    });
    expect(res.statusCode).toBe(200);
    const b = res.json().data.breakdown;
    // ข้าว 2000×0.10 = 200 · ซอส 100 g ที่ต้นทุนใหม่ 0.20/g = 20
    expect(b.ingredientCost).toBeCloseTo(200, 4);
    expect(b.subRecipeCost).toBeCloseTo(20, 4);
    await prisma.item.update({ where: { id: riceId }, data: { lastCost: 0.05 } });
  });

  it('R5 อ้างอิงวน A → B → A ต้องถูกปฏิเสธ และไม่บันทึกค้างไว้บางส่วน', async () => {
    /* สร้างสูตรสองตัวที่ใช้หน่วยผลผลิตเดียวกัน (กรัม) เพื่อให้ผ่านด่านแปลงหน่วยไปก่อน
       จะได้ทดสอบ "ด่านกันอ้างอิงวน" ได้ตรง ๆ ไม่ไปติดที่เรื่องหน่วย */
    const mkMenu = async (suffix: string) => (await prisma.item.create({
      data: { companyId, code: `CY${suffix}_${TAG}`, name: `เมนูวน ${suffix}`, type: ItemType.FINISHED_GOOD, baseUnitId: gramId },
    })).id;

    const menuA = await mkMenu('A');
    const menuB = await mkMenu('B');
    const version = (components: unknown[]) => ({
      standardYieldQty: 100, yieldPercent: 100, yieldMode: 'ACTUAL', yieldUnitId: gramId, components,
    });

    const recipeA = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: { productId: menuA, version: version([{ componentType: 'ITEM', itemId: riceId, quantity: 100, wastePercent: 0 }]) },
    });
    expect(recipeA.statusCode).toBe(201);
    const recipeAId = recipeA.json().data.id;

    // B ใช้ A เป็นสูตรย่อย — ปกติดี
    const recipeB = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: { productId: menuB, version: version([{ componentType: 'SUB_RECIPE', childRecipeId: recipeAId, quantity: 10, unitId: gramId, wastePercent: 0 }]) },
    });
    expect(recipeB.statusCode).toBe(201);
    const recipeBId = recipeB.json().data.id;

    const versionsBefore = await prisma.recipeVersion.count({ where: { recipeId: recipeAId } });

    // ให้ A กลับไปใช้ B = วนกลับมาหาตัวเอง
    const res = await app.inject({
      method: 'POST', url: `/api/recipes/${recipeAId}/versions`, headers: auth(),
      payload: version([{ componentType: 'SUB_RECIPE', childRecipeId: recipeBId, quantity: 10, unitId: gramId, wastePercent: 0 }]),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error.code).toBe('CIRCULAR_SUBRECIPE');

    // สำคัญที่สุด: ต้องไม่มีเวอร์ชันใหม่ค้างอยู่
    expect(await prisma.recipeVersion.count({ where: { recipeId: recipeAId } })).toBe(versionsBefore);
  });

  it('R5b สูตรย่อยที่แปลงหน่วยไม่ได้ ถูกปฏิเสธพร้อมรหัสที่สื่อความหมาย', async () => {
    /* สูตรจานเป็นโหมด BATCH จึงอ้างเป็น "ถุง" ไม่ได้ — ต้องบอกเหตุผลชัด ไม่ใช่คิดต้นทุนมั่ว */
    const versionsBefore = await prisma.recipeVersion.count({ where: { recipeId: sauceRecipeId } });
    const res = await app.inject({
      method: 'POST', url: `/api/recipes/${sauceRecipeId}/versions`, headers: auth(),
      payload: {
        standardYieldQty: 500, yieldPercent: 100, yieldMode: 'ACTUAL', yieldUnitId: gramId,
        components: [{ componentType: 'SUB_RECIPE', childRecipeId: dishRecipeId, quantity: 1, unitId: bagId, wastePercent: 0 }],
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.json().error.code).toBe('BATCH_UNIT_NOT_CONVERTIBLE');
    expect(await prisma.recipeVersion.count({ where: { recipeId: sauceRecipeId } })).toBe(versionsBefore);
  });

  it('R6 โหมด ACTUAL ต้องระบุหน่วยผลผลิต ไม่งั้นถูกปฏิเสธ', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: {
        newMenu: { name: 'เมนูไม่มีหน่วยผลผลิต', sellingUnitId: bagId },
        version: {
          standardYieldQty: 5, yieldMode: 'ACTUAL',
          components: [{ componentType: 'ITEM', itemId: riceId, quantity: 100, wastePercent: 0 }],
        },
      },
    });
    expect(res.statusCode).toBe(400);
  });

  it('R7 หน่วยที่แปลงไม่ได้ต้องถูกปฏิเสธ ไม่ใช่คิดต้นทุนมั่ว', async () => {
    /* หน่วยใหม่ที่ไม่มีอัตราแปลงไปหน่วยฐาน (กรัม) เลย */
    const odd = await prisma.unit.upsert({ where: { code: `ODD_${TAG}` }, update: {}, create: { code: `ODD_${TAG}`, name: 'หน่วยแปลก(ทดสอบ)' } });
    const res = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: {
        newMenu: { name: 'เมนูหน่วยแปลก', sellingUnitId: bagId },
        version: {
          standardYieldQty: 5, yieldMode: 'BATCH',
          components: [{ componentType: 'ITEM', itemId: riceId, quantity: 1, unitId: odd.id, wastePercent: 0 }],
        },
      },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });

  it('R8 สูตรของบริษัทอื่นเข้าถึงไม่ได้', async () => {
    const other = await prisma.company.create({ data: { code: `CO_R_${TAG}`, nameTh: 'บริษัทอื่น(ทดสอบสูตร)' } });
    const otherUnit = await prisma.unit.upsert({ where: { code: `OU_${TAG}` }, update: {}, create: { code: `OU_${TAG}`, name: 'หน่วยบริษัทอื่น' } });
    const otherMenu = await prisma.item.create({
      data: { companyId: other.id, code: `OM_${TAG}`, name: 'เมนูบริษัทอื่น', type: ItemType.FINISHED_GOOD, baseUnitId: otherUnit.id },
    });
    const otherRecipe = await prisma.recipe.create({
      data: { companyId: other.id, code: `OR_${TAG}`, name: 'สูตรบริษัทอื่น', productId: otherMenu.id },
    });

    const res = await app.inject({ method: 'GET', url: `/api/recipes/${otherRecipe.id}`, headers: auth() });
    expect([403, 404]).toContain(res.statusCode);
  });

  /** หา id ของเวอร์ชันที่ใช้งานอยู่ของสูตร */
  async function activeVersionId(recipeId: string): Promise<string> {
    const v = await prisma.recipeVersion.findFirstOrThrow({
      where: { recipeId, isActive: true }, orderBy: { versionNo: 'desc' },
    });
    return v.id;
  }
});
