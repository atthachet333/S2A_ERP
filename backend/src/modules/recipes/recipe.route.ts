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
import { effectiveYieldMode, toBaseQuantity, toChildYieldQuantity, type ConvEdge } from '../../lib/unit-convert.js';

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

const versionBase = z.object({
  standardYieldQty: z.number().positive('ผลผลิตต้องมากกว่า 0'),
  yieldMode: z.enum(['ACTUAL', 'BATCH']).optional().nullable(),
  yieldUnitId: z.string().optional().nullable(),
  yieldPercent: z.number().positive().max(100).default(100),
  standardWaste: z.number().min(0).default(0),
  portionQty: z.number().positive().optional().nullable(),
  portionUnit: z.string().max(40).optional().nullable(),
  overhead: overheadSchema,
  note: z.string().max(300).optional().nullable(),
  components: z.array(componentSchema).min(1, 'ต้องมีอย่างน้อย 1 รายการ'),
});

/** ACTUAL ต้องมีหน่วยผลผลิตเสมอ · BATCH ไม่ต้องมี (คิดเป็น 1 Batch) */
const requireYieldUnitForActual = (v: { yieldMode?: 'ACTUAL' | 'BATCH' | null; yieldUnitId?: string | null }) =>
  v.yieldMode !== 'ACTUAL' || Boolean(v.yieldUnitId);
const YIELD_UNIT_ISSUE = { message: 'โหมดผลผลิตจริงต้องระบุหน่วยผลผลิต', path: ['yieldUnitId'] };

const versionSchema = versionBase.refine(requireYieldUnitForActual, YIELD_UNIT_ISSUE);
type VersionInput = z.infer<typeof versionBase>;

const createRecipeSchema = z.object({
  productId: z.string().min(1).optional(),
  newMenu: z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().max(40).optional(), sellingUnitId: z.string().min(1) }).optional(),
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120).optional(),
  description: z.string().max(500).optional().nullable(),
  version: versionSchema,
}).refine((b) => Boolean(b.productId) !== Boolean(b.newMenu), { message: 'เลือกเมนูเดิมหรือสร้างเมนูใหม่อย่างใดอย่างหนึ่ง' });

const newVersionSchema = versionBase.extend({ reason: z.string().max(300).optional() }).refine(requireYieldUnitForActual, YIELD_UNIT_ISSUE);

// ---------- helpers ----------
type DraftComp = { componentType: string; itemId?: string | null; childRecipeId?: string | null; quantity: number; unitId?: string | null; wastePercent: number };

function overheadInputFromDraft(o: VersionInput['overhead']): OverheadInput {
  if (o?.mode) return { mode: o.mode, total: o.total ?? null, percent: o.percent ?? null, base: o.base ?? null, details: o.details ?? null };
  return {};
}

/** โหลดกราฟสูตร (root + สูตรย่อยทั้งหมดในบริษัทเดียวกัน) → Map สำหรับ engine · มี guard กันลูปตอนโหลด */
async function loadGraph(companyId: string, rootId: string, comps: DraftComp[], overhead: OverheadInput, yieldQty: number, yieldPercent: number, portionQty: number | null): Promise<Map<string, RecipeNode>> {
  const nodes = new Map<string, RecipeNode>();
  // ตารางแปลงหน่วยมาตรฐาน โหลดครั้งเดียวต่อการคำนวณ (ใช้ร่วมทุก node ในกราฟ)
  const edges: ConvEdge[] = (await prisma.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
    .map((e) => ({ fromUnitId: e.fromUnitId, toUnitId: e.toUnitId, factor: num(e.factor) }));

  async function add(id: string, c: DraftComp[], ov: OverheadInput, y: number, yp: number, pq: number | null) {
    if (nodes.has(id)) return;
    const itemIds = c.filter((x) => x.componentType !== 'SUB_RECIPE' && x.itemId).map((x) => x.itemId!);
    const items = itemIds.length ? await prisma.item.findMany({ where: { id: { in: itemIds }, companyId, deletedAt: null }, select: { id: true, type: true, lastCost: true, baseUnitId: true, purchaseUnitId: true, purchaseToBaseFactor: true } }) : [];
    const im = new Map(items.map((i) => [i.id, i]));
    // สูตรย่อยที่ถูกอ้างถึง — ต้องรู้หน่วยผลผลิตเพื่อแปลงปริมาณที่ใช้ให้ถูกหน่วย
    const childIds = c.filter((x) => x.componentType === 'SUB_RECIPE' && x.childRecipeId).map((x) => x.childRecipeId!);
    const childYieldUnits = new Map<string, string | null>();
    const childYieldModes = new Map<string, 'ACTUAL' | 'BATCH' | null>();
    if (childIds.length) {
      const rows = await prisma.recipe.findMany({ where: { id: { in: childIds }, companyId, deletedAt: null }, select: { id: true, versions: { where: { isActive: true }, take: 1, select: { yieldUnitId: true, yieldMode: true, standardYieldQty: true } } } });
      for (const r of rows) {
        const cv = r.versions[0];
        childYieldUnits.set(r.id, cv?.yieldUnitId ?? null);
        // สูตรเก่าที่มีผลผลิตจริงครบ (qty + หน่วย) ถือเป็น ACTUAL โดยไม่ต้องแก้ DB
        childYieldModes.set(r.id, effectiveYieldMode(cv?.yieldMode as 'ACTUAL' | 'BATCH' | null, cv?.yieldUnitId, cv ? num(cv.standardYieldQty) : 0));
      }
    }

    const engineComps: Component[] = c.map((x) => {
      if (x.componentType === 'SUB_RECIPE') {
        // ปริมาณสูตรย่อยคิดเป็นหน่วยผลผลิตของสูตรลูกเสมอ
        const childMode = childYieldModes.get(x.childRecipeId!) ?? null;
        const qty = toChildYieldQuantity(x.quantity, x.unitId, childYieldUnits.get(x.childRecipeId!) ?? null, edges, childMode);
        if (qty == null) {
          if (childMode === 'BATCH') throw new RecipeCostError('BATCH_UNIT_NOT_CONVERTIBLE', 'สูตรย่อยนี้ยังไม่ทราบผลผลิตจริง จึงแปลงเป็นหน่วยอื่นไม่ได้ — ใช้เป็นจำนวน Batch หรือกำหนด Yield จริงก่อน');
          if (childMode === null) throw new RecipeCostError('YIELD_MODE_REQUIRED', 'สูตรย่อยยังไม่ได้กำหนดวิธีคิดผลผลิต (ผลผลิตจริง หรือ 1 รอบการผลิต) กรุณากำหนดก่อน');
          throw new RecipeCostError('MISSING_CONVERSION', 'ไม่มีอัตราแปลงหน่วยระหว่างหน่วยที่เลือกกับหน่วยผลผลิตของสูตรย่อย กรุณาตั้งค่าอัตราแปลงก่อน');
        }
        return { type: 'SUB_RECIPE', childRecipeId: x.childRecipeId!, quantity: qty, wastePercent: x.wastePercent };
      }
      const it = im.get(x.itemId!);
      // lastCost คือต้นทุนต่อ "หน่วยฐาน" จึงต้องแปลงปริมาณเป็นหน่วยฐานก่อนคูณเสมอ
      const qtyBase = it
        ? toBaseQuantity(x.quantity, x.unitId, { baseUnitId: it.baseUnitId, purchaseUnitId: it.purchaseUnitId, purchaseToBaseFactor: num(it.purchaseToBaseFactor) }, edges)
        : x.quantity;
      if (qtyBase == null) throw new RecipeCostError('MISSING_CONVERSION', 'ไม่มีอัตราแปลงหน่วยของวัตถุดิบนี้ กรุณาตั้งค่าอัตราแปลงหน่วยสำหรับสูตรก่อน');
      return { type: x.componentType === 'PACKAGING' ? 'PACKAGING' : 'ITEM', quantityBase: qtyBase, unitCostPerBase: it ? num(it.lastCost) : 0, wastePercent: x.wastePercent };
    });
    nodes.set(id, { id, components: engineComps, overhead: ov, yieldQty: y, yieldPercent: yp, portionQty: pq });
    for (const x of c.filter((x) => x.componentType === 'SUB_RECIPE' && x.childRecipeId)) {
      if (nodes.has(x.childRecipeId!)) continue;
      const child = await prisma.recipe.findFirst({ where: { id: x.childRecipeId!, companyId, deletedAt: null }, include: { versions: { where: { isActive: true }, take: 1, include: { ingredients: true } } } });
      if (!child) throw new RecipeCostError('MISSING_RECIPE', 'ไม่พบสูตรย่อยในบริษัทปัจจุบัน (หรือถูกลบ/เก็บถาวร)');
      const cv = child.versions[0];
      if (!cv) throw new RecipeCostError('NO_ACTIVE_VERSION', 'สูตรย่อยยังไม่มีเวอร์ชันที่ใช้งาน');
      await add(child.id,
        cv.ingredients.map((g) => ({ componentType: g.componentType, itemId: g.itemId, childRecipeId: g.childRecipeId, quantity: num(g.quantity), unitId: g.unitId, wastePercent: num(g.wastePercent) })),
        overheadFromRecord({ overheadMode: cv.overheadMode, overheadTotal: cv.overheadTotal != null ? num(cv.overheadTotal) : null, overheadPercent: cv.overheadPercent != null ? num(cv.overheadPercent) : null, overheadBase: cv.overheadBase, overheadDetails: cv.overheadDetails, laborCost: num(cv.laborCost), electricCost: num(cv.electricCost), waterCost: num(cv.waterCost), gasCost: num(cv.gasCost), overheadCost: num(cv.overheadCost), otherCost: num(cv.otherCost) }),
        num(cv.standardYieldQty), num(cv.yieldPercent), cv.portionQty != null ? num(cv.portionQty) : null);
    }
  }
  await add(rootId, comps, overhead, yieldQty, yieldPercent, portionQty);
  return nodes;
}

/** คำนวณต้นทุน draft (rootId = id จริงสำหรับ edit เพื่อจับ cycle; placeholder สำหรับ create) */
async function computeDraft(companyId: string, rootId: string, v: VersionInput) {
  const comps: DraftComp[] = v.components.map((c) => ({ componentType: c.componentType, itemId: c.itemId, childRecipeId: c.childRecipeId, quantity: c.quantity, unitId: c.unitId, wastePercent: c.wastePercent }));
  const nodes = await loadGraph(companyId, rootId, comps, overheadInputFromDraft(v.overhead), v.standardYieldQty, v.yieldPercent, v.portionQty ?? null);
  return calcRecipeCost(rootId, nodes);
}

/** overhead ของเวอร์ชันที่บันทึกไว้ → รูปแบบ draft · สูตรเก่าที่ยังใช้ช่องค่าใช้จ่ายเดิมถูกรวมเป็นรายการเดียว */
function overheadDraftFromVersion(v: {
  overheadMode: string | null; overheadTotal: Prisma.Decimal | null; overheadPercent: Prisma.Decimal | null;
  overheadBase: string | null; overheadDetails: Prisma.JsonValue | null;
  laborCost: Prisma.Decimal; electricCost: Prisma.Decimal; waterCost: Prisma.Decimal;
  gasCost: Prisma.Decimal; overheadCost: Prisma.Decimal; otherCost: Prisma.Decimal;
}): VersionInput['overhead'] {
  if (v.overheadMode) {
    return {
      mode: v.overheadMode as 'TOTAL' | 'PERCENTAGE' | 'DETAILED',
      total: v.overheadTotal != null ? num(v.overheadTotal) : null,
      percent: v.overheadPercent != null ? num(v.overheadPercent) : null,
      base: v.overheadBase as 'INGREDIENT' | 'DIRECT' | 'TOTAL' | null,
      details: Array.isArray(v.overheadDetails) ? (v.overheadDetails as { label: string; amount: number }[]) : null,
    };
  }
  const legacyTotal = num(v.laborCost) + num(v.electricCost) + num(v.waterCost) + num(v.gasCost) + num(v.overheadCost) + num(v.otherCost);
  return legacyTotal > 0 ? { mode: 'TOTAL', total: legacyTotal } : null;
}

/**
 * ต้นทุนของ "เวอร์ชันที่บันทึกไว้" — ใช้ engine ตัวเดียวกับ Recipe Builder (calcRecipeCost)
 * เพื่อให้หน้า /costing และ /pricing ได้เลขชุดเดียวกันเสมอ (แปลงหน่วย + สูตรย่อย + overhead โหมดใหม่)
 * อ่านราคาวัตถุดิบ/อัตราแปลงล่าสุดทุกครั้งที่เรียก จึงเป็น real-time ตามราคาปัจจุบัน
 */
export async function computeSavedVersionCost(companyId: string, versionId: string) {
  const v = await prisma.recipeVersion.findFirst({
    where: { id: versionId, recipe: { companyId } },
    include: { ingredients: true, recipe: { select: { id: true } } },
  });
  if (!v) return null;
  const draft: VersionInput = {
    standardYieldQty: num(v.standardYieldQty), yieldMode: v.yieldMode as 'ACTUAL' | 'BATCH' | null,
    yieldUnitId: v.yieldUnitId, yieldPercent: num(v.yieldPercent), standardWaste: num(v.standardWaste),
    portionQty: v.portionQty != null ? num(v.portionQty) : null, portionUnit: v.portionUnit,
    overhead: overheadDraftFromVersion(v),
    note: v.note,
    components: v.ingredients.map((g) => ({ componentType: g.componentType as 'ITEM' | 'SUB_RECIPE' | 'PACKAGING', itemId: g.itemId, childRecipeId: g.childRecipeId, quantity: num(g.quantity), unitId: g.unitId, wastePercent: num(g.wastePercent), note: g.note })),
  };
  const cost = await computeDraft(companyId, v.recipeId, draft);
  return { cost, versionNo: v.versionNo, recipeId: v.recipeId, yieldUnitId: v.yieldUnitId, portionUnit: v.portionUnit };
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
      standardYieldQty: new Prisma.Decimal(v.yieldMode === 'BATCH' ? 1 : v.standardYieldQty), yieldPercent: new Prisma.Decimal(v.yieldPercent), standardWaste: new Prisma.Decimal(v.standardWaste),
      yieldMode: v.yieldMode ?? null,
      yieldUnitId: v.yieldMode === 'BATCH' ? null : (v.yieldUnitId ?? null), portionQty: v.portionQty != null ? new Prisma.Decimal(v.portionQty) : null, portionUnit: v.portionUnit ?? null,
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
    standardYieldQty: num(v.standardYieldQty), yieldMode: (v.yieldMode as 'ACTUAL' | 'BATCH' | null) ?? null, yieldUnitId: v.yieldUnitId, yieldPercent: num(v.yieldPercent), standardWaste: num(v.standardWaste),
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
  // ปริมาณในหน่วยฐานของแต่ละแถว — ใช้ทั้งการแสดงผลและ lineCost ให้ตรงกับ engine
  const convEdges: ConvEdge[] = (await prisma.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
    .map((e) => ({ fromUnitId: e.fromUnitId, toUnitId: e.toUnitId, factor: num(e.factor) }));
  const baseQtyOf = (g: (typeof v.ingredients)[number]): number | null => (g.item
    ? toBaseQuantity(num(g.quantity), g.unitId, { baseUnitId: g.item.baseUnitId, purchaseUnitId: g.item.purchaseUnitId, purchaseToBaseFactor: num(g.item.purchaseToBaseFactor) }, convEdges)
    : num(g.quantity));

  const components = v.ingredients.map((g) => ({
    id: g.id, componentType: g.componentType, itemId: g.itemId, childRecipeId: g.childRecipeId, quantity: num(g.quantity), unitId: g.unitId, quantityInBaseUnit: baseQtyOf(g), wastePercent: num(g.wastePercent), note: g.note,
    item: g.item ? { id: g.item.id, code: g.item.code, name: g.item.name, type: g.item.type, imageUrl: g.item.imageUrl, baseUnitCode: g.item.baseUnit?.code ?? null, purchaseUnitCode: g.item.purchaseUnit?.code ?? null, purchaseToBaseFactor: num(g.item.purchaseToBaseFactor), lastCost: num(g.item.lastCost) } : null,
    unit: g.unit ? { id: g.unit.id, code: g.unit.code, name: g.unit.name } : null,
    childRecipe: g.childRecipe ? { id: g.childRecipe.id, code: g.childRecipe.code, name: g.childRecipe.name, ...(childCosts.get(g.childRecipe.id) ?? { yieldQty: 0, unitCost: 0, yieldUnitId: null }) } : null,
  }));
  const storedCost = v.costs[0];
  const legacyOverheadCost = v.overheadMode ? (breakdown?.overheadCost ?? num(v.overheadTotal)) : num(v.overheadCost);
  return {
    id: v.id, versionNo: v.versionNo, isActive: v.isActive,
    standardYieldQty: num(v.standardYieldQty), yieldMode: effectiveYieldMode(v.yieldMode as 'ACTUAL' | 'BATCH' | null, v.yieldUnitId, num(v.standardYieldQty)), yieldUnitId: v.yieldUnitId, yieldUnit: v.yieldUnit ? { id: v.yieldUnit.id, code: v.yieldUnit.code, name: v.yieldUnit.name } : null,
    yieldPercent: num(v.yieldPercent), standardWaste: num(v.standardWaste), portionQty: v.portionQty != null ? num(v.portionQty) : null, portionUnit: v.portionUnit,
    overhead: draft.overhead, note: v.note, createdAt: v.createdAt.toISOString(),
    components,
    // Legacy Recipe Builder contract. Keep item-backed rows in their original
    // locations; sub-recipes remain available only through `components`.
    ingredients: components.filter((g) => g.itemId && g.item).map((g) => ({
      id: g.id, itemId: g.itemId!, item: g.item, quantityBase: g.quantityInBaseUnit ?? g.quantity, unitId: g.unitId,
      unit: g.unit, wastePercent: g.wastePercent,
      lineCost: (g.quantityInBaseUnit ?? g.quantity) * (1 + g.wastePercent / 100) * g.item!.lastCost,
    })),
    laborCost: num(v.laborCost), electricCost: num(v.electricCost), electricityCost: num(v.electricCost),
    waterCost: num(v.waterCost), gasCost: num(v.gasCost), overheadCost: legacyOverheadCost, otherCost: num(v.otherCost),
    cost: breakdown ? {
      ...breakdown,
      materialCost: storedCost ? num(storedCost.materialCost) : breakdown.ingredientCost,
      laborCost: storedCost ? num(storedCost.laborCost) : num(v.laborCost),
      utilityCost: storedCost ? num(storedCost.utilityCost) : num(v.electricCost) + num(v.waterCost) + num(v.gasCost),
      overheadCost: storedCost ? num(storedCost.overheadCost) : breakdown.overheadCost,
      wasteCost: storedCost ? num(storedCost.wasteCost) : 0,
      otherCost: num(v.otherCost), unitCost: storedCost ? num(storedCost.unitCost) : breakdown.costPerYieldUnit,
    } : null,
    costError,
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
    return ok(rows.filter((r) => r.versions[0]).map((r) => { const v = r.versions[0]; const c = v.costs[0]; return { id: r.id, code: r.code, name: r.name, yieldQty: num(v.standardYieldQty), yieldMode: effectiveYieldMode(v.yieldMode as 'ACTUAL' | 'BATCH' | null, v.yieldUnitId, num(v.standardYieldQty)), yieldUnit: v.yieldUnit?.code ?? null, yieldUnitId: v.yieldUnitId, totalCost: c ? num(c.totalCost) : 0, unitCost: c ? num(c.unitCost) : 0 }; }));
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
        standardYieldQty: src.standardYieldQty, yieldMode: src.yieldMode, yieldPercent: src.yieldPercent, standardWaste: src.standardWaste, yieldUnitId: src.yieldUnitId, portionQty: src.portionQty, portionUnit: src.portionUnit,
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
