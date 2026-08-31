import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const TAG = `pr${Date.now().toString().slice(-7)}`;
const n = (value: unknown) => Number(value);

describe.sequential('production run', () => {
  let app: FastifyInstance;
  let token = '';
  let viewerToken = '';
  let companyId = '';
  let warehouseId = '';
  let unitId = '';
  let unitCode = '';
  const auth = () => ({ authorization: `Bearer ${token}` });
  const viewer = () => ({ authorization: `Bearer ${viewerToken}` });

  const item = async (code: string, type: ItemType, lastCost = 0) => prisma.item.create({
    data: { companyId, code: `${code}_${TAG}`, name: `${code} ${TAG}`, type, baseUnitId: unitId, lastCost, avgCost: lastCost },
  });

  const recipe = async (materialId: string, productId: string, materialQty = 5, yieldQty = 10) => prisma.recipe.create({
    data: {
      companyId, code: `R_${materialId.slice(-6)}_${TAG}`, name: `สูตร ${materialId.slice(-4)}`, productId,
      versions: { create: { versionNo: 1, isActive: true, standardYieldQty: yieldQty, yieldPercent: 100, yieldMode: 'ACTUAL', yieldUnitId: unitId, ingredients: { create: { componentType: 'ITEM', itemId: materialId, quantity: materialQty, unitId, wastePercent: 0 } } } },
    }, include: { versions: true },
  });

  const receive = (itemId: string, qty: number, unitPrice = 10) => app.inject({
    method: 'POST', url: '/api/business/receiving', headers: auth(),
    payload: { warehouseId, confirm: true, items: [{ itemId, quantity: qty, unitPrice }] },
  });

  const createRun = (recipeId: string, plannedQty: number, actualOutputQty = plannedQty, materials?: { itemId: string; actualQty: number }[]) => app.inject({
    method: 'POST', url: '/api/business/production', headers: auth(),
    payload: { recipeId, warehouseId, plannedQty, actualOutputQty, productionDate: new Date().toISOString(), materials },
  });

  const onHand = async (itemId: string) => n((await prisma.stockBalance.findFirst({ where: { itemId, warehouseId } }))?.onHand ?? 0);

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;
    const createUser = async (username: string, roleId: string) => {
      const passwordHash = await bcrypt.hash('ProductionPass123!', 10);
      const user = await prisma.user.create({ data: { username, email: `${username}@s2a.local`, passwordHash, fullName: username, isActive: true, mustChangePassword: false } });
      await prisma.userRole.create({ data: { userId: user.id, roleId } });
      await prisma.companyMembership.create({ data: { userId: user.id, companyId, roleId, isDefault: true } });
    };
    await createUser(`pradmin_${TAG}`, superRole.id);
    await createUser(`prviewer_${TAG}`, viewerRole.id);
    const unit = await prisma.unit.create({ data: { code: `PU_${TAG}`, name: 'หน่วยผลิต' } });
    unitId = unit.id; unitCode = unit.code;
    warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `PW_${TAG}`, name: 'คลังผลิต' } })).id;
    app = await buildApp(); await app.ready();
    const login = async (username: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'ProductionPass123!' } })).json().data.accessToken as string;
    token = await login(`pradmin_${TAG}`); viewerToken = await login(`prviewer_${TAG}`);
  });

  afterAll(async () => { if (app) await app.close(); await prisma.$disconnect(); });

  it('creates and edits a draft with expected/actual quantities without stock movement', async () => {
    const raw = await item('RAW_DRAFT', ItemType.RAW_MATERIAL, 10); const output = await item('FG_DRAFT', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id);
    expect((await receive(raw.id, 100)).statusCode).toBe(201);
    const created = await createRun(formula.id, 20, 19, [{ itemId: raw.id, actualQty: 12 }]);
    expect(created.statusCode).toBe(201);
    const doc = created.json().data;
    expect(doc.orderNo).toMatch(/^PR-\d{8}-\d{4}$/);
    expect(doc.status).toBe('DRAFT'); expect(doc.materials[0].plannedQty).toBeCloseTo(10, 4); expect(doc.materials[0].actualQty).toBeCloseTo(12, 4);
    expect(doc.standardCost).toBeCloseTo(100, 4); expect(await onHand(raw.id)).toBeCloseTo(100, 4); expect(await onHand(output.id)).toBe(0);
    expect(await prisma.stockLedger.count({ where: { refId: doc.id } })).toBe(0);

    const edited = await app.inject({ method: 'PATCH', url: `/api/business/production/${doc.id}`, headers: auth(), payload: { recipeId: formula.id, warehouseId, plannedQty: 30, actualOutputQty: 28, productionDate: new Date().toISOString(), materials: [{ itemId: raw.id, actualQty: 16 }], version: doc.version } });
    expect(edited.statusCode).toBe(200); expect(edited.json().data.orderNo).toBe(doc.orderNo); expect(edited.json().data.materials[0].plannedQty).toBeCloseTo(15, 4);
    expect(await onHand(raw.id)).toBeCloseTo(100, 4);
  });

  it('confirms atomically, snapshots costs, moves both sides, and updates output cost source', async () => {
    const raw = await item('RAW_CONFIRM', ItemType.RAW_MATERIAL, 10); const output = await item('FG_CONFIRM', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id);
    await receive(raw.id, 100, 10);
    const doc = (await createRun(formula.id, 20, 18, [{ itemId: raw.id, actualQty: 12 }])).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/business/production/${doc.id}/confirm`, headers: auth() });
    expect(response.statusCode).toBe(200);
    const confirmed = response.json().data;
    expect(confirmed.status).toBe('COMPLETED'); expect(confirmed.standardCost).toBeCloseTo(100, 4); expect(confirmed.actualCost).toBeCloseTo(120, 4); expect(confirmed.actualUnitCost).toBeCloseTo(120 / 18, 5);
    expect(await onHand(raw.id)).toBeCloseTo(88, 4); expect(await onHand(output.id)).toBeCloseTo(18, 4);
    const ledgers = await prisma.stockLedger.findMany({ where: { refId: doc.id } });
    expect(ledgers).toHaveLength(2); expect(ledgers.find((line) => line.movementType === 'PRODUCTION_ISSUE')?.qtyOut.toNumber()).toBeCloseTo(12, 4); expect(ledgers.find((line) => line.movementType === 'PRODUCTION_OUTPUT')?.qtyIn.toNumber()).toBeCloseTo(18, 4);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: output.id } })).lastCost.toNumber()).toBeCloseTo(120 / 18, 4);
    expect(await prisma.itemPriceHistory.count({ where: { itemId: output.id, source: 'PRODUCTION', note: doc.orderNo } })).toBe(1);
    await prisma.item.update({ where: { id: raw.id }, data: { lastCost: 999 } });
    const historical = (await app.inject({ method: 'GET', url: `/api/business/production/${doc.id}`, headers: auth() })).json().data;
    expect(historical.materials[0].unitCost).toBeCloseTo(10, 4); expect(historical.actualCost).toBeCloseTo(120, 4);
  });

  it('rolls back every movement when one material is insufficient', async () => {
    const raw = await item('RAW_SHORT', ItemType.RAW_MATERIAL, 4); const output = await item('FG_SHORT', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id, 5, 10);
    await receive(raw.id, 2, 4); const doc = (await createRun(formula.id, 10, 10, [{ itemId: raw.id, actualQty: 5 }])).json().data;
    const response = await app.inject({ method: 'POST', url: `/api/business/production/${doc.id}/confirm`, headers: auth() });
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('INSUFFICIENT_STOCK');
    expect(await onHand(raw.id)).toBeCloseTo(2, 4); expect(await onHand(output.id)).toBe(0); expect(await prisma.stockLedger.count({ where: { refId: doc.id } })).toBe(0);
    expect((await prisma.productionOrder.findUniqueOrThrow({ where: { id: doc.id } })).status).toBe('DRAFT');
  });

  it('reverses exactly once and blocks reversal if output stock was consumed', async () => {
    const raw = await item('RAW_REV', ItemType.RAW_MATERIAL, 3); const output = await item('FG_REV', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id, 4, 8);
    await receive(raw.id, 20, 3); const doc = (await createRun(formula.id, 8, 7)).json().data;
    await app.inject({ method: 'POST', url: `/api/business/production/${doc.id}/confirm`, headers: auth() });
    const reversed = await app.inject({ method: 'POST', url: `/api/business/production/${doc.id}/reverse`, headers: auth(), payload: { reason: 'ทดสอบกลับรายการ' } });
    expect(reversed.statusCode).toBe(200); expect(reversed.json().data.status).toBe('CANCELLED'); expect(await onHand(raw.id)).toBeCloseTo(20, 4); expect(await onHand(output.id)).toBe(0);
    expect(await prisma.stockLedger.count({ where: { refId: doc.id, reason: 'REVERSAL' } })).toBe(2);
    const again = await app.inject({ method: 'POST', url: `/api/business/production/${doc.id}/reverse`, headers: auth(), payload: { reason: 'ซ้ำ' } });
    expect(again.statusCode).toBe(409);

    const raw2 = await item('RAW_REVBLOCK', ItemType.RAW_MATERIAL, 2); const output2 = await item('FG_REVBLOCK', ItemType.FINISHED_GOOD); const formula2 = await recipe(raw2.id, output2.id, 2, 5);
    await receive(raw2.id, 10, 2); const doc2 = (await createRun(formula2.id, 5, 5)).json().data; await app.inject({ method: 'POST', url: `/api/business/production/${doc2.id}/confirm`, headers: auth() });
    const issue = await app.inject({ method: 'POST', url: '/api/business/stock-issues', headers: auth(), payload: { warehouseId, confirm: true, idempotencyKey: `${TAG}-consume-output`, items: [{ itemId: output2.id, issuedQty: 4, unit: unitCode, baseQty: 4 }] } });
    expect(issue.statusCode).toBe(201);
    const blocked = await app.inject({ method: 'POST', url: `/api/business/production/${doc2.id}/reverse`, headers: auth(), payload: { reason: 'ควรถูกบล็อก' } });
    expect(blocked.statusCode).toBe(409); expect(blocked.json().error.code).toBe('INSUFFICIENT_STOCK'); expect(await onHand(output2.id)).toBeCloseTo(1, 4);
  });

  it('enforces permissions and company scope', async () => {
    const raw = await item('RAW_SCOPE', ItemType.RAW_MATERIAL, 1); const output = await item('FG_SCOPE', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id);
    const forbidden = await app.inject({ method: 'POST', url: '/api/business/production', headers: viewer(), payload: { recipeId: formula.id, warehouseId, plannedQty: 1, actualOutputQty: 1, productionDate: new Date().toISOString() } });
    expect(forbidden.statusCode).toBe(403);
    const other = await prisma.company.create({ data: { code: `OTHER_${TAG}`, nameTh: 'บริษัทอื่น' } });
    const otherUnit = await prisma.unit.create({ data: { code: `OU_${TAG}`, name: 'หน่วยอื่น' } });
    const otherProduct = await prisma.item.create({ data: { companyId: other.id, code: `OP_${TAG}`, name: 'สินค้าอื่น', type: ItemType.FINISHED_GOOD, baseUnitId: otherUnit.id } });
    const otherRecipe = await prisma.recipe.create({ data: { companyId: other.id, code: `OR_${TAG}`, name: 'สูตรอื่น', productId: otherProduct.id, versions: { create: { versionNo: 1, standardYieldQty: 1, yieldMode: 'ACTUAL', yieldUnitId: otherUnit.id, ingredients: { create: { componentType: 'ITEM', itemId: otherProduct.id, quantity: 1, unitId: otherUnit.id } } } } } });
    const scoped = await createRun(otherRecipe.id, 1, 1); expect(scoped.statusCode).toBe(400); expect(scoped.json().error.code).toBe('RECIPE_NOT_FOUND');
  });

  it('serializes ten concurrent confirms without duplicate posting or negative stock', async () => {
    const raw = await item('RAW_CONCURRENT', ItemType.RAW_MATERIAL, 5); const output = await item('FG_CONCURRENT', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id, 1, 1);
    await receive(raw.id, 5, 5);
    const docs = await Promise.all(Array.from({ length: 10 }, () => createRun(formula.id, 1, 1)));
    const results = await Promise.all(docs.map((doc) => app.inject({ method: 'POST', url: `/api/business/production/${doc.json().data.id}/confirm`, headers: auth() })));
    expect(results.filter((result) => result.statusCode === 200)).toHaveLength(5);
    expect(results.filter((result) => result.statusCode === 409)).toHaveLength(5);
    expect(await onHand(raw.id)).toBeCloseTo(0, 4); expect(await onHand(output.id)).toBeCloseTo(5, 4);
    expect(await prisma.stockLedger.count({ where: { refId: { in: docs.map((doc) => doc.json().data.id) } } })).toBe(10);
  }, 60_000);

  it('uses deterministic multi-line lock order and permits one concurrent reversal only', async () => {
    const a = await item('RAW_ORDER_A', ItemType.RAW_MATERIAL, 2); const b = await item('RAW_ORDER_B', ItemType.RAW_MATERIAL, 3);
    const outputA = await item('FG_ORDER_A', ItemType.FINISHED_GOOD); const outputB = await item('FG_ORDER_B', ItemType.FINISHED_GOOD);
    const make = (productId: string, ingredients: { itemId: string; quantity: number }[]) => prisma.recipe.create({ data: {
      companyId, code: `RM_${productId.slice(-5)}_${TAG}`, name: `สูตรหลายรายการ ${productId.slice(-4)}`, productId,
      versions: { create: { versionNo: 1, standardYieldQty: 1, yieldMode: 'ACTUAL', yieldUnitId: unitId, ingredients: { create: ingredients.map((line, index) => ({ componentType: 'ITEM', itemId: line.itemId, quantity: line.quantity, unitId, sortOrder: index })) } } },
    } });
    const [formulaA, formulaB] = await Promise.all([make(outputA.id, [{ itemId: a.id, quantity: 1 }, { itemId: b.id, quantity: 1 }]), make(outputB.id, [{ itemId: b.id, quantity: 1 }, { itemId: a.id, quantity: 1 }])]);
    await receive(a.id, 2, 2); await receive(b.id, 2, 3);
    const [docA, docB] = await Promise.all([createRun(formulaA.id, 1), createRun(formulaB.id, 1)]);
    const confirmed = await Promise.all([app.inject({ method: 'POST', url: `/api/business/production/${docA.json().data.id}/confirm`, headers: auth() }), app.inject({ method: 'POST', url: `/api/business/production/${docB.json().data.id}/confirm`, headers: auth() })]);
    expect(confirmed.every((result) => result.statusCode === 200)).toBe(true); expect(await onHand(a.id)).toBe(0); expect(await onHand(b.id)).toBe(0);
    const reverseResults = await Promise.all(Array.from({ length: 2 }, () => app.inject({ method: 'POST', url: `/api/business/production/${docA.json().data.id}/reverse`, headers: auth(), payload: { reason: 'concurrent reverse' } })));
    expect(reverseResults.filter((result) => result.statusCode === 200)).toHaveLength(1); expect(reverseResults.filter((result) => result.statusCode === 409)).toHaveLength(1);
    expect(await onHand(a.id)).toBe(1); expect(await onHand(b.id)).toBe(1); expect(await onHand(outputA.id)).toBe(0);
  }, 60_000);

  it('shares stock locks safely with receiving and stock issue', async () => {
    const rawReceiving = await item('RAW_WITH_RECEIVE', ItemType.RAW_MATERIAL, 5); const outputReceiving = await item('FG_WITH_RECEIVE', ItemType.FINISHED_GOOD); const formulaReceiving = await recipe(rawReceiving.id, outputReceiving.id, 1, 1);
    await receive(rawReceiving.id, 1, 5); const docReceiving = (await createRun(formulaReceiving.id, 1)).json().data;
    const [productionResult, receivingResult] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/business/production/${docReceiving.id}/confirm`, headers: auth() }),
      receive(rawReceiving.id, 1, 6),
    ]);
    expect(productionResult.statusCode).toBe(200); expect(receivingResult.statusCode).toBe(201); expect(await onHand(rawReceiving.id)).toBeCloseTo(1, 4); expect(await onHand(outputReceiving.id)).toBeCloseTo(1, 4);

    const rawIssue = await item('RAW_WITH_ISSUE', ItemType.RAW_MATERIAL, 4); const outputIssue = await item('FG_WITH_ISSUE', ItemType.FINISHED_GOOD); const formulaIssue = await recipe(rawIssue.id, outputIssue.id, 1, 1);
    await receive(rawIssue.id, 2, 4); const docIssue = (await createRun(formulaIssue.id, 1)).json().data;
    const [productionWithIssue, issueResult] = await Promise.all([
      app.inject({ method: 'POST', url: `/api/business/production/${docIssue.id}/confirm`, headers: auth() }),
      app.inject({ method: 'POST', url: '/api/business/stock-issues', headers: auth(), payload: { warehouseId, confirm: true, idempotencyKey: `${TAG}-production-issue`, items: [{ itemId: rawIssue.id, issuedQty: 1, unit: unitCode, baseQty: 1 }] } }),
    ]);
    expect(productionWithIssue.statusCode).toBe(200); expect(issueResult.statusCode).toBe(201); expect(await onHand(rawIssue.id)).toBe(0); expect(await onHand(outputIssue.id)).toBe(1);
  }, 60_000);

  it('supports BATCH recipe scaling without inventing a yield conversion', async () => {
    const raw = await item('RAW_BATCH', ItemType.RAW_MATERIAL, 7); const output = await item('FG_BATCH', ItemType.SEMI_FINISHED);
    const formula = await prisma.recipe.create({ data: { companyId, code: `RB_${TAG}`, name: 'สูตร Batch', productId: output.id, versions: { create: { versionNo: 1, standardYieldQty: 1, yieldMode: 'BATCH', ingredients: { create: { componentType: 'ITEM', itemId: raw.id, quantity: 2, unitId } } } } } });
    const preview = await app.inject({ method: 'POST', url: '/api/business/production/preview', headers: auth(), payload: { recipeId: formula.id, plannedQty: 3 } });
    expect(preview.statusCode).toBe(200); expect(preview.json().data.yieldMode).toBe('BATCH'); expect(preview.json().data.materials[0].plannedQty).toBeCloseTo(6, 4);
  });

  it('reports yield, usage/cost variance and explicit waste from immutable snapshots', async () => {
    const raw = await item('RAW_ANALYTICS', ItemType.RAW_MATERIAL, 10); const output = await item('FG_ANALYTICS', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id, 5, 10);
    await receive(raw.id, 100, 10);
    const created = await app.inject({ method: 'POST', url: '/api/business/production', headers: auth(), payload: { recipeId: formula.id, warehouseId, plannedQty: 20, actualOutputQty: 19, productionDate: new Date().toISOString(), materials: [{ itemId: raw.id, actualQty: 12 }], wastes: [{ itemId: raw.id, quantity: 0.3, reason: 'TRIM_LOSS' }, { quantity: 0.1, reason: 'OTHER', note: 'สูญเสียที่ไม่ผูกวัตถุดิบ' }] } });
    expect(created.statusCode).toBe(201); const draft = created.json().data; expect(draft.wastes).toHaveLength(2); expect(draft.wastes[0].totalCost).toBeNull();
    const confirmed = await app.inject({ method: 'POST', url: `/api/business/production/${draft.id}/confirm`, headers: auth() });
    expect(confirmed.statusCode).toBe(200); const detail = confirmed.json().data;
    expect(detail.analytics.output.variance).toBeCloseTo(-1, 4); expect(detail.analytics.output.yieldPercent).toBeCloseTo(95, 4);
    expect(detail.analytics.materialPerformance[0].quantityVariance).toBeCloseTo(2, 4); expect(detail.analytics.materialPerformance[0].quantityVariancePercent).toBeCloseTo(20, 4);
    expect(detail.analytics.materialCost.variance).toBeCloseTo(20, 4); expect(detail.analytics.contributions[0].costVariance).toBeCloseTo(20, 4);
    expect(detail.wastes.find((row: { itemId: string | null }) => row.itemId === raw.id).totalCost).toBeCloseTo(3, 4);
    expect(detail.wastes.find((row: { itemId: string | null }) => row.itemId === null).totalCost).toBeNull();
    await prisma.item.update({ where: { id: raw.id }, data: { lastCost: 999 } });
    const historical = (await app.inject({ method: 'GET', url: `/api/business/production/${draft.id}`, headers: auth() })).json().data;
    expect(historical.wastes.find((row: { itemId: string | null }) => row.itemId === raw.id).totalCost).toBeCloseTo(3, 4);
    const immutable = await app.inject({ method: 'PATCH', url: `/api/business/production/${draft.id}`, headers: auth(), payload: { recipeId: formula.id, warehouseId, plannedQty: 20, actualOutputQty: 19, productionDate: new Date().toISOString(), version: detail.version, wastes: [] } });
    expect(immutable.statusCode).toBe(409);

    const query = `?recipeId=${formula.id}`;
    const [summary, recipes, materials] = await Promise.all([
      app.inject({ method: 'GET', url: `/api/business/production/analytics/summary${query}`, headers: auth() }),
      app.inject({ method: 'GET', url: `/api/business/production/analytics/recipes${query}`, headers: auth() }),
      app.inject({ method: 'GET', url: `/api/business/production/analytics/materials${query}`, headers: auth() }),
    ]);
    expect(summary.statusCode).toBe(200); expect(summary.json().data.completed).toBe(1); expect(summary.json().data.averageYieldPercent).toBeCloseTo(95, 4); expect(summary.json().data.lowSample).toBe(true);
    expect(recipes.json().data[0].runs).toBe(1); expect(recipes.json().data[0].lowSample).toBe(true);
    expect(materials.json().data[0].expectedQty).toBeCloseTo(10, 4); expect(materials.json().data[0].actualQty).toBeCloseTo(12, 4);

    expect((await app.inject({ method: 'POST', url: `/api/business/production/${draft.id}/reverse`, headers: auth(), payload: { reason: 'exclude from analytics' } })).statusCode).toBe(200);
    const afterReverse = await app.inject({ method: 'GET', url: `/api/business/production/analytics/summary${query}`, headers: auth() });
    expect(afterReverse.json().data.completed).toBe(0); expect(afterReverse.json().data.averageYieldPercent).toBeNull();
  });

  it('allocates unique production numbers during concurrent creation and renders A5 PDF', async () => {
    const raw = await item('RAW_NO', ItemType.RAW_MATERIAL, 1); const output = await item('FG_NO', ItemType.FINISHED_GOOD); const formula = await recipe(raw.id, output.id);
    const created = await Promise.all(Array.from({ length: 10 }, () => createRun(formula.id, 1, 1)));
    expect(created.every((result) => result.statusCode === 201)).toBe(true);
    const numbers = created.map((result) => result.json().data.orderNo); expect(new Set(numbers).size).toBe(10);
    const pdf = await app.inject({ method: 'GET', url: `/api/business/production/${created[0].json().data.id}/document.pdf`, headers: auth() });
    expect(pdf.statusCode).toBe(200); expect(pdf.headers['content-type']).toContain('application/pdf'); expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
  }, 60_000);
});
