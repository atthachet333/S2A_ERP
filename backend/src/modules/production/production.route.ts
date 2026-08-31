import { Prisma, ProductionStatus, StockMovementType } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import { num } from '../../lib/http.js';
import {
  applyMovement, InsufficientStockError, lockBalancePairs, nextDocumentNo, reverseDocument,
} from '../../lib/inventory-ledger.js';
import { withDocumentNumberRetry, withStockLockRetry } from '../../lib/tx-retry.js';
import { buildProductionPlan, ProductionCalculationError } from './production.service.js';
import { renderBusinessPdf, type BusinessDocument } from '../business/document.service.js';
import { assertLotPolicy, ensureInventoryLot, LotPolicyError, validateLotAllocations } from '../../lib/inventory-lot.js';

const D = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value);
const VIEW = requirePermission('PRODUCTION_VIEW', 'PRODUCTION_CREATE');
const CREATE = requirePermission('PRODUCTION_CREATE');
const CONFIRM = requirePermission('PRODUCTION_CONFIRM');
const REVERSE = requirePermission('PRODUCTION_REVERSE');

const WASTE_REASONS = ['TRIM_LOSS', 'SPILLAGE', 'DAMAGED', 'OVERCOOKED', 'EXPIRED_DURING_PRODUCTION', 'QUALITY_REJECT', 'OTHER'] as const;
const wasteInput = z.object({
  itemId: z.string().min(1).optional().nullable(), quantity: z.number().positive(),
  reason: z.enum(WASTE_REASONS), note: z.string().trim().max(1000).optional().nullable(),
}).superRefine((value, context) => {
  if (value.reason === 'OTHER' && !value.note) context.addIssue({ code: z.ZodIssueCode.custom, path: ['note'], message: 'กรุณาระบุรายละเอียดสำหรับเหตุผลอื่น' });
});

const lotAllocationInput = z.object({ lotId: z.string().min(1), quantity: z.number().positive() });
const materialInput = z.object({ itemId: z.string().min(1), actualQty: z.number().nonnegative(), allocations: z.array(lotAllocationInput).default([]) });
const draftInput = z.object({
  recipeId: z.string().min(1), recipeVersionId: z.string().min(1).optional().nullable(),
  warehouseId: z.string().min(1), outputWarehouseId: z.string().min(1).optional().nullable(),
  plannedQty: z.number().positive(), actualOutputQty: z.number().positive(),
  productionDate: z.coerce.date(), note: z.string().max(1000).optional().nullable(),
  outputLotNo: z.string().trim().max(80).optional().nullable(), manufactureDate: z.coerce.date().optional().nullable(), expiryDate: z.coerce.date().optional().nullable(),
  materials: z.array(materialInput).optional(),
  wastes: z.array(wasteInput).max(100).optional(),
});
const editInput = draftInput.extend({ version: z.number().int().positive() });
const reverseInput = z.object({ reason: z.string().trim().min(1).max(500) });

const detailInclude = {
  recipe: { select: { id: true, code: true, name: true } },
  recipeVersion: { select: { id: true, versionNo: true, yieldMode: true } },
  product: { include: { baseUnit: true } },
  materialWarehouse: true, fgWarehouse: true,
  materials: { orderBy: { itemId: 'asc' as const }, include: { item: { include: { baseUnit: true } }, lotAllocations: { include: { lot: true } } } },
  outputs: { orderBy: { createdAt: 'asc' as const }, include: { item: { include: { baseUnit: true } }, inventoryLot: true } },
  wastes: { orderBy: { recordedAt: 'asc' as const }, include: { item: { include: { baseUnit: true } } } },
} satisfies Prisma.ProductionOrderInclude;

type Detail = Prisma.ProductionOrderGetPayload<{ include: typeof detailInclude }>;

async function availableOf(detail: Detail) {
  const ids = detail.materials.map((line) => line.itemId);
  const rows = ids.length && detail.materialWarehouseId ? await prisma.stockBalance.findMany({
    where: { warehouseId: detail.materialWarehouseId, itemId: { in: ids }, locationId: null, lotId: null },
    select: { itemId: true, onHand: true, reserved: true },
  }) : [];
  return new Map(rows.map((row) => [row.itemId, num(row.onHand) - num(row.reserved)]));
}

async function serializeDetail(detail: Detail) {
  const available = await availableOf(detail);
  const ledgers = await prisma.stockLedger.findMany({
    where: { refType: 'PRODUCTION_ORDER', refId: detail.id }, orderBy: { createdAt: 'asc' },
    include: { item: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } },
  });
  const measurableOutput = detail.recipeVersion?.yieldMode !== 'BATCH' && num(detail.plannedQty) > 0;
  const outputVariance = measurableOutput ? num(detail.producedQty) - num(detail.plannedQty) : null;
  const materialPerformance = detail.materials.map((line) => {
    const quantityVariance = num(line.actualQty) - num(line.plannedQty);
    const costVariance = num(line.totalCost) - num(line.plannedTotalCost);
    return { itemId: line.itemId, quantityVariance, quantityVariancePercent: num(line.plannedQty) > 0 ? quantityVariance / num(line.plannedQty) * 100 : null, costVariance };
  });
  return {
    ...detail,
    plannedQty: num(detail.plannedQty), producedQty: num(detail.producedQty), standardCost: num(detail.standardCost),
    actualCost: num(detail.actualCost), actualUnitCost: num(detail.actualUnitCost),
    materials: detail.materials.map((line) => ({
      ...line, plannedQty: num(line.plannedQty), actualQty: num(line.actualQty),
      plannedUnitCost: num(line.plannedUnitCost), plannedTotalCost: num(line.plannedTotalCost),
      unitCost: num(line.unitCost), totalCost: num(line.totalCost), availableQty: available.get(line.itemId) ?? 0,
    })),
    outputs: detail.outputs.map((line) => ({ ...line, quantity: num(line.quantity), unitCost: num(line.unitCost) })),
    wastes: detail.wastes.map((line) => ({ ...line, quantity: num(line.quantity), unitCost: line.unitCost == null ? null : num(line.unitCost), totalCost: line.totalCost == null ? null : num(line.totalCost) })),
    ledgers: ledgers.map((line) => ({ ...line, beforeQty: num(line.beforeQty), qtyIn: num(line.qtyIn), qtyOut: num(line.qtyOut), balanceAfter: num(line.balanceAfter), unitCost: num(line.unitCost), totalValue: num(line.totalValue) })),
    analytics: {
      output: { measurable: measurableOutput, variance: outputVariance, variancePercent: outputVariance == null ? null : outputVariance / num(detail.plannedQty) * 100, yieldPercent: measurableOutput ? num(detail.producedQty) / num(detail.plannedQty) * 100 : null },
      materialCost: { standard: num(detail.standardCost), actual: num(detail.actualCost), variance: num(detail.actualCost) - num(detail.standardCost), variancePercent: num(detail.standardCost) > 0 ? (num(detail.actualCost) - num(detail.standardCost)) / num(detail.standardCost) * 100 : null },
      materialPerformance,
      contributions: materialPerformance.filter((line) => Math.abs(line.costVariance) > 1e-9).sort((a, b) => Math.abs(b.costVariance) - Math.abs(a.costVariance)),
      waste: { recorded: detail.wastes.length > 0, knownCost: detail.wastes.reduce((sum, line) => sum + (line.totalCost == null ? 0 : num(line.totalCost)), 0), uncostedCount: detail.wastes.filter((line) => line.totalCost == null).length },
    },
  };
}

const filterInput = z.object({
  dateFrom: z.string().date().optional(), dateTo: z.string().date().optional(), recipeId: z.string().optional(),
  productId: z.string().optional(), warehouseId: z.string().optional(), status: z.nativeEnum(ProductionStatus).optional(),
  wasteReason: z.enum(WASTE_REASONS).optional(),
});

function productionWhere(companyId: string, filters: z.infer<typeof filterInput>, completedOnly = false): Prisma.ProductionOrderWhereInput {
  const dateRange = filters.dateFrom || filters.dateTo ? {
    ...(filters.dateFrom ? { gte: new Date(`${filters.dateFrom}T00:00:00.000Z`) } : {}),
    ...(filters.dateTo ? { lte: new Date(`${filters.dateTo}T23:59:59.999Z`) } : {}),
  } : undefined;
  return {
    companyId, status: completedOnly ? ProductionStatus.COMPLETED : filters.status,
    recipeId: filters.recipeId, productId: filters.productId, materialWarehouseId: filters.warehouseId,
    productionDate: dateRange,
    ...(filters.wasteReason ? { wastes: { some: { reason: filters.wasteReason } } } : {}),
  };
}

async function assertWasteItems(companyId: string, wastes: z.infer<typeof wasteInput>[]) {
  const ids = [...new Set(wastes.flatMap((line) => line.itemId ? [line.itemId] : []))];
  if (!ids.length) return new Map<string, string>();
  const items = await prisma.item.findMany({ where: { companyId, id: { in: ids }, isActive: true, deletedAt: null }, select: { id: true, baseUnit: { select: { code: true } } } });
  if (items.length !== ids.length) throw new ProductionCalculationError('WASTE_ITEM_NOT_FOUND', 'ไม่พบรายการของเสียในบริษัทปัจจุบัน');
  return new Map(items.map((item) => [item.id, item.baseUnit.code]));
}

async function findDetail(companyId: string, id: string) {
  return prisma.productionOrder.findFirst({ where: { id, companyId }, include: detailInclude });
}

function actualQtyOf(plan: Awaited<ReturnType<typeof buildProductionPlan>>, overrides?: z.infer<typeof materialInput>[]) {
  const provided = new Map((overrides ?? []).map((line) => [line.itemId, line]));
  if (provided.size !== (overrides ?? []).length) throw new ProductionCalculationError('DUPLICATE_MATERIAL', 'รายการวัตถุดิบจริงซ้ำกัน');
  for (const id of provided.keys()) if (!plan.materials.some((line) => line.itemId === id)) throw new ProductionCalculationError('UNKNOWN_MATERIAL', 'พบวัตถุดิบที่ไม่ได้อยู่ในสูตร');
  return plan.materials.map((line) => ({ ...line, actualQty: provided.get(line.itemId)?.actualQty ?? line.plannedQty, allocations: provided.get(line.itemId)?.allocations ?? [] }));
}

async function assertWarehouses(companyId: string, sourceId: string, outputId: string) {
  const count = await prisma.warehouse.count({ where: { companyId, id: { in: [...new Set([sourceId, outputId])] }, isActive: true, deletedAt: null } });
  if (count !== new Set([sourceId, outputId]).size) throw new ProductionCalculationError('WAREHOUSE_NOT_FOUND', 'ไม่พบคลังที่เลือกในบริษัทปัจจุบัน');
}

function sendError(reply: FastifyReply, error: unknown) {
  if (error instanceof LotPolicyError) return reply.status(409).send(fail(error.code, error.message, error.details));
  if (error instanceof ProductionCalculationError) return reply.status(400).send(fail(error.code, error.message));
  if (error instanceof InsufficientStockError) return reply.status(409).send(fail('INSUFFICIENT_STOCK', error.message, { itemId: error.itemId, available: error.available, requested: error.requested }));
  const message = error instanceof Error ? error.message : 'PRODUCTION_FAILED';
  if (message === 'PRODUCTION_NOT_DRAFT') return reply.status(409).send(fail(message, 'ใบผลิตนี้ไม่ใช่ร่าง หรือถูกดำเนินการไปแล้ว'));
  if (message === 'PRODUCTION_NOT_COMPLETED') return reply.status(409).send(fail(message, 'กลับรายการได้เฉพาะใบผลิตที่ยืนยันแล้ว'));
  if (message === 'PRODUCTION_VERSION_CONFLICT') return reply.status(409).send(fail(message, 'ใบผลิตถูกแก้ไขจากหน้าจออื่น กรุณาโหลดใหม่'));
  throw error;
}

export default async function productionRoutes(app: FastifyInstance) {
  app.get('/production/lookups', { preHandler: VIEW }, async (req) => {
    const companyId = req.user.companyId!;
    const [recipes, warehouses] = await Promise.all([
      prisma.recipe.findMany({
        where: { companyId, isActive: true, deletedAt: null, versions: { some: { isActive: true } } },
        select: { id: true, code: true, name: true, product: { select: { id: true, code: true, name: true, isLotTracked: true, isExpiryTracked: true, baseUnit: { select: { code: true } } } }, versions: { where: { isActive: true }, orderBy: { versionNo: 'desc' }, take: 1, select: { id: true, versionNo: true, yieldMode: true, standardYieldQty: true, yieldPercent: true, yieldUnit: { select: { code: true } } } } },
        orderBy: { name: 'asc' },
      }),
      prisma.warehouse.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    return ok({ recipes: recipes.map((recipe) => ({ ...recipe, versions: recipe.versions.map((v) => ({ ...v, standardYieldQty: num(v.standardYieldQty), yieldPercent: num(v.yieldPercent) })) })), warehouses });
  });

  app.get('/production', { preHandler: VIEW }, async (req) => {
    const filters = filterInput.parse(req.query);
    const rows = await prisma.productionOrder.findMany({
      where: productionWhere(req.user.companyId!, filters), orderBy: { createdAt: 'desc' }, take: 200,
      include: { recipe: { select: { name: true } }, recipeVersion: { select: { yieldMode: true } }, product: { select: { name: true, baseUnit: { select: { code: true } } } }, materialWarehouse: { select: { name: true } } },
    });
    return ok(rows.map((row) => ({ ...row, plannedQty: num(row.plannedQty), producedQty: num(row.producedQty), standardCost: num(row.standardCost), actualCost: num(row.actualCost), actualUnitCost: num(row.actualUnitCost) })));
  });

  app.get('/production/analytics/summary', { preHandler: VIEW }, async (req) => {
    const filters = filterInput.parse(req.query); const companyId = req.user.companyId!;
    const [allCount, completed] = await Promise.all([
      prisma.productionOrder.count({ where: productionWhere(companyId, filters) }),
      prisma.productionOrder.findMany({ where: productionWhere(companyId, filters, true), include: { recipeVersion: { select: { yieldMode: true } }, wastes: true } }),
    ]);
    const measurable = completed.filter((row) => row.recipeVersion?.yieldMode !== 'BATCH' && num(row.plannedQty) > 0);
    const wasteByUnit = new Map<string, number>();
    for (const row of completed) for (const waste of row.wastes) wasteByUnit.set(waste.unitCode ?? 'ไม่ระบุหน่วย', (wasteByUnit.get(waste.unitCode ?? 'ไม่ระบุหน่วย') ?? 0) + num(waste.quantity));
    return ok({
      runs: allCount, completed: completed.length,
      averageYieldPercent: measurable.length ? measurable.reduce((sum, row) => sum + num(row.producedQty) / num(row.plannedQty) * 100, 0) / measurable.length : null,
      totalCostVariance: completed.reduce((sum, row) => sum + num(row.actualCost) - num(row.standardCost), 0),
      recordedWaste: [...wasteByUnit].map(([unitCode, quantity]) => ({ unitCode, quantity })),
      wasteCost: completed.flatMap((row) => row.wastes).reduce((sum, row) => sum + (row.totalCost == null ? 0 : num(row.totalCost)), 0),
      sampleSize: completed.length, lowSample: completed.length > 0 && completed.length < 3,
    });
  });

  app.get('/production/analytics/recipes', { preHandler: VIEW }, async (req) => {
    const filters = filterInput.parse(req.query); const rows = await prisma.productionOrder.findMany({
      where: productionWhere(req.user.companyId!, filters, true),
      include: { recipe: { select: { id: true, code: true, name: true } }, recipeVersion: { select: { yieldMode: true } }, materials: true, wastes: true },
    });
    const groups = new Map<string, typeof rows>();
    for (const row of rows) if (row.recipeId) groups.set(row.recipeId, [...(groups.get(row.recipeId) ?? []), row]);
    return ok([...groups.values()].map((runs) => {
      const measurable = runs.filter((row) => row.recipeVersion?.yieldMode !== 'BATCH' && num(row.plannedQty) > 0);
      const materialPercents = runs.flatMap((row) => row.materials.filter((line) => num(line.plannedQty) > 0).map((line) => (num(line.actualQty) - num(line.plannedQty)) / num(line.plannedQty) * 100));
      const wasteByUnit = new Map<string, number>(); for (const row of runs) for (const waste of row.wastes) wasteByUnit.set(waste.unitCode ?? 'ไม่ระบุหน่วย', (wasteByUnit.get(waste.unitCode ?? 'ไม่ระบุหน่วย') ?? 0) + num(waste.quantity));
      return { recipe: runs[0].recipe, runs: runs.length, averageActualOutput: runs.reduce((sum, row) => sum + num(row.producedQty), 0) / runs.length, averageYieldPercent: measurable.length ? measurable.reduce((sum, row) => sum + num(row.producedQty) / num(row.plannedQty) * 100, 0) / measurable.length : null, averageMaterialVariancePercent: materialPercents.length ? materialPercents.reduce((a, b) => a + b, 0) / materialPercents.length : null, totalCostVariance: runs.reduce((sum, row) => sum + num(row.actualCost) - num(row.standardCost), 0), recordedWaste: [...wasteByUnit].map(([unitCode, quantity]) => ({ unitCode, quantity })), lowSample: runs.length < 3 };
    }));
  });

  app.get('/production/analytics/materials', { preHandler: VIEW }, async (req) => {
    const filters = filterInput.parse(req.query); const runs = await prisma.productionOrder.findMany({
      where: productionWhere(req.user.companyId!, filters, true),
      include: { materials: { include: { item: { select: { id: true, code: true, name: true } } } } },
    });
    const groups = new Map<string, { item: { id: string; code: string; name: string }; unitCode: string | null; runIds: Set<string>; expected: number; actual: number; expectedCost: number; actualCost: number }>();
    for (const run of runs) for (const line of run.materials) { const group = groups.get(line.itemId) ?? { item: line.item, unitCode: line.unitCode, runIds: new Set<string>(), expected: 0, actual: 0, expectedCost: 0, actualCost: 0 }; group.runIds.add(run.id); group.expected += num(line.plannedQty); group.actual += num(line.actualQty); group.expectedCost += num(line.plannedTotalCost); group.actualCost += num(line.totalCost); groups.set(line.itemId, group); }
    return ok([...groups.values()].map((group) => ({ item: group.item, unitCode: group.unitCode, runs: group.runIds.size, expectedQty: group.expected, actualQty: group.actual, varianceQty: group.actual - group.expected, variancePercent: group.expected > 0 ? (group.actual - group.expected) / group.expected * 100 : null, expectedCost: group.expectedCost, actualCost: group.actualCost, costVariance: group.actualCost - group.expectedCost, lowSample: group.runIds.size < 3 })).sort((a, b) => Math.abs(b.costVariance) - Math.abs(a.costVariance)));
  });

  app.get('/production/:id', { preHandler: VIEW }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params);
    const detail = await findDetail(req.user.companyId!, id);
    if (!detail) return reply.status(404).send(fail('PRODUCTION_NOT_FOUND', 'ไม่พบใบผลิตในบริษัทปัจจุบัน'));
    return ok(await serializeDetail(detail));
  });

  app.post('/production/preview', { preHandler: CREATE }, async (req, reply) => {
    try {
      const body = draftInput.pick({ recipeId: true, recipeVersionId: true, plannedQty: true }).parse(req.body);
      return ok(await buildProductionPlan(req.user.companyId!, body.recipeId, body.plannedQty, body.recipeVersionId));
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/production', { preHandler: CREATE }, async (req, reply) => {
    try {
      const body = draftInput.parse(req.body); const companyId = req.user.companyId!;
      const outputWarehouseId = body.outputWarehouseId ?? body.warehouseId;
      const [plan, , wasteUnits] = await Promise.all([buildProductionPlan(companyId, body.recipeId, body.plannedQty, body.recipeVersionId), assertWarehouses(companyId, body.warehouseId, outputWarehouseId), assertWasteItems(companyId, body.wastes ?? [])]);
      const materials = actualQtyOf(plan, body.materials);
      const created = await withDocumentNumberRetry(() => prisma.$transaction(async (tx) => {
        const orderNo = await nextDocumentNo(tx, companyId, 'PRODUCTION_RUN', body.productionDate);
        const order = await tx.productionOrder.create({ data: {
          companyId, orderNo, productId: plan.productId, recipeId: plan.recipeId, recipeVersionId: plan.recipeVersionId,
          status: ProductionStatus.DRAFT, plannedQty: D(body.plannedQty), producedQty: D(body.actualOutputQty),
          materialWarehouseId: body.warehouseId, fgWarehouseId: outputWarehouseId, productionDate: body.productionDate,
          lotNo: body.outputLotNo ?? null, manufactureDate: body.manufactureDate ?? null, expiryDate: body.expiryDate ?? null,
          standardCost: D(plan.standardCost), note: body.note ?? null, createdById: req.user.sub, updatedById: req.user.sub,
          materials: { create: materials.map((line) => ({ itemId: line.itemId, plannedQty: D(line.plannedQty), actualQty: D(line.actualQty), unitCode: line.unitCode, plannedUnitCost: D(line.plannedUnitCost), plannedTotalCost: D(line.plannedTotalCost), lotAllocations: { create: line.allocations.map((row) => ({ lotId: row.lotId, quantity: D(row.quantity) })) } })) },
          wastes: { create: (body.wastes ?? []).map((line) => ({ itemId: line.itemId ?? null, quantity: D(line.quantity), unitCode: line.itemId ? wasteUnits.get(line.itemId) : null, reason: line.reason, note: line.note ?? null, recordedById: req.user.sub, recordedAt: new Date() })) },
        }, include: detailInclude });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PRODUCTION_CREATED', entity: 'ProductionOrder', entityId: order.id, after: { orderNo, recipeVersionId: plan.recipeVersionId, plannedQty: body.plannedQty } } });
        return order;
      }, { maxWait: 10_000, timeout: 20_000 }));
      return reply.status(201).send(ok(await serializeDetail(created), 'บันทึกใบผลิตร่างแล้ว'));
    } catch (error) { return sendError(reply, error); }
  });

  app.patch('/production/:id', { preHandler: CREATE }, async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params); const body = editInput.parse(req.body); const companyId = req.user.companyId!;
      const outputWarehouseId = body.outputWarehouseId ?? body.warehouseId;
      const current = await prisma.productionOrder.findFirst({ where: { id, companyId } });
      if (!current) return reply.status(404).send(fail('PRODUCTION_NOT_FOUND', 'ไม่พบใบผลิตในบริษัทปัจจุบัน'));
      if (current.status !== ProductionStatus.DRAFT) throw new Error('PRODUCTION_NOT_DRAFT');
      const [plan, , wasteUnits] = await Promise.all([buildProductionPlan(companyId, body.recipeId, body.plannedQty, body.recipeVersionId), assertWarehouses(companyId, body.warehouseId, outputWarehouseId), assertWasteItems(companyId, body.wastes ?? [])]);
      const materials = actualQtyOf(plan, body.materials);
      const updated = await prisma.$transaction(async (tx) => {
        const changed = await tx.productionOrder.updateMany({ where: { id, companyId, status: ProductionStatus.DRAFT, version: body.version }, data: {
          productId: plan.productId, recipeId: plan.recipeId, recipeVersionId: plan.recipeVersionId,
          plannedQty: D(body.plannedQty), producedQty: D(body.actualOutputQty), materialWarehouseId: body.warehouseId, fgWarehouseId: outputWarehouseId,
          productionDate: body.productionDate, standardCost: D(plan.standardCost), note: body.note ?? null, updatedById: req.user.sub, version: { increment: 1 },
          lotNo: body.outputLotNo ?? null, manufactureDate: body.manufactureDate ?? null, expiryDate: body.expiryDate ?? null,
        } });
        if (changed.count !== 1) throw new Error('PRODUCTION_VERSION_CONFLICT');
        await tx.productionMaterial.deleteMany({ where: { productionOrderId: id } });
        for (const line of materials) await tx.productionMaterial.create({ data: { productionOrderId: id, itemId: line.itemId, plannedQty: D(line.plannedQty), actualQty: D(line.actualQty), unitCode: line.unitCode, plannedUnitCost: D(line.plannedUnitCost), plannedTotalCost: D(line.plannedTotalCost), lotAllocations: { create: line.allocations.map((row) => ({ lotId: row.lotId, quantity: D(row.quantity) })) } } });
        await tx.productionWaste.deleteMany({ where: { productionOrderId: id } });
        if (body.wastes?.length) await tx.productionWaste.createMany({ data: body.wastes.map((line) => ({ productionOrderId: id, itemId: line.itemId ?? null, quantity: D(line.quantity), unitCode: line.itemId ? wasteUnits.get(line.itemId) : null, reason: line.reason, note: line.note ?? null, recordedById: req.user.sub, recordedAt: new Date() })) });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PRODUCTION_UPDATED', entity: 'ProductionOrder', entityId: id, after: { plannedQty: body.plannedQty, actualOutputQty: body.actualOutputQty } } });
        return tx.productionOrder.findUniqueOrThrow({ where: { id }, include: detailInclude });
      });
      return ok(await serializeDetail(updated), 'แก้ไขใบผลิตร่างแล้ว');
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/production/:id/confirm', { preHandler: CONFIRM }, async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params); const companyId = req.user.companyId!;
      const confirmed = await withStockLockRetry(() => prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT \`id\` FROM \`production_orders\` WHERE \`id\` = ${id} FOR UPDATE`;
        const order = await tx.productionOrder.findFirst({ where: { id, companyId }, include: detailInclude });
        if (!order) throw new ProductionCalculationError('PRODUCTION_NOT_FOUND', 'ไม่พบใบผลิตในบริษัทปัจจุบัน');
        if (order.status !== ProductionStatus.DRAFT) throw new Error('PRODUCTION_NOT_DRAFT');
        if (!order.materialWarehouseId || !order.fgWarehouseId || num(order.producedQty) <= 0 || order.materials.length === 0) throw new ProductionCalculationError('PRODUCTION_INCOMPLETE', 'ข้อมูลใบผลิตไม่ครบสำหรับยืนยัน');
        if (order.materials.some((line) => num(line.actualQty) < 0)) throw new ProductionCalculationError('INVALID_ACTUAL_QTY', 'จำนวนใช้จริงต้องไม่ติดลบ');

        await lockBalancePairs(tx, [
          ...order.materials.map((line) => ({ itemId: line.itemId, warehouseId: order.materialWarehouseId! })),
          { itemId: order.productId, warehouseId: order.fgWarehouseId },
        ]);
        const costRows = await tx.item.findMany({ where: { companyId, id: { in: order.materials.map((line) => line.itemId) } }, select: { id: true, lastCost: true, isLotTracked: true, baseUnit: { select: { code: true } } } });
        if (costRows.length !== order.materials.length) throw new ProductionCalculationError('MATERIAL_NOT_AVAILABLE', 'วัตถุดิบบางรายการไม่อยู่ในบริษัทปัจจุบัน');
        const costOf = new Map(costRows.map((item) => [item.id, num(item.lastCost)]));
        const unitOf = new Map(costRows.map((item) => [item.id, item.baseUnit.code]));
        let actualCost = D(0);
        for (const line of [...order.materials].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
          const qty = num(line.actualQty); const unitCost = costOf.get(line.itemId) ?? 0; const total = D(qty).mul(unitCost);
          actualCost = actualCost.plus(total);
          await tx.productionMaterial.update({ where: { id: line.id }, data: { unitCode: unitOf.get(line.itemId), unitCost: D(unitCost), totalCost: total } });
          if (qty > 0) {
            const item = costRows.find((row) => row.id === line.itemId)!;
            const allocations = item.isLotTracked
              ? await validateLotAllocations(tx, { companyId, warehouseId: order.materialWarehouseId!, itemId: line.itemId, requiredQty: qty, allocations: line.lotAllocations.map((row) => ({ lotId: row.lotId, quantity: num(row.quantity) })) })
              : line.lotAllocations.length ? (() => { throw new LotPolicyError('LOT_NOT_ENABLED', 'วัตถุดิบนี้ไม่ได้เปิดการติดตาม Lot'); })() : [];
            const movements = item.isLotTracked ? allocations : [{ lotId: undefined, quantity: qty }];
            for (const allocation of movements) await applyMovement(tx, { companyId, warehouseId: order.materialWarehouseId!, itemId: line.itemId, lotId: allocation.lotId, movementType: StockMovementType.PRODUCTION_ISSUE, changeQty: -allocation.quantity, unit: unitOf.get(line.itemId), refType: 'PRODUCTION_ORDER', refId: order.id, refNo: order.orderNo, unitCost, createdById: req.user.sub });
          }
        }
        const materialSnapshotCost = new Map(order.materials.map((line) => [line.itemId, costOf.get(line.itemId) ?? null]));
        for (const waste of order.wastes) {
          const snapshotUnitCost = waste.itemId ? materialSnapshotCost.get(waste.itemId) ?? null : null;
          await tx.productionWaste.update({ where: { id: waste.id }, data: { unitCost: snapshotUnitCost == null ? null : D(snapshotUnitCost), totalCost: snapshotUnitCost == null ? null : D(waste.quantity).mul(snapshotUnitCost) } });
        }
        const producedQty = num(order.producedQty); const outputUnitCost = num(actualCost.div(producedQty));
        const outputLotNo = assertLotPolicy(order.product, order.lotNo, order.manufactureDate, order.expiryDate);
        const outputLot = outputLotNo ? await ensureInventoryLot(tx, { companyId, itemId: order.productId, warehouseId: order.fgWarehouseId, lotNo: outputLotNo, manufactureDate: order.manufactureDate, expiryDate: order.expiryDate, receivedDate: order.productionDate ?? new Date(), sourceType: 'PRODUCTION', sourceProductionId: order.id, createdById: req.user.sub }) : null;
        await applyMovement(tx, { companyId, warehouseId: order.fgWarehouseId, itemId: order.productId, lotId: outputLot?.id, movementType: StockMovementType.PRODUCTION_OUTPUT, changeQty: producedQty, unit: order.product.baseUnit.code, refType: 'PRODUCTION_ORDER', refId: order.id, refNo: order.orderNo, unitCost: outputUnitCost, createdById: req.user.sub });
        await tx.productionOutput.create({ data: { productionOrderId: order.id, itemId: order.productId, quantity: D(producedQty), unitCode: order.product.baseUnit.code, unitCost: D(outputUnitCost), lotNo: outputLotNo, inventoryLotId: outputLot?.id ?? null, manufactureDate: order.manufactureDate, expiryDate: order.expiryDate } });
        await tx.item.update({ where: { id: order.productId }, data: { lastCost: D(outputUnitCost), avgCost: D(outputUnitCost), updatedById: req.user.sub } });
        await tx.itemPriceHistory.create({ data: { companyId, itemId: order.productId, price: D(outputUnitCost), source: 'PRODUCTION', note: order.orderNo, createdById: req.user.sub } });
        await tx.productionOrder.update({ where: { id: order.id }, data: { status: ProductionStatus.COMPLETED, actualCost, actualUnitCost: D(outputUnitCost), confirmedAt: new Date(), confirmedById: req.user.sub, finishedAt: new Date(), version: { increment: 1 } } });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PRODUCTION_CONFIRMED', entity: 'ProductionOrder', entityId: order.id, after: { orderNo: order.orderNo, actualCost: num(actualCost), producedQty } } });
        return order.id;
      }, { maxWait: 10_000, timeout: 30_000 }));
      return ok(await serializeDetail((await findDetail(companyId, confirmed))!), 'ยืนยันการผลิตและบันทึกสต็อกแล้ว');
    } catch (error) { return sendError(reply, error); }
  });

  app.post('/production/:id/reverse', { preHandler: REVERSE }, async (req, reply) => {
    try {
      const { id } = z.object({ id: z.string().min(1) }).parse(req.params); const body = reverseInput.parse(req.body); const companyId = req.user.companyId!;
      await withStockLockRetry(() => prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT \`id\` FROM \`production_orders\` WHERE \`id\` = ${id} FOR UPDATE`;
        const order = await tx.productionOrder.findFirst({ where: { id, companyId } });
        if (!order) throw new ProductionCalculationError('PRODUCTION_NOT_FOUND', 'ไม่พบใบผลิตในบริษัทปัจจุบัน');
        if (order.status !== ProductionStatus.COMPLETED) throw new Error('PRODUCTION_NOT_COMPLETED');
        const reversed = await reverseDocument(tx, 'PRODUCTION_ORDER', order.id, req.user.sub);
        if (!reversed) throw new Error('PRODUCTION_ALREADY_REVERSED');
        await tx.productionOrder.update({ where: { id: order.id }, data: { status: ProductionStatus.CANCELLED, reversedAt: new Date(), reversedById: req.user.sub, reversalReason: body.reason, version: { increment: 1 } } });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PRODUCTION_REVERSED', entity: 'ProductionOrder', entityId: order.id, after: { orderNo: order.orderNo, reason: body.reason, reversedMovements: reversed } } });
      }, { maxWait: 10_000, timeout: 30_000 }));
      return ok(await serializeDetail((await findDetail(companyId, id))!), 'กลับรายการผลิตแล้ว');
    } catch (error) { return sendError(reply, error); }
  });

  app.get('/production/:id/document.pdf', { preHandler: [VIEW, requirePermission('DOCUMENT_DOWNLOAD')] }, async (req, reply) => {
    const { id } = z.object({ id: z.string().min(1) }).parse(req.params); const companyId = req.user.companyId!;
    const [detail, company] = await Promise.all([findDetail(companyId, id), prisma.company.findUnique({ where: { id: companyId } })]);
    if (!detail || !company) return reply.status(404).send(fail('PRODUCTION_NOT_FOUND', 'ไม่พบใบผลิตในบริษัทปัจจุบัน'));
    const outputMeasurable = detail.recipeVersion?.yieldMode !== 'BATCH' && num(detail.plannedQty) > 0;
    const outputVariance = outputMeasurable ? num(detail.producedQty) - num(detail.plannedQty) : null;
    const wasteSummary = new Map<string, number>();
    for (const waste of detail.wastes) wasteSummary.set(waste.unitCode ?? 'ไม่ระบุหน่วย', (wasteSummary.get(waste.unitCode ?? 'ไม่ระบุหน่วย') ?? 0) + num(waste.quantity));
    const document: BusinessDocument = {
      type: 'PRODUCTION_RUN_SLIP', title: 'PRODUCTION_RUN_SLIP', documentNo: detail.orderNo,
      date: detail.productionDate ?? detail.createdAt,
      company: { nameTh: company.nameTh, nameEn: company.nameEn, logoUrl: company.logoUrl, address: company.address, phone: company.phone, email: company.email, taxId: company.taxId, website: company.website, lineId: company.lineId, documentFooter: company.documentFooter },
      status: detail.status, subject: [
        { label: 'สูตร', value: `${detail.recipe?.name ?? '—'} · V${detail.recipeVersion?.versionNo ?? '—'}` },
        { label: 'ผลผลิต', value: detail.product.name },
        { label: 'ตามแผน', value: `${num(detail.plannedQty)} ${detail.recipeVersion?.yieldMode === 'BATCH' ? 'Batch' : detail.product.baseUnit.code}` },
        { label: 'ผลผลิตจริง', value: `${num(detail.producedQty)} ${detail.product.baseUnit.code}` },
      ],
      lines: detail.materials.map((line) => ({ name: line.item.name, expected: num(line.plannedQty), actual: num(line.actualQty), variance: num(line.actualQty) - num(line.plannedQty), unit: line.unitCode ?? line.item.baseUnit.code })),
      summary: [
        ...(outputMeasurable ? [
          { label: 'ผลต่างผลผลิต', value: `${outputVariance! >= 0 ? '+' : ''}${outputVariance!.toFixed(4)} ${detail.product.baseUnit.code}` },
          { label: 'Yield', value: `${(num(detail.producedQty) / num(detail.plannedQty) * 100).toFixed(2)}%` },
        ] : [{ label: 'Yield', value: 'N/A (Batch)' }]),
        { label: 'ผลต่างการใช้', value: `${detail.materials.filter((line) => num(line.actualQty) > num(line.plannedQty)).length} เกิน / ${detail.materials.filter((line) => num(line.actualQty) < num(line.plannedQty)).length} ต่ำกว่า` },
        { label: 'ต้นทุนมาตรฐาน', value: num(detail.standardCost) }, { label: 'ต้นทุนจริง', value: num(detail.actualCost) },
        { label: 'ผลต่างต้นทุน', value: num(detail.actualCost) - num(detail.standardCost) },
        ...([...wasteSummary].map(([unit, quantity]) => ({ label: 'ของเสียบันทึก', value: `${quantity.toFixed(4)} ${unit}` }))),
      ], note: detail.note,
    };
    const pdf = await renderBusinessPdf(document);
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'DOWNLOAD', entity: 'PRODUCTION_RUN_SLIP', entityId: id } });
    return reply.header('Content-Type', 'application/pdf').header('Content-Disposition', `inline; filename="${detail.orderNo}.pdf"`).send(pdf);
  });
}
