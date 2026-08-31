import { DocumentStatus, Prisma, ProductionStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { num } from '../../lib/http.js';
import { toBaseQuantity, type ConvEdge } from '../../lib/unit-convert.js';

const D = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const zero = D(0);

type RecipeLine = {
  itemId: string; itemCode: string; itemName: string; unitCode: string;
  quantity: Prisma.Decimal | null; unitCost: Prisma.Decimal | null; lineCost: Prisma.Decimal | null;
  costEventId: string | null; costEventAt: Date | null; costSource: string | null;
};

async function recipeVersion(companyId: string, id: string) {
  return prisma.recipeVersion.findFirst({
    where: { id, recipe: { companyId, deletedAt: null } },
    include: {
      recipe: { include: { product: { include: { baseUnit: true } } } }, costs: { orderBy: { calculatedAt: 'desc' } },
      ingredients: { orderBy: { sortOrder: 'asc' }, include: {
        unit: true, item: { include: { baseUnit: true, purchaseUnit: true } },
        childRecipe: { include: { product: { include: { baseUnit: true, purchaseUnit: true } } } },
      } },
    },
  });
}

async function normalizedLines(companyId: string, version: NonNullable<Awaited<ReturnType<typeof recipeVersion>>>): Promise<RecipeLine[]> {
  const edges: ConvEdge[] = (await prisma.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
    .map((x) => ({ fromUnitId: x.fromUnitId, toUnitId: x.toUnitId, factor: num(x.factor) }));
  const itemIds = version.ingredients.flatMap((line) => line.itemId ? [line.itemId] : line.childRecipe?.productId ? [line.childRecipe.productId] : []);
  const events = await prisma.itemPriceHistory.findMany({ where: { itemId: { in: itemIds }, item: { companyId }, createdAt: { lte: version.createdAt } }, orderBy: { createdAt: 'asc' } });
  const latest = new Map<string, typeof events[number]>(); for (const event of events) latest.set(event.itemId, event);
  const grouped = new Map<string, RecipeLine>();
  for (const ingredient of version.ingredients) {
    const item = ingredient.item ?? ingredient.childRecipe?.product; if (!item || item.companyId !== companyId) continue;
    const quantity = toBaseQuantity(num(ingredient.quantity), ingredient.unitId, { baseUnitId: item.baseUnitId, purchaseUnitId: item.purchaseUnitId, purchaseToBaseFactor: num(item.purchaseToBaseFactor) }, edges);
    const event = latest.get(item.id); const unitCost = event ? event.price : null; const q = quantity == null ? null : D(quantity).mul(D(1).plus(ingredient.wastePercent.div(100)));
    const prior = grouped.get(item.id); const nextQty = prior?.quantity != null && q != null ? prior.quantity.plus(q) : q;
    grouped.set(item.id, { itemId: item.id, itemCode: item.code, itemName: item.name, unitCode: item.baseUnit.code, quantity: nextQty,
      unitCost, lineCost: nextQty != null && unitCost != null ? nextQty.mul(unitCost) : null,
      costEventId: event?.id ?? null, costEventAt: event?.createdAt ?? null, costSource: event?.source ?? null });
  }
  return [...grouped.values()];
}

export async function compareRecipeVersions(companyId: string, fromVersionId: string, toVersionId: string) {
  const [from, to] = await Promise.all([recipeVersion(companyId, fromVersionId), recipeVersion(companyId, toVersionId)]);
  if (!from || !to || from.recipeId !== to.recipeId) return null;
  const [previousLines, currentLines] = await Promise.all([normalizedLines(companyId, from), normalizedLines(companyId, to)]);
  const a = new Map(previousLines.map((x) => [x.itemId, x])), b = new Map(currentLines.map((x) => [x.itemId, x]));
  const ids = new Set([...a.keys(), ...b.keys()]);
  const lines = [...ids].map((itemId) => {
    const p = a.get(itemId), c = b.get(itemId); const status = !p ? 'ADDED' : !c ? 'REMOVED' : 'UNCHANGED';
    const comparable = status === 'ADDED' ? c?.lineCost != null : status === 'REMOVED' ? p?.lineCost != null : p?.quantity != null && c?.quantity != null && p.unitCost != null && c.unitCost != null;
    let priceEffect: Prisma.Decimal | null = null, quantityEffect: Prisma.Decimal | null = null, interactionEffect: Prisma.Decimal | null = null, contribution: Prisma.Decimal | null = null;
    if (comparable && status === 'ADDED') contribution = c!.lineCost;
    else if (comparable && status === 'REMOVED') contribution = p!.lineCost!.negated();
    else if (comparable && p && c) {
      priceEffect = p.quantity!.mul(c.unitCost!.minus(p.unitCost!));
      quantityEffect = p.unitCost!.mul(c.quantity!.minus(p.quantity!));
      interactionEffect = c.quantity!.minus(p.quantity!).mul(c.unitCost!.minus(p.unitCost!));
      contribution = c.lineCost!.minus(p.lineCost!);
    }
    return { itemId, itemCode: c?.itemCode ?? p!.itemCode, itemName: c?.itemName ?? p!.itemName, unitCode: c?.unitCode ?? p!.unitCode, status, comparable,
      unavailableReason: comparable ? null : 'COST_HISTORY_INCOMPLETE_OR_UNIT_NOT_CONVERTIBLE', previousQty: p?.quantity == null ? null : num(p.quantity), currentQty: c?.quantity == null ? null : num(c.quantity),
      previousUnitCost: p?.unitCost == null ? null : num(p.unitCost), currentUnitCost: c?.unitCost == null ? null : num(c.unitCost), previousLineCost: p?.lineCost == null ? null : num(p.lineCost), currentLineCost: c?.lineCost == null ? null : num(c.lineCost),
      priceEffect: priceEffect == null ? null : num(priceEffect), quantityEffect: quantityEffect == null ? null : num(quantityEffect), interactionEffect: interactionEffect == null ? null : num(interactionEffect), netContribution: contribution == null ? null : num(contribution),
      previousEvidence: p ? { id: p.costEventId, at: p.costEventAt, source: p.costSource } : null, currentEvidence: c ? { id: c.costEventId, at: c.costEventAt, source: c.costSource } : null };
  }).sort((x, y) => Math.abs(y.netContribution ?? 0) - Math.abs(x.netContribution ?? 0));
  const comparableLines = lines.filter((x) => x.comparable); const previousCost = comparableLines.reduce((s, x) => s.plus(x.previousLineCost ?? 0), zero); const currentCost = comparableLines.reduce((s, x) => s.plus(x.currentLineCost ?? 0), zero);
  const priceEffect = comparableLines.reduce((s, x) => s.plus(x.priceEffect ?? 0), zero), quantityEffect = comparableLines.reduce((s, x) => s.plus(x.quantityEffect ?? 0), zero), interactionEffect = comparableLines.reduce((s, x) => s.plus(x.interactionEffect ?? 0), zero);
  const compositionEffect = comparableLines.filter((x) => x.status !== 'UNCHANGED').reduce((s, x) => s.plus(x.netContribution ?? 0), zero); const change = currentCost.minus(previousCost);
  return { recipe: { id: from.recipe.id, code: from.recipe.code, name: from.recipe.name, product: from.recipe.product }, from: { id: from.id, versionNo: from.versionNo, createdAt: from.createdAt, storedCost: from.costs[0] ? num(from.costs[0].totalCost) : null }, to: { id: to.id, versionNo: to.versionNo, createdAt: to.createdAt, storedCost: to.costs[0] ? num(to.costs[0].totalCost) : null },
    summary: { previousComparableCost: num(previousCost), currentComparableCost: num(currentCost), change: num(change), changePercent: previousCost.eq(0) ? null : num(change.div(previousCost).mul(100)), priceEffect: num(priceEffect), quantityEffect: num(quantityEffect), interactionEffect: num(interactionEffect), compositionEffect: num(compositionEffect), reconciled: change.minus(priceEffect).minus(quantityEffect).minus(interactionEffect).minus(compositionEffect).abs().lte('0.0001'), comparableLineCount: comparableLines.length, unavailableLineCount: lines.length - comparableLines.length, coveragePercent: lines.length ? comparableLines.length / lines.length * 100 : 100 }, lines };
}

export async function productionVariance(companyId: string, filters: { from?: Date; to?: Date; recipeId?: string; productId?: string; warehouseId?: string } = {}) {
  const rows = await prisma.productionOrder.findMany({ where: { companyId, status: ProductionStatus.COMPLETED, productionDate: filters.from || filters.to ? { gte: filters.from, lte: filters.to } : undefined, recipeId: filters.recipeId, productId: filters.productId, materialWarehouseId: filters.warehouseId }, orderBy: { productionDate: 'desc' }, include: { recipe: true, product: true, materialWarehouse: true, materials: { include: { item: true } }, wastes: true } });
  return rows.map((row) => ({ id: row.id, orderNo: row.orderNo, date: row.productionDate, recipe: row.recipe && { id: row.recipe.id, code: row.recipe.code, name: row.recipe.name }, product: { id: row.product.id, code: row.product.code, name: row.product.name }, warehouse: row.materialWarehouse && { id: row.materialWarehouse.id, name: row.materialWarehouse.name }, standardCost: num(row.standardCost), actualCost: num(row.actualCost), variance: num(row.actualCost.minus(row.standardCost)), variancePercent: row.standardCost.eq(0) ? null : num(row.actualCost.minus(row.standardCost).div(row.standardCost).mul(100)), producedQty: num(row.producedQty), recordedWasteCost: num(row.wastes.reduce((s, x) => s.plus(x.totalCost ?? 0), zero)), uncostedWasteCount: row.wastes.filter((x) => x.totalCost == null).length,
    materials: row.materials.map((line) => ({ itemId: line.itemId, itemCode: line.item.code, itemName: line.item.name, unitCode: line.unitCode, expectedQty: num(line.plannedQty), actualQty: num(line.actualQty), snapshotUnitCost: num(line.unitCost), standardUnitCost: num(line.plannedUnitCost), expectedCost: num(line.plannedTotalCost), actualCost: num(line.totalCost), usageContribution: num(line.actualQty.minus(line.plannedQty).mul(line.unitCost)) })).sort((a,b)=>Math.abs(b.usageContribution)-Math.abs(a.usageContribution)) }));
}

export async function purchaseVariance(companyId: string) {
  const lines = await prisma.goodsReceiptItem.findMany({ where: { purchaseOrderItemId: { not: null }, goodsReceipt: { companyId, status: DocumentStatus.CONFIRMED } }, include: { goodsReceipt: { include: { supplier: true, purchaseOrder: true } }, purchaseOrderItem: true, item: true }, orderBy: { goodsReceipt: { receiptDate: 'desc' } } });
  return lines.flatMap((line) => { const po = line.purchaseOrderItem!; if (!line.purchaseToBaseFactor || line.purchaseToBaseFactor.lte(0) || po.purchaseToBaseFactor.lte(0)) return [];
    const actualBasePrice = line.unitPrice.div(line.purchaseToBaseFactor), poBasePrice = po.unitPrice.div(po.purchaseToBaseFactor), receivedBaseQty = line.quantity.mul(line.purchaseToBaseFactor), perBase = actualBasePrice.minus(poBasePrice);
    return [{ receiptId: line.goodsReceiptId, receiptNo: line.goodsReceipt.receiptNo, receiptDate: line.goodsReceipt.receiptDate, purchaseOrderId: line.goodsReceipt.purchaseOrderId, poNo: line.goodsReceipt.purchaseOrder?.poNo, supplierId: line.goodsReceipt.supplierId, supplierName: line.goodsReceipt.supplier?.name, itemId: line.itemId, itemCode: line.item.code, itemName: line.item.name, receivedBaseQty: num(receivedBaseQty), baseUnitPriceOrdered: num(poBasePrice), baseUnitPriceActual: num(actualBasePrice), variancePerBaseUnit: num(perBase), totalVariance: num(perBase.mul(receivedBaseQty)) }]; }).sort((a,b)=>Math.abs(b.totalVariance)-Math.abs(a.totalVariance));
}

export async function itemCostMovers(companyId: string) {
  const items = await prisma.item.findMany({ where: { companyId, deletedAt: null, priceHistory: { some: {} } }, include: { baseUnit: true, priceHistory: { orderBy: { createdAt: 'desc' }, take: 3 } } });
  return items.flatMap((item) => { const latest=item.priceHistory[0],previous=item.priceHistory[1];if(!latest||!previous)return[];const change=latest.price.minus(previous.price);return[{itemId:item.id,itemCode:item.code,itemName:item.name,unitCode:item.baseUnit.code,previous:{id:previous.id,at:previous.createdAt,cost:num(previous.price),source:previous.source},latest:{id:latest.id,at:latest.createdAt,cost:num(latest.price),source:latest.source},change:num(change),changePercent:previous.price.eq(0)?null:num(change.div(previous.price).mul(100)),observationCount:item.priceHistory.length,lowSample:item.priceHistory.length<3}]}).sort((a,b)=>Math.abs(b.change)-Math.abs(a.change));
}
