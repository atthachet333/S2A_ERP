import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, ItemType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requireCompany } from '../auth/auth.guard.js';
import { requireRoles, writeAudit, num } from '../../lib/http.js';
import { computeRecipeCost, type CostIngredientInput } from '../../lib/costing.js';

const MANAGE = requireRoles('ADMIN', 'PRODUCTION', 'CHEF', 'COSTING_STAFF');

const ingredientSchema = z.object({
  itemId: z.string().min(1),
  quantityBase: z.number().nonnegative(),
  unitId: z.string().optional().nullable(),
  wastePercent: z.number().min(0).max(100).default(0),
  note: z.string().max(200).optional().nullable(),
});

const versionSchema = z.object({
  standardYieldQty: z.number().positive('ผลผลิตต้องมากกว่า 0'),
  yieldPercent: z.number().positive().max(100).default(100),
  standardWaste: z.number().min(0).default(0),
  laborCost: z.number().min(0).default(0),
  electricCost: z.number().min(0).default(0),
  waterCost: z.number().min(0).default(0),
  gasCost: z.number().min(0).default(0),
  overheadCost: z.number().min(0).default(0),
  otherCost: z.number().min(0).default(0),
  note: z.string().max(300).optional().nullable(),
  ingredients: z.array(ingredientSchema).default([]),
});

const createRecipeSchema = z.object({
  productId: z.string().min(1).optional(),
  newMenu: z.object({
    name: z.string().trim().min(1).max(120),
    code: z.string().trim().max(40).optional(),
    sellingUnitId: z.string().min(1),
  }).optional(),
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  version: versionSchema,
}).refine((body) => Boolean(body.productId) !== Boolean(body.newMenu), {
  message: 'เลือกเมนูเดิมหรือสร้างเมนูใหม่อย่างใดอย่างหนึ่ง',
});

const newVersionSchema = versionSchema.extend({ reason: z.string().max(300).optional() });

type VersionInput = z.infer<typeof versionSchema>;

/** โหลด item (type + ต้นทุนต่อหน่วยฐาน) เพื่อคำนวณต้นทุนจากราคาปัจจุบัน */
async function buildCostInputs(version: VersionInput, companyId: string) {
  const itemIds = [...new Set(version.ingredients.map((i) => i.itemId))];
  const items = await prisma.item.findMany({ where: { id: { in: itemIds }, companyId }, select: { id: true, type: true, lastCost: true } });
  const map = new Map(items.map((i) => [i.id, i]));
  const costIngredients: CostIngredientInput[] = version.ingredients.map((ing) => {
    const item = map.get(ing.itemId);
    return {
      itemType: item?.type ?? ItemType.RAW_MATERIAL,
      quantityBase: ing.quantityBase,
      unitCostPerBase: item ? num(item.lastCost) : 0,
      wastePercent: ing.wastePercent,
    };
  });
  return { costIngredients, missing: itemIds.filter((id) => !map.has(id)) };
}

function costBreakdownFrom(version: VersionInput, costIngredients: CostIngredientInput[]) {
  return computeRecipeCost({
    ingredients: costIngredients,
    yieldQty: version.standardYieldQty,
    yieldPercent: version.yieldPercent,
    laborCost: version.laborCost,
    electricCost: version.electricCost,
    waterCost: version.waterCost,
    gasCost: version.gasCost,
    overheadCost: version.overheadCost,
    otherCost: version.otherCost,
  });
}

/** สร้าง RecipeVersion + ingredients + RecipeCost ภายใน transaction */
async function persistVersion(tx: Prisma.TransactionClient, recipeId: string, versionNo: number, v: VersionInput, userId: string, companyId: string) {
  const { costIngredients } = await buildCostInputsTx(tx, v, companyId);
  const breakdown = costBreakdownFrom(v, costIngredients);
  await tx.recipeVersion.updateMany({ where: { recipeId, isActive: true }, data: { isActive: false } });
  const created = await tx.recipeVersion.create({
    data: {
      recipeId, versionNo, isActive: true,
      standardYieldQty: new Prisma.Decimal(v.standardYieldQty), yieldPercent: new Prisma.Decimal(v.yieldPercent),
      standardWaste: new Prisma.Decimal(v.standardWaste),
      laborCost: new Prisma.Decimal(v.laborCost), electricCost: new Prisma.Decimal(v.electricCost),
      waterCost: new Prisma.Decimal(v.waterCost), gasCost: new Prisma.Decimal(v.gasCost),
      overheadCost: new Prisma.Decimal(v.overheadCost), otherCost: new Prisma.Decimal(v.otherCost),
      note: v.note ?? null, createdById: userId,
      ingredients: {
        create: v.ingredients.map((ing) => ({
          itemId: ing.itemId, quantity: new Prisma.Decimal(ing.quantityBase),
          unitId: ing.unitId ?? null, wastePercent: new Prisma.Decimal(ing.wastePercent), note: ing.note ?? null,
        })),
      },
      costs: {
        create: {
          materialCost: new Prisma.Decimal(breakdown.materialCost), packagingCost: new Prisma.Decimal(breakdown.packagingCost),
          laborCost: new Prisma.Decimal(breakdown.laborCost), utilityCost: new Prisma.Decimal(breakdown.utilityCost),
          overheadCost: new Prisma.Decimal(breakdown.overheadCost), wasteCost: new Prisma.Decimal(breakdown.wasteCost),
          totalCost: new Prisma.Decimal(breakdown.totalCost), unitCost: new Prisma.Decimal(breakdown.unitCost),
          costType: 'STANDARD',
        },
      },
    },
  });
  return { created, breakdown };
}

async function buildCostInputsTx(tx: Prisma.TransactionClient, version: VersionInput, companyId: string) {
  const itemIds = [...new Set(version.ingredients.map((i) => i.itemId))];
  const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId }, select: { id: true, type: true, lastCost: true } });
  const map = new Map(items.map((i) => [i.id, i]));
  const costIngredients: CostIngredientInput[] = version.ingredients.map((ing) => {
    const item = map.get(ing.itemId);
    return { itemType: item?.type ?? ItemType.RAW_MATERIAL, quantityBase: ing.quantityBase, unitCostPerBase: item ? num(item.lastCost) : 0, wastePercent: ing.wastePercent };
  });
  return { costIngredients };
}

export default async function recipeRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireCompany }, async (req) => {
    const recipes = await prisma.recipe.findMany({
      where: { deletedAt: null, companyId: req.user.companyId! },
      orderBy: { updatedAt: 'desc' },
      include: {
        product: { select: { id: true, code: true, name: true, imageUrl: true } },
        versions: { where: { isActive: true }, take: 1, include: { costs: { orderBy: { calculatedAt: 'desc' }, take: 1 } } },
        _count: { select: { versions: true } },
      },
    });
    return ok(recipes.map((r) => {
      const active = r.versions[0];
      const cost = active?.costs[0];
      return {
        id: r.id, code: r.code, name: r.name, isActive: r.isActive,
        product: r.product, versionCount: r._count.versions,
        activeVersionNo: active?.versionNo ?? null,
        yield: active ? num(active.standardYieldQty) : null,
        totalCost: cost ? num(cost.totalCost) : null,
        unitCost: cost ? num(cost.unitCost) : null,
        updatedAt: r.updatedAt.toISOString(),
      };
    }));
  });

  app.get('/:id', { preHandler: requireCompany }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const recipe = await prisma.recipe.findFirst({
      where: { id, deletedAt: null, companyId: req.user.companyId! },
      include: {
        product: { select: { id: true, code: true, name: true, imageUrl: true } },
        versions: {
          orderBy: { versionNo: 'desc' },
          include: {
            costs: { orderBy: { calculatedAt: 'desc' }, take: 1 },
            ingredients: { include: { item: { select: { id: true, code: true, name: true, type: true, imageUrl: true, lastCost: true, baseUnit: { select: { code: true } } } } } },
          },
        },
      },
    });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    return ok({
      id: recipe.id, code: recipe.code, name: recipe.name, description: recipe.description, isActive: recipe.isActive,
      product: recipe.product,
      versions: recipe.versions.map((v) => {
        const cost = v.costs[0];
        return {
          id: v.id, versionNo: v.versionNo, isActive: v.isActive,
          standardYieldQty: num(v.standardYieldQty), yieldPercent: num(v.yieldPercent), standardWaste: num(v.standardWaste),
          laborCost: num(v.laborCost), electricCost: num(v.electricCost), waterCost: num(v.waterCost),
          gasCost: num(v.gasCost), overheadCost: num(v.overheadCost), otherCost: num(v.otherCost),
          note: v.note, createdAt: v.createdAt.toISOString(),
          cost: cost ? { materialCost: num(cost.materialCost), packagingCost: num(cost.packagingCost), laborCost: num(cost.laborCost), utilityCost: num(cost.utilityCost), overheadCost: num(cost.overheadCost), wasteCost: num(cost.wasteCost), totalCost: num(cost.totalCost), unitCost: num(cost.unitCost) } : null,
          ingredients: v.ingredients.map((ing) => ({
            id: ing.id, itemId: ing.itemId, item: ing.item ? { id: ing.item.id, code: ing.item.code, name: ing.item.name, type: ing.item.type, imageUrl: ing.item.imageUrl, baseUnitCode: ing.item.baseUnit?.code ?? null, lastCost: num(ing.item.lastCost) } : null,
            quantityBase: num(ing.quantity), unitId: ing.unitId, wastePercent: num(ing.wastePercent),
            lineCost: num(ing.quantity) * (1 + num(ing.wastePercent) / 100) * (ing.item ? num(ing.item.lastCost) : 0),
          })),
        };
      }),
    });
  });

  app.post('/', { preHandler: MANAGE }, async (req, reply) => {
    const body = createRecipeSchema.parse(req.body);
    const companyId = req.user.companyId!;
    const product = body.productId
      ? await prisma.item.findFirst({ where: { id: body.productId, deletedAt: null, companyId, type: ItemType.FINISHED_GOOD } })
      : null;
    if (body.productId && !product) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบเมนูที่เลือก'));
    if (body.newMenu) {
      const duplicate = await prisma.item.findFirst({ where: { companyId, deletedAt: null, type: ItemType.FINISHED_GOOD, name: { equals: body.newMenu.name, mode: 'insensitive' } }, select: { id: true } });
      if (duplicate) return reply.status(409).send(fail('CONFLICT', 'มีเมนูชื่อนี้อยู่แล้ว กรุณาเลือกเมนูเดิม'));
      const unit = await prisma.unit.findFirst({ where: { id: body.newMenu.sellingUnitId, deletedAt: null, isActive: true }, select: { id: true } });
      if (!unit) return reply.status(400).send(fail('VALIDATION_ERROR', 'ไม่พบหน่วยขายที่เลือก'));
    }
    const { missing } = await buildCostInputs(body.version, companyId);
    if (missing.length) return reply.status(400).send(fail('VALIDATION_ERROR', 'มีวัตถุดิบที่ไม่พบในระบบ', { missing }));

    const productCode = product?.code ?? body.newMenu?.code?.trim() ?? `MENU-${Date.now().toString().slice(-6)}`;
    if (!product && await prisma.item.findUnique({ where: { code: productCode } })) return reply.status(409).send(fail('CONFLICT', 'มีรหัสเมนูนี้อยู่แล้ว'));
    let code = body.code?.trim() || `RCP-${productCode}`;
    if (await prisma.recipe.findUnique({ where: { code } })) code = `${code}-${Date.now().toString().slice(-5)}`;

    const result = await prisma.$transaction(async (tx) => {
      const menu = product ?? await tx.item.create({ data: { companyId, code: productCode, name: body.newMenu!.name, type: ItemType.FINISHED_GOOD, baseUnitId: body.newMenu!.sellingUnitId, isLotTracked: true, isExpiryTracked: true, createdById: req.user.sub, updatedById: req.user.sub } });
      const recipe = await tx.recipe.create({ data: { companyId, code, name: body.name ?? menu.name, productId: menu.id, description: body.description ?? null, createdById: req.user.sub, updatedById: req.user.sub } });
      const { breakdown } = await persistVersion(tx, recipe.id, 1, body.version, req.user.sub, companyId);
      return { recipe, breakdown, menuCreated: !product, menuId: menu.id };
    });
    await writeAudit(req, { action: 'CREATE', entity: 'Recipe', entityId: result.recipe.id, after: { code, versionNo: 1, menuCreated: result.menuCreated, menuId: result.menuId } });
    return reply.status(201).send(ok({ id: result.recipe.id, code, versionNo: 1, cost: result.breakdown, menuCreated: result.menuCreated }, 'สร้างสูตรสำเร็จ'));
  });

  app.post('/:id/versions', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = newVersionSchema.parse(req.body);
    const recipe = await prisma.recipe.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! }, include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    const { missing } = await buildCostInputs(body, req.user.companyId!);
    if (missing.length) return reply.status(400).send(fail('VALIDATION_ERROR', 'มีวัตถุดิบที่ไม่พบในระบบ', { missing }));
    const nextNo = (recipe.versions[0]?.versionNo ?? 0) + 1;

    const result = await prisma.$transaction(async (tx) => {
      const { created, breakdown } = await persistVersion(tx, id, nextNo, body, req.user.sub, req.user.companyId!);
      await tx.recipe.update({ where: { id }, data: { updatedById: req.user.sub } });
      return { created, breakdown };
    });
    await writeAudit(req, { action: 'NEW_VERSION', entity: 'Recipe', entityId: id, after: { versionNo: nextNo, reason: body.reason ?? null } });
    return reply.status(201).send(ok({ versionId: result.created.id, versionNo: nextNo, cost: result.breakdown }, `สร้างสูตรเวอร์ชัน ${nextNo} สำเร็จ`));
  });
}
