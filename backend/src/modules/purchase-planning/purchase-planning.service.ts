import { DocumentStatus, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { num } from '../../lib/http.js';
import { buildProductionPlan, ProductionCalculationError } from '../production/production.service.js';

const D = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value);

export type PlanningTargetInput = { recipeId: string; recipeVersionId?: string | null; plannedQty: number };

export async function calculatePurchasePlan(companyId: string, warehouseId: string, inputs: PlanningTargetInput[]) {
  if (!inputs.length) throw new ProductionCalculationError('TARGET_REQUIRED', 'กรุณาเพิ่มรายการผลิตอย่างน้อยหนึ่งรายการ');
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, companyId, isActive: true, deletedAt: null }, select: { id: true } });
  if (!warehouse) throw new ProductionCalculationError('WAREHOUSE_NOT_FOUND', 'ไม่พบคลังที่เลือกในบริษัทปัจจุบัน');
  const plans = await Promise.all(inputs.map((target) => buildProductionPlan(companyId, target.recipeId, target.plannedQty, target.recipeVersionId)));
  const itemIds = [...new Set(plans.flatMap((plan) => plan.materials.map((line) => line.itemId)))];
  const [items, balances, receiptLines] = await Promise.all([
    prisma.item.findMany({ where: { companyId, id: { in: itemIds }, isActive: true, deletedAt: null }, include: { baseUnit: true, purchaseUnit: true, category: true, priceHistory: { where: { source: 'PURCHASE' }, orderBy: { createdAt: 'desc' }, take: 1 } } }),
    prisma.stockBalance.findMany({ where: { warehouseId, itemId: { in: itemIds } }, select: { itemId: true, onHand: true, reserved: true } }),
    prisma.goodsReceiptItem.findMany({ where: { itemId: { in: itemIds }, goodsReceipt: { companyId, status: DocumentStatus.CONFIRMED, supplierId: { not: null } } }, include: { goodsReceipt: { include: { supplier: true } } }, orderBy: { goodsReceipt: { receiptDate: 'desc' } } }),
  ]);
  if (items.length !== itemIds.length) throw new ProductionCalculationError('MATERIAL_NOT_AVAILABLE', 'วัตถุดิบบางรายการไม่พร้อมใช้งานในบริษัทปัจจุบัน');
  const itemOf = new Map(items.map((item) => [item.id, item]));
  const stockOf = new Map<string, { onHand: number; reserved: number }>();
  for (const row of balances) { const value = stockOf.get(row.itemId) ?? { onHand: 0, reserved: 0 }; value.onHand += num(row.onHand); value.reserved += num(row.reserved); stockOf.set(row.itemId, value); }
  const receiptOf = new Map<string, typeof receiptLines[number]>(); for (const line of receiptLines) if (!receiptOf.has(line.itemId)) receiptOf.set(line.itemId, line);
  const grouped = new Map<string, { requiredQty: number; sources: { recipeId: string; recipeVersionId: string; recipeName: string; productName: string; quantity: number; unitCode: string }[] }>();
  for (const plan of plans) for (const material of plan.materials) { const value = grouped.get(material.itemId) ?? { requiredQty: 0, sources: [] }; value.requiredQty += material.plannedQty; value.sources.push({ recipeId: plan.recipeId, recipeVersionId: plan.recipeVersionId, recipeName: plan.recipeName, productName: plan.productName, quantity: material.plannedQty, unitCode: material.unitCode }); grouped.set(material.itemId, value); }
  const requirements = [...grouped].map(([itemId, groupedLine]) => {
    const item = itemOf.get(itemId)!; const stock = stockOf.get(itemId) ?? { onHand: 0, reserved: 0 }; const available = stock.onHand - stock.reserved; const shortage = Math.max(groupedLine.requiredQty - available, 0);
    const factor = num(item.purchaseToBaseFactor) > 0 ? num(item.purchaseToBaseFactor) : null; const receipt = receiptOf.get(itemId);
    const hasPrice = Boolean(receipt || item.priceHistory.length); const basePrice = hasPrice ? num(item.lastCost) : null;
    return { itemId, itemCode: item.code, itemName: item.name, categoryId: item.categoryId, categoryName: item.category?.name ?? null, requiredQty: groupedLine.requiredQty, onHandQty: stock.onHand, reservedQty: stock.reserved, availableQty: available, shortageQty: shortage, baseUnitCode: item.baseUnit.code, purchaseUnitCode: item.purchaseUnit?.code ?? null, purchaseToBaseFactor: factor, purchaseQty: factor ? shortage / factor : null, lastBaseUnitPrice: basePrice, lastPurchasePrice: receipt ? num(receipt.unitPrice) : (basePrice != null && factor ? basePrice * factor : null), estimatedCost: basePrice == null ? null : shortage * basePrice, latestSupplierId: receipt?.goodsReceipt.supplier?.id ?? null, latestSupplierName: receipt?.goodsReceipt.supplier?.name ?? null, selectedSupplierId: null, selectedSupplierName: null, sources: groupedLine.sources };
  }).sort((a, b) => b.shortageQty - a.shortageQty || a.itemName.localeCompare(b.itemName));
  return {
    targets: plans.map((plan, index) => ({ recipeId: plan.recipeId, recipeVersionId: plan.recipeVersionId, productId: plan.productId, recipeCode: plan.recipeCode, recipeName: plan.recipeName, recipeVersionNo: plan.recipeVersionNo, productCode: plan.productCode, productName: plan.productName, plannedQty: inputs[index].plannedQty, yieldMode: plan.yieldMode, outputUnitCode: plan.outputUnitCode })),
    requirements,
    summary: { materialCount: requirements.length, shortageCount: requirements.filter((line) => line.shortageQty > 0).length, estimatedCost: requirements.reduce((sum, line) => sum.plus(line.estimatedCost ?? 0), D(0)).toNumber(), targetCount: plans.length },
  };
}
