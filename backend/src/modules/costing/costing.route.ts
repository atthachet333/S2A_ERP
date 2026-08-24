import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, ItemType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requireCompany, requirePermission } from '../auth/auth.guard.js';
import { writeAudit, num } from '../../lib/http.js';
import { computeRecipeCost, analyzePrice, priceFromMarkup, priceFromMargin, type CostIngredientInput } from '../../lib/costing.js';
import { RecipeCostError } from '../../lib/recipe-cost.js';
import { computeSavedVersionCost } from '../recipes/recipe.route.js';
import { completenessOf, costStatusOf } from '../../lib/cost-status.js';

// บันทึกราคาขาย = จัดการราคา/กำไร → ใช้สิทธิ์ PRICING_EDIT
const MANAGE = requirePermission('PRICING_EDIT');

const inlineIngredient = z.object({ itemId: z.string().min(1), quantityBase: z.number().nonnegative(), wastePercent: z.number().min(0).max(100).default(0) });

const calcSchema = z.object({
  recipeVersionId: z.string().optional(),
  ingredients: z.array(inlineIngredient).optional(),
  yieldQty: z.number().positive().optional(),
  yieldPercent: z.number().positive().max(100).default(100),
  laborCost: z.number().min(0).default(0),
  electricCost: z.number().min(0).default(0),
  waterCost: z.number().min(0).default(0),
  gasCost: z.number().min(0).default(0),
  overheadCost: z.number().min(0).default(0),
  otherCost: z.number().min(0).default(0),
  // pricing (optional): ระบุอย่างใดอย่างหนึ่ง
  sellingPrice: z.number().min(0).optional(),
  markupPercent: z.number().optional(),
  marginPercent: z.number().max(99.99).optional(),
});

const savePriceSchema = z.object({
  itemId: z.string().min(1),
  priceType: z.enum(['RETAIL', 'WHOLESALE', 'AGENT', 'SPECIAL']).default('RETAIL'),
  price: z.number().positive(),
  markupPercent: z.number().optional(),
  marginPercent: z.number().optional(),
});

export default async function costingRoutes(app: FastifyInstance) {
  /**
   * PHASE 21 — ความครบถ้วนของข้อมูลต้นทุนในแต่ละสูตรที่ใช้งานอยู่
   *
   * ตอบคำถามเดียว: "ต้นทุนที่เห็นอยู่นี้ คิดจากวัตถุดิบครบทุกตัวหรือยัง"
   * ไม่ประมาณราคาที่ยังไม่รู้ให้ และไม่แตะ snapshot ใด ๆ — อ่านอย่างเดียวล้วน
   *
   * "ยืนยันว่าต้นทุนศูนย์" นับเป็นข้อมูลครบ ไม่ใช่ข้อมูลขาด
   */
  app.get('/completeness', { preHandler: requireCompany }, async (req) => {
    const companyId = req.user.companyId!;
    const versions = await prisma.recipeVersion.findMany({
      where: { isActive: true, recipe: { companyId, deletedAt: null } },
      include: {
        recipe: { select: { id: true, product: { select: { id: true, code: true, name: true } } } },
        ingredients: { include: { item: { select: { id: true, code: true, name: true, lastCost: true, _count: { select: { priceHistory: true } } } } } },
      },
    });

    const rows = versions.map((version) => {
      const lines = version.ingredients.map((line) => ({
        item: line.item,
        // บรรทัดที่อ้างสูตรย่อยไม่มี item จึงไม่นับในความครบถ้วนของราคาวัตถุดิบ
        countsTowardCost: Boolean(line.item),
        status: line.item
          ? costStatusOf({ lastCost: num(line.item.lastCost), priceRecordCount: line.item._count.priceHistory })
          : ('PRICED' as const),
      }));
      const completeness = completenessOf(lines.map((l) => ({ status: l.status, countsTowardCost: l.countsTowardCost })));
      return {
        recipeId: version.recipe.id,
        recipeVersionId: version.id,
        versionNo: version.versionNo,
        productId: version.recipe.product?.id ?? null,
        productCode: version.recipe.product?.code ?? null,
        productName: version.recipe.product?.name ?? null,
        ...completeness,
        // ชื่อของที่ยังไม่รู้ต้นทุน เพื่อให้ผู้ใช้กดไปแก้ได้ตรงจุด ไม่ต้องเดาเอง
        missingItems: lines.filter((l) => l.status === 'MISSING' && l.item)
          .map((l) => ({ id: l.item!.id, code: l.item!.code, name: l.item!.name })),
      };
    });

    return ok({
      rows: rows.sort((a, b) => b.missing - a.missing || (a.productName ?? '').localeCompare(b.productName ?? '')),
      summary: {
        recipes: rows.length,
        complete: rows.filter((r) => r.complete).length,
        incomplete: rows.filter((r) => !r.complete).length,
      },
    });
  });

  /** คำนวณต้นทุน + จำลองราคาขาย (backend เป็น source of truth) */
  app.post('/calculate', { preHandler: requireCompany }, async (req, reply) => {
    const body = calcSchema.parse(req.body ?? {});

    let ingredients: CostIngredientInput[] = [];
    let yieldQty = body.yieldQty ?? 0;
    let yieldPercent = body.yieldPercent;
    let expenses = { laborCost: body.laborCost, electricCost: body.electricCost, waterCost: body.waterCost, gasCost: body.gasCost, overheadCost: body.overheadCost, otherCost: body.otherCost };

    if (body.recipeVersionId) {
      // ใช้ engine เดียวกับ Recipe Builder เพื่อให้ตัวเลขตรงกันทุกหน้า
      // (แปลงหน่วยตามอัตราจริง + รวมสูตรย่อย + overhead โหมดใหม่) และอ่านราคาวัตถุดิบล่าสุดทุกครั้ง
      let saved;
      try { saved = await computeSavedVersionCost(req.user.companyId!, body.recipeVersionId); }
      catch (e) {
        if (e instanceof RecipeCostError) return reply.status(e.code === 'CIRCULAR_SUBRECIPE' ? 409 : 400).send(fail(e.code, e.message));
        throw e;
      }
      if (!saved) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตรเวอร์ชันนี้'));
      const c = saved.cost;
      const breakdownV2 = {
        materialCost: c.ingredientCost, packagingCost: c.packagingCost, laborCost: 0,
        utilityCost: c.subRecipeCost, overheadCost: c.overheadCost, wasteCost: 0, otherCost: 0,
        totalCost: c.totalCost, effectiveYield: c.effectiveYield, unitCost: c.costPerYieldUnit,
        ingredientCost: c.ingredientCost, subRecipeCost: c.subRecipeCost,
        costPerYieldUnit: c.costPerYieldUnit, portionCount: c.portionCount, costPerPortion: c.costPerPortion,
      };
      const unitBasis = c.costPerPortion ?? c.costPerYieldUnit;
      const pricingV2 = body.sellingPrice !== undefined ? { sellingPrice: body.sellingPrice, ...analyzePrice(unitBasis, body.sellingPrice) }
        : body.markupPercent !== undefined ? (() => { const sp = priceFromMarkup(unitBasis, body.markupPercent!); return { sellingPrice: sp, ...analyzePrice(unitBasis, sp) }; })()
        : body.marginPercent !== undefined ? (() => { const sp = priceFromMargin(unitBasis, body.marginPercent!); return { sellingPrice: sp, ...analyzePrice(unitBasis, sp) }; })()
        : null;
      return ok({ breakdown: breakdownV2, pricing: pricingV2, versionNo: saved.versionNo, calculatedAt: new Date().toISOString() });
    } else if (body.ingredients && body.ingredients.length > 0) {
      const items = await prisma.item.findMany({ where: { id: { in: [...new Set(body.ingredients.map((i) => i.itemId))] }, companyId: req.user.companyId! }, select: { id: true, type: true, lastCost: true } });
      const map = new Map(items.map((i) => [i.id, i]));
      ingredients = body.ingredients.map((ing) => {
        const item = map.get(ing.itemId);
        return { itemType: item?.type ?? ItemType.RAW_MATERIAL, quantityBase: ing.quantityBase, unitCostPerBase: item ? num(item.lastCost) : 0, wastePercent: ing.wastePercent };
      });
    }

    const breakdown = computeRecipeCost({ ingredients, yieldQty, yieldPercent, ...expenses });

    // pricing simulator
    let pricing = null as null | { sellingPrice: number; profit: number; marginPercent: number; markupPercent: number; isLoss: boolean };
    const cost = breakdown.unitCost;
    if (body.sellingPrice !== undefined) {
      pricing = { sellingPrice: body.sellingPrice, ...analyzePrice(cost, body.sellingPrice) };
    } else if (body.markupPercent !== undefined) {
      const sp = priceFromMarkup(cost, body.markupPercent);
      pricing = { sellingPrice: sp, ...analyzePrice(cost, sp) };
    } else if (body.marginPercent !== undefined) {
      const sp = priceFromMargin(cost, body.marginPercent);
      pricing = { sellingPrice: sp, ...analyzePrice(cost, sp) };
    }

    return ok({ breakdown, pricing });
  });

  /** บันทึกราคาขายของเมนู (SellingPrice) */
  /** ราคาขายทุกระดับของเมนูหนึ่งรายการ (ปลีก/ส่ง/คนรู้จัก) — อ่านอย่างเดียว */
  app.get('/prices/:itemId', { preHandler: requireCompany }, async (req) => {
    const { itemId } = req.params as { itemId: string };
    const rows = await prisma.sellingPrice.findMany({
      where: { itemId, companyId: req.user.companyId!, isActive: true },
      select: { id: true, priceType: true, price: true, marginPercent: true, markupPercent: true, updatedAt: true },
    });
    return ok(rows.map((r) => ({
      id: r.id, priceType: r.priceType, price: num(r.price),
      marginPercent: r.marginPercent != null ? num(r.marginPercent) : null,
      markupPercent: r.markupPercent != null ? num(r.markupPercent) : null,
      updatedAt: r.updatedAt.toISOString(),
    })));
  });

  app.post('/price', { preHandler: MANAGE }, async (req, reply) => {
    const body = savePriceSchema.parse(req.body);
    const item = await prisma.item.findFirst({ where: { id: body.itemId, deletedAt: null, companyId: req.user.companyId! } });
    if (!item) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบเมนู/สินค้า'));
    const saved = await prisma.sellingPrice.upsert({
      where: { itemId_priceType: { itemId: body.itemId, priceType: body.priceType } },
      update: { price: new Prisma.Decimal(body.price), markupPercent: body.markupPercent !== undefined ? new Prisma.Decimal(body.markupPercent) : null, marginPercent: body.marginPercent !== undefined ? new Prisma.Decimal(body.marginPercent) : null, isActive: true },
      create: { companyId: req.user.companyId!, itemId: body.itemId, priceType: body.priceType, price: new Prisma.Decimal(body.price), markupPercent: body.markupPercent !== undefined ? new Prisma.Decimal(body.markupPercent) : null, marginPercent: body.marginPercent !== undefined ? new Prisma.Decimal(body.marginPercent) : null, createdById: req.user.sub },
    });
    await writeAudit(req, { action: 'SET_PRICE', entity: 'SellingPrice', entityId: saved.id, after: { itemId: body.itemId, priceType: body.priceType, price: body.price } });
    return ok({ id: saved.id, price: num(saved.price) }, 'บันทึกราคาขายสำเร็จ');
  });
}
