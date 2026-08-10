import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

/** integration: catalog (items/units) + recipe + costing — ใช้ผู้ใช้ทดสอบเฉพาะ กันชนกับ auth.test */
const TAG = `ct${Date.now().toString().slice(-7)}`;
const USERNAME = `catalog_${TAG}`;

describe.sequential('catalog + recipe + costing integration', () => {
  let app: FastifyInstance;
  let token = '';
  let userId = '';
  let baseUnitId = '';
  let sellUnitId = '';
  let itemId = '';
  let packagingId = '';
  let menuId = '';
  let recipeId = '';
  let versionId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const passwordHash = await bcrypt.hash('CatalogPass123!', 10);
    const user = await prisma.user.upsert({
      where: { username: USERNAME },
      update: { passwordHash, mustChangePassword: false, isActive: true, deletedAt: null },
      create: { username: USERNAME, email: `${USERNAME}@s2a.local`, passwordHash, fullName: 'Catalog Tester', isActive: true, mustChangePassword: false },
    });
    userId = user.id;
    await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, update: {}, create: { userId: user.id, roleId: role.id } });
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } });
    await prisma.companyMembership.upsert({ where: { userId_companyId: { userId: user.id, companyId: company.id } }, update: { roleId: role.id }, create: { userId: user.id, companyId: company.id, roleId: role.id, isDefault: true } });

    const g = await prisma.unit.upsert({ where: { code: `G_${TAG}` }, update: {}, create: { code: `G_${TAG}`, name: 'กรัม(ทดสอบ)' } });
    const box = await prisma.unit.upsert({ where: { code: `BOX_${TAG}` }, update: {}, create: { code: `BOX_${TAG}`, name: 'กล่อง(ทดสอบ)' } });
    baseUnitId = g.id; sellUnitId = box.id;

    app = await buildApp();
    await app.ready();
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: USERNAME, password: 'CatalogPass123!' } });
    token = login.json().data.accessToken;
  });

  afterAll(async () => {
    try {
      if (recipeId) await prisma.recipeVersion.deleteMany({ where: { recipeId } });
      if (recipeId) await prisma.recipe.deleteMany({ where: { id: recipeId } });
      if (menuId) await prisma.sellingPrice.deleteMany({ where: { itemId: menuId } });
      if (itemId) await prisma.itemPriceHistory.deleteMany({ where: { itemId } });
      if (packagingId) await prisma.itemPriceHistory.deleteMany({ where: { itemId: packagingId } });
      await prisma.item.deleteMany({ where: { id: { in: [itemId, packagingId, menuId].filter(Boolean) } } });
      await prisma.unit.deleteMany({ where: { code: { in: [`G_${TAG}`, `BOX_${TAG}`] } } });
      if (userId) { await prisma.userRole.deleteMany({ where: { userId } }); await prisma.refreshToken.deleteMany({ where: { userId } }); await prisma.auditLog.deleteMany({ where: { userId } }); await prisma.user.deleteMany({ where: { id: userId } }); }
    } finally {
      if (app) await app.close();
      await prisma.$disconnect();
    }
  });

  it('ปฏิเสธการเรียก API เมื่อไม่มี token', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/items' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/items', payload: {} })).statusCode).toBe(401);
  });

  it('สร้างวัตถุดิบพร้อมราคาซื้อ แล้วคำนวณต้นทุนต่อหน่วยฐานถูกต้อง (150/kg → 0.15/g)', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/items', headers: auth(),
      payload: { code: `RM-${TAG}`, name: 'ข้าวหอมมะลิ(ทดสอบ)', type: ItemType.RAW_MATERIAL, baseUnitId, purchaseToBaseFactor: 1000, purchasePrice: 150, purchaseQuantity: 1 },
    });
    expect(res.statusCode).toBe(201);
    itemId = res.json().data.id;
    expect(res.json().data.lastCost).toBeCloseTo(0.15, 6);
  });

  it('รายละเอียดวัตถุดิบมีประวัติราคาและสถิติ', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/items/${itemId}`, headers: auth() });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.priceHistory.length).toBe(1);
    expect(data.priceStats.last).toBeCloseTo(0.15, 6);
    expect(data.priceHistory[0].purchasePrice).toBe(150);
  });

  it('สร้างบรรจุภัณฑ์และแปลงราคาซื้อ 100 กล่อง 350 บาทเป็น 3.50 บาทต่อกล่อง', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/items', headers: auth(),
      payload: { code: `PK-${TAG}`, name: 'กล่องอาหาร(ทดสอบ)', type: ItemType.PACKAGING, baseUnitId: sellUnitId, purchaseUnitId: sellUnitId, purchaseToBaseFactor: 1, purchasePrice: 350, purchaseQuantity: 100 },
    });
    expect(res.statusCode).toBe(201);
    packagingId = res.json().data.id;
    expect(res.json().data.type).toBe(ItemType.PACKAGING);
    expect(res.json().data.lastCost).toBeCloseTo(3.5, 6);
  });

  it('บันทึกราคาซื้อใหม่แล้วอัปเดต lastCost', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/items/${itemId}/prices`, headers: auth(), payload: { purchasePrice: 200, purchaseQuantity: 1 } });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.baseUnitCost).toBeCloseTo(0.2, 6);
    const detail = await app.inject({ method: 'GET', url: `/api/items/${itemId}`, headers: auth() });
    expect(detail.json().data.lastCost).toBeCloseTo(0.2, 6);
    expect(detail.json().data.priceStats.count).toBe(2);
  });

  it('สร้างเมนู (FINISHED_GOOD) และสูตรที่อ้างวัตถุดิบ พร้อมคำนวณต้นทุนที่ backend', async () => {
    const menu = await app.inject({ method: 'POST', url: '/api/menus', headers: auth(), payload: { code: `MENU-${TAG}`, name: 'ข้าวกล่อง(ทดสอบ)', sellingUnitId: sellUnitId } });
    expect(menu.statusCode).toBe(201);
    menuId = menu.json().data.id;

    const recipe = await app.inject({
      method: 'POST', url: '/api/recipes', headers: auth(),
      payload: { productId: menuId, version: { standardYieldQty: 10, yieldPercent: 100, laborCost: 20, ingredients: [{ itemId, quantityBase: 1000, wastePercent: 0 }, { itemId: packagingId, quantityBase: 10, wastePercent: 0 }] } },
    });
    expect(recipe.statusCode).toBe(201);
    recipeId = recipe.json().data.id;
    // 200 material + (10 boxes × 3.50) + 20 labor = 255 total; /10 = 25.50 per unit
    expect(recipe.json().data.cost.materialCost).toBeCloseTo(200, 4);
    expect(recipe.json().data.cost.packagingCost).toBeCloseTo(35, 4);
    expect(recipe.json().data.cost.totalCost).toBeCloseTo(255, 4);
    expect(recipe.json().data.cost.unitCost).toBeCloseTo(25.5, 4);
  });

  it('คำนวณต้นทุนซ้ำจาก recipeVersion + จำลองราคาขาย markup 30%', async () => {
    const detail = await app.inject({ method: 'GET', url: `/api/recipes/${recipeId}`, headers: auth() });
    versionId = detail.json().data.versions[0].id;
    const res = await app.inject({ method: 'POST', url: '/api/costing/calculate', headers: auth(), payload: { recipeVersionId: versionId, markupPercent: 30 } });
    expect(res.statusCode).toBe(200);
    const { breakdown, pricing } = res.json().data;
    expect(breakdown.packagingCost).toBeCloseTo(35, 4);
    expect(breakdown.unitCost).toBeCloseTo(25.5, 4);
    expect(pricing.sellingPrice).toBeCloseTo(33.15, 2); // 25.5 × 1.3
    expect(pricing.isLoss).toBe(false);
  });

  it('ปิดการใช้งานวัตถุดิบ (soft) โดยไม่ลบจริง', async () => {
    const res = await app.inject({ method: 'POST', url: `/api/items/${itemId}/deactivate`, headers: auth() });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.isActive).toBe(false);
    const still = await prisma.item.findUnique({ where: { id: itemId } });
    expect(still).not.toBeNull();
  });
});
