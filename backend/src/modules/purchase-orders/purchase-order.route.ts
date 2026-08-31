import type { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma, PurchaseOrderStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import { nextDocumentNo } from '../../lib/inventory-ledger.js';
import { withDocumentNumberRetry } from '../../lib/tx-retry.js';
import { num } from '../../lib/http.js';
import { renderBusinessPdf, type BusinessDocument } from '../business/document.service.js';
import { purchaseOrderInclude, serializePurchaseOrder } from './purchase-order.service.js';

const VIEW = requirePermission('PURCHASE_ORDER_VIEW', 'PURCHASE_ORDER_CREATE', 'PURCHASE_ORDER_EDIT');
const CREATE = requirePermission('PURCHASE_ORDER_CREATE');
const EDIT = requirePermission('PURCHASE_ORDER_EDIT', 'PURCHASE_ORDER_CREATE');
const CONFIRM = requirePermission('PURCHASE_ORDER_CONFIRM');
const CANCEL = requirePermission('PURCHASE_ORDER_CANCEL');

const lineInput = z.object({
  itemId: z.string().min(1), purchasePlanRequirementId: z.string().optional().nullable(),
  purchaseUnitId: z.string().optional().nullable(), orderedQty: z.coerce.number().positive(),
  unitPrice: z.coerce.number().min(0), note: z.string().max(300).optional().nullable(),
});
const orderInput = z.object({
  supplierId: z.string().min(1), warehouseId: z.string().min(1), purchasePlanId: z.string().optional().nullable(),
  orderDate: z.coerce.date(), expectedDeliveryAt: z.coerce.date().optional().nullable(),
  discount: z.coerce.number().min(0).default(0), tax: z.coerce.number().min(0).default(0),
  note: z.string().max(1000).optional().nullable(), items: z.array(lineInput).min(1),
});
const editInput = orderInput.extend({ version: z.number().int().positive() });

function errorReply(reply: FastifyReply, error: unknown) {
  const message = error instanceof Error ? error.message : 'PURCHASE_ORDER_FAILED';
  const map: Record<string, [number, string]> = {
    PURCHASE_ORDER_NOT_FOUND: [404, 'ไม่พบใบสั่งซื้อ'], PURCHASE_ORDER_NOT_DRAFT: [409, 'แก้ไขได้เฉพาะใบสั่งซื้อร่าง'],
    SUPPLIER_NOT_FOUND: [404, 'ไม่พบผู้ขายในบริษัทปัจจุบัน'], WAREHOUSE_NOT_FOUND: [404, 'ไม่พบคลังในบริษัทปัจจุบัน'],
    ITEM_NOT_IN_COMPANY: [400, 'มีรายการที่ไม่อยู่ในบริษัทปัจจุบัน'], PLAN_NOT_READY: [409, 'สร้างใบสั่งซื้อได้จากแผนสถานะ READY เท่านั้น'],
    PLAN_REQUIREMENT_INVALID: [400, 'รายการแผนไม่ตรงกับวัตถุดิบหรือบริษัทปัจจุบัน'], VERSION_CONFLICT: [409, 'ข้อมูลถูกแก้ไขแล้ว กรุณาโหลดใหม่'],
    PURCHASE_ORDER_NOT_CONFIRMABLE: [409, 'ยืนยันได้เฉพาะใบสั่งซื้อร่าง'], PURCHASE_ORDER_HAS_RECEIPTS: [409, 'ยกเลิกไม่ได้เพราะมีประวัติรับของแล้ว'],
    PURCHASE_ORDER_NOT_CANCELLABLE: [409, 'สถานะนี้ไม่สามารถยกเลิกได้'],
  };
  const hit = map[message];
  if (hit) return reply.status(hit[0]).send(fail(message, hit[1]));
  throw error;
}

async function snapshots(companyId: string, body: z.infer<typeof orderInput>) {
  const [supplier, warehouse, items, plan] = await Promise.all([
    prisma.supplier.findFirst({ where: { id: body.supplierId, companyId, isActive: true, deletedAt: null } }),
    prisma.warehouse.findFirst({ where: { id: body.warehouseId, companyId, isActive: true, deletedAt: null } }),
    prisma.item.findMany({ where: { id: { in: [...new Set(body.items.map((line) => line.itemId))] }, companyId, deletedAt: null }, include: { baseUnit: true, purchaseUnit: true } }),
    body.purchasePlanId ? prisma.purchasePlan.findFirst({ where: { id: body.purchasePlanId, companyId }, include: { requirements: true } }) : null,
  ]);
  if (!supplier) throw new Error('SUPPLIER_NOT_FOUND');
  if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');
  if (items.length !== new Set(body.items.map((line) => line.itemId)).size) throw new Error('ITEM_NOT_IN_COMPANY');
  if (body.purchasePlanId && plan?.status !== 'READY') throw new Error('PLAN_NOT_READY');
  const itemOf = new Map(items.map((item) => [item.id, item]));
  const requirementOf = new Map(plan?.requirements.map((line) => [line.id, line]) ?? []);
  const lines = body.items.map((line) => {
    const item = itemOf.get(line.itemId)!;
    const requirement = line.purchasePlanRequirementId ? requirementOf.get(line.purchasePlanRequirementId) : null;
    if (line.purchasePlanRequirementId && (!requirement || requirement.itemId !== line.itemId)) throw new Error('PLAN_REQUIREMENT_INVALID');
    const usingBase = line.purchaseUnitId === item.baseUnitId;
    if (line.purchaseUnitId && !usingBase && line.purchaseUnitId !== item.purchaseUnitId) throw new Error('PLAN_REQUIREMENT_INVALID');
    const factor = requirement?.purchaseToBaseFactor ? num(requirement.purchaseToBaseFactor) : usingBase ? 1 : num(item.purchaseToBaseFactor) || 1;
    const unitCode = requirement?.purchaseUnitCode ?? (usingBase ? item.baseUnit.code : item.purchaseUnit?.code ?? item.baseUnit.code);
    return {
      itemId: item.id, purchasePlanRequirementId: line.purchasePlanRequirementId ?? null,
      itemCode: item.code, itemName: item.name, purchaseUnitId: line.purchaseUnitId ?? item.purchaseUnitId ?? item.baseUnitId,
      purchaseUnitCode: unitCode, purchaseToBaseFactor: new Prisma.Decimal(factor),
      orderedQty: new Prisma.Decimal(line.orderedQty), orderedBaseQty: new Prisma.Decimal(line.orderedQty).mul(factor),
      unitPrice: new Prisma.Decimal(line.unitPrice), lineSubtotal: new Prisma.Decimal(line.orderedQty).mul(line.unitPrice), note: line.note ?? null,
    };
  });
  const subtotal = lines.reduce((sum, line) => sum.plus(line.lineSubtotal), new Prisma.Decimal(0));
  return { supplier, warehouse, plan, lines, subtotal, grandTotal: Prisma.Decimal.max(0, subtotal.minus(body.discount).plus(body.tax)) };
}

export default async function purchaseOrderRoutes(app: FastifyInstance) {
  app.get('/purchase-orders/lookups', { preHandler: VIEW }, async (req) => {
    const companyId = req.user.companyId!;
    const [suppliers, warehouses, items, plans] = await Promise.all([
      prisma.supplier.findMany({ where: { companyId, isActive: true, deletedAt: null }, orderBy: { name: 'asc' } }),
      prisma.warehouse.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ where: { companyId, isActive: true, deletedAt: null }, include: { baseUnit: true, purchaseUnit: true, goodsReceiptItems: { where: { goodsReceipt: { status: 'CONFIRMED' } }, orderBy: { goodsReceipt: { receiptDate: 'desc' } }, take: 1 } }, orderBy: { name: 'asc' } }),
      prisma.purchasePlan.findMany({ where: { companyId, status: 'READY' }, include: { requirements: { where: { shortageQty: { gt: 0 } }, include: { purchaseOrderItems: { where: { purchaseOrder: { status: { not: PurchaseOrderStatus.CANCELLED } } }, select: { orderedQty: true } } } } }, orderBy: { planDate: 'desc' }, take: 50 }),
    ]);
    return ok({ suppliers, warehouses, items: items.map((item) => ({ ...item, latestPurchasePrice: item.goodsReceiptItems[0] ? num(item.goodsReceiptItems[0].unitPrice) : null })), plans: plans.map((plan) => ({ ...plan, requirements: plan.requirements.map((line) => ({ ...line, orderedQty: line.purchaseOrderItems.reduce((sum, entry) => sum + num(entry.orderedQty), 0) })) })) });
  });

  app.get('/purchase-orders', { preHandler: VIEW }, async (req) => {
    const q = z.object({ status: z.nativeEnum(PurchaseOrderStatus).optional(), supplierId: z.string().optional(), overdue: z.coerce.boolean().optional() }).parse(req.query ?? {});
    const rows = await prisma.purchaseOrder.findMany({ where: { companyId: req.user.companyId!, status: q.status, supplierId: q.supplierId, ...(q.overdue ? { expectedDeliveryAt: { lt: new Date() }, status: { in: [PurchaseOrderStatus.CONFIRMED, PurchaseOrderStatus.PARTIALLY_RECEIVED] } } : {}) }, include: purchaseOrderInclude, orderBy: { createdAt: 'desc' }, take: 200 });
    return ok(rows.map(serializePurchaseOrder));
  });

  app.get('/purchase-orders/:id', { preHandler: VIEW }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params); const row = await prisma.purchaseOrder.findFirst({ where: { id, companyId: req.user.companyId! }, include: purchaseOrderInclude });
    if (!row) return reply.status(404).send(fail('PURCHASE_ORDER_NOT_FOUND', 'ไม่พบใบสั่งซื้อ'));
    const auditTrail = await prisma.auditLog.findMany({ where: { companyId: req.user.companyId!, entity: 'PurchaseOrder', entityId: row.id }, select: { id: true, action: true, createdAt: true, before: true, after: true, user: { select: { fullName: true } } }, orderBy: { createdAt: 'asc' } });
    return ok({ ...serializePurchaseOrder(row), auditTrail });
  });

  app.post('/purchase-orders', { preHandler: CREATE }, async (req, reply) => {
    try {
      const body = orderInput.parse(req.body); const companyId = req.user.companyId!; const snap = await snapshots(companyId, body);
      const id = await withDocumentNumberRetry(() => prisma.$transaction(async (tx) => {
        const poNo = await nextDocumentNo(tx, companyId, 'PURCHASE_ORDER', body.orderDate);
        const order = await tx.purchaseOrder.create({ data: { companyId, poNo, supplierId: body.supplierId, warehouseId: body.warehouseId, purchasePlanId: body.purchasePlanId ?? null, orderDate: body.orderDate, expectedDeliveryAt: body.expectedDeliveryAt, subtotal: snap.subtotal, discount: body.discount, tax: body.tax, grandTotal: snap.grandTotal, note: body.note, createdById: req.user.sub, updatedById: req.user.sub, items: { create: snap.lines } } });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PURCHASE_ORDER_CREATED', entity: 'PurchaseOrder', entityId: order.id, after: { poNo, purchasePlanId: body.purchasePlanId ?? null, lineCount: snap.lines.length } } }); return order.id;
      }));
      return reply.status(201).send(ok(serializePurchaseOrder(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: purchaseOrderInclude }))));
    } catch (error) { return errorReply(reply, error); }
  });

  app.patch('/purchase-orders/:id', { preHandler: EDIT }, async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string() }).parse(req.params); const body = editInput.parse(req.body); const companyId = req.user.companyId!;
      const current = await prisma.purchaseOrder.findFirst({ where: { id, companyId } }); if (!current) throw new Error('PURCHASE_ORDER_NOT_FOUND'); if (current.status !== PurchaseOrderStatus.DRAFT) throw new Error('PURCHASE_ORDER_NOT_DRAFT');
      const snap = await snapshots(companyId, body); await prisma.$transaction(async (tx) => { const changed = await tx.purchaseOrder.updateMany({ where: { id, companyId, status: PurchaseOrderStatus.DRAFT, version: body.version }, data: { supplierId: body.supplierId, warehouseId: body.warehouseId, purchasePlanId: body.purchasePlanId ?? null, orderDate: body.orderDate, expectedDeliveryAt: body.expectedDeliveryAt, subtotal: snap.subtotal, discount: body.discount, tax: body.tax, grandTotal: snap.grandTotal, note: body.note, updatedById: req.user.sub, version: { increment: 1 } } }); if (changed.count !== 1) throw new Error('VERSION_CONFLICT'); await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } }); await tx.purchaseOrderItem.createMany({ data: snap.lines.map((line) => ({ ...line, purchaseOrderId: id })) }); await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PURCHASE_ORDER_UPDATED', entity: 'PurchaseOrder', entityId: id } }); });
      return ok(serializePurchaseOrder(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: purchaseOrderInclude })));
    } catch (error) { return errorReply(reply, error); }
  });

  app.post('/purchase-orders/:id/confirm', { preHandler: CONFIRM }, async (req, reply) => {
    try { const { id } = z.object({ id: z.string() }).parse(req.params); const companyId = req.user.companyId!; await prisma.$transaction(async (tx) => { const changed = await tx.purchaseOrder.updateMany({ where: { id, companyId, status: PurchaseOrderStatus.DRAFT }, data: { status: PurchaseOrderStatus.CONFIRMED, confirmedAt: new Date(), updatedById: req.user.sub, version: { increment: 1 } } }); if (changed.count !== 1) throw new Error('PURCHASE_ORDER_NOT_CONFIRMABLE'); await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PURCHASE_ORDER_CONFIRMED', entity: 'PurchaseOrder', entityId: id } }); }); return ok(serializePurchaseOrder(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: purchaseOrderInclude }))); } catch (error) { return errorReply(reply, error); }
  });

  app.post('/purchase-orders/:id/cancel', { preHandler: CANCEL }, async (req, reply) => {
    try { const { id } = z.object({ id: z.string() }).parse(req.params); const { reason } = z.object({ reason: z.string().trim().min(1).max(500) }).parse(req.body); const companyId = req.user.companyId!; await prisma.$transaction(async (tx) => { const order = await tx.purchaseOrder.findFirst({ where: { id, companyId } }); if (!order) throw new Error('PURCHASE_ORDER_NOT_FOUND'); if (order.status !== PurchaseOrderStatus.DRAFT && order.status !== PurchaseOrderStatus.CONFIRMED) throw new Error('PURCHASE_ORDER_NOT_CANCELLABLE'); if (await tx.goodsReceipt.count({ where: { purchaseOrderId: id, status: { in: ['CONFIRMED','REVERSED'] } } })) throw new Error('PURCHASE_ORDER_HAS_RECEIPTS'); await tx.purchaseOrder.update({ where: { id }, data: { status: PurchaseOrderStatus.CANCELLED, cancellationReason: reason, cancelledAt: new Date(), updatedById: req.user.sub, version: { increment: 1 } } }); await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PURCHASE_ORDER_CANCELLED', entity: 'PurchaseOrder', entityId: id, after: { reason } } }); }); return ok(serializePurchaseOrder(await prisma.purchaseOrder.findUniqueOrThrow({ where: { id }, include: purchaseOrderInclude }))); } catch (error) { return errorReply(reply, error); }
  });

  app.get('/purchase-orders/:id/receiving-prefill', { preHandler: [VIEW, requirePermission('RECEIVING_CREATE')] }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params); const row = await prisma.purchaseOrder.findFirst({ where: { id, companyId: req.user.companyId!, status: { in: [PurchaseOrderStatus.CONFIRMED, PurchaseOrderStatus.PARTIALLY_RECEIVED] } }, include: purchaseOrderInclude });
    if (!row) return reply.status(404).send(fail('PURCHASE_ORDER_NOT_RECEIVABLE', 'ไม่พบใบสั่งซื้อที่รับของได้'));
    const data = serializePurchaseOrder(row); return ok({ purchaseOrderId: row.id, poNo: row.poNo, supplierId: row.supplierId, warehouseId: row.warehouseId, items: data.items.filter((line) => line.remainingQty > 0).map((line) => ({ itemId: line.itemId, purchaseOrderItemId: line.id, quantity: line.remainingQty, unitPrice: num(line.unitPrice), purchaseUnitCode: line.purchaseUnitCode, purchaseToBaseFactor: num(line.purchaseToBaseFactor), orderedQty: num(line.orderedQty), previouslyReceivedQty: line.receivedQty, remainingQty: line.remainingQty })) });
  });

  app.get('/purchase-orders/:id/document.pdf', { preHandler: [VIEW, requirePermission('DOCUMENT_DOWNLOAD')] }, async (req, reply) => {
    const { id } = z.object({ id: z.string() }).parse(req.params); const companyId = req.user.companyId!; const [row, company] = await Promise.all([prisma.purchaseOrder.findFirst({ where: { id, companyId }, include: purchaseOrderInclude }), prisma.company.findUnique({ where: { id: companyId } })]); if (!row || !company) return reply.status(404).send(fail('PURCHASE_ORDER_NOT_FOUND', 'ไม่พบใบสั่งซื้อ'));
    const document: BusinessDocument = { type: 'PURCHASE_ORDER', title: 'PURCHASE_ORDER', documentNo: row.poNo, date: row.orderDate, company: { nameTh: company.nameTh, nameEn: company.nameEn, logoUrl: company.logoUrl, address: company.address, phone: company.phone, email: company.email, taxId: company.taxId, website: company.website, lineId: company.lineId, documentFooter: company.documentFooter }, status: row.status, subject: [{ label: 'ผู้ขาย', value: row.supplier.name }, ...(row.supplier.taxId ? [{ label: 'เลขผู้เสียภาษี', value: row.supplier.taxId }] : []), ...(row.supplier.phone ? [{ label: 'โทร', value: row.supplier.phone }] : []), ...(row.supplier.email ? [{ label: 'อีเมล', value: row.supplier.email }] : []), ...(row.supplier.address ? [{ label: 'ที่อยู่', value: row.supplier.address }] : []), ...(row.expectedDeliveryAt ? [{ label: 'กำหนดส่ง', value: row.expectedDeliveryAt.toISOString().slice(0, 10) }] : [])], lines: row.items.map((line) => ({ name: line.itemName, detail: line.itemCode, quantity: num(line.orderedQty), unit: line.purchaseUnitCode, price: num(line.unitPrice), total: num(line.lineSubtotal) })), summary: [{ label: 'ยอดก่อนส่วนลด', value: num(row.subtotal) }, { label: 'ส่วนลด', value: num(row.discount) }, { label: 'ภาษี', value: num(row.tax) }, { label: 'ยอดรวม', value: num(row.grandTotal) }], note: row.note ?? undefined };
    return reply.header('Content-Type', 'application/pdf').send(await renderBusinessPdf(document));
  });
}
