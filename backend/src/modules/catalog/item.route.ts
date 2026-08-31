import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ItemType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok, paginate } from '../../lib/response.js';
import { requireCompany, requirePermission } from '../auth/auth.guard.js';
import { writeAudit, num } from '../../lib/http.js';
import { checkStandardFactor, factorConflictMessage, type FactorConflict } from '../../lib/item-conversion.js';
import { costStatusOf, EXPLICIT_ZERO_SOURCE } from '../../lib/cost-status.js';

// สิทธิ์แบบ permission-code (source of truth ที่ backend) — ครอบคลุมทั้งวัตถุดิบและบรรจุภัณฑ์
const CREATE = requirePermission('INGREDIENT_CREATE', 'PACKAGING_CREATE');
const EDIT = requirePermission('INGREDIENT_EDIT', 'PACKAGING_EDIT');

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
  /* PHASE 20C — ตัวกรองคุณภาพข้อมูล
     หน้ารายการมีการ์ดบอกจำนวน "ยังไม่มีราคาซื้อ" อยู่แล้ว แต่ไม่มีทางกรองให้เหลือเฉพาะรายการนั้น
     ผู้ใช้จึงเห็นตัวเลขแต่หาไม่เจอว่าคือรายการไหน */
  dataIssue: z.enum(['noPrice', 'noFactor']).optional(),
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

/**
 * PHASE 21 — ราคา 0 ต้องเป็นการยืนยันอย่างตั้งใจเท่านั้น
 * ช่องว่างกับเลข 0 ต้องไม่มีความหมายเดียวกัน จึงบังคับให้ส่ง explicitZero มาด้วย
 */
const priceSchema = z.object({
  purchasePrice: z.number().min(0, 'ราคาซื้อต้องไม่ติดลบ'),
  purchaseQuantity: z.number().positive().default(1),
  supplierId: z.string().optional().nullable(),
  note: z.string().max(300).optional(),
  effectiveDate: z.string().datetime().optional(),
  /** ยืนยันว่ารายการนี้มีต้นทุน 0 บาทจริง (เช่น น้ำประปา ของแถม) */
  explicitZero: z.boolean().default(false),
  zeroReason: z.string().max(200).optional(),
}).refine((v) => v.purchasePrice > 0 || v.explicitZero, {
  message: 'ราคา 0 ต้องยืนยันว่าเป็นต้นทุนศูนย์จริง',
  path: ['purchasePrice'],
});

/**
 * PHASE 20/20B — ตรวจอัตราแปลงผ่านด่านกลางของระบบ (src/lib/item-conversion.ts)
 * ทุกเส้นทางที่เขียนอัตราต้องใช้ด่านเดียวกัน ห้ามมีตรรกะตรวจซ้ำคนละที่
 */
const readConversionEdges = async () =>
  (await prisma.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
    .map((e) => ({ fromUnitId: e.fromUnitId, toUnitId: e.toUnitId, factor: num(e.factor) }));

const factorConflictReply = (reply: import('fastify').FastifyReply, conflict: FactorConflict) =>
  reply.status(400).send(fail('CONVERSION_FACTOR_CONFLICT', factorConflictMessage(conflict)));

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

  // รายการวัตถุดิบ/บรรจุภัณฑ์ที่เลือกได้ในสูตร (ไม่แบ่งหน้า) — ผูก scope กับบริษัทปัจจุบันเสมอ
  // ใช้โดย Recipe Builder เพื่อให้วัตถุดิบ/บรรจุภัณฑ์ที่เพิ่งเพิ่มปรากฏทันทีโดยไม่ต้องรีเฟรชทั้งหน้า
  app.get('/selectable', { preHandler: requireCompany }, async (req) => {
    const q = z.object({ type: z.nativeEnum(ItemType).optional() }).parse(req.query ?? {});
    const rows = await prisma.item.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        companyId: req.user.companyId!,
        type: q.type ?? { in: [ItemType.RAW_MATERIAL, ItemType.PACKAGING] },
      },
      include: itemInclude,
      orderBy: { name: 'asc' },
    });
    return ok(rows.map(serializeItem));
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
    // ยังไม่มีราคาซื้อ = ต้นทุนต่อหน่วยฐานยังเป็น 0 (คิดต้นทุนสูตรไม่ได้จริง)
    if (q.dataIssue === 'noPrice') where.lastCost = { lte: 0 };
    /* ยังไม่ตั้งอัตราแปลง — ตรงกับ needsConversion ที่หน้าจอใช้นับการ์ด KPI
       (เงื่อนไข "หน่วยซื้อต่างจากหน่วยฐาน" เทียบสองคอลัมน์ตรง ๆ ใน Prisma ไม่ได้
        แต่ factor <= 0 ก็ถือว่าตั้งค่าไม่ครบอยู่แล้วไม่ว่าหน่วยจะเป็นอะไร) */
    if (q.dataIssue === 'noFactor') {
      where.purchaseUnitId = { not: null };
      where.purchaseToBaseFactor = { lte: 0 };
    }
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

  app.post('/', { preHandler: CREATE }, async (req, reply) => {
    const body = upsertSchema.parse(req.body);
    if (body.isExpiryTracked && !body.isLotTracked) return reply.status(400).send(fail('LOT_POLICY_INVALID', 'การติดตามวันหมดอายุต้องเปิดการติดตาม Lot ด้วย'));
    const dup = await prisma.item.findUnique({ where: { code: body.code } });
    if (dup) return reply.status(409).send(fail('CONFLICT', `มีรหัส ${body.code} อยู่แล้ว`));

    const conflict = await checkStandardFactor(body.baseUnitId, body.purchaseUnitId, body.purchaseToBaseFactor, readConversionEdges);
    if (conflict) return factorConflictReply(reply, conflict);

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

  app.patch('/:id', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = upsertSchema.partial().parse(req.body);
    const existing = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const nextLotTracked = body.isLotTracked ?? existing.isLotTracked;
    const nextExpiryTracked = body.isExpiryTracked ?? existing.isExpiryTracked;
    if (nextExpiryTracked && !nextLotTracked) return reply.status(400).send(fail('LOT_POLICY_INVALID', 'การติดตามวันหมดอายุต้องเปิดการติดตาม Lot ด้วย'));
    if (!existing.isLotTracked && nextLotTracked) {
      const legacy = await prisma.stockBalance.aggregate({ where: { itemId: id, lotId: null }, _sum: { onHand: true, reserved: true } });
      if (num(legacy._sum.onHand) !== 0 || num(legacy._sum.reserved) !== 0) return reply.status(409).send(fail('LEGACY_STOCK_REQUIRES_ALLOCATION', 'ต้องทำให้สต็อกเดิมที่ไม่มี Lot เป็นศูนย์หรือจัดสรรผ่านขั้นตอนเฉพาะก่อนเปิดการติดตาม Lot'));
    }
    if (body.code && body.code !== existing.code) {
      const dup = await prisma.item.findUnique({ where: { code: body.code } });
      if (dup) return reply.status(409).send(fail('CONFLICT', `มีรหัส ${body.code} อยู่แล้ว`));
    }
    /* หน่วยหรืออัตราเปลี่ยนเมื่อไร ต้องตรวจกับอัตรามาตรฐานใหม่เสมอ
       ใช้ค่าเดิมของรายการเป็นตัวตั้งสำหรับฟิลด์ที่ไม่ได้ส่งมา (PATCH ส่งมาเฉพาะที่แก้) */
    const nextBaseUnitId = body.baseUnitId ?? existing.baseUnitId;
    const nextPurchaseUnitId = body.purchaseUnitId !== undefined ? body.purchaseUnitId : existing.purchaseUnitId;
    const nextFactor = body.purchaseToBaseFactor ?? num(existing.purchaseToBaseFactor);
    if (body.baseUnitId !== undefined || body.purchaseUnitId !== undefined || body.purchaseToBaseFactor !== undefined) {
      const conflict = await checkStandardFactor(nextBaseUnitId, nextPurchaseUnitId, nextFactor, readConversionEdges);
      if (conflict) return factorConflictReply(reply, conflict);
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
  app.post('/:id/deactivate', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const updated = await prisma.item.update({ where: { id }, data: { isActive: false, updatedById: req.user.sub }, include: itemInclude });
    await writeAudit(req, { action: 'DEACTIVATE', entity: 'Item', entityId: id });
    return ok(serializeItem(updated), 'ปิดการใช้งานวัตถุดิบแล้ว');
  });

  app.post('/:id/activate', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const existing = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const updated = await prisma.item.update({ where: { id }, data: { isActive: true, updatedById: req.user.sub }, include: itemInclude });
    await writeAudit(req, { action: 'ACTIVATE', entity: 'Item', entityId: id });
    return ok(serializeItem(updated), 'เปิดการใช้งานวัตถุดิบแล้ว');
  });

  /* ============================================================
     PHASE 21 — เติมข้อมูลต้นทุนที่ยังขาด
     ระบบช่วยให้ผู้ใช้ "กรอกให้ครบ" ไม่ใช่ "สร้างตัวเลขขึ้นมาเอง"
     ============================================================ */

  /** รายการที่ยังไม่มีข้อมูลต้นทุน พร้อมผลกระทบต่อสูตรและเมนู เรียงตามความสำคัญ */
  app.get('/cost-completion', { preHandler: requireCompany }, async (req) => {
    const companyId = req.user.companyId!;
    const items = await prisma.item.findMany({
      where: { companyId, deletedAt: null, isActive: true, type: { in: [ItemType.RAW_MATERIAL, ItemType.PACKAGING] } },
      include: { ...itemInclude, _count: { select: { priceHistory: true } } },
      orderBy: { code: 'asc' },
    });

    const usage = await prisma.recipeIngredient.findMany({
      where: { itemId: { in: items.map((i) => i.id) }, recipeVersion: { isActive: true } },
      select: { itemId: true, recipeVersion: { select: { recipeId: true, recipe: { select: { product: { select: { id: true, name: true } } } } } } },
    });
    const recipesOf = new Map<string, Set<string>>();
    const menusOf = new Map<string, Map<string, string>>();
    for (const u of usage) {
      if (!u.itemId) continue;
      (recipesOf.get(u.itemId) ?? recipesOf.set(u.itemId, new Set()).get(u.itemId)!).add(u.recipeVersion!.recipeId);
      const product = u.recipeVersion?.recipe?.product;
      if (product) (menusOf.get(u.itemId) ?? menusOf.set(u.itemId, new Map()).get(u.itemId)!).set(product.id, product.name);
    }

    const rows = items.map((item) => {
      const status = costStatusOf({ lastCost: num(item.lastCost), priceRecordCount: item._count.priceHistory });
      const menus = [...(menusOf.get(item.id)?.values() ?? [])];
      return {
        ...serializeItem(item),
        costStatus: status,
        priceRecordCount: item._count.priceHistory,
        recipesAffected: recipesOf.get(item.id)?.size ?? 0,
        menusAffected: menus.length,
        menuNames: menus.slice(0, 4),
      };
    });

    /* เรียงตามผลกระทบจริง: สูตรที่กระทบ → เมนูที่กระทบ → รหัส
       ของอย่างน้ำเปล่าที่ใช้ใน 7 สูตร จึงขึ้นมาก่อนของที่ใช้สูตรเดียว */
    const incomplete = rows
      .filter((r) => r.costStatus === 'MISSING')
      .sort((a, b) => b.recipesAffected - a.recipesAffected || b.menusAffected - a.menusAffected || a.code.localeCompare(b.code));

    return ok({
      rows: incomplete,
      summary: {
        total: rows.length,
        priced: rows.filter((r) => r.costStatus === 'PRICED').length,
        explicitZero: rows.filter((r) => r.costStatus === 'ZERO').length,
        missing: incomplete.length,
      },
    });
  });

  /**
   * บันทึกราคาหลายรายการในครั้งเดียว — รับเฉพาะแถวที่ผู้ใช้ส่งมาจริงเท่านั้น
   *
   * เลือกแบบ "ทั้งหมดหรือไม่เลย" เพราะผู้ใช้เห็นสรุปและกดยืนยันเป็นชุดเดียว
   * ถ้าปล่อยให้สำเร็จบางแถวเงียบ ๆ ผู้ใช้จะไม่รู้ว่าอะไรเข้าไม่เข้า
   * แถวที่ไม่ผ่านจะถูกรายงานกลับพร้อมเหตุผลรายแถว โดยไม่มีอะไรถูกเขียนเลย
   */
  app.post('/cost-completion', { preHandler: EDIT }, async (req, reply) => {
    const body = z.object({
      rows: z.array(z.object({
        itemId: z.string().min(1),
        purchasePrice: z.number().min(0),
        purchaseQuantity: z.number().positive().default(1),
        explicitZero: z.boolean().default(false),
        zeroReason: z.string().max(200).optional(),
        note: z.string().max(300).optional(),
      })).min(1).max(100),
    }).parse(req.body);

    const companyId = req.user.companyId!;
    const ids = body.rows.map((r) => r.itemId);
    if (new Set(ids).size !== ids.length) {
      return reply.status(400).send(fail('DUPLICATE_ROW', 'มีวัตถุดิบซ้ำกันในคำขอเดียว'));
    }

    const items = await prisma.item.findMany({ where: { id: { in: ids }, companyId, deletedAt: null } });
    const itemOf = new Map(items.map((i) => [i.id, i]));

    // ตรวจทุกแถวให้ครบก่อน แล้วค่อยเขียน — ไม่มีการเขียนบางส่วนแล้วค่อยพบว่าผิด
    const errors: { itemId: string; code: string; message: string }[] = [];
    const prepared: { itemId: string; cost: number; row: (typeof body.rows)[number] }[] = [];
    for (const row of body.rows) {
      const item = itemOf.get(row.itemId);
      if (!item) { errors.push({ itemId: row.itemId, code: 'NOT_FOUND', message: 'ไม่พบวัตถุดิบในบริษัทนี้' }); continue; }
      if (row.purchasePrice === 0 && !row.explicitZero) {
        errors.push({ itemId: row.itemId, code: 'ZERO_NOT_CONFIRMED', message: 'ราคา 0 ต้องยืนยันว่าเป็นต้นทุนศูนย์จริง' });
        continue;
      }
      // ใช้สูตรเดียวกับทุกที่ในระบบ ไม่สร้างสูตรที่สอง
      prepared.push({ itemId: row.itemId, cost: baseUnitCost(row.purchasePrice, row.purchaseQuantity, num(item.purchaseToBaseFactor)), row });
    }
    if (errors.length) return reply.status(400).send(fail('ROW_VALIDATION_FAILED', 'มีรายการที่บันทึกไม่ได้', errors));

    await prisma.$transaction(async (tx) => {
      for (const { itemId, cost, row } of prepared) {
        await tx.itemPriceHistory.create({
          data: {
            companyId, itemId, price: new Prisma.Decimal(cost),
            source: row.purchasePrice === 0 ? EXPLICIT_ZERO_SOURCE : 'PURCHASE',
            createdById: req.user.sub,
            note: JSON.stringify({
              purchasePrice: row.purchasePrice, purchaseQuantity: row.purchaseQuantity,
              pricePerPurchaseUnit: row.purchasePrice / row.purchaseQuantity,
              supplierId: null, note: row.note ?? null,
              ...(row.purchasePrice === 0 ? { zeroReason: row.zeroReason ?? null } : {}),
              source: 'COST_COMPLETION',
            }),
          },
        });
        await tx.item.update({ where: { id: itemId }, data: { lastCost: new Prisma.Decimal(cost), avgCost: new Prisma.Decimal(cost), updatedById: req.user.sub } });
      }
    });

    await writeAudit(req, { action: 'COST_COMPLETION', entity: 'Item', entityId: prepared[0].itemId, after: { updated: prepared.length, itemIds: prepared.map((p) => p.itemId) } });
    return ok({ updated: prepared.map((p) => ({ itemId: p.itemId, baseUnitCost: p.cost })) }, `บันทึกต้นทุน ${prepared.length} รายการแล้ว`);
  });

  // ประวัติราคา
  app.get('/:id/prices', { preHandler: requireCompany }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const item = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! }, select: { id: true } });
    if (!item) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const history = await prisma.itemPriceHistory.findMany({ where: { itemId: id }, orderBy: { createdAt: 'desc' }, take: 200 });
    return ok(history.map(parsePriceRow));
  });

  app.post('/:id/prices', { preHandler: EDIT }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = priceSchema.parse(req.body);
    const item = await prisma.item.findFirst({ where: { id, deletedAt: null, companyId: req.user.companyId! } });
    if (!item) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบวัตถุดิบ'));
    const cost = baseUnitCost(body.purchasePrice, body.purchaseQuantity, num(item.purchaseToBaseFactor));

    await prisma.$transaction([
      prisma.itemPriceHistory.create({
        data: {
          companyId: req.user.companyId!,
          itemId: id, price: new Prisma.Decimal(cost),
          /* PHASE 21 — แถวประวัติราคาคือหลักฐานว่ามีคนตัดสินใจแล้ว
             source บอกว่าเป็นราคาซื้อจริง หรือเป็นการยืนยันว่าต้นทุนเป็นศูนย์ */
          source: body.purchasePrice === 0 ? EXPLICIT_ZERO_SOURCE : 'PURCHASE',
          createdById: req.user.sub,
          createdAt: body.effectiveDate ? new Date(body.effectiveDate) : undefined,
          note: JSON.stringify({
            purchasePrice: body.purchasePrice, purchaseQuantity: body.purchaseQuantity,
            pricePerPurchaseUnit: body.purchasePrice / body.purchaseQuantity,
            supplierId: body.supplierId ?? null, note: body.note ?? null,
            ...(body.purchasePrice === 0 ? { zeroReason: body.zeroReason ?? null } : {}),
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
