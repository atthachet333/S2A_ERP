import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const TAG = `po${Date.now().toString().slice(-7)}`;

describe.sequential('purchase orders and receiving match', () => {
  let app: FastifyInstance; let token = ''; let viewerToken = ''; let companyId = ''; let warehouseId = ''; let supplierId = ''; let baseUnitId = ''; let purchaseUnitId = ''; let itemId = '';
  const headers = () => ({ authorization: `Bearer ${token}` });
  const payload = (overrides: Record<string, unknown> = {}) => ({ supplierId, warehouseId, orderDate: new Date().toISOString(), expectedDeliveryAt: new Date(Date.now() + 86_400_000).toISOString(), discount: 5, tax: 7, items: [{ itemId, purchaseUnitId, orderedQty: 5, unitPrice: 100 }], ...overrides });

  beforeAll(async () => {
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;
    const [superRole, viewerRole] = await Promise.all([prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } }), prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } })]);
    for (const [name, roleId] of [[`poadmin_${TAG}`, superRole.id], [`poviewer_${TAG}`, viewerRole.id]] as const) { const user = await prisma.user.create({ data: { username: name, email: `${name}@s2a.local`, passwordHash: await bcrypt.hash('PurchaseOrder123!', 10), fullName: name, mustChangePassword: false } }); await prisma.userRole.create({ data: { userId: user.id, roleId } }); await prisma.companyMembership.create({ data: { userId: user.id, companyId, roleId, isDefault: true } }); }
    baseUnitId = (await prisma.unit.create({ data: { code: `G_${TAG}`, name: 'กรัม' } })).id; purchaseUnitId = (await prisma.unit.create({ data: { code: `KG_${TAG}`, name: 'กิโลกรัม' } })).id;
    warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `POW_${TAG}`, name: 'คลัง PO' } })).id; supplierId = (await prisma.supplier.create({ data: { companyId, code: `POS_${TAG}`, name: 'ผู้ขาย PO', taxId: '0105550000000', phone: '020000000', email: 'po@example.test', address: 'Bangkok' } })).id;
    itemId = (await prisma.item.create({ data: { companyId, code: `POI_${TAG}`, name: 'วัตถุดิบ PO', type: ItemType.RAW_MATERIAL, baseUnitId, purchaseUnitId, purchaseToBaseFactor: 1000, lastCost: 2 } })).id;
    app = await buildApp(); await app.ready();
    const login = async (username: string) => (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'PurchaseOrder123!' } })).json().data.accessToken as string;
    token = await login(`poadmin_${TAG}`); viewerToken = await login(`poviewer_${TAG}`);
  });
  afterAll(async () => { await app.close(); await prisma.$disconnect(); });

  it('creates/edits/confirms manual snapshot POs with concurrent numbering, PDF, and no stock or price history', async () => {
    const ledgerBefore = await prisma.stockLedger.count(); const balanceBefore = await prisma.stockBalance.count(); const historyBefore = await prisma.itemPriceHistory.count({ where: { itemId } });
    const created = await app.inject({ method: 'POST', url: '/api/business/purchase-orders', headers: headers(), payload: payload() }); expect(created.statusCode).toBe(201); let order = created.json().data;
    expect(order.poNo).toMatch(/^PO-\d{8}-\d{4}$/); expect(Number(order.items[0].orderedBaseQty)).toBe(5000); expect(Number(order.subtotal)).toBe(500); expect(Number(order.grandTotal)).toBe(502);
    const edited = await app.inject({ method: 'PATCH', url: `/api/business/purchase-orders/${order.id}`, headers: headers(), payload: payload({ version: order.version, items: [{ itemId, purchaseUnitId, orderedQty: 6, unitPrice: 110 }] }) }); expect(edited.statusCode).toBe(200); order = edited.json().data; expect(Number(order.items[0].lineSubtotal)).toBe(660);
    expect((await app.inject({ method: 'POST', url: `/api/business/purchase-orders/${order.id}/confirm`, headers: headers() })).statusCode).toBe(200);
    expect(await prisma.stockLedger.count()).toBe(ledgerBefore); expect(await prisma.stockBalance.count()).toBe(balanceBefore); expect(await prisma.itemPriceHistory.count({ where: { itemId } })).toBe(historyBefore); expect(Number((await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).lastCost)).toBe(2);
    const pdf = await app.inject({ method: 'GET', url: `/api/business/purchase-orders/${order.id}/document.pdf`, headers: headers() }); expect(pdf.statusCode).toBe(200); expect(pdf.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const concurrent = await Promise.all(Array.from({ length: 5 }, () => app.inject({ method: 'POST', url: '/api/business/purchase-orders', headers: headers(), payload: payload() }))); expect(concurrent.every((response) => response.statusCode === 201)).toBe(true); expect(new Set(concurrent.map((response) => response.json().data.poNo)).size).toBe(5);
  }, 30_000);

  it('tracks partial/full receipts, quantity and price variance, explicit over-receiving, and reversal truth', async () => {
    const po = (await app.inject({ method: 'POST', url: '/api/business/purchase-orders', headers: headers(), payload: payload({ discount: 0, tax: 0 }) })).json().data; await app.inject({ method: 'POST', url: `/api/business/purchase-orders/${po.id}/confirm`, headers: headers() }); const lineId = po.items[0].id;
    const first = await app.inject({ method: 'POST', url: '/api/business/receiving', headers: headers(), payload: { purchaseOrderId: po.id, supplierId, warehouseId, items: [{ itemId, purchaseOrderItemId: lineId, quantity: 2, unitPrice: 105 }] } }); expect(first.statusCode).toBe(201); expect((await app.inject({ method: 'POST', url: `/api/business/receiving/${first.json().data.id}/confirm`, headers: headers(), payload: {} })).statusCode).toBe(200);
    let detail = (await app.inject({ method: 'GET', url: `/api/business/purchase-orders/${po.id}`, headers: headers() })).json().data; expect(detail.status).toBe('PARTIALLY_RECEIVED'); expect(detail.items[0].receivedQty).toBe(2); expect(detail.items[0].remainingQty).toBe(3); expect(detail.items[0].priceVariance).toBe(5); expect(detail.items[0].priceVariancePercent).toBeCloseTo(5, 4);
    const second = await app.inject({ method: 'POST', url: '/api/business/receiving', headers: headers(), payload: { purchaseOrderId: po.id, supplierId, warehouseId, items: [{ itemId, purchaseOrderItemId: lineId, quantity: 3, unitPrice: 95 }] } }); await app.inject({ method: 'POST', url: `/api/business/receiving/${second.json().data.id}/confirm`, headers: headers(), payload: {} }); detail = (await app.inject({ method: 'GET', url: `/api/business/purchase-orders/${po.id}`, headers: headers() })).json().data; expect(detail.status).toBe('RECEIVED'); expect(detail.items[0].receivedQty).toBe(5);
    expect((await app.inject({ method: 'POST', url: `/api/business/receiving/${second.json().data.id}/reverse`, headers: headers(), payload: { reason: 'supplier return' } })).statusCode).toBe(200); detail = (await app.inject({ method: 'GET', url: `/api/business/purchase-orders/${po.id}`, headers: headers() })).json().data; expect(detail.status).toBe('PARTIALLY_RECEIVED'); expect(detail.items[0].receivedQty).toBe(2);
    const excess = await app.inject({ method: 'POST', url: '/api/business/receiving', headers: headers(), payload: { purchaseOrderId: po.id, supplierId, warehouseId, items: [{ itemId, purchaseOrderItemId: lineId, quantity: 4, unitPrice: 100 }] } }); const rejected = await app.inject({ method: 'POST', url: `/api/business/receiving/${excess.json().data.id}/confirm`, headers: headers(), payload: {} }); expect(rejected.statusCode).toBe(409); expect(rejected.json().error.code).toBe('OVER_RECEIVE_ACK_REQUIRED'); expect((await app.inject({ method: 'POST', url: `/api/business/receiving/${excess.json().data.id}/confirm`, headers: headers(), payload: { overReceiveAcknowledged: true } })).statusCode).toBe(200);
  }, 30_000);

  it('links READY plan requirements, reports ordered state, enforces cancellation, permissions and company scope', async () => {
    const plan = await prisma.purchasePlan.create({ data: { companyId, planNo: `PP-LINK-${TAG}`, status: 'READY', planDate: new Date(), warehouseId, requirements: { create: { itemId, itemCode: `POI_${TAG}`, itemName: 'วัตถุดิบ PO', requiredQty: 5000, onHandQty: 0, reservedQty: 0, availableQty: 0, shortageQty: 5000, baseUnitCode: `G_${TAG}`, purchaseUnitCode: `KG_${TAG}`, purchaseToBaseFactor: 1000, purchaseQty: 5, lastPurchasePrice: 100, sources: [] } } }, include: { requirements: true } });
    const reqId = plan.requirements[0].id; const created = await app.inject({ method: 'POST', url: '/api/business/purchase-orders', headers: headers(), payload: payload({ purchasePlanId: plan.id, items: [{ itemId, purchaseUnitId, purchasePlanRequirementId: reqId, orderedQty: 2, unitPrice: 100 }] }) }); expect(created.statusCode).toBe(201); const po = created.json().data;
    const planDetail = (await app.inject({ method: 'GET', url: `/api/business/purchase-planning/${plan.id}`, headers: headers() })).json().data; expect(planDetail.requirements[0].orderedQty).toBe(2); expect(planDetail.requirements[0].orderState).toBe('PARTIALLY_ORDERED');
    expect((await app.inject({ method: 'GET', url: `/api/business/purchase-orders/${po.id}`, headers: { authorization: `Bearer ${viewerToken}` } })).statusCode).toBe(403);
    const other = await prisma.company.create({ data: { code: `POC_${TAG}`, nameTh: 'บริษัท PO อื่น' } }); const otherSupplier = await prisma.supplier.create({ data: { companyId: other.id, code: `POSO_${TAG}`, name: 'ผู้ขายอื่น' } }); expect((await app.inject({ method: 'POST', url: '/api/business/purchase-orders', headers: headers(), payload: payload({ supplierId: otherSupplier.id }) })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `/api/business/purchase-orders/${po.id}/cancel`, headers: headers(), payload: { reason: 'ยกเลิกการสั่ง' } })).statusCode).toBe(200);
    const confirmed = (await app.inject({ method: 'POST', url: '/api/business/purchase-orders', headers: headers(), payload: payload() })).json().data; await app.inject({ method: 'POST', url: `/api/business/purchase-orders/${confirmed.id}/confirm`, headers: headers() }); expect((await app.inject({ method: 'POST', url: `/api/business/purchase-orders/${confirmed.id}/cancel`, headers: headers(), payload: { reason: 'supplier unavailable' } })).statusCode).toBe(200);
  });
});
