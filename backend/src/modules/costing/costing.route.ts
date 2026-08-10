import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, ItemType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requireCompany } from '../auth/auth.guard.js';
import { requireRoles, writeAudit, num } from '../../lib/http.js';
import { computeRecipeCost, analyzePrice, priceFromMarkup, priceFromMargin, type CostIngredientInput } from '../../lib/costing.js';

const MANAGE = requireRoles('ADMIN', 'PRODUCTION', 'SALES');

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
  /** คำนวณต้นทุน + จำลองราคาขาย (backend เป็น source of truth) */
  app.post('/calculate', { preHandler: requireCompany }, async (req, reply) => {
    const body = calcSchema.parse(req.body ?? {});

    let ingredients: CostIngredientInput[] = [];
    let yieldQty = body.yieldQty ?? 0;
    let yieldPercent = body.yieldPercent;
    let expenses = { laborCost: body.laborCost, electricCost: body.electricCost, waterCost: body.waterCost, gasCost: body.gasCost, overheadCost: body.overheadCost, otherCost: body.otherCost };

    if (body.recipeVersionId) {
      const version = await prisma.recipeVersion.findUnique({
        where: { id: body.recipeVersionId, recipe: { companyId: req.user.companyId! } },
        include: { ingredients: { include: { item: { select: { type: true, lastCost: true } } } } },
      });
      if (!version) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบสูตรเวอร์ชันนี้'));
      ingredients = version.ingredients.map((ing) => ({
        itemType: ing.item?.type ?? ItemType.RAW_MATERIAL,
        quantityBase: num(ing.quantity),
        unitCostPerBase: ing.item ? num(ing.item.lastCost) : 0,
        wastePercent: num(ing.wastePercent),
      }));
      yieldQty = num(version.standardYieldQty);
      yieldPercent = num(version.yieldPercent);
      expenses = { laborCost: num(version.laborCost), electricCost: num(version.electricCost), waterCost: num(version.waterCost), gasCost: num(version.gasCost), overheadCost: num(version.overheadCost), otherCost: num(version.otherCost) };
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
