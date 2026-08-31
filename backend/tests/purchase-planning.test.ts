import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const TAG = `pp${Date.now().toString().slice(-7)}`;
describe.sequential('purchase planning', () => {
  let app: FastifyInstance; let token = ''; let viewerToken = ''; let companyId = ''; let warehouseId = ''; let baseUnitId = ''; let purchaseUnitId = ''; let supplierId = '';
  const auth = () => ({ authorization: `Bearer ${token}` }); const viewer = () => ({ authorization: `Bearer ${viewerToken}` });
  const item = (code: string, factor = 25) => prisma.item.create({ data: { companyId, code: `${code}_${TAG}`, name: `${code} ${TAG}`, type: ItemType.RAW_MATERIAL, baseUnitId, purchaseUnitId, purchaseToBaseFactor: factor } });
  const product = (code: string) => prisma.item.create({ data: { companyId, code: `${code}_${TAG}`, name: `${code} ${TAG}`, type: ItemType.FINISHED_GOOD, baseUnitId } });
  const recipe = (rawId: string, outputId: string, materialQty: number, yieldQty: number, mode = 'ACTUAL') => prisma.recipe.create({ data: { companyId, code: `R_${outputId.slice(-5)}_${TAG}`, name: `สูตร ${outputId.slice(-4)}`, productId: outputId, versions: { create: { versionNo: 1, isActive: true, standardYieldQty: yieldQty, yieldPercent: 100, yieldMode: mode, yieldUnitId: mode === 'ACTUAL' ? baseUnitId : null, ingredients: { create: { itemId: rawId, quantity: materialQty, unitId: baseUnitId } } } } }, include: { versions: true } });
  const create = (targets: { recipeId: string; plannedQty: number }[]) => app.inject({ method: 'POST', url: '/api/business/purchase-planning', headers: auth(), payload: { planDate: new Date().toISOString(), warehouseId, targets } });

  beforeAll(async () => {
    const company = await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } }); companyId = company.id;
    const [superRole, viewerRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } }), prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } })]);
    for (const [name, roleId] of [[`ppadmin_${TAG}`, superRole.id], [`ppviewer_${TAG}`, viewerRole.id]] as const) { const user = await prisma.user.create({ data: { username: name, email: `${name}@s2a.local`, passwordHash: await bcrypt.hash('PurchasePlan123!', 10), fullName: name, mustChangePassword: false } }); await prisma.userRole.create({ data: { userId: user.id, roleId } }); await prisma.companyMembership.create({ data: { userId: user.id, companyId, roleId, isDefault: true } }); }
    baseUnitId = (await prisma.unit.create({ data: { code: `KG_${TAG}`, name: 'กิโลกรัม' } })).id; purchaseUnitId = (await prisma.unit.create({ data: { code: `BAG_${TAG}`, name: 'ถุง' } })).id;
    warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `PPW_${TAG}`, name: 'คลังวางแผน' } })).id; supplierId = (await prisma.supplier.create({ data: { companyId, code: `PPS_${TAG}`, name: 'ผู้ขายจริง' } })).id;
    app = await buildApp(); await app.ready(); const login = async (username: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'PurchasePlan123!' } })).json().data.accessToken as string; token = await login(`ppadmin_${TAG}`); viewerToken = await login(`ppviewer_${TAG}`);
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('aggregates multiple ACTUAL recipes and uses reserved, purchase units, real price and supplier history', async () => {
    const raw = await item('RAW_MULTI'); const [fgA, fgB] = await Promise.all([product('FG_A'), product('FG_B')]); const [a, b] = await Promise.all([recipe(raw.id, fgA.id, 10, 20), recipe(raw.id, fgB.id, 5, 10)]);
    const received = await app.inject({ method: 'POST', url: '/api/business/receiving', headers: auth(), payload: { warehouseId, supplierId, confirm: true, items: [{ itemId: raw.id, quantity: 1, unitPrice: 250 }] } }); expect(received.statusCode).toBe(201);
    await prisma.stockBalance.updateMany({ where: { warehouseId, itemId: raw.id }, data: { reserved: 5 } });
    const ledgerBefore = await prisma.stockLedger.count(); const response = await create([{ recipeId: a.id, plannedQty: 20 }, { recipeId: b.id, plannedQty: 20 }]); expect(response.statusCode).toBe(201); const doc = response.json().data;
    expect(doc.planNo).toMatch(/^PP-\d{8}-\d{4}$/); expect(doc.targets).toHaveLength(2); expect(doc.requirements).toHaveLength(1); const line = doc.requirements[0];
    expect(line.requiredQty).toBeCloseTo(20, 4); expect(line.onHandQty).toBeCloseTo(25, 4); expect(line.reservedQty).toBeCloseTo(5, 4); expect(line.availableQty).toBeCloseTo(20, 4); expect(line.shortageQty).toBe(0); expect(line.purchaseToBaseFactor).toBe(25); expect(line.lastPurchasePrice).toBe(250); expect(line.latestSupplierName).toBe('ผู้ขายจริง'); expect(line.sources).toHaveLength(2);
    expect(await prisma.stockLedger.count()).toBe(ledgerBefore); expect((await prisma.stockBalance.findFirstOrThrow({ where: { warehouseId, itemId: raw.id } })).reserved.toNumber()).toBe(5);
  });

  it('handles BATCH deterministically, snapshots shortages, and recalculates only on explicit draft edit', async () => {
    const raw = await item('RAW_BATCH', 10); const fg = await product('FG_BATCH'); const formula = await recipe(raw.id, fg.id, 4, 1, 'BATCH');
    const created = await create([{ recipeId: formula.id, plannedQty: 3 }]); expect(created.statusCode).toBe(201); let doc = created.json().data; expect(doc.targets[0].yieldMode).toBe('BATCH'); expect(doc.requirements[0].requiredQty).toBeCloseTo(12, 4); expect(doc.requirements[0].shortageQty).toBeCloseTo(12, 4); expect(doc.requirements[0].purchaseQty).toBeCloseTo(1.2, 4); expect(doc.requirements[0].estimatedCost).toBeNull();
    await prisma.stockBalance.create({ data: { warehouseId, itemId: raw.id, onHand: 5 } }); const detail = (await app.inject({ method: 'GET', url: `/api/business/purchase-planning/${doc.id}`, headers: auth() })).json().data; expect(detail.requirements[0].availableQty).toBe(0); expect(detail.requirements[0].currentStock.available).toBe(5);
    const recalculated = await app.inject({ method: 'PATCH', url: `/api/business/purchase-planning/${doc.id}`, headers: auth(), payload: { version: doc.version, planDate: doc.planDate, warehouseId, targets: [{ recipeId: formula.id, recipeVersionId: formula.versions[0].id, plannedQty: 3 }] } }); expect(recalculated.statusCode).toBe(200); doc = recalculated.json().data; expect(doc.requirements[0].availableQty).toBe(5); expect(doc.requirements[0].shortageQty).toBe(7);
    expect((await app.inject({ method: 'POST', url: `/api/business/purchase-planning/${doc.id}/ready`, headers: auth() })).statusCode).toBe(200); const immutable = await app.inject({ method: 'PATCH', url: `/api/business/purchase-planning/${doc.id}`, headers: auth(), payload: { version: doc.version + 1, planDate: doc.planDate, warehouseId, targets: [{ recipeId: formula.id, plannedQty: 4 }] } }); expect(immutable.statusCode).toBe(409);
  });

  it('enforces permission/company scope, allocates concurrent numbers, exports PDF, and never creates stock rows', async () => {
    const raw = await item('RAW_SCOPE'); const fg = await product('FG_SCOPE'); const formula = await recipe(raw.id, fg.id, 1, 1); const balancesBefore = await prisma.stockBalance.count(); const ledgersBefore = await prisma.stockLedger.count();
    expect((await app.inject({ method: 'POST', url: '/api/business/purchase-planning', headers: viewer(), payload: { planDate: new Date().toISOString(), warehouseId, targets: [{ recipeId: formula.id, plannedQty: 1 }] } })).statusCode).toBe(403);
    const docs = await Promise.all(Array.from({ length: 6 }, () => create([{ recipeId: formula.id, plannedQty: 1 }]))); expect(docs.every((row) => row.statusCode === 201)).toBe(true); expect(new Set(docs.map((row) => row.json().data.planNo)).size).toBe(6);
    const pdf = await app.inject({ method: 'GET', url: `/api/business/purchase-planning/${docs[0].json().data.id}/document.pdf`, headers: auth() }); expect(pdf.statusCode).toBe(200); expect(pdf.rawPayload.subarray(0,4).toString()).toBe('%PDF');
    const other = await prisma.company.create({ data: { code: `PPO_${TAG}`, nameTh: 'บริษัทอื่น' } }); const otherWarehouse = await prisma.warehouse.create({ data: { companyId: other.id, code: `PPOW_${TAG}`, name: 'คลังอื่น' } }); expect((await app.inject({ method: 'POST', url: '/api/business/purchase-planning', headers: auth(), payload: { planDate: new Date().toISOString(), warehouseId: otherWarehouse.id, targets: [{ recipeId: formula.id, plannedQty: 1 }] } })).statusCode).toBe(400); expect((await app.inject({ method: 'GET', url: `/api/business/purchase-planning/${docs[0].json().data.id}`, headers: viewer() })).statusCode).toBe(403);
    expect(await prisma.stockBalance.count()).toBe(balancesBefore); expect(await prisma.stockLedger.count()).toBe(ledgersBefore);
  }, 30_000);
});
