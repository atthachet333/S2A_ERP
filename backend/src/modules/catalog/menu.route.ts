import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, ItemType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requireCompany, requirePermission } from '../auth/auth.guard.js';
import { writeAudit, num } from '../../lib/http.js';

// เมนู (FINISHED_GOOD) ผูกกับสูตร/ราคาขาย — ให้ผู้จัดการสูตรหรือราคาขายดูแลได้
const MANAGE = requirePermission('RECIPE_CREATE', 'RECIPE_EDIT', 'PRICING_EDIT');

/**
 * เมนูอาหาร = Item ประเภท FINISHED_GOOD (ตาม architecture เดิม — ไม่สร้าง model ซ้ำ)
 * ผูกกับสูตร (Recipe.productId = menuItem.id) และราคาขาย (SellingPrice)
 */
const createSchema = z.object({
  code: z.string().trim().max(40).optional(),
  name: z.string().trim().min(1).max(120),
  categoryId: z.string().optional().nullable(),
  sellingUnitId: z.string().min(1, 'ต้องระบุหน่วยขาย'),
  imageUrl: z.string().max(300).optional().nullable(),
  description: z.string().max(500).optional().nullable(),
});

const updateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  categoryId: z.string().optional().nullable(),
  sellingUnitId: z.string().optional(),
  imageUrl: z.string().max(300).optional().nullable(),
  isActive: z.boolean().optional(),
});

export default async function menuRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requireCompany }, async (req) => {
    const menus = await prisma.item.findMany({
      where: { deletedAt: null, type: ItemType.FINISHED_GOOD, companyId: req.user.companyId! },
      orderBy: { updatedAt: 'desc' },
      include: {
        category: { select: { id: true, name: true } },
        baseUnit: { select: { code: true, name: true } },
        recipes: { where: { deletedAt: null }, take: 1, include: { versions: { where: { isActive: true }, take: 1, include: { costs: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } } },
        sellingPrices: { where: { priceType: 'RETAIL', isActive: true }, take: 1 },
      },
    });
    return ok(menus.map((m) => {
      const recipe = m.recipes[0];
      const cost = recipe?.versions[0]?.costs[0];
      const totalCost = cost ? num(cost.totalCost) : null;
      const sell = m.sellingPrices[0];
      const price = sell ? num(sell.price) : null;
      const margin = price && totalCost !== null && price > 0 ? Math.round(((price - totalCost) / price) * 10000) / 100 : null;
      return {
        id: m.id, code: m.code, name: m.name, imageUrl: m.imageUrl,
        category: m.category, sellingUnit: m.baseUnit?.code ?? null, isActive: m.isActive,
        recipeId: recipe?.id ?? null, hasRecipe: Boolean(recipe),
        totalCost, sellingPrice: price, margin,
      };
    }));
  });

  app.get('/:id', { preHandler: requireCompany }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const m = await prisma.item.findFirst({
      where: { id, deletedAt: null, type: ItemType.FINISHED_GOOD, companyId: req.user.companyId! },
      include: {
        category: { select: { id: true, name: true } }, baseUnit: { select: { id: true, code: true, name: true } },
        recipes: { where: { deletedAt: null }, include: { versions: { where: { isActive: true }, take: 1, include: { costs: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } } },
        sellingPrices: { where: { priceType: 'RETAIL', isActive: true }, take: 1 },
      },
    });
    if (!m) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบเมนู'));
    const activeRecipe = m.recipes.find((r) => r.versions.length > 0) ?? m.recipes[0];
    const activeVersion = activeRecipe?.versions[0];
    const currentCost = activeVersion?.costs[0] ? num(activeVersion.costs[0].unitCost) : null;
    const sellingPrice = m.sellingPrices[0] ? num(m.sellingPrices[0].price) : null;
    const margin = sellingPrice && currentCost !== null ? Math.round(((sellingPrice - currentCost) / sellingPrice) * 10000) / 100 : null;
    return ok({
      id: m.id, code: m.code, name: m.name, imageUrl: m.imageUrl, categoryId: m.categoryId,
      category: m.category, sellingUnit: m.baseUnit, isActive: m.isActive,
      recipes: m.recipes.map((r) => ({ id: r.id, code: r.code })), activeRecipeId: activeRecipe?.id ?? null,
      activeVersionNo: activeVersion?.versionNo ?? null, currentCost, sellingPrice, margin,
      createdAt: m.createdAt.toISOString(), updatedAt: m.updatedAt.toISOString(),
    });
  });

  app.post('/', { preHandler: MANAGE }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    let code = body.code?.trim() || `MENU-${Date.now().toString().slice(-6)}`;
    if (await prisma.item.findUnique({ where: { code } })) return reply.status(409).send(fail('CONFLICT', `มีรหัส ${code} อยู่แล้ว`));
    const menu = await prisma.item.create({
      data: {
        companyId: req.user.companyId!,
        code, name: body.name, type: ItemType.FINISHED_GOOD, categoryId: body.categoryId ?? null,
        baseUnitId: body.sellingUnitId, imageUrl: body.imageUrl ?? null, isLotTracked: true, isExpiryTracked: true,
        createdById: req.user.sub, updatedById: req.user.sub,
      },
    });
    await writeAudit(req, { action: 'CREATE', entity: 'Menu', entityId: menu.id, after: { code, name: menu.name } });
    return reply.status(201).send(ok({ id: menu.id, code: menu.code, name: menu.name }, 'เพิ่มเมนูสำเร็จ'));
  });

  app.patch('/:id', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const existing = await prisma.item.findFirst({ where: { id, deletedAt: null, type: ItemType.FINISHED_GOOD } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบเมนู'));
    const data: Prisma.ItemUpdateInput = { updatedById: req.user.sub };
    if (body.name !== undefined) data.name = body.name;
    if (body.categoryId !== undefined) data.category = body.categoryId ? { connect: { id: body.categoryId } } : { disconnect: true };
    if (body.sellingUnitId !== undefined) data.baseUnit = { connect: { id: body.sellingUnitId } };
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    const updated = await prisma.item.update({ where: { id }, data });
    await writeAudit(req, { action: 'UPDATE', entity: 'Menu', entityId: id, after: { name: updated.name } });
    return ok({ id: updated.id, code: updated.code, name: updated.name, isActive: updated.isActive }, 'บันทึกเมนูสำเร็จ');
  });
}
