import type { FastifyInstance, FastifyReply } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import {
  applyMovement, InsufficientStockError, lockBalancePairs, nextDocumentNo, reverseDocument,
} from '../../lib/inventory-ledger.js';
import { withDocumentNumberRetry, withStockLockRetry } from '../../lib/tx-retry.js';

/**
 * PHASE 18 — โอนย้ายสินค้าระหว่างคลัง
 *
 * ใบโอนย้ายหนึ่งใบ = การเคลื่อนไหวสองขาที่ต้องสำเร็จหรือล้มพร้อมกันเสมอ
 * ไม่ใช่ "ใบเบิก + ใบรับของ" สองใบที่แยกกัน — ถ้าขาออกล้ม ปลายทางต้องไม่ขยับแม้แต่หน่วยเดียว
 *
 * ต้นทุน: การโอนย้ายไม่ตีราคาสินค้าใหม่ ใช้ต้นทุนล่าสุดของสินค้าเป็นค่าอ้างอิงของทั้งสองขา
 * และไม่แตะ item.lastCost / item.avgCost — การรับซื้อยังเป็นแหล่งเดียวที่อัปเดตต้นทุน
 */

const num = (v: Prisma.Decimal | number | string | null | undefined) => Number(v ?? 0);

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive(),
  lotNo: z.string().max(60).optional().nullable(),
});

const createSchema = z.object({
  fromWarehouseId: z.string().min(1),
  toWarehouseId: z.string().min(1),
  transferDate: z.coerce.date().default(() => new Date()),
  note: z.string().max(500).optional().nullable(),
  confirm: z.boolean().default(false),
  items: z.array(lineSchema).min(1),
});

/* PATCH ของร่าง — ทุกฟิลด์เป็นตัวเลือก ส่งมาเฉพาะสิ่งที่ต้องการแก้
   ถ้าบังคับให้ส่งครบ คำขอที่ผิดสถานะจะถูกปฏิเสธด้วย 400 จาก schema ก่อนจะได้เหตุผลจริงว่าเอกสารไม่ใช่ร่าง */
const updateSchema = createSchema.omit({ confirm: true }).partial();

const filterSchema = z.object({
  status: z.enum(['DRAFT', 'CONFIRMED', 'REVERSED', 'CANCELLED']).optional(),
  fromWarehouseId: z.string().optional(),
  toWarehouseId: z.string().optional(),
  keyword: z.string().trim().max(100).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().min(1).max(200).default(200),
  skip: z.coerce.number().min(0).default(0),
});

function transferWhere(companyId: string, q: z.infer<typeof filterSchema>): Prisma.StockTransferWhereInput {
  return {
    companyId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.fromWarehouseId ? { fromWarehouseId: q.fromWarehouseId } : {}),
    ...(q.toWarehouseId ? { toWarehouseId: q.toWarehouseId } : {}),
    ...(q.from || q.to ? { transferDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.keyword
      ? { OR: [{ transferNo: { contains: q.keyword } }, { note: { contains: q.keyword } }] }
      : {}),
  };
}

/** ข้อผิดพลาดทางธุรกิจ → รหัสและข้อความที่ผู้ใช้อ่านรู้เรื่อง (ที่ไม่รู้จักต้องโยนต่อ ไม่กลบ) */
function transferErrorReply(reply: FastifyReply, error: unknown) {
  if (error instanceof InsufficientStockError) {
    return reply.status(409).send(fail('INSUFFICIENT_STOCK', error.message));
  }
  const message = error instanceof Error ? error.message : 'STOCK_TRANSFER_FAILED';
  const map: Record<string, [number, string]> = {
    WAREHOUSE_NOT_FOUND: [404, 'ไม่พบคลังในบริษัทปัจจุบัน'],
    SAME_WAREHOUSE: [400, 'คลังต้นทางและคลังปลายทางต้องไม่ใช่คลังเดียวกัน'],
    ITEM_NOT_IN_COMPANY: [400, 'มีสินค้าที่ไม่อยู่ในบริษัทปัจจุบัน'],
    DUPLICATE_ITEM: [400, 'มีสินค้าซ้ำกันในใบโอนย้ายเดียวกัน'],
    TRANSFER_NOT_FOUND: [404, 'ไม่พบใบโอนย้ายนี้'],
    NOT_DRAFT: [409, 'ใบโอนย้ายนี้ยืนยันแล้ว จึงแก้ไขไม่ได้'],
    NOT_CONFIRMED: [409, 'ใบโอนย้ายนี้ยังเป็นร่าง จึงกลับรายการไม่ได้'],
    ALREADY_CONFIRMED: [409, 'ใบโอนย้ายนี้ยืนยันแล้ว ไม่สามารถยืนยันซ้ำได้'],
    ALREADY_REVERSED: [409, 'ใบโอนย้ายนี้ถูกกลับรายการแล้ว'],
    ALREADY_CANCELLED: [409, 'ใบโอนย้ายนี้ถูกยกเลิกแล้ว'],
  };
  const hit = map[message];
  if (hit) return reply.status(hit[0]).send(fail(message, hit[1]));
  throw error;
}

const DETAIL_INCLUDE = {
  fromWarehouse: { select: { id: true, code: true, name: true } },
  toWarehouse: { select: { id: true, code: true, name: true } },
  items: { include: { item: { select: { id: true, code: true, name: true, baseUnit: { select: { code: true } } } } } },
} satisfies Prisma.StockTransferInclude;

/** transaction ที่ออกเลขเอกสารและขยับสต็อกสองคลัง */
const numberedTransaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
  withDocumentNumberRetry(() => prisma.$transaction(run, { maxWait: 10_000, timeout: 20_000 }));

/** transaction ที่ขยับสต็อกอย่างเดียว (ยืนยันร่าง / กลับรายการ) */
const stockTransaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
  withStockLockRetry(() => prisma.$transaction(run, { maxWait: 10_000, timeout: 20_000 }));

type Tx = Prisma.TransactionClient;

/** ตรวจคลังต้นทาง/ปลายทางและสินค้าว่าอยู่ในบริษัทนี้จริง */
async function validateWithin(tx: Tx, companyId: string, fromWarehouseId: string, toWarehouseId: string, itemIds: string[]) {
  if (fromWarehouseId === toWarehouseId) throw new Error('SAME_WAREHOUSE');
  if (new Set(itemIds).size !== itemIds.length) throw new Error('DUPLICATE_ITEM');

  const warehouses = await tx.warehouse.findMany({ where: { id: { in: [fromWarehouseId, toWarehouseId] }, companyId }, select: { id: true } });
  if (warehouses.length !== 2) throw new Error('WAREHOUSE_NOT_FOUND');

  const items = await tx.item.findMany({
    where: { id: { in: itemIds }, companyId, deletedAt: null },
    select: { id: true, lastCost: true, baseUnit: { select: { code: true } } },
  });
  if (items.length !== itemIds.length) throw new Error('ITEM_NOT_IN_COMPANY');
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * ย้ายของจริงทั้งใบ — ขาออกจากต้นทางและขาเข้าปลายทางอยู่ใน transaction เดียวกัน
 * ถ้าบรรทัดใดของไม่พอ จะโยน InsufficientStockError แล้วทั้งใบถูกย้อน ปลายทางไม่ขยับเลย
 */
async function moveStockWithin(
  tx: Tx, companyId: string, userId: string,
  doc: { id: string; transferNo: string; fromWarehouseId: string; toWarehouseId: string; note: string | null },
  lines: { itemId: string; quantity: number }[],
  itemOf: Map<string, { lastCost: Prisma.Decimal | null; baseUnit: { code: string } | null }>,
) {
  // ล็อกทั้งสองคลังด้วยลำดับสากลเดียว ใบ A→B และ B→A จึงต่อคิวกันแทนที่จะวนตาย
  await lockBalancePairs(tx, lines.flatMap((line) => ([
    { itemId: line.itemId, warehouseId: doc.fromWarehouseId },
    { itemId: line.itemId, warehouseId: doc.toWarehouseId },
  ])));

  for (const line of lines) {
    const item = itemOf.get(line.itemId);
    /* ต้นทุนอ้างอิงเดียวกันทั้งสองขา — การโอนย้ายไม่สร้างต้นทุนใหม่และไม่แก้ต้นทุนสินค้า
       หน่วยเขียนเป็นรหัสหน่วยที่อ่านออก ไม่ใช่ id (บทเรียนจาก PHASE 13B) */
    const unitCost = num(item?.lastCost);
    const unit = item?.baseUnit?.code ?? null;
    const shared = {
      companyId, itemId: line.itemId, unit, unitCost,
      refType: 'STOCK_TRANSFER', refId: doc.id, refNo: doc.transferNo,
      note: doc.note, createdById: userId,
    };

    // ขาออกก่อนเสมอ ถ้าของไม่พอต้องล้มก่อนที่ปลายทางจะได้รับอะไร
    await applyMovement(tx, { ...shared, warehouseId: doc.fromWarehouseId, movementType: 'TRANSFER_OUT', changeQty: -line.quantity });
    await applyMovement(tx, { ...shared, warehouseId: doc.toWarehouseId, movementType: 'TRANSFER_IN', changeQty: line.quantity });
  }
}

export default async function transferRoutes(app: FastifyInstance) {
  /** รายการใบโอนย้าย — กรองตามสถานะ คลังต้นทาง/ปลายทาง ช่วงวันที่ และคำค้น */
  app.get('/transfers', { preHandler: requirePermission('STOCK_TRANSFER_VIEW', 'STOCK_VIEW') }, async (req) => {
    const q = filterSchema.parse(req.query ?? {});
    const companyId = req.user.companyId!;
    const where = transferWhere(companyId, q);
    const [rows, total] = await Promise.all([
      prisma.stockTransfer.findMany({ where, include: DETAIL_INCLUDE, orderBy: [{ transferDate: 'desc' }, { createdAt: 'desc' }], take: q.take, skip: q.skip }),
      prisma.stockTransfer.count({ where }),
    ]);
    return ok({ rows, total, take: q.take, skip: q.skip });
  });

  app.get('/transfers/:id', { preHandler: requirePermission('STOCK_TRANSFER_VIEW', 'STOCK_VIEW') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const doc = await prisma.stockTransfer.findFirst({ where: { id, companyId: req.user.companyId! }, include: DETAIL_INCLUDE });
    if (!doc) return reply.status(404).send(fail('TRANSFER_NOT_FOUND', 'ไม่พบใบโอนย้ายนี้'));
    return ok(doc);
  });

  /** สร้างใบโอนย้าย — ค่าเริ่มต้นเป็นร่าง (ยังไม่ขยับสต็อก) ส่ง confirm=true เพื่อย้ายของในคำขอเดียว */
  app.post('/transfers', { preHandler: requirePermission('STOCK_TRANSFER_CREATE') }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const companyId = req.user.companyId!;
    const canConfirm = req.user.roles.includes('SUPER_ADMIN') || req.user.permissions.includes('STOCK_TRANSFER_CONFIRM');
    if (body.confirm && !canConfirm) return reply.status(403).send(fail('FORBIDDEN', 'ต้องมีสิทธิ์ STOCK_TRANSFER_CONFIRM จึงจะยืนยันการโอนย้ายได้'));

    try {
      const created = await numberedTransaction(async (tx) => {
        // PHASE 16 — ออกเลขเป็นคำสั่งแรกของ transaction เสมอ
        const transferNo = await nextDocumentNo(tx, companyId, 'STOCK_TRANSFER');
        const itemOf = await validateWithin(tx, companyId, body.fromWarehouseId, body.toWarehouseId, body.items.map((l) => l.itemId));

        const doc = await tx.stockTransfer.create({
          data: {
            companyId, transferNo,
            fromWarehouseId: body.fromWarehouseId, toWarehouseId: body.toWarehouseId,
            transferDate: body.transferDate, note: body.note ?? null,
            status: body.confirm ? 'CONFIRMED' : 'DRAFT',
            createdById: req.user.sub,
            items: { create: body.items.map((l) => ({ itemId: l.itemId, quantity: new Prisma.Decimal(l.quantity), lotNo: l.lotNo ?? null })) },
          },
          include: DETAIL_INCLUDE,
        });

        if (body.confirm) await moveStockWithin(tx, companyId, req.user.sub, doc, body.items, itemOf);

        await tx.auditLog.create({ data: {
          userId: req.user.sub, companyId,
          action: body.confirm ? 'STOCK_TRANSFER_CONFIRMED' : 'STOCK_TRANSFER_CREATED',
          entity: 'StockTransfer', entityId: doc.id,
          after: { transferNo, fromWarehouseId: body.fromWarehouseId, toWarehouseId: body.toWarehouseId, lines: body.items.length, status: doc.status },
        } });
        return doc;
      });
      return reply.status(201).send(ok(created, created.status === 'CONFIRMED'
        ? `ยืนยันใบโอนย้าย ${created.transferNo} และย้ายของแล้ว`
        : `บันทึกร่างใบโอนย้าย ${created.transferNo}`));
    } catch (error: unknown) {
      return transferErrorReply(reply, error);
    }
  });

  /** แก้ไขร่าง — เลข TR เดิมคงอยู่เสมอ และสถานะอื่นแก้ไม่ได้ */
  app.patch('/transfers/:id', { preHandler: requirePermission('STOCK_TRANSFER_CREATE') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const companyId = req.user.companyId!;
    try {
      const updated = await prisma.$transaction(async (tx) => {
        const doc = await tx.stockTransfer.findFirst({ where: { id, companyId } });
        if (!doc) throw new Error('TRANSFER_NOT_FOUND');
        if (doc.status !== 'DRAFT') throw new Error('NOT_DRAFT');

        const fromWarehouseId = body.fromWarehouseId ?? doc.fromWarehouseId;
        const toWarehouseId = body.toWarehouseId ?? doc.toWarehouseId;
        const items = body.items ?? [];
        if (items.length) await validateWithin(tx, companyId, fromWarehouseId, toWarehouseId, items.map((l) => l.itemId));
        else if (fromWarehouseId === toWarehouseId) throw new Error('SAME_WAREHOUSE');

        // แทนที่บรรทัดทั้งชุด (ร่างยังไม่มี ledger จึงไม่กระทบสต็อก)
        if (items.length) await tx.stockTransferItem.deleteMany({ where: { stockTransferId: doc.id } });
        const saved = await tx.stockTransfer.update({
          where: { id: doc.id },
          data: {
            fromWarehouseId, toWarehouseId,
            ...(body.transferDate ? { transferDate: body.transferDate } : {}),
            note: body.note ?? null,
            ...(items.length ? { items: { create: items.map((l) => ({ itemId: l.itemId, quantity: new Prisma.Decimal(l.quantity), lotNo: l.lotNo ?? null })) } } : {}),
          },
          include: DETAIL_INCLUDE,
        });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_TRANSFER_UPDATED', entity: 'StockTransfer', entityId: doc.id, after: { transferNo: doc.transferNo, lines: items.length } } });
        return saved;
      });
      return ok(updated, `บันทึกร่าง ${updated.transferNo} แล้ว`);
    } catch (error: unknown) {
      return transferErrorReply(reply, error);
    }
  });

  /** ยืนยันร่าง — ย้ายของจริงทั้งสองขาในธุรกรรมเดียว */
  app.post('/transfers/:id/confirm', { preHandler: requirePermission('STOCK_TRANSFER_CONFIRM') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    try {
      const confirmed = await stockTransaction(async (tx) => {
        const doc = await tx.stockTransfer.findFirst({ where: { id, companyId }, include: { items: true } });
        if (!doc) throw new Error('TRANSFER_NOT_FOUND');
        if (doc.status !== 'DRAFT') throw new Error(`ALREADY_${doc.status}`);

        const itemOf = await validateWithin(tx, companyId, doc.fromWarehouseId, doc.toWarehouseId, doc.items.map((l) => l.itemId));
        await moveStockWithin(tx, companyId, req.user.sub, doc, doc.items.map((l) => ({ itemId: l.itemId, quantity: num(l.quantity) })), itemOf);

        const saved = await tx.stockTransfer.update({ where: { id: doc.id }, data: { status: 'CONFIRMED' }, include: DETAIL_INCLUDE });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_TRANSFER_CONFIRMED', entity: 'StockTransfer', entityId: doc.id, after: { transferNo: doc.transferNo, lines: doc.items.length } } });
        return saved;
      });
      return ok(confirmed, `ยืนยันใบโอนย้าย ${confirmed.transferNo} และย้ายของแล้ว`);
    } catch (error: unknown) {
      return transferErrorReply(reply, error);
    }
  });

  /**
   * กลับรายการ — คืนของให้ต้นทางและหักออกจากปลายทาง ครั้งเดียวเท่านั้น
   * ถ้าปลายทางมีของไม่พอจะคืน (ของถูกเบิกต่อไปแล้ว) จะล้มด้วย INSUFFICIENT_STOCK
   * ไม่ปล่อยให้ปลายทางติดลบเงียบ ๆ
   */
  app.post('/transfers/:id/reverse', { preHandler: requirePermission('STOCK_TRANSFER_REVERSE', 'STOCK_TRANSFER_CONFIRM') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    try {
      const reversed = await stockTransaction(async (tx) => {
        const doc = await tx.stockTransfer.findFirst({ where: { id, companyId } });
        if (!doc) throw new Error('TRANSFER_NOT_FOUND');
        if (doc.status === 'DRAFT') throw new Error('NOT_CONFIRMED');
        if (doc.status !== 'CONFIRMED') throw new Error(`ALREADY_${doc.status}`);

        const restored = await reverseDocument(tx, 'STOCK_TRANSFER', doc.id, req.user.sub);
        if (restored === 0) throw new Error('ALREADY_REVERSED');

        const saved = await tx.stockTransfer.update({ where: { id: doc.id }, data: { status: 'REVERSED' }, include: DETAIL_INCLUDE });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_TRANSFER_REVERSED', entity: 'StockTransfer', entityId: doc.id, after: { transferNo: doc.transferNo, restoredLines: restored, reason: body.reason ?? null } } });
        return saved;
      });
      return ok(reversed, `กลับรายการใบโอนย้าย ${reversed.transferNo} แล้ว`);
    } catch (error: unknown) {
      return transferErrorReply(reply, error);
    }
  });
}
