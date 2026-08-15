import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, ItemType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requireCompany, requirePermission } from '../auth/auth.guard.js';
import { writeAudit, num } from '../../lib/http.js';
import {
  calcRecipeCost, overheadFromRecord, RecipeCostError,
  type RecipeNode, type Component, type OverheadInput,
} from '../../lib/recipe-cost.js';

// สิทธิ์ (permission-code) — สร้าง = RECIPE_CREATE, แก้ไข/เก็บถาวร/ลบ/ทำสำเนา = RECIPE_EDIT
const CREATE = requirePermission('RECIPE_CREATE');
const EDIT = requirePermission('RECIPE_EDIT', 'RECIPE_CREATE');

// ---------- schemas ----------
const componentSchema = z.object({
  componentType: z.enum(['ITEM', 'SUB_RECIPE', 'PACKAGING']),
  itemId: z.string().optional().nullable(),
  childRecipeId: z.string().optional().nullable(),
  quantity: z.number().nonnegative(),
  unitId: z.string().optional().nullable(),
  wastePercent: z.number().min(0).max(100).default(0),
  note: z.string().max(200).optional().nullable(),
}).refine((c) => (c.componentType === 'SUB_RECIPE' ? Boolean(c.childRecipeId) && !c.itemId : Boolean(c.itemId) && !c.childRecipeId), {
  message: 'ต้องระบุ itemId (ITEM/PACKAGING) หรือ childRecipeId (SUB_RECIPE) อย่างใดอย่างหนึ่ง',
});

const overheadSchema = z.object({
  mode: z.enum(['TOTAL', 'PERCENTAGE', 'DETAILED']).nullable().optional(),
  total: z.number().min(0).nullable().optional(),
  percent: z.number().min(0).nullable().optional(),
  base: z.enum(['INGREDIENT', 'DIRECT', 'TOTAL']).nullable().optional(),
  details: z.array(z.object({ label: z.string().max(80), amount: z.number().min(0) })).nullable().optional(),
  note: z.string().max(300).nullable().optional(),
}).nullable().optional();

const versionSchema = z.object({
  standardYieldQty: z.number().positive('ผลผลิตต้องมากกว่า 0'),
  yieldUnitId: z.string().optional().nullable(),
  yieldPercent: z.number().positive().max(100).default(100),
  standardWaste: z.number().min(0).default(0),
  portionQty: z.number().positive().optional().nullable(),
  portionUnit: z.string().max(40).optional().nullable(),
  overhead: overheadSchema,
  note: z.string().max(300).optional().nullable(),
  components: z.array(componentSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
});
type VersionInput = z.infer<typeof versionSchema>;

const createRecipeSchema = z.object({
  productId: z.string().min(1).optional(),
  newMenu: z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().max(40).optional(), sellingUnitId: z.string().min(1) }).optional(),
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  version: versionSchema,
}).refine((b) => Boolean(b.productId) !== Boolean(b.newMenu), { message: 'เลือกเมนูเดิมหรือสร้างเมนูใหม่อย่างใดอย่างหนึ่ง' });

const newVersionSchema = versionSchema.extend({ reason: z.string().max(300).optional() });

// ---------- helpers ----------
type DraftComp = { componentType: string; itemId?: string | null; childRecipeId?: string | null; quantity: number; wastePercent: number };

function overheadInputFromDraft(o: VersionInput['overhead']): OverheadInput {
  if (o?.mode) return { mode: o.mode, total: o.total ?? null, percent: o.percent ?? null, base: o.base ?? null, details: o.details ?? null };
  return {};
}

/** โหลดกราฟสูตร (root + สูตรย่อยทั้งหมดในบริษัทเดียวกัน) → Map สำหรับ engine · มี guard กันลูปตอนโหลด */
async function loadGraph(companyId: string, rootId: string, comps: DraftComp[], overhead: OverheadInput, yieldQty: number, yieldPercent: number, portionQty: number | null): Promise<Map<string, RecipeNode>> {
  const nodes = new Map<string, RecipeNode>();
  async function add(id: string, c: DraftComp[], ov: OverheadInput, y: number, yp: number, pq: number | null) {
    if (nodes.has(id)) return;
    const itemIds = c.filter((x) => x.componentType !== 'SUB_RECIPE' && x.itemId).map((x) => x.itemId!);
    const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds }, companyId, deletedAt: null }, select: { id: true, type: true, lastCost: true } }) : [];
    const im = new Map(items.map((i) => [i.id, i]));
    const engineComps: Component[] = c.map((x) => {
      if (x.componentType === 'SUB_RECIPE') return { type: 'SUB_RECIPE', childRecipeId: x.childRecipeId!, quantity: x.quantity, wastePercent: x.wastePercent };
      const it = im.get(x.itemId!);
      return { type: x.componentType === 'PACKAGING' ? 'PACKAGING' : 'ITEM', quantityBase: x.quantity, unitCostPerBase: it ? num(it.lastCost) : 0, wastePercent: x.wastePercent };
    });
    nodes.set(id, { id, components: engineComps, overhead: ov, yieldQty: y, yieldPercent: yp, portionQty: pq });
    for (const x of c.filter((x) => x.componentType === 'SUB_RECIPE' && x.childRecipeId)) {
      if (nodes.has(x.childRecipeId!)) continue;
      const child = await prisma.recipe.findFirst({ where: { id: x.childRecipeId!, companyId, deletedAt: null }, include: { versions: { where: { isActive: true }, take: 1, include: { ingredients: true } } } });
      if (!child) throw new RecipeCostError('MISSING_RECIPE', 'ไม่พบสูตรย่อยในบริษัทปัจจุบัน (หรือถูกลบ/เก็บถาวร)');
      const cv = child.versions[0];
      if (!cv) throw new RecipeCostError('NO_ACTIVE_VERSION', 'สูตรย่อยยังไม่มีเวอร์ชันที่ใช้งาน');
      await add(child.id,
        cv.ingredients.map((g) => ({ componentType: g.componentType, itemId: g.itemId, childRecipeId: g.childRecipeId, quantity: num(g.quantity), wastePercent: num(g.wastePercent) })),
        overheadFromRecord({ overheadMode: cv.overheadMode, overheadTotal: cv.overheadTotal != null ? num(cv.overheadTotal) : null, overheadPercent: cv.overheadPercent != null ? num(cv.overheadPercent) : null, overheadBase: cv.overheadBase, overheadDetails: cv.overheadDetails, laborCost: num(cv.laborCost), electricCost: num(cv.electricCost), waterCost: num(cv.waterCost), gasCost: num(cv.gasCost), overheadCost: num(cv.overheadCost), otherCost: num(cv.otherCost) }),
        num(cv.standardYieldQty), num(cv.yieldPercent), cv.portionQty != null ? num(cv.portionQty) : null);
    }
  }
  await add(rootId, comps, overhead, yieldQty, yieldPercent, portionQty);
  return nodes;
}

/** คำนวณต้นทุน draft (rootId = id จริงสำหรับ edit เพื่อจับ cycle; placeholder สำหรับ create) */
async function computeDraft(companyId: string, rootId: string, v: VersionInput) {
  const comps: DraftComp[] = v.components.map((c) => ({ componentType: c.componentType, itemId: c.itemId, childRecipeId: c.childRecipeId, quantity: c.quantity, wastePercent: c.wastePercent }));
  const nodes = await loadGraph(companyId, rootId, comps, overheadInputFromDraft(v.overhead), v.standardYieldQty, v.yieldPercent, v.portionQty ?? null);
  return calcRecipeCost(rootId, nodes);
}

function costErrorReply(reply: import('fastify').FastifyReply, e: unknown) {
  if (e instanceof RecipeCostError) {
    const status = e.code === 'CIRCULAR_SUBRECIPE' ? 409 : 400;
    return reply.status(status).send(fail(e.code, e.message));
  }
  throw e;
}

/** validate ว่า item/child อยู่ในบริษัทเดียวกัน (company scoping) */
async function assertComponentsInCompany(companyId: string, v: VersionInput, selfRecipeId: string | null) {
  const itemIds = [...new Set(v.components.filter((c) => c.componentType !== 'SUB_RECIPE' && c.itemId).map((c) => c.itemId!))];
  if (itemIds.length) {
    const found = await prisma.item.count({ where: { id: { in: itemIds }, companyId, deletedAt: null } });
    if (found !== itemIds.length) throw new RecipeCostError('ITEM_NOT_IN_COMPANY', 'มีวัตถุดิบ/บรรจุภัณฑ์ที่ไม่พบในบริษัทปัจจุบัน');
  }
  const childIds = [...new Set(v.components.filter((c) => c.componentType === 'SUB_RECIPE' && c.childRecipeId).map((c) => c.childRecipeId!))];
  if (childIds.includes(selfRecipeId ?? '__none__')) throw new RecipeCostError('CIRCULAR_SUBRECIPE', 'ไม่สามารถอ้างอิงสูตรตัวเองเป็นสูตรย่อยได้');
  if (childIds.length) {
    const found = await prisma.recipe.count({ where: { id: { in: childIds }, companyId, deletedAt: null, isActive: true } });
    if (found !== childIds.length) throw new RecipeCostError('CHILD_NOT_IN_COMPANY', 'มีสูตรย่อยที่ไม่พบ/ถูกเก็บถาวรในบริษัทปัจจุบัน');
  }
}

async function persistVersion(tx: Prisma.TransactionClient, recipeId: string, versionNo: number, v: VersionInput, userId: string, cost: Awaited<ReturnType<typeof computeDraft>>) {
  const o = v.overhead;
  await tx.recipeVersion.updateMany({ where: { recipeId, isActive: true }, data: { isActive: false } });
  const created = await tx.recipeVersion.create({
    data: {
      recipeId, versionNo, isActive: true,
      standardYieldQty: new Prisma.Decimal(v.standardYieldQty), yieldPercent: new Prisma.Decimal(v.yieldPercent), standardWaste: new Prisma.Decimal(v.standardWaste),
      yieldUnitId: v.yieldUnitId ?? null, portionQty: v.portionQty != null ? new Prisma.Decimal(v.portionQty) : null, portionUnit: v.portionUnit ?? null,
      overheadMode: o?.mode ?? null, overheadPercent: o?.percent != null ? new Prisma.Decimal(o.percent) : null, overheadBase: o?.base ?? null,
      overheadTotal: o?.total != null ? new Prisma.Decimal(o.total) : null, overheadDetails: (o?.details ?? undefined) as Prisma.InputJsonValue | undefined,
      // legacy fields kept 0 (new recipes use overhead modes)
      note: v.note ?? null, createdById: userId,
      ingredients: {
        create: v.components.map((c, i) => ({
          componentType: c.componentType, itemId: c.componentType === 'SUB_RECIPE' ? null : c.itemId!, childRecipeId: c.componentType === 'SUB_RECIPE' ? c.childRecipeId! : null,
          quantity: new Prisma.Decimal(c.quantity), unitId: c.unitId ?? null, wastePercent: new Prisma.Decimal(c.wastePercent), sortOrder: i, note: c.note ?? null,
        })),
      },
      costs: {
        create: {
          materialCost: new Prisma.Decimal(cost.ingredientCost), packagingCost: new Prisma.Decimal(cost.packagingCost),
          laborCost: new Prisma.Decimal(0), utilityCost: new Prisma.Decimal(cost.subRecipeCost), overheadCost: new Prisma.Decimal(cost.overheadCost),
          wasteCost: new Prisma.Decimal(0), totalCost: new Prisma.Decimal(cost.totalCost), unitCost: new Prisma.Decimal(cost.costPerYieldUnit), costType: 'STANDARD',
        },
      },
    },
  });
  return created;
}

// serialize a stored version → builder view (recompute live for sub-recipe accuracy)
async function serializeVersion(companyId: string, recipeId: string, v: Prisma.RecipeVersionGetPayload<{ include: { ingredients: { include: { item: { include: { baseUnit: true; purchaseUnit: true } }; childRecipe: true; unit: true } }; yieldUnit: true; costs: true } }>) {
  const draft: VersionInput = {
    standardYieldQty: num(v.standardYieldQty), yieldUnitId: v.yieldUnitId, yieldPercent: num(v.yieldPercent), standardWaste: num(v.standardWaste),
    portionQty: v.portionQty != null ? num(v.portionQty) : null, portionUnit: v.portionUnit,
    overhead: v.overheadMode ? { mode: v.overheadMode as 'TOTAL' | 'PERCENTAGE' | 'DETAILED', total: v.overheadTotal != null ? num(v.overheadTotal) : null, percent: v.overheadPercent != null ? num(v.overheadPercent) : null, base: v.overheadBase as 'INGREDIENT' | 'DIRECT' | 'TOTAL' | null, details: Array.isArray(v.overheadDetails) ? (v.overheadDetails as { label: string; amount: number }[]) : null } : null,
    note: v.note,
    components: v.ingredients.map((g) => ({ componentType: g.componentType as 'ITEM' | 'SUB_RECIPE' | 'PACKAGING', itemId: g.itemId, childRecipeId: g.childRecipeId, quantity: num(g.quantity), unitId: g.unitId, wastePercent: num(g.wastePercent), note: g.note })),
  };
  let breakdown; let costError: string | null = null;
  try { breakdown = await computeDraft(companyId, recipeId, draft); } catch (e) { costError = e instanceof RecipeCostError ? e.code : 'COST_ERROR'; }
  // child recipe live unit cost for display
  const childIds = v.ingredients.filter((g) => g.childRecipeId).map((g) => g.childRecipeId!);
  const childCosts = new Map<string, { yieldQty: number; unitCost: number; yieldUnitId: string | null }>();
  for (const cid of [...new Set(childIds)]) {
    const cv = await prisma.recipeVersion.findFirst({ where: { recipeId: cid, isActive: true }, include: { costs: { orderBy: { calculatedAt: 'desc' }, take: 1 } } });
    if (cv) childCosts.set(cid, { yieldQty: num(cv.standardYieldQty), unitCost: cv.costs[0] ? num(cv.costs[0].unitCost) : 0, yieldUnitId: cv.yieldUnitId });
  }
  return {
    id: v.id, versionNo: v.versionNo, isActive: v.isActive,
    standardYieldQty: num(v.standardYieldQty), yieldUnitId: v.yieldUnitId, yieldUnit: v.yieldUnit ? { id: v.yieldUnit.id, code: v.yieldUnit.code, name: v.yieldUnit.name } : null,
    yieldPercent: num(v.yieldPercent), portionQty: v.portionQty != null ? num(v.portionQty) : null, portionUnit: v.portionUnit,
    overhead: draft.overhead, note: v.note, createdAt: v.createdAt.toISOString(),
    components: v.ingredients.map((g) => ({
      id: g.id, componentType: g.componentType, itemId: g.itemId, childRecipeId: g.childRecipeId, quantity: num(g.quantity), unitId: g.unitId, wastePercent: num(g.wastePercent), note: g.note,
      item: g.item ? { id: g.item.id, code: g.item.code, name: g.item.name, type: g.item.type, imageUrl: g.item.imageUrl, baseUnitCode: g.item.baseUnit?.code ?? null, purchaseUnitCode: g.item.purchaseUnit?.code ?? null, purchaseToBaseFactor: num(g.item.purchaseToBaseFactor), lastCost: num(g.item.lastCost) } : null,
      childRecipe: g.childRecipe ? { id: g.childRecipe.id, code: g.childRecipe.code, name: g.childRecipe.name, ...(childCosts.get(g.childRecipe.id) ?? { yieldQty: 0, unitCost: 0, yieldUnitId: null }) } : null,
    })),
    cost: breakdown ?? null, costError,
  };
}

export default async function recipeRoutes(app: FastifyInstance) {
  // list (active by default; ?archived=1 for archived)
  app.get('/', { preHandler: requireCompany }, async (req) => {
    const { archived } = z.object({ archived: z.enum(['0', '1']).optional() }).parse(req.query ?? {});
    const recipes = await prisma.recipe.findMany({
      where: { deletedAt: null, companyId: req.user.companyId!, ...(archived === '1' ? { isActive: false } : { isActive: true }) },
      orderBy: { updatedAt: 'desc' },
      include: { product: { select: { id: true, code: true, name: true, imageUrl: true } }, versions: { where: { isActive: true }, take: 1, include: { costs: { orderBy: { calculatedAt: 'desc' }, take: 1 }, yieldUnit: true } }, _count: { select: { versions: true } } },
    });
    return ok(recipes.map((r) => {
      const a = r.versions[0]; const c = a?.costs[0];
      return { id: r.id, code: r.code, name: r.name, isActive: r.isActive, product: r.product, versionCount: r._count.versions, activeVersionNo: a?.versionNo ?? null, yield: a ? num(a.standardYieldQty) : null, yieldUnit: a?.yieldUnit?.code ?? null, totalCost: c ? num(c.totalCost) : null, unitCost: c ? num(c.unitCost) : null, updatedAt: r.updatedAt.toISOString() };
    }));
  });

  // selectable sub-recipes (current company, active, exclude self)
  app.get('/selectable-subrecipes', { preHandler: requireCompany }, async (req) => {
    const { search, exclude } = z.object({ search: z.string().trim().optional(), exclude: z.string().optional() }).parse(req.query ?? {});
    const rows = await prisma.recipe.findMany({
      where: { companyId: req.user.companyId!, deletedAt: null, isActive: true, ...(exclude ? { id: { not: exclude } } : {}), ...(search ? { OR: [{ name: { contains: search } }, { code: { contains: search } }] } : {}) },
      orderBy: { name: 'asc' }, take: 100,
      include: { versions: { where: { isActive: true }, take: 1, include: { costs: { orderBy: { calculatedAt: 'desc' }, take: 1 }, yieldUnit: true } } },
    });
    return ok(rows.filter((r) => r.versions[0]).map((r) => { const v = r.versions[0]; const c = v.costs[0]; return { id: r.id, code: r.code, name: r.name, yieldQty: num(v.standardYieldQty), yieldUnit: v.yieldUnit?.code ?? null, yieldUnitId: v.yieldUnitId, totalCost: c ? num(c.totalCost) : 0, unitCost: c ? num(c.unitCost) : 0 }; }));
  });

  // draft preview (no persistence)
  app.post('/calculate', { preHandler: requireCompany }, async (req, reply) => {
    const body = z.object({ recipeId: z.string().optional(), version: versionSchema }).parse(req.body);
    try { await assertComponentsInCompany(req.user.companyId!, body.version, body.recipeId ?? null); return ok(await computeDraft(req.user.companyId!, body.recipeId ?? '__DRAFT__', body.version)); }
    catch (e) { return costErrorReply(reply, e); }
  });

  app.get('/:id', { preHandler: requireCompany }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const recipe = await prisma.recipe.findFirst({
      where: { id, deletedAt: null, companyId: req.user.companyId! },
      include: { product: { select: { id: true, code: true, name: true, imageUrl: true } }, versions: { orderBy: { versionNo: 'desc' }, include: { yieldUnit: true, costs: { orderBy: { calculatedAt: 'desc' }, take: 1 }, ingredients: { orderBy: { sortOrder: 'asc' }, include: { item: { include: { baseUnit: true, purchaseUnit: true } }, childRecipe: true, unit: true } } } } },
    });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    const versions = await Promise.all(recipe.versions.map((v) => serializeVersion(req.user.companyId!, recipe.id, v)));
    return ok({ id: recipe.id, code: recipe.code, name: recipe.name, description: recipe.description, isActive: recipe.isActive, product: recipe.product, versions });
  });

  app.post('/', { preHandler: CREATE }, async (req, reply) => {
    const body = createRecipeSchema.parse(req.body);
    const companyId = req.user.companyId!;
    const product = body.productId ? await prisma.item.findFirst({ where: { id: body.productId, deletedAt: null, companyId, type: ItemType.FINISHED_GOOD } }) : null;
    if (body.productId && !product) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบเมนูที่เลือก'));
    if (body.newMenu) {
      if (await prisma.item.findFirst({ where: { companyId, deletedAt: null, type: ItemType.FINISHED_GOOD, name: { equals: body.newMenu.name } }, select: { id: true } })) return reply.status(409).send(fail('CONFLICT', 'มีเมนูชื่อนี้อยู่แล้ว กรุณาเลือกเมนูเดิม'));
      if (!await prisma.unit.findFirst({ where: { id: body.newMenu.sellingUnitId, deletedAt: null, isActive: true }, select: { id: true } })) return reply.status(400).send(fail('VALIDATION_ERROR', 'ไม่พบหน่วยขายที่เลือก'));
    }
    try {
      await assertComponentsInCompany(companyId, body.version, null);
      const cost = await computeDraft(companyId, '__NEW__', body.version); // new recipe not referenceable → no cycle
      const productCode = product?.code ?? body.newMenu?.code?.trim() ?? `MENU-${Date.now().toString().slice(-6)}`;
      if (!product && await prisma.item.findUnique({ where: { code: productCode } })) return reply.status(409).send(fail('CONFLICT', 'มีรหัสเมนูนี้อยู่แล้ว'));
      let code = body.code?.trim() || `RCP-${productCode}`;
      if (await prisma.recipe.findUnique({ where: { code } })) code = `${code}-${Date.now().toString().slice(-5)}`;
      const result = await prisma.$transaction(async (tx) => {
        const menu = product ?? await tx.item.create({ data: { companyId, code: productCode, name: body.newMenu!.name, type: ItemType.FINISHED_GOOD, baseUnitId: body.newMenu!.sellingUnitId, isLotTracked: true, isExpiryTracked: true, createdById: req.user.sub, updatedById: req.user.sub } });
        const recipe = await tx.recipe.create({ data: { companyId, code, name: body.name ?? menu.name, productId: menu.id, description: body.description ?? null, createdById: req.user.sub, updatedById: req.user.sub } });
        await persistVersion(tx, recipe.id, 1, body.version, req.user.sub, cost);
        return { recipe, menuCreated: !product };
      });
      await writeAudit(req, { action: 'RECIPE_CREATED', entity: 'Recipe', entityId: result.recipe.id, after: { code, versionNo: 1, menuCreated: result.menuCreated } });
      return reply.status(201).send(ok({ id: result.recipe.id, code, versionNo: 1, cost, menuCreated: result.menuCreated }, 'สร้างสูตรสำเร็จ'));
    } catch (e) { return costErrorReply(reply, e); }
  });

  app.post('/:id/versions', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = newVersionSchema.parse(req.body);
    const recipe = await prisma.recipe.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! }, include: { versions: { orderBy: { versionNo: 'desc' }, take: 1 } } });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    try {
      await assertComponentsInCompany(req.user.companyId!, body, id);
      const cost = await computeDraft(req.user.companyId!, id, body); // rootId=id → catches A→…→A
      const nextNo = (recipe.versions[0]?.versionNo ?? 0) + 1;
      const created = await prisma.$transaction(async (tx) => { const c = await persistVersion(tx, id, nextNo, body, req.user.sub, cost); await tx.recipe.update({ where: { id }, data: { updatedById: req.user.sub } }); return c; });
      await writeAudit(req, { action: 'RECIPE_UPDATED', entity: 'Recipe', entityId: id, after: { versionNo: nextNo, reason: body.reason ?? null } });
      return reply.status(201).send(ok({ versionId: created.id, versionNo: nextNo, cost }, `สร้างสูตรเวอร์ชัน ${nextNo} สำเร็จ`));
    } catch (e) { return costErrorReply(reply, e); }
  });

  app.post('/:id/archive', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const recipe = await prisma.recipe.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    if (!recipe.isActive) return ok(recipe);
    const updated = await prisma.recipe.update({ where: { id }, data: { isActive: false, updatedById: req.user.sub } });
    await writeAudit(req, { action: 'RECIPE_ARCHIVED', entity: 'Recipe', entityId: id });
    return ok(updated, 'เก็บถาวรสูตรแล้ว');
  });

  app.post('/:id/restore', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const recipe = await prisma.recipe.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    const updated = await prisma.recipe.update({ where: { id }, data: { isActive: true, updatedById: req.user.sub } });
    await writeAudit(req, { action: 'RECIPE_RESTORED', entity: 'Recipe', entityId: id });
    return ok(updated, 'กู้คืนสูตรแล้ว');
  });

  // safe hard delete — blocked if referenced (sub-recipe / production)
  app.delete('/:id', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const recipe = await prisma.recipe.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    const [usedAsSub, usedInProduction] = await Promise.all([
      prisma.recipeIngredient.count({ where: { childRecipeId: id } }),
      prisma.productionOrder.count({ where: { recipeId: id } }),
    ]);
    if (usedAsSub > 0 || usedInProduction > 0) return reply.status(409).send(fail('RECIPE_IN_USE', 'สูตรนี้มีประวัติการใช้งาน จึงไม่สามารถลบถาวรได้', { usedAsSub, usedInProduction }));
    await prisma.$transaction(async (tx) => {
      const vids = (await tx.recipeVersion.findMany({ where: { recipeId: id }, select: { id: true } })).map((v) => v.id);
      if (vids.length) { await tx.recipeCost.deleteMany({ where: { recipeVersionId: { in: vids } } }); await tx.recipeIngredient.deleteMany({ where: { recipeVersionId: { in: vids } } }); }
      await tx.recipeVersion.deleteMany({ where: { recipeId: id } });
      await tx.recipe.update({ where: { id }, data: { deletedAt: new Date(), isActive: false, updatedById: req.user.sub } });
    });
    await writeAudit(req, { action: 'RECIPE_DELETED', entity: 'Recipe', entityId: id, before: { code: recipe.code, name: recipe.name } });
    return ok({ id, deleted: true }, 'ลบสูตรถาวรแล้ว');
  });

  app.post('/:id/duplicate', { preHandler: CREATE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const recipe = await prisma.recipe.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! }, include: { versions: { where: { isActive: true }, take: 1, include: { ingredients: { orderBy: { sortOrder: 'asc' } } } } } });
    if (!recipe) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตร'));
    const src = recipe.versions[0];
    if (!src) return reply.status(400).send(fail('NO_ACTIVE_VERSION', 'สูตรต้นทางไม่มีเวอร์ชันที่ใช้งาน'));
    const newCode = `${recipe.code}-COPY-${Date.now().toString().slice(-5)}`;
    const dup = await prisma.$transaction(async (tx) => {
      const created = await tx.recipe.create({ data: { companyId: req.user.companyId!, code: newCode, name: `${recipe.name} - สำเนา`, productId: recipe.productId, description: recipe.description, createdById: req.user.sub, updatedById: req.user.sub } });
      await tx.recipeVersion.create({ data: {
        recipeId: created.id, versionNo: 1, isActive: true,
        standardYieldQty: src.standardYieldQty, yieldPercent: src.yieldPercent, standardWaste: src.standardWaste, yieldUnitId: src.yieldUnitId, portionQty: src.portionQty, portionUnit: src.portionUnit,
        overheadMode: src.overheadMode, overheadPercent: src.overheadPercent, overheadBase: src.overheadBase, overheadTotal: src.overheadTotal, overheadDetails: (src.overheadDetails ?? undefined) as Prisma.InputJsonValue | undefined,
        laborCost: src.laborCost, electricCost: src.electricCost, waterCost: src.waterCost, gasCost: src.gasCost, overheadCost: src.overheadCost, otherCost: src.otherCost, createdById: req.user.sub,
        ingredients: { create: src.ingredients.map((g) => ({ componentType: g.componentType, itemId: g.itemId, childRecipeId: g.childRecipeId, quantity: g.quantity, unitId: g.unitId, wastePercent: g.wastePercent, sortOrder: g.sortOrder, note: g.note })) },
      } });
      return created;
    });
    await writeAudit(req, { action: 'RECIPE_DUPLICATED', entity: 'Recipe', entityId: dup.id, after: { fromRecipeId: id, code: newCode } });
    return reply.status(201).send(ok({ id: dup.id, code: newCode, name: dup.name }, 'ทำสำเนาสูตรสำเร็จ'));
  });
}
