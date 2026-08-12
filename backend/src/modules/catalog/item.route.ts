import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ItemType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok, paginate } from '../../lib/response.js';
import { requireCompany } from '../auth/auth.guard.js';
import { requireRoles, writeAudit, num } from '../../lib/http.js';

const MANAGE = requireRoles('ADMIN', 'PURCHASING', 'PRODUCTION');

const itemInclude = {
  baseUnit: { select: { id: true, code: true, name: true } },
  purchaseUnit: { select: { id: true, code: true, name: true } },
  category: { select: { id: true, code: true, name: true } },
} satisfies Prisma.ItemInclude;

type ItemWithRelations = Prisma.ItemGetPayload<{ include: typeof itemInclude }>;

function serializeItem(item: ItemWithRelations) {
  return {
    id: item.id,
    code: item.code,
    barcode: item.barcode,
    name: item.name,
    type: item.type,
    categoryId: item.categoryId,
    category: item.category,
    baseUnitId: item.baseUnitId,
    baseUnit: item.baseUnit,
    purchaseUnitId: item.purchaseUnitId,
    purchaseUnit: item.purchaseUnit,
    purchaseToBaseFactor: num(item.purchaseToBaseFactor),
    avgCost: num(item.avgCost),
    lastCost: num(item.lastCost),
    reorderPoint: num(item.reorderPoint),
    minQty: num(item.minQty),
    isLotTracked: item.isLotTracked,
    isExpiryTracked: item.isExpiryTracked,
    imageUrl: item.imageUrl,
    isActive: item.isActive,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().trim().optional(),
  categoryId: z.string().optional(),
  type: z.nativeEnum(ItemType).optional(),
  baseUnitId: z.string().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  hasImage: z.enum(['yes', 'no']).optional(),
});

const upsertSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  type: z.nativeEnum(ItemType).default(ItemType.RAW_MATERIAL),
  barcode: z.string().trim().max(60).optional().nullable(),
  categoryId: z.string().optional().nullable(),
  baseUnitId: z.string().min(1, 'ต้องระบุหน่วยฐาน'),
  purchaseUnitId: z.string().optional().nullable(),
  purchaseToBaseFactor: z.number().positive().default(1),
  reorderPoint: z.number().min(0).default(0),
  minQty: z.number().min(0).default(0),
  imageUrl: z.string().max(300).optional().nullable(),
  isLotTracked: z.boolean().default(false),
  isExpiryTracked: z.boolean().default(false),
  note: z.string().max(500).optional(),
  // ราคาซื้อเริ่มต้น (optional) — ถ้าใส่ ระบบจะบันทึกประวัติราคา
  purchasePrice: z.number().positive().optional(),
  purchaseQuantity: z.number().positive().optional(),
});

const priceSchema = z.object({
  purchasePrice: z.number().positive('ราคาซื้อต้องมากกว่า 0'),
  purchaseQuantity: z.number().positive().default(1),
  supplierId: z.string().optional().nullable(),
  note: z.string().max(300).optional(),
  effectiveDate: z.string().datetime().optional(),
});

/** คำนวณต้นทุนต่อหน่วยฐานจากราคาซื้อ */
function baseUnitCost(purchasePrice: number, purchaseQuantity: number, purchaseToBaseFactor: number) {
  const perPurchaseUnit = purchasePrice / purchaseQuantity;
  const factor = purchaseToBaseFactor > 0 ? purchaseToBaseFactor : 1;
  return perPurchaseUnit / factor;
}

export default async function itemRoutes(app: FastifyInstance) {
  // สรุปตัวเลขหัวหน้า (summary cards)
  app.get('/summary', { preHandler: requireCompany }, async (req) => {
    const [total, active, noPrice, latest] = await Promise.all([
      prisma.item.count({ where: { deletedAt: null, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, isActive: true, companyId: req.user.companyId! } }),
      prisma.item.count({ where: { deletedAt: null, lastCost: 0, companyId: req.user.companyId! } }),
      prisma.itemPriceHistory.findFirst({ where: { companyId: req.user.companyId! }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    return ok({ total, active, noPrice, latestPriceUpdate: latest?.createdAt.toISOString() ?? null });
  });

  // รายการวัตถุดิบ (filter + pagination)
  app.get('/', { preHandler: requireCompany }, async (req) => {
    const q = listQuery.parse(req.query ?? {});
    const where: Prisma.ItemWhereInput = { deletedAt: null, companyId: req.user.companyId! };
    if (q.search) where.OR = [
      { code: { contains: q.search } },
      { name: { contains: q.search } },
      { barcode: { contains: q.search } },
    ];
    if (q.categoryId) where.categoryId = q.categoryId;
    if (q.type) where.type = q.type;
    if (q.baseUnitId) where.baseUnitId = q.baseUnitId;
    if (q.status) where.isActive = q.status === 'active';
    if (q.hasImage === 'yes') where.imageUrl = { not: null };
    if (q.hasImage === 'no') where.imageUrl = null;

    const [rows, total] = await Promise.all([
      prisma.item.findMany({ where, include: itemInclude, orderBy: { updatedAt: 'desc' }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      prisma.item.count({ where }),
    ]);
    return ok(paginate(rows.map(serializeItem), total, q.page, q.pageSize));
  });

  // รายละเอียด + ประวัติราคา
  app.get('/:id', { preHandler: requireCompany }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! }, include: itemInclude });
    if (!item) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const history = await prisma.itemPriceHistory.findMany({ where: { itemId: id, companyId: req.user.companyId! }, orderBy: { createdAt: 'desc' }, take: 100 });
    const prices = history.map(parsePriceRow);
    const values = prices.map((p) => p.baseUnitCost).filter((v) => v > 0);
    return ok({
      ...serializeItem(item),
      priceHistory: prices,
      priceStats: {
        last: values[0] ?? null,
        min: values.length ? Math.min(...values) : null,
        max: values.length ? Math.max(...values) : null,
        count: prices.length,
      },
    });
  });

  app.post('/', { preHandler: MANAGE }, async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    const dup = await prisma.item.findUnique({ where: { code: body.code } });
    if (dup) return reply.status(409).send(fail('CONFLICT', `มีรหัส ${body.code} อยู่แล้ว`));

    let lastCost = 0;
    if (body.purchasePrice) lastCost = baseUnitCost(body.purchasePrice, body.purchaseQuantity ?? 1, body.purchaseToBaseFactor);

    const created = await prisma.$transaction(async (tx) => {
      const item = await tx.item.create({
        data: {
          companyId: req.user.companyId!,
          code: body.code, name: body.name, type: body.type, barcode: body.barcode ?? null,
          categoryId: body.categoryId ?? null, baseUnitId: body.baseUnitId,
          purchaseUnitId: body.purchaseUnitId ?? null,
          purchaseToBaseFactor: new Prisma.Decimal(body.purchaseToBaseFactor),
          reorderPoint: new Prisma.Decimal(body.reorderPoint), minQty: new Prisma.Decimal(body.minQty),
          imageUrl: body.imageUrl ?? null, isLotTracked: body.isLotTracked, isExpiryTracked: body.isExpiryTracked,
          avgCost: new Prisma.Decimal(lastCost), lastCost: new Prisma.Decimal(lastCost),
          createdById: req.user.sub, updatedById: req.user.sub,
        },
        include: itemInclude,
      });
      if (body.purchasePrice) {
        await tx.itemPriceHistory.create({
          data: {
            companyId: req.user.companyId!,
            itemId: item.id, price: new Prisma.Decimal(lastCost), source: 'PURCHASE', createdById: req.user.sub,
            note: JSON.stringify({ purchasePrice: body.purchasePrice, purchaseQuantity: body.purchaseQuantity ?? 1, pricePerPurchaseUnit: body.purchasePrice / (body.purchaseQuantity ?? 1) }),
          },
        });
      }
      return item;
    });
    await writeAudit(req, { action: 'CREATE', entity: 'Item', entityId: created.id, after: { code: created.code, name: created.name } });
    return reply.status(201).send(ok(serializeItem(created), 'เพิ่มวัตถุดิบสำเร็จ'));
  });

  app.patch('/:id', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = upsertSchema.partial().parse(req.body);
    const existing = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    if (body.code && body.code !== existing.code) {
      const dup = await prisma.item.findUnique({ where: { code: body.code } });
      if (dup) return reply.status(409).send(fail('CONFLICT', `มีรหัส ${body.code} อยู่แล้ว`));
    }
    const data: Prisma.ItemUpdateInput = { updatedById: req.user.sub };
    if (body.code !== undefined) data.code = body.code;
    if (body.name !== undefined) data.name = body.name;
    if (body.type !== undefined) data.type = body.type;
    if (body.barcode !== undefined) data.barcode = body.barcode;
    if (body.categoryId !== undefined) data.category = body.categoryId ? { connect: { id: body.categoryId } } : { disconnect: true };
    if (body.baseUnitId !== undefined) data.baseUnit = { connect: { id: body.baseUnitId } };
    if (body.purchaseUnitId !== undefined) data.purchaseUnit = body.purchaseUnitId ? { connect: { id: body.purchaseUnitId } } : { disconnect: true };
    if (body.purchaseToBaseFactor !== undefined) data.purchaseToBaseFactor = new Prisma.Decimal(body.purchaseToBaseFactor);
    if (body.reorderPoint !== undefined) data.reorderPoint = new Prisma.Decimal(body.reorderPoint);
    if (body.minQty !== undefined) data.minQty = new Prisma.Decimal(body.minQty);
    if (body.imageUrl !== undefined) data.imageUrl = body.imageUrl;
    if (body.isLotTracked !== undefined) data.isLotTracked = body.isLotTracked;
    if (body.isExpiryTracked !== undefined) data.isExpiryTracked = body.isExpiryTracked;

    const updated = await prisma.item.update({ where: { id }, data, include: itemInclude });
    await writeAudit(req, { action: 'UPDATE', entity: 'Item', entityId: id, before: { code: existing.code, name: existing.name }, after: { code: updated.code, name: updated.name } });
    return ok(serializeItem(updated), 'บันทึกการแก้ไขสำเร็จ');
  });

  // ปิดการใช้งาน (soft) — ไม่ hard delete วัตถุดิบที่อาจถูกใช้ในสูตร
  app.post('/:id/deactivate', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const updated = await prisma.item.update({ where: { id }, data: { isActive: false, updatedById: req.user.sub }, include: itemInclude });
    await writeAudit(req, { action: 'DEACTIVATE', entity: 'Item', entityId: id });
    return ok(serializeItem(updated), 'ปิดการใช้งานวัตถุดิบแล้ว');
  });

  app.post('/:id/activate', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const updated = await prisma.item.update({ where: { id }, data: { isActive: true, updatedById: req.user.sub }, include: itemInclude });
    await writeAudit(req, { action: 'ACTIVATE', entity: 'Item', entityId: id });
    return ok(serializeItem(updated), 'เปิดการใช้งานวัตถุดิบแล้ว');
  });

  // ประวัติราคา
  app.get('/:id/prices', { preHandler: requireCompany }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! }, select: { id: true } });
    if (!item) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const history = await prisma.itemPriceHistory.findMany({ where: { itemId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
    return ok(history.map(parsePriceRow));
  });

  app.post('/:id/prices', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = priceSchema.parse(req.body);
    const item = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!item) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const cost = baseUnitCost(body.purchasePrice, body.purchaseQuantity, num(item.purchaseToBaseFactor));

    await prisma.$transaction([
      prisma.itemPriceHistory.create({
        data: {
          companyId: req.user.companyId!,
          itemId: id, price: new Prisma.Decimal(cost), source: 'PURCHASE', createdById: req.user.sub,
          createdAt: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
          note: JSON.stringify({
            purchasePrice: body.purchasePrice, purchaseQuantity: body.purchaseQuantity,
            pricePerPurchaseUnit: body.purchasePrice / body.purchaseQuantity,
            supplierId: body.supplierId ?? null, note: body.note ?? null,
          }),
        },
      }),
      prisma.item.update({ where: { id }, data: { lastCost: new Prisma.Decimal(cost), avgCost: new Prisma.Decimal(cost), updatedById: req.user.sub } }),
    ]);
    await writeAudit(req, { action: 'PRICE_UPDATE', entity: 'Item', entityId: id, after: { baseUnitCost: cost, purchasePrice: body.purchasePrice } });
    return reply.status(201).send(ok({ baseUnitCost: cost }, 'บันทึกราคาซื้อสำเร็จ'));
  });
}

type PriceRow = { id: string; price: Prisma.Decimal; source: string | null; note: string | null; createdAt: Date };
function parsePriceRow(row: PriceRow) {
  let extra: Record<string, unknown> = {};
  if (row.note) { try { extra = JSON.parse(row.note) as Record<string, unknown>; } catch { extra = { note: row.note }; } }
  return {
    id: row.id,
    baseUnitCost: num(row.price),
    source: row.source,
    purchasePrice: typeof extra.purchasePrice === 'number' ? extra.purchasePrice : null,
    purchaseQuantity: typeof extra.purchaseQuantity === 'number' ? extra.purchaseQuantity : null,
    pricePerPurchaseUnit: typeof extra.pricePerPurchaseUnit === 'number' ? extra.pricePerPurchaseUnit : null,
    supplierId: typeof extra.supplierId === 'string' ? extra.supplierId : null,
    note: typeof extra.note === 'string' ? extra.note : null,
    createdAt: row.createdAt.toISOString(),
  };
}
