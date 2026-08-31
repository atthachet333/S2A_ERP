import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { effectiveYieldMode, toBaseQuantity, type ConvEdge } from '../../lib/unit-convert.js';
import { num } from '../../lib/http.js';

const D = (value: number | string | Prisma.Decimal) => new Prisma.Decimal(value);

export class ProductionCalculationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'ProductionCalculationError';
  }
}

export type ExpectedMaterial = {
  itemId: string;
  itemCode: string;
  itemName: string;
  isLotTracked: boolean;
  unitCode: string;
  plannedQty: number;
  actualQty: number;
  plannedUnitCost: number;
  plannedTotalCost: number;
};

export type ProductionPlan = {
  recipeId: string;
  recipeCode: string;
  recipeVersionId: string;
  recipeVersionNo: number;
  recipeName: string;
  productId: string;
  productCode: string;
  productName: string;
  outputUnitCode: string;
  yieldMode: 'ACTUAL' | 'BATCH';
  materials: ExpectedMaterial[];
  standardCost: number;
};

/**
 * แปลงสูตรเวอร์ชันที่เลือกเป็น requirement ของใบผลิต
 * ใช้กติกา unit/yield เดียวกับ Recipe Builder และเก็บผลเป็นหน่วยฐานของ item เสมอ
 * สูตรย่อยถูกใช้เป็นสินค้ากึ่งสำเร็จรูปใน stock ไม่แตก BOM ซ้ำ เพราะต้องสะท้อนของที่เบิกจริง
 */
export async function buildProductionPlan(companyId: string, recipeId: string, plannedQty: number, recipeVersionId?: string | null): Promise<ProductionPlan> {
  if (!Number.isFinite(plannedQty) || plannedQty <= 0) throw new ProductionCalculationError('INVALID_PLANNED_QTY', 'จำนวนผลผลิตตามแผนต้องมากกว่า 0');

  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, companyId, isActive: true, deletedAt: null },
    include: {
      product: { include: { baseUnit: true, purchaseUnit: true } },
      versions: {
        where: recipeVersionId ? { id: recipeVersionId } : { isActive: true },
        orderBy: { versionNo: 'desc' }, take: 1,
        include: {
          yieldUnit: true,
          ingredients: {
            orderBy: { sortOrder: 'asc' },
            include: {
              item: { include: { baseUnit: true, purchaseUnit: true } },
              childRecipe: {
                include: {
                  product: { include: { baseUnit: true, purchaseUnit: true } },
                  versions: { where: { isActive: true }, orderBy: { versionNo: 'desc' }, take: 1, include: { yieldUnit: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!recipe) throw new ProductionCalculationError('RECIPE_NOT_FOUND', 'ไม่พบสูตรในบริษัทปัจจุบัน');
  const version = recipe.versions[0];
  if (!version || (recipeVersionId && version.id !== recipeVersionId)) throw new ProductionCalculationError('RECIPE_VERSION_NOT_FOUND', 'ไม่พบเวอร์ชันสูตรที่เลือก');

  const edges: ConvEdge[] = (await prisma.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
    .map((edge) => ({ fromUnitId: edge.fromUnitId, toUnitId: edge.toUnitId, factor: num(edge.factor) }));
  const mode = effectiveYieldMode(version.yieldMode as 'ACTUAL' | 'BATCH' | null, version.yieldUnitId, num(version.standardYieldQty));
  if (!mode) throw new ProductionCalculationError('YIELD_MODE_REQUIRED', 'สูตรยังไม่ได้กำหนดวิธีคิดผลผลิต');

  let scale: number;
  if (mode === 'BATCH') {
    scale = plannedQty;
  } else {
    const yieldBase = toBaseQuantity(
      num(version.standardYieldQty), version.yieldUnitId,
      { baseUnitId: recipe.product.baseUnitId, purchaseUnitId: recipe.product.purchaseUnitId, purchaseToBaseFactor: num(recipe.product.purchaseToBaseFactor) }, edges,
    );
    const effectiveYield = (yieldBase ?? 0) * num(version.yieldPercent) / 100;
    if (effectiveYield <= 0) throw new ProductionCalculationError('OUTPUT_UNIT_NOT_CONVERTIBLE', 'หน่วยผลผลิตของสูตรแปลงเป็นหน่วยฐานของสินค้าไม่ได้');
    scale = plannedQty / effectiveYield;
  }

  const grouped = new Map<string, ExpectedMaterial>();
  for (const ingredient of version.ingredients) {
    let item = ingredient.item;
    let quantityBase: number | null = null;
    if (ingredient.componentType === 'SUB_RECIPE') {
      const child = ingredient.childRecipe;
      const childVersion = child?.versions[0];
      if (!child || child.companyId !== companyId || !child.isActive || child.deletedAt || !childVersion) {
        throw new ProductionCalculationError('SUB_RECIPE_NOT_AVAILABLE', 'สูตรย่อยไม่พร้อมใช้งานในบริษัทปัจจุบัน');
      }
      const childMode = effectiveYieldMode(childVersion.yieldMode as 'ACTUAL' | 'BATCH' | null, childVersion.yieldUnitId, num(childVersion.standardYieldQty));
      if (childMode !== 'ACTUAL') throw new ProductionCalculationError('SUB_RECIPE_NOT_INVENTORY_TRACKABLE', 'สูตรย่อยแบบ Batch ยังไม่มีปริมาณผลผลิตจริงสำหรับตัดสต็อก');
      item = child.product;
      quantityBase = toBaseQuantity(
        num(ingredient.quantity), ingredient.unitId ?? childVersion.yieldUnitId,
        { baseUnitId: item.baseUnitId, purchaseUnitId: item.purchaseUnitId, purchaseToBaseFactor: num(item.purchaseToBaseFactor) }, edges,
      );
    } else if (item) {
      quantityBase = toBaseQuantity(
        num(ingredient.quantity), ingredient.unitId,
        { baseUnitId: item.baseUnitId, purchaseUnitId: item.purchaseUnitId, purchaseToBaseFactor: num(item.purchaseToBaseFactor) }, edges,
      );
    }
    if (!item || item.companyId !== companyId || item.deletedAt || !item.isActive) throw new ProductionCalculationError('MATERIAL_NOT_AVAILABLE', 'วัตถุดิบในสูตรไม่พร้อมใช้งานในบริษัทปัจจุบัน');
    if (quantityBase == null) throw new ProductionCalculationError('MATERIAL_UNIT_NOT_CONVERTIBLE', `แปลงหน่วยของ ${item.name} เป็นหน่วยฐานไม่ได้`);

    const qty = num(D(quantityBase).mul(D(1).plus(D(ingredient.wastePercent).div(100))).mul(scale));
    const unitCost = num(item.lastCost);
    const existing = grouped.get(item.id);
    const nextQty = (existing?.plannedQty ?? 0) + qty;
    grouped.set(item.id, {
      itemId: item.id, itemCode: item.code, itemName: item.name, unitCode: item.baseUnit.code,
      isLotTracked: item.isLotTracked,
      plannedQty: nextQty, actualQty: nextQty, plannedUnitCost: unitCost,
      plannedTotalCost: num(D(nextQty).mul(unitCost)),
    });
  }

  const materials = [...grouped.values()].sort((a, b) => a.itemId.localeCompare(b.itemId));
  return {
    recipeId: recipe.id, recipeCode: recipe.code, recipeVersionId: version.id, recipeVersionNo: version.versionNo, recipeName: recipe.name,
    productId: recipe.product.id, productCode: recipe.product.code, productName: recipe.product.name,
    outputUnitCode: mode === 'BATCH' ? 'BATCH' : recipe.product.baseUnit.code,
    yieldMode: mode,
    materials,
    standardCost: num(materials.reduce((sum, line) => sum.plus(line.plannedTotalCost), D(0))),
  };
}
