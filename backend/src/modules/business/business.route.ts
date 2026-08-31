import type { FastifyInstance } from 'fastify';
import { Prisma, SalesOrderStatus, ItemType } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import { num } from '../../lib/http.js';
import { applyMovement, InsufficientStockError, lockBalance, lockBalancesInOrder, nextDocumentNo, nextOrderNo, reverseDocument } from '../../lib/inventory-ledger.js';
import { withDocumentNumberRetry, withStockLockRetry } from '../../lib/tx-retry.js';
import { checkStandardFactor, factorConflictMessage } from '../../lib/item-conversion.js';
import { aggregateStock, buildPatch, duplicateMessage, normalizeCode, normalizeName, optionalText, searchWhere, statusWhere, toNum as pnum, warehouseDeactivateBlock } from '../../lib/partner-master.js';
import ExcelJS from 'exceljs';
import { notificationChannels } from '../notifications/channel.service.js';
import { renderBusinessPdf, type BusinessDocument, type DocumentType } from './document.service.js';
import { toDocumentCompany } from './company-identity.js';
import { recomputePurchaseOrderStatus, validateReceiptOverage } from '../purchase-orders/purchase-order.service.js';
import { assertLotPolicy, ensureInventoryLot, LotPolicyError, validateLotAllocations } from '../../lib/inventory-lot.js';

/** ระดับราคาที่ยอมรับ — ชุดเดียวกับที่ costing.route.ts ใช้กับ SellingPrice.priceType
    ไม่มี enum ใน schema จึงบังคับที่ชั้น route แบบเดียวกับของเดิม */
const PRICE_TIER = z.enum(['RETAIL', 'WHOLESALE', 'AGENT', 'SPECIAL']);

const customerSchema = z.object({
  // code เป็น optional เพื่อรองรับ "เพิ่มลูกค้าด่วน" (ต้องการเพียงชื่อ) — ระบบจะออกรหัสให้อัตโนมัติ
  code: z.string().trim().min(1).max(40).optional(), name: z.string().trim().min(1).max(160),
  customerType: z.string().max(60).optional(), contactName: z.string().max(120).optional(),
  phone: z.string().max(40).optional(), email: z.string().email().optional().or(z.literal('')),
  address: z.string().max(500).optional(), taxId: z.string().max(30).optional(), note: z.string().max(500).optional(),
  billingAddress: z.string().max(500).optional(), lineId: z.string().max(80).optional(), branch: z.string().max(120).optional(),
});
const orderSchema = z.object({
  customerId: z.string().min(1), deliveryDate: z.coerce.date(), deliveryTime: z.string().max(10).optional(),
  contactName: z.string().max(120).optional(), phone: z.string().max(40).optional(), email: z.string().email().optional().or(z.literal('')),
  deliveryAddress: z.string().max(500).optional(), discount: z.coerce.number().min(0).default(0),
  tax: z.coerce.number().min(0).default(0), note: z.string().max(500).optional(), idempotencyKey: z.string().max(100).optional(),
  priceTier: PRICE_TIER.optional(),
  items: z.array(z.object({ menuId: z.string().min(1), menuNameSnapshot: z.string().min(1), quantity: z.coerce.number().positive(), unit: z.string().min(1), unitPrice: z.coerce.number().min(0), note: z.string().optional() })).min(1),
});
const transitions: Record<SalesOrderStatus, SalesOrderStatus[]> = {
  DRAFT: ['CONFIRMED', 'CANCELLED'], CONFIRMED: ['SENT_TO_PREP', 'CANCELLED'],
  SENT_TO_PREP: ['PICKING', 'CANCELLED'], PICKING: ['ISSUED', 'CANCELLED'], ISSUED: ['READY'],
  READY: ['DELIVERED'], DELIVERED: [], CANCELLED: [],
};
const timestampFor = (status: SalesOrderStatus) => ({
  ...(status === 'CONFIRMED' ? { confirmedAt: new Date() } : {}),
  ...(status === 'SENT_TO_PREP' ? { sentToOperationsAt: new Date() } : {}),
  ...(status === 'ISSUED' ? { issuedAt: new Date() } : {}),
  ...(status === 'READY' ? { readyAt: new Date() } : {}),
  ...(status === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
  ...(status === 'CANCELLED' ? { cancelledAt: new Date() } : {}),
});

type StockDemand = { itemId: string; name: string; unit: string; quantity: Prisma.Decimal };

async function expandRecipeDemand(
  companyId: string,
  recipeId: string,
  multiplier: Prisma.Decimal,
  demand: Map<string, StockDemand>,
  warnings: string[],
  path: string[] = [],
): Promise<void> {
  if (path.includes(recipeId)) {
    warnings.push(`Circular sub-recipe reference: ${[...path, recipeId].join(' -> ')}`);
    return;
  }
  // Archived recipes remain resolvable when an active historical version references them.
  const recipe = await prisma.recipe.findFirst({
    where: { id: recipeId, companyId },
    select: {
      versions: {
        where: { isActive: true }, orderBy: { versionNo: 'desc' }, take: 1,
        select: {
          standardYieldQty: true, yieldPercent: true,
          ingredients: { include: { item: { include: { baseUnit: true } }, unit: true } },
        },
      },
    },
  });
  const version = recipe?.versions[0];
  if (!version) {
    warnings.push(`Recipe ${recipeId} is missing or has no active version.`);
    return;
  }
  const nextPath = [...path, recipeId];
  for (const ingredient of version.ingredients) {
    const wasteFactor = new Prisma.Decimal(1).plus(ingredient.wastePercent.div(100));
    if (ingredient.componentType === 'SUB_RECIPE') {
      if (!ingredient.childRecipeId) {
        warnings.push(`Sub-recipe component ${ingredient.id} has no child recipe.`);
        continue;
      }
      const child = await prisma.recipe.findFirst({
        where: { id: ingredient.childRecipeId, companyId },
        select: { versions: { where: { isActive: true }, orderBy: { versionNo: 'desc' }, take: 1, select: { standardYieldQty: true, yieldPercent: true } } },
      });
      const childVersion = child?.versions[0];
      const childYield = childVersion ? childVersion.standardYieldQty.mul(childVersion.yieldPercent).div(100) : new Prisma.Decimal(0);
      if (childYield.lte(0)) {
        warnings.push(`Sub-recipe ${ingredient.childRecipeId} is missing or has zero yield.`);
        continue;
      }
      await expandRecipeDemand(
        companyId,
        ingredient.childRecipeId,
        multiplier.mul(ingredient.quantity).mul(wasteFactor).div(childYield),
        demand,
        warnings,
        nextPath,
      );
      continue;
    }
    if (ingredient.componentType === 'ITEM' || ingredient.componentType === 'PACKAGING') {
      if (!ingredient.itemId || !ingredient.item) {
        warnings.push(`${ingredient.componentType} component ${ingredient.id} has no stock item.`);
        continue;
      }
      const quantity = ingredient.quantity.mul(multiplier).mul(wasteFactor);
      const current = demand.get(ingredient.itemId);
      if (current) current.quantity = current.quantity.plus(quantity);
      else demand.set(ingredient.itemId, { itemId: ingredient.itemId, name: ingredient.item.name, unit: ingredient.unit?.code ?? ingredient.item.baseUnit?.code ?? '—', quantity });
      continue;
    }
    warnings.push(`Unsupported recipe component type '${ingredient.componentType}' on ${ingredient.id}.`);
  }
}

/** แปลง error ของใบเบิกให้เป็น response ที่อ่านรู้เรื่อง (คงพฤติกรรม insufficient stock เดิม) */
function issueErrorReply(reply: import('fastify').FastifyReply, error: unknown) {
  if (error instanceof LotPolicyError) {
    return reply.status(409).send(fail(error.code, error.message, error.details));
  }
  if (error instanceof InsufficientStockError) {
    return reply.status(409).send(fail('INSUFFICIENT_STOCK', error.message));
  }
  const message = error instanceof Error ? error.message : 'STOCK_ISSUE_FAILED';
  const map: Record<string, [number, string]> = {
    WAREHOUSE_NOT_FOUND: [404, 'ไม่พบคลังในบริษัทปัจจุบัน'],
    ORDER_NOT_FOUND: [404, 'ไม่พบออเดอร์ในบริษัทปัจจุบัน'],
    ITEM_NOT_IN_COMPANY: [400, 'มีสินค้าที่ไม่อยู่ในบริษัทปัจจุบัน'],
    ISSUE_NOT_FOUND: [404, 'ไม่พบใบเบิกนี้'],
    NOT_CONFIRMED: [409, 'ใบเบิกนี้ยังเป็นร่าง จึงกลับรายการไม่ได้'],
    ALREADY_ISSUED: [409, 'ใบเบิกนี้ยืนยันแล้ว ไม่สามารถยืนยันซ้ำได้'],
    ALREADY_REVERSED: [409, 'ใบเบิกนี้ถูกกลับรายการแล้ว'],
    ALREADY_CANCELLED: [409, 'ใบเบิกนี้ถูกยกเลิกแล้ว'],
  };
  const hit = map[message];
  if (hit) return reply.status(hit[0]).send(fail(message, hit[1]));
  if (message.startsWith('FORBIDDEN_CONFIRM:')) return reply.status(403).send(fail('FORBIDDEN', `ต้องมีสิทธิ์ ${message.split(':')[1]} จึงจะยืนยันเอกสารได้`));
  throw error;
}

/** ยืนยันในคำขอเดียว (confirm=true) ต้องมีสิทธิ์ยืนยันจริง ไม่ให้ CREATE ข้ามด่าน */
function assertCanConfirm(req: { user: { roles: string[]; permissions: string[] } }, permission: string) {
  const allowed = req.user.roles.includes('SUPER_ADMIN') || req.user.permissions.includes(permission);
  if (!allowed) throw new Error(`FORBIDDEN_CONFIRM:${permission}`);
}

/** filter ของหน้ารับของเข้า — ใช้ทั้ง list และ export เพื่อให้ผลลัพธ์ตรงกันเสมอ */
const receivingFilterSchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  supplierId: z.string().optional(),
  warehouseId: z.string().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'REVERSED', 'CANCELLED']).optional(),
  keyword: z.string().trim().max(100).optional(),
});
type ReceivingFilter = z.infer<typeof receivingFilterSchema>;

function receivingWhere(companyId: string, q: ReceivingFilter): Prisma.GoodsReceiptWhereInput {
  return {
    companyId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.supplierId ? { supplierId: q.supplierId } : {}),
    ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
    ...(q.from || q.to ? { receiptDate: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    ...(q.keyword
      ? {
        OR: [
          { receiptNo: { contains: q.keyword } },
          { supplierDocNo: { contains: q.keyword } },
          { note: { contains: q.keyword } },
          { supplier: { name: { contains: q.keyword } } },
          { items: { some: { item: { OR: [{ code: { contains: q.keyword } }, { name: { contains: q.keyword } }] } } } },
        ],
      }
      : {}),
  };
}

/**
 * ต้นทุนต่อหน่วยฐานจากราคาซื้อ — กติกาเดียวกับ item.route.ts (baseUnitCost)
 * เช่น ซื้อ 47 บาท/L และ 1 L = 1000 ML → 0.047 บาท/ML
 * ห้ามเขียน unitPrice ลง lastCost ตรง ๆ เพราะจะได้ 47 บาท/ML (ผิด)
 */
function receiptBaseUnitCost(unitPrice: number, purchaseToBaseFactor: number) {
  const factor = purchaseToBaseFactor > 0 ? purchaseToBaseFactor : 1;
  return unitPrice / factor;
}

/**
 * ยืนยันใบรับของภายใน transaction — เพิ่มสต็อกผ่าน ledger service เดียวของระบบ
 * และอัปเดตต้นทุน "เฉพาะตอนยืนยัน" เท่านั้น
 */
async function confirmReceiptWithin(tx: Prisma.TransactionClient, receiptId: string, companyId: string, userId: string) {
  const doc = await tx.goodsReceipt.findFirstOrThrow({
    where: { id: receiptId },
    include: { items: { include: { item: { include: { baseUnit: true } } } } },
  });

  // PHASE 17 — ล็อกแถวยอดคงเหลือทั้งใบตามลำดับ itemId ก่อน เพื่อไม่ให้สองใบจับล็อกสวนทางกัน
  await lockBalancesInOrder(tx, doc.warehouseId, doc.items.map((line) => line.itemId));

  for (const line of doc.items) {
    // PO-linked receipts keep the confirmed purchase-unit factor snapshot; legacy receipts fall back to the item master.
    const factor = line.purchaseToBaseFactor == null ? num(line.item.purchaseToBaseFactor) : num(line.purchaseToBaseFactor);
    const unitPrice = num(line.unitPrice);
    // ปริมาณที่รับระบุเป็นหน่วยซื้อ → แปลงเป็นหน่วยฐานก่อนเข้าสต็อก
    const baseQty = num(line.quantity) * (factor > 0 ? factor : 1);
    const baseCost = receiptBaseUnitCost(unitPrice, factor);
    if (!line.item.isLotTracked && (line.lotNo || line.manufactureDate || line.expiryDate)) throw new LotPolicyError('LOT_TRACKING_NOT_ENABLED', 'ต้องเปิดการติดตาม Lot ที่ข้อมูลสินค้าก่อนระบุ Lot ในใบรับของ');
    const lotNo = assertLotPolicy(line.item, line.lotNo, line.manufactureDate, line.expiryDate);
    const lot = lotNo ? await ensureInventoryLot(tx, {
      companyId, itemId: line.itemId, warehouseId: doc.warehouseId, lotNo,
      manufactureDate: line.manufactureDate, expiryDate: line.expiryDate,
      receivedDate: doc.receiptDate, sourceType: 'GOODS_RECEIPT', sourceReceiptId: doc.id, createdById: userId,
    }) : null;
    if (lot) await tx.goodsReceiptItem.update({ where: { id: line.id }, data: { inventoryLotId: lot.id } });

    await applyMovement(tx, {
      companyId, warehouseId: doc.warehouseId, itemId: line.itemId,
      lotId: lot?.id,
      movementType: 'PURCHASE_RECEIPT', changeQty: baseQty,
      // PHASE 13B — เดิมเขียน baseUnitId (cuid) ลงคอลัมน์ unit ของบัญชีเดินสต็อก
      unit: line.item.baseUnit?.code ?? null,
      refType: 'GOODS_RECEIPT', refId: doc.id, refNo: doc.receiptNo,
      unitCost: baseCost, createdById: userId,
    });

    // ประวัติราคา + lastCost เก็บเป็น "ต้นทุนต่อหน่วยฐาน" ให้ตรงกับที่ระบบใช้คิดสูตร
    await tx.itemPriceHistory.create({
      data: {
        companyId, itemId: line.itemId, price: new Prisma.Decimal(baseCost), source: 'PURCHASE',
        note: JSON.stringify({ purchasePrice: unitPrice, purchaseQuantity: 1, pricePerPurchaseUnit: unitPrice, receiptNo: doc.receiptNo }),
        createdById: userId,
      },
    });
    await tx.item.update({ where: { id: line.itemId }, data: { lastCost: new Prisma.Decimal(baseCost), avgCost: new Prisma.Decimal(baseCost), updatedById: userId } });
  }
}

/** แปลง error ของใบรับของให้เป็น response ที่อ่านรู้เรื่อง */
function receivingErrorReply(reply: import('fastify').FastifyReply, error: unknown) {
  if (error instanceof InsufficientStockError) return reply.status(409).send(fail('INSUFFICIENT_STOCK', error.message));
  if (error instanceof LotPolicyError) return reply.status(409).send(fail(error.code, error.message, error.details));
  const message = error instanceof Error ? error.message : 'RECEIVING_FAILED';
  const map: Record<string, [number, string]> = {
    WAREHOUSE_NOT_FOUND: [404, 'ไม่พบคลังในบริษัทปัจจุบัน'],
    ITEM_NOT_IN_COMPANY: [400, 'มีสินค้าที่ไม่อยู่ในบริษัทปัจจุบัน'],
    RECEIPT_NOT_FOUND: [404, 'ไม่พบใบรับของนี้'],
    NOT_CONFIRMED: [409, 'ใบรับของนี้ยังเป็นร่าง จึงกลับรายการไม่ได้'],
    ALREADY_CONFIRMED: [409, 'ใบรับของนี้ยืนยันแล้ว ไม่สามารถยืนยันซ้ำได้'],
    ALREADY_REVERSED: [409, 'ใบรับของนี้ถูกกลับรายการแล้ว'],
    ALREADY_CANCELLED: [409, 'ใบรับของนี้ถูกยกเลิกแล้ว'],
    ADJUSTMENT_NOT_FOUND: [404, 'ไม่พบรายการปรับปรุงสต็อกนี้'],
    PURCHASE_ORDER_NOT_FOUND: [404, 'ไม่พบใบสั่งซื้อในบริษัทปัจจุบัน'],
    PURCHASE_ORDER_NOT_RECEIVABLE: [409, 'ใบสั่งซื้อนี้ไม่อยู่ในสถานะที่รับของได้'],
    PURCHASE_ORDER_MISMATCH: [400, 'ผู้ขาย คลัง หรือรายการรับของไม่ตรงกับใบสั่งซื้อ'],
  };
  const hit = map[message];
  if (hit) return reply.status(hit[0]).send(fail(message, hit[1]));
  if (message.startsWith('OVER_RECEIVE_ACK_REQUIRED:')) {
    const details = JSON.parse(message.slice('OVER_RECEIVE_ACK_REQUIRED:'.length)) as unknown;
    return reply.status(409).send(fail('OVER_RECEIVE_ACK_REQUIRED', 'ปริมาณรับเกินใบสั่งซื้อ ต้องยืนยันการรับเกินอย่างชัดเจน', details));
  }
  if (message.startsWith('FORBIDDEN_CONFIRM:')) return reply.status(403).send(fail('FORBIDDEN', `ต้องมีสิทธิ์ ${message.split(':')[1]} จึงจะยืนยันเอกสารได้`));
  throw error;
}


/** PHASE 7B — รูปแบบข้อมูล Supplier/Warehouse ที่ส่งให้ frontend
    ส่งเฉพาะ field ที่ schema มีจริง ไม่เติม field ที่ไม่มีที่เก็บ */
type SupplierRow = {
  id: string; code: string; name: string;
  taxId: string | null; phone: string | null; email: string | null; address: string | null;
  isActive: boolean; createdAt: Date; updatedAt: Date;
  _count?: { goodsReceipts: number };
};
function serializeSupplier(s: SupplierRow) {
  return {
    id: s.id, code: s.code, name: s.name,
    taxId: s.taxId, phone: s.phone, email: s.email, address: s.address,
    isActive: s.isActive,
    receivingCount: s._count?.goodsReceipts ?? 0,
    createdAt: s.createdAt.toISOString(), updatedAt: s.updatedAt.toISOString(),
  };
}

type WarehouseRow = {
  id: string; code: string; name: string; type: ItemType | null;
  isActive: boolean; createdAt: Date; updatedAt: Date;
};
function serializeWarehouse(w: WarehouseRow, stock: { itemCount: number; onHand: number; reserved: number; stockValue: number } | undefined) {
  return {
    id: w.id, code: w.code, name: w.name, type: w.type,
    isActive: w.isActive,
    itemCount: stock?.itemCount ?? 0,
    onHand: pnum(stock?.onHand),
    reserved: pnum(stock?.reserved),
    stockValue: pnum(stock?.stockValue),
    createdAt: w.createdAt.toISOString(), updatedAt: w.updatedAt.toISOString(),
  };
}

/** จำนวนในสมการของใบปรับปรุงสต็อก — ไม่บังคับทศนิยม */
const fmtQty = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 4 });

/** คำนำหน้าชื่อไฟล์ตามชนิดเอกสาร — ให้ผู้ใช้รู้ว่าไฟล์ไหนคืออะไรตั้งแต่ชื่อ */
const DOC_FILE_PREFIX: Record<string, string> = {
  GOODS_RECEIPT_SLIP: 'GR', STOCK_ISSUE_SLIP: 'RI', ORDER_SLIP: 'ORDER',
  KITCHEN_PREPARATION_SLIP: 'PREP', RECIPE_COST_SHEET: 'COST', SALES_REPORT: 'SALES',
  STOCK_ADJUSTMENT_SLIP: 'AJ',
};

/**
 * Content-Disposition ที่ Windows/Excel เปิดได้แน่นอน
 * ส่ง filename เป็น ASCII ล้วน แล้วแนบ filename* (RFC 5987) สำหรับชื่อที่มีอักษรไทย
 */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** สถานะเอกสารเป็นภาษาไทยสำหรับงานพิมพ์ — ค่าที่ไม่รู้จักคืนค่าดิบ ไม่เดา */
const DOC_STATUS_TH: Record<string, string> = {
  DRAFT: 'ร่าง', CONFIRMED: 'ยืนยันแล้ว', REVERSED: 'กลับรายการแล้ว', CANCELLED: 'ยกเลิก',
  ISSUED: 'เบิกแล้ว', SENT_TO_PREP: 'ส่งครัวแล้ว', PREPARING: 'กำลังเตรียม',
  READY: 'พร้อมส่ง', DELIVERED: 'ส่งแล้ว',
};
const ORDER_TIER_TH: Record<string, string> = { RETAIL: 'ราคาปลีก', WHOLESALE: 'ราคาส่ง', AGENT: 'ราคาตัวแทน' };

/**
 * PHASE 16 — transaction ที่ต้องออกเลขเอกสาร
 *
 * ใช้เฉพาะ 4 จุดที่ออกเลข (ออเดอร์ · ใบรับของ · ใบเบิก · ใบปรับปรุงสต็อก)
 * ไม่ใช่ตัวห่อสำหรับ transaction ทั่วไป — ข้อผิดพลาดทางธุรกิจยังล้มทันทีเหมือนเดิม
 */
const numberedTransaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
  withDocumentNumberRetry(() => prisma.$transaction(run, { maxWait: 10_000, timeout: 20_000 }));

/**
 * PHASE 17 — transaction ที่ขยับยอดคงเหลือแต่ไม่ได้ออกเลขเอกสารใหม่ (ยืนยัน / กลับรายการ)
 * ลองใหม่เฉพาะการชนกันของล็อกเท่านั้น สต็อกไม่พอหรือสถานะไม่ถูกต้องจะล้มทันทีเหมือนเดิม
 */
const stockTransaction = <T>(run: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
  withStockLockRetry(() => prisma.$transaction(run, { maxWait: 10_000, timeout: 20_000 }));

export default async function businessRoutes(app: FastifyInstance) {
  app.get('/documents/:type/:id.pdf', { preHandler: requirePermission('DOCUMENT_DOWNLOAD') }, async (req, reply) => {
    const { type, id } = z.object({ type: z.enum(['ORDER_SLIP','KITCHEN_PREPARATION_SLIP','STOCK_ISSUE_SLIP','GOODS_RECEIPT_SLIP','RECIPE_COST_SHEET','SALES_REPORT','STOCK_ADJUSTMENT_SLIP','STOCK_TRANSFER_SLIP']), id: z.string().min(1) }).parse(req.params) as { type: DocumentType; id: string };
    const companyId = req.user.companyId!; const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    /* PHASE 13 — เดิมเขียนทับ nameTh ของบริษัทหลักเป็น 'ครัวสดดี'
       ทำให้เอกสารไม่ขึ้นชื่อนิติบุคคลจริงที่จดทะเบียนไว้ จึงใช้ค่าใน Company ตรง ๆ */
    const identity = toDocumentCompany(company); let document: BusinessDocument | undefined;
    if (type === 'ORDER_SLIP' || type === 'KITCHEN_PREPARATION_SLIP') {
      const order = await prisma.salesOrder.findFirst({ where: { id, companyId }, include: { customer: true, items: true, createdBy: { select: { fullName: true } } } });
      if (order) document = { type, title: type, documentNo: order.orderNo, date: order.deliveryDate, company: identity, createdBy: order.createdBy.fullName, status: DOC_STATUS_TH[order.status] ?? order.status, totalLabel: 'ยอดรวมทั้งสิ้น', subject: [{ label: 'ลูกค้า', value: order.customer.name }, { label: 'ผู้ติดต่อ', value: order.contactName ?? '—' }, { label: 'กำหนดส่ง', value: `${order.deliveryDate.toLocaleDateString('th-TH')} ${order.deliveryTime ?? ''}` }, ...(order.priceTier ? [{ label: 'ระดับราคา', value: ORDER_TIER_TH[order.priceTier] ?? order.priceTier }] : [])], lines: order.items.map((line) => ({ name: line.menuNameSnapshot, detail: line.note ?? undefined, quantity: line.quantity.toString(), unit: line.unit, price: line.unitPrice.toString(), total: line.lineTotal.toString() })), total: type === 'ORDER_SLIP' ? order.totalAmount.toString() : undefined, note: order.note };
    } else if (type === 'GOODS_RECEIPT_SLIP') {
      const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId }, include: { supplier: true, warehouse: true, items: { include: { item: { include: { baseUnit: true } } } } } });
      const grAuthor = receipt?.createdById ? (await prisma.user.findUnique({ where: { id: receipt.createdById }, select: { fullName: true } }))?.fullName : undefined;
      if (receipt) document = { type, title: type, documentNo: receipt.receiptNo, date: receipt.receiptDate, company: identity, createdBy: grAuthor ?? undefined, status: DOC_STATUS_TH[receipt.status] ?? receipt.status, totalLabel: 'ยอดรวมทั้งสิ้น', subject: [{ label: 'ผู้จำหน่าย', value: receipt.supplier?.name ?? '—' }, { label: 'คลังปลายทาง', value: receipt.warehouse.name }, { label: 'วันที่รับ', value: receipt.receiptDate.toLocaleDateString('th-TH') }, ...(receipt.supplierDocNo ? [{ label: 'เอกสารอ้างอิง', value: receipt.supplierDocNo }] : [])], lines: receipt.items.map((line) => ({ name: line.item.name, detail: [line.lotNo && `Lot ${line.lotNo}`, line.expiryDate && `Expiry ${line.expiryDate.toLocaleDateString('th-TH')}`].filter(Boolean).join(' · '), quantity: line.quantity.toString(), unit: line.item.baseUnit?.code ?? '—', price: line.unitPrice.toString(), total: line.totalCost.toString() })), total: receipt.items.reduce((sum,line)=>sum.plus(line.totalCost),new Prisma.Decimal(0)).toString(), note: receipt.note };
    } else if (type === 'STOCK_TRANSFER_SLIP') {
      /* PHASE 18 — ใบโอนย้ายระหว่างคลัง: ไม่มียอดเงิน แสดงเฉพาะคลังต้นทาง/ปลายทางและจำนวน */
      const tr = await prisma.stockTransfer.findFirst({ where: { id, companyId }, include: { fromWarehouse: true, toWarehouse: true, items: { include: { item: { include: { baseUnit: true } } } } } });
      const trAuthor = tr?.createdById ? (await prisma.user.findUnique({ where: { id: tr.createdById }, select: { fullName: true } }))?.fullName : undefined;
      if (tr) document = { type, title: type, documentNo: tr.transferNo, date: tr.transferDate, company: identity, createdBy: trAuthor ?? undefined, status: DOC_STATUS_TH[tr.status] ?? tr.status, subject: [{ label: 'คลังต้นทาง', value: `${tr.fromWarehouse.code} · ${tr.fromWarehouse.name}` }, { label: 'คลังปลายทาง', value: `${tr.toWarehouse.code} · ${tr.toWarehouse.name}` }, { label: 'วันที่โอนย้าย', value: tr.transferDate.toLocaleDateString('th-TH') }], lines: tr.items.map((line) => ({ name: line.item.name, detail: line.lotNo ? `Lot ${line.lotNo}` : undefined, quantity: line.quantity.toString(), unit: line.item.baseUnit?.code ?? '—' })), note: tr.note };
    } else if (type === 'STOCK_ISSUE_SLIP') {
      const issue = await prisma.stockIssue.findFirst({ where: { id, companyId }, include: { order: true, createdBy: { select: { fullName: true } }, items: true } });
      if (issue) { const itemNames = new Map((await prisma.item.findMany({ where: { companyId, id: { in: issue.items.map((line)=>line.itemId) } }, select: { id: true, name: true } })).map((item)=>[item.id,item.name])); document = { type, title: type, documentNo: issue.issueNo, date: issue.issueDate, company: identity, createdBy: issue.createdBy.fullName, status: DOC_STATUS_TH[issue.status] ?? issue.status, subject: [{ label: 'คำสั่งซื้ออ้างอิง', value: issue.order?.orderNo ?? '—' }, { label: 'ปลายทาง', value: issue.destination }, { label: 'วันที่เบิก', value: issue.issueDate.toLocaleDateString('th-TH') }], lines: issue.items.map((line)=>({ name:itemNames.get(line.itemId)??line.itemId,quantity:line.issuedQty.toString(),unit:line.unit })), note: issue.note }; }
    } else if (type === 'STOCK_ADJUSTMENT_SLIP') {
      /* ใบปรับปรุงสต็อก — อ่านเฉพาะเอกสารที่ร้องขอ (id) และใช้ยอดที่บันทึกไว้ตอนทำรายการเท่านั้น
         systemQty = ยอดก่อนปรับ · diffQty = ส่วนต่าง · countedQty = ยอดหลังปรับ
         ห้ามย้อนคำนวณจากสต็อกปัจจุบัน เพราะเอกสารเก่าจะเพี้ยนทันทีที่สต็อกขยับ */
      const adj = await prisma.stockAdjustment.findFirst({
        where: { id, companyId },
        include: { warehouse: true, items: { include: { item: { include: { baseUnit: true } } } } },
      });
      if (adj) {
        const ajAuthor = adj.createdById
          ? (await prisma.user.findUnique({ where: { id: adj.createdById }, select: { fullName: true } }))?.fullName
          : undefined;
        document = {
          type, title: type, documentNo: adj.adjustmentNo, date: adj.adjustmentDate, company: identity,
          createdBy: ajAuthor ?? undefined,
          status: DOC_STATUS_TH[adj.status] ?? adj.status,
          subject: [
            { label: 'คลัง', value: adj.warehouse.name },
            { label: 'วันที่ปรับปรุง', value: adj.adjustmentDate.toLocaleDateString('th-TH') },
            ...(adj.reason ? [{ label: 'เหตุผล', value: adj.reason }] : []),
          ],
          lines: adj.items.map((line) => {
            const unit = line.item.baseUnit?.code ?? '—';
            const before = num(line.systemQty); const change = num(line.diffQty); const after = num(line.countedQty);
            const sign = change < 0 ? '−' : '+';
            return {
              name: line.item.name,
              // สมการอ่านง่ายใต้ชื่อรายการ เช่น 100 KG − 6 KG = 94 KG
              detail: `${fmtQty(before)} ${unit} ${sign} ${fmtQty(Math.abs(change))} ${unit} = ${fmtQty(after)} ${unit}`,
              before, change, after, unit,
            };
          }),
          note: adj.note,
        };
      }
    } else if (type === 'RECIPE_COST_SHEET') {
      const recipe = await prisma.recipe.findFirst({ where: { id, companyId }, include: { product: true, versions: { where: { isActive: true }, take: 1, include: { ingredients: { include: { item: { include: { baseUnit: true } }, unit: true, childRecipe: true } }, costs: { orderBy: { calculatedAt: 'desc' }, take: 1 } } } } }); const version=recipe?.versions[0]; const cost=version?.costs[0];
      if(recipe&&version)document={type,title:type,documentNo:`${recipe.code}-V${version.versionNo}`,date:cost?.calculatedAt??version.createdAt,company:identity,subject:[{label:'เมนู',value:recipe.product.name},{label:'Version',value:String(version.versionNo)},{label:'Yield',value:version.standardYieldQty.toString()}],lines:version.ingredients.map((line)=>{
        if (line.componentType === 'SUB_RECIPE') return { name: line.childRecipe?.name ?? 'Missing sub-recipe', detail: 'SUB_RECIPE', quantity: line.quantity.toString(), unit: line.unit?.code ?? '-' };
        if (line.item) return { name: line.item.name, quantity: line.quantity.toString(), unit: line.unit?.code ?? line.item.baseUnit?.code ?? '—', price: line.item.lastCost.toString(), total: line.quantity.mul(line.item.lastCost).toString() };
        return { name: 'Missing stock item', detail: line.componentType, quantity: line.quantity.toString(), unit: line.unit?.code ?? '-' };
      }),total:cost?.totalCost.toString(),note:version.note};
    } else {
      const start=new Date(new Date().getFullYear(),new Date().getMonth(),1);const orders=await prisma.salesOrder.findMany({where:{companyId,status:'DELIVERED',deliveredAt:{gte:start}},include:{customer:true}});document={type,title:type,documentNo:`SALES-${start.toISOString().slice(0,7)}`,date:new Date(),company:identity,subject:[{label:'รอบรายงาน',value:start.toLocaleDateString('th-TH',{month:'long',year:'numeric'})},{label:'ออเดอร์ส่งสำเร็จ',value:String(orders.length)}],lines:orders.map((order)=>({name:order.orderNo,detail:order.customer.name,quantity:1,unit:'order',total:order.totalAmount.toString()})),total:orders.reduce((sum,order)=>sum.plus(order.totalAmount),new Prisma.Decimal(0)).toString()};
    }
    if (!document) return reply.status(404).send(fail('DOCUMENT_SOURCE_NOT_FOUND', 'ไม่พบข้อมูลต้นทางของเอกสารในบริษัทปัจจุบัน'));
    const pdf = await renderBusinessPdf(document); await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'DOWNLOAD', entity: type, entityId: id } });
    const fileName = `${DOC_FILE_PREFIX[type]}-${document.documentNo}.pdf`;
    return reply.header('Content-Type','application/pdf').header('Content-Disposition',contentDisposition('inline', fileName)).send(pdf);
  });

  app.get('/operations/lookups', { preHandler: requirePermission('RECEIVING_CREATE', 'INVENTORY_ADJUST', 'STOCK_ISSUE_CREATE', 'ORDER_VIEW') }, async (req) => {
    const companyId = req.user.companyId!;
    const [warehouses, suppliers, items, orders] = await Promise.all([
      prisma.warehouse.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.supplier.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.item.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true, type: true, imageUrl: true, lastCost: true, purchaseToBaseFactor: true, isLotTracked: true, isExpiryTracked: true, baseUnit: { select: { code: true, name: true } }, purchaseUnit: { select: { code: true, name: true } }, stockBalances: { select: { warehouseId: true, onHand: true, reserved: true } } }, orderBy: { name: 'asc' } }),
      prisma.salesOrder.findMany({ where: { companyId, status: { in: ['CONFIRMED', 'SENT_TO_PREP', 'PICKING'] } }, select: { id: true, orderNo: true, deliveryDate: true, deliveryTime: true, status: true, customer: { select: { name: true } }, items: { select: { menuNameSnapshot: true, quantity: true } } }, orderBy: { deliveryDate: 'asc' }, take: 100 }),
    ]);
    return ok({ warehouses, suppliers, items, orders });
  });

  // ============================================================
  // PHASE 7B — Supplier / Warehouse master (list / detail / update)
  // เปิด contract ที่ DB มีอยู่แล้ว โดยไม่แตะ stock และไม่ลบประวัติ
  // สิทธิ์: reuse ของเดิม (ไม่มี SUPPLIER_*/WAREHOUSE_* ใน permission model)
  //   อ่าน  = คนที่เห็นงานรับของ/สต็อกอยู่แล้ว
  //   แก้ไข = คนที่สร้าง master เหล่านี้ได้อยู่แล้ว (RECEIVING_CREATE) เท่ากับ POST เดิม
  // ============================================================
  const PARTNER_READ = requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE', 'STOCK_ISSUE_CREATE', 'ORDER_VIEW', 'INVENTORY_VIEW', 'STOCK_VIEW');
  const PARTNER_WRITE = requirePermission('RECEIVING_CREATE');

  const partnerListQuery = z.object({
    keyword: z.string().trim().max(100).optional(),
    status: z.enum(['active', 'inactive', 'all']).default('active'),
  });

  /** ยอดสต็อกต่อคลัง — ดึงครั้งเดียวแล้วรวมในหน่วยความจำ ไม่เกิด N+1
      ใช้สูตรเดียวกับ GET /business/inventory: stockValue = onHand x item.lastCost */
  const warehouseStockMap = async (companyId: string) => {
    const balances = await prisma.stockBalance.findMany({
      where: { warehouse: { companyId } },
      select: { warehouseId: true, itemId: true, onHand: true, reserved: true, item: { select: { lastCost: true } } },
    });
    return aggregateStock(balances);
  };

  // ---------- SUPPLIERS ----------
  app.get('/suppliers', { preHandler: PARTNER_READ }, async (req) => {
    const q = partnerListQuery.parse(req.query ?? {});
    const companyId = req.user.companyId!;
    const rows = await prisma.supplier.findMany({
      where: {
        companyId, deletedAt: null,
        ...statusWhere(q.status),
        ...searchWhere(q.keyword, ['phone', 'email']),
      },
      // _count ทำใน query เดียว ไม่ต้องวนถาม GoodsReceipt ทีละราย
      include: { _count: { select: { goodsReceipts: true } } },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return ok(rows.map(serializeSupplier));
  });

  app.get('/suppliers/:id', { preHandler: PARTNER_READ }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const row = await prisma.supplier.findFirst({
      where: { id, companyId: req.user.companyId!, deletedAt: null },
      include: { _count: { select: { goodsReceipts: true } } },
    });
    if (!row) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบผู้จำหน่ายในบริษัทปัจจุบัน'));
    return ok(serializeSupplier(row));
  });

  app.patch('/suppliers/:id', { preHandler: PARTNER_WRITE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = z.object({
      name: z.string().trim().min(1).max(160).optional(),
      code: z.string().trim().min(1).max(40).optional(),
      phone: z.string().max(40).optional(),
      taxId: z.string().max(30).optional(),
      email: z.string().email().optional().or(z.literal('')),
      address: z.string().max(500).optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);

    const current = await prisma.supplier.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบผู้จำหน่ายในบริษัทปัจจุบัน'));

    const name = normalizeName(body.name);
    const code = normalizeCode(body.code);

    // ชื่อซ้ำในบริษัทเดียวกัน (ไม่นับตัวเอง) — กติกาเดียวกับตอน POST
    if (name && name !== current.name) {
      const dup = await prisma.supplier.findFirst({ where: { companyId, deletedAt: null, name, id: { not: id } } });
      if (dup) return reply.status(409).send(fail('DUPLICATE_SUPPLIER', duplicateMessage('supplier', 'name', name)));
    }
    // รหัสเป็น unique ทั้งระบบตาม schema จึงต้องเช็คนอก scope บริษัทด้วย
    if (code && code !== current.code) {
      const dup = await prisma.supplier.findFirst({ where: { code, id: { not: id } } });
      if (dup) return reply.status(409).send(fail('DUPLICATE_SUPPLIER', duplicateMessage('supplier', 'code', code)));
    }

    const data = buildPatch({
      name, code,
      phone: optionalText(body.phone),
      taxId: optionalText(body.taxId),
      email: optionalText(body.email),
      address: optionalText(body.address),
      isActive: body.isActive,
    });
    if (Object.keys(data).length === 0) return ok(serializeSupplier({ ...current, _count: { goodsReceipts: 0 } }));

    let updated;
    try {
      updated = await prisma.supplier.update({ where: { id }, data, include: { _count: { select: { goodsReceipts: true } } } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send(fail('DUPLICATE_SUPPLIER', duplicateMessage('supplier', 'code', code ?? current.code)));
      }
      throw error;
    }
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'SUPPLIER_UPDATED', entity: 'Supplier', entityId: id, before: { code: current.code, name: current.name, isActive: current.isActive }, after: { code: updated.code, name: updated.name, isActive: updated.isActive } } });
    return ok(serializeSupplier(updated), 'บันทึกข้อมูลผู้จำหน่ายแล้ว');
  });

  // ---------- WAREHOUSES ----------
  app.get('/warehouses', { preHandler: PARTNER_READ }, async (req) => {
    const q = partnerListQuery.parse(req.query ?? {});
    const companyId = req.user.companyId!;
    const [rows, stock] = await Promise.all([
      prisma.warehouse.findMany({
        where: { companyId, deletedAt: null, ...statusWhere(q.status), ...searchWhere(q.keyword) },
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      }),
      warehouseStockMap(companyId),
    ]);
    return ok(rows.map((w) => serializeWarehouse(w, stock.get(w.id))));
  });

  app.get('/warehouses/:id', { preHandler: PARTNER_READ }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const row = await prisma.warehouse.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!row) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบคลังในบริษัทปัจจุบัน'));
    const stock = await warehouseStockMap(companyId);
    return ok(serializeWarehouse(row, stock.get(id)));
  });

  app.patch('/warehouses/:id', { preHandler: PARTNER_WRITE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = z.object({
      name: z.string().trim().min(1).max(160).optional(),
      code: z.string().trim().min(1).max(40).optional(),
      type: z.nativeEnum(ItemType).nullable().optional(),
      isActive: z.boolean().optional(),
    }).parse(req.body);

    const current = await prisma.warehouse.findFirst({ where: { id, companyId, deletedAt: null } });
    if (!current) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบคลังในบริษัทปัจจุบัน'));

    const name = normalizeName(body.name);
    const code = normalizeCode(body.code);

    if (name && name !== current.name) {
      const dup = await prisma.warehouse.findFirst({ where: { companyId, deletedAt: null, name, id: { not: id } } });
      if (dup) return reply.status(409).send(fail('DUPLICATE_WAREHOUSE', duplicateMessage('warehouse', 'name', name)));
    }
    if (code && code !== current.code) {
      const dup = await prisma.warehouse.findFirst({ where: { code, id: { not: id } } });
      if (dup) return reply.status(409).send(fail('DUPLICATE_WAREHOUSE', duplicateMessage('warehouse', 'code', code)));
    }

    // ปิดใช้งานคลังที่ยังมีของ = บล็อก และคืนยอดจริงไปให้ UI แสดง
    // ห้ามล้าง/ย้ายสต็อกอัตโนมัติ ผู้ใช้ต้องเคลียร์ผ่านเอกสารปกติเอง
    if (body.isActive === false && current.isActive) {
      const stock = await warehouseStockMap(companyId);
      const block = warehouseDeactivateBlock(stock.get(id));
      if (block) return reply.status(409).send(fail(block.code, block.message, { onHand: block.onHand, reserved: block.reserved, itemCount: block.itemCount }));
    }

    const data = buildPatch({ name, code, type: body.type, isActive: body.isActive });
    if (Object.keys(data).length === 0) return ok(serializeWarehouse(current, undefined));

    let updated;
    try {
      updated = await prisma.warehouse.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send(fail('DUPLICATE_WAREHOUSE', duplicateMessage('warehouse', 'code', code ?? current.code)));
      }
      throw error;
    }
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'WAREHOUSE_UPDATED', entity: 'Warehouse', entityId: id, before: { code: current.code, name: current.name, isActive: current.isActive }, after: { code: updated.code, name: updated.name, isActive: updated.isActive } } });
    const stock = await warehouseStockMap(companyId);
    return ok(serializeWarehouse(updated, stock.get(id)), 'บันทึกข้อมูลคลังแล้ว');
  });

  // ---- Inline master-data creation จากหน้ารับของ (Issue 5) — persist + auto-select ----
  // สร้างคลังใหม่ (reusable) — ไม่เก็บเป็น free text ในเอกสารรับของ
  app.post('/warehouses', { preHandler: requirePermission('RECEIVING_CREATE') }, async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(160), code: z.string().trim().max(40).optional(), type: z.nativeEnum(ItemType).optional() }).parse(req.body);
    const companyId = req.user.companyId!;
    const dup = await prisma.warehouse.findFirst({ where: { companyId, deletedAt: null, name: body.name } });
    if (dup) return reply.status(409).send(fail('DUPLICATE_WAREHOUSE', 'มีคลังชื่อนี้อยู่แล้ว'));
    const create = (code: string) => prisma.warehouse.create({ data: { companyId, code, name: body.name, type: body.type ?? null } });
    let warehouse;
    try { warehouse = await create(body.code?.trim() || `WH-${Date.now().toString().slice(-6)}`); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (body.code?.trim()) return reply.status(409).send(fail('DUPLICATE_WAREHOUSE', 'มีรหัสคลังนี้อยู่แล้ว'));
        warehouse = await create(`WH-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`);
      } else throw error;
    }
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'WAREHOUSE_CREATED', entity: 'Warehouse', entityId: warehouse.id, after: { code: warehouse.code, name: warehouse.name } } });
    return reply.status(201).send(ok({ id: warehouse.id, code: warehouse.code, name: warehouse.name }, 'เพิ่มคลังใหม่แล้ว'));
  });

  // สร้างซัพพลายเออร์ใหม่ (reusable)
  app.post('/suppliers', { preHandler: requirePermission('RECEIVING_CREATE') }, async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(160), code: z.string().trim().max(40).optional(), phone: z.string().max(40).optional(), taxId: z.string().max(30).optional(), email: z.string().email().optional().or(z.literal('')), address: z.string().max(500).optional() }).parse(req.body);
    const companyId = req.user.companyId!;
    const dup = await prisma.supplier.findFirst({ where: { companyId, deletedAt: null, name: body.name } });
    if (dup) return reply.status(409).send(fail('DUPLICATE_SUPPLIER', 'มีซัพพลายเออร์ชื่อนี้อยู่แล้ว'));
    const create = (code: string) => prisma.supplier.create({ data: { companyId, code, name: body.name, phone: body.phone ?? null, taxId: body.taxId ?? null, email: body.email || null, address: body.address ?? null } });
    let supplier;
    try { supplier = await create(body.code?.trim() || `SUP-${Date.now().toString().slice(-6)}`); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (body.code?.trim()) return reply.status(409).send(fail('DUPLICATE_SUPPLIER', 'มีรหัสซัพพลายเออร์นี้อยู่แล้ว'));
        supplier = await create(`SUP-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`);
      } else throw error;
    }
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'SUPPLIER_CREATED', entity: 'Supplier', entityId: supplier.id, after: { code: supplier.code, name: supplier.name } } });
    return reply.status(201).send(ok({ id: supplier.id, code: supplier.code, name: supplier.name }, 'เพิ่มซัพพลายเออร์ใหม่แล้ว'));
  });

  // สร้างสินค้า/วัตถุดิบใหม่จากหน้ารับของ (ข้อมูลขั้นต่ำที่ไม่ทำให้ต้นทุน/สต๊อกพัง)
  app.post('/receiving-items', { preHandler: requirePermission('RECEIVING_CREATE') }, async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(1).max(120), code: z.string().trim().max(40).optional(), type: z.nativeEnum(ItemType).default(ItemType.RAW_MATERIAL), baseUnitId: z.string().min(1, 'ต้องระบุหน่วยฐาน'), purchaseUnitId: z.string().optional(), purchaseToBaseFactor: z.coerce.number().positive().default(1) }).parse(req.body);
    const companyId = req.user.companyId!;
    const unit = await prisma.unit.findFirst({ where: { id: body.baseUnitId, isActive: true, deletedAt: null } });
    if (!unit) return reply.status(400).send(fail('VALIDATION_ERROR', 'ไม่พบหน่วยฐานที่เลือก'));

    /* PHASE 20B — เส้นทางนี้เคยเขียนอัตราแปลงลงฐานโดยไม่ตรวจอะไรเลย
       จึงเป็นช่องที่ค่าผิดทิศ (KG→G = 0.001) เล็ดลอดเข้าไปได้ ทั้งที่หน้าวัตถุดิบกันไว้แล้ว
       ใช้ด่านกลางตัวเดียวกับ /api/items เพื่อไม่ให้มีกติกาสองชุด */
    const conflict = await checkStandardFactor(
      body.baseUnitId, body.purchaseUnitId, body.purchaseToBaseFactor,
      async () => (await prisma.unitConversion.findMany({ select: { fromUnitId: true, toUnitId: true, factor: true } }))
        .map((e) => ({ fromUnitId: e.fromUnitId, toUnitId: e.toUnitId, factor: num(e.factor) })),
    );
    if (conflict) return reply.status(400).send(fail('CONVERSION_FACTOR_CONFLICT', factorConflictMessage(conflict)));
    const create = (code: string) => prisma.item.create({ data: { companyId, code, name: body.name, type: body.type, baseUnitId: body.baseUnitId, purchaseUnitId: body.purchaseUnitId ?? null, purchaseToBaseFactor: new Prisma.Decimal(body.purchaseToBaseFactor), createdById: req.user.sub, updatedById: req.user.sub }, include: { baseUnit: { select: { code: true, name: true } } } });
    let item;
    try { item = await create(body.code?.trim() || `ITM-${Date.now().toString().slice(-6)}`); }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (body.code?.trim()) return reply.status(409).send(fail('DUPLICATE_ITEM', 'มีรหัสสินค้านี้อยู่แล้ว'));
        item = await create(`ITM-${Date.now().toString().slice(-6)}-${Math.floor(Math.random() * 900 + 100)}`);
      } else throw error;
    }
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'ITEM_CREATED', entity: 'Item', entityId: item.id, after: { code: item.code, name: item.name, source: 'RECEIVING' } } });
    return reply.status(201).send(ok({ id: item.id, code: item.code, name: item.name, type: item.type, baseUnit: item.baseUnit }, 'เพิ่มรายการใหม่แล้ว'));
  });

  app.get('/receiving', { preHandler: requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE') }, async (req) => {
    const q = receivingFilterSchema.parse(req.query ?? {});
    const rows = await prisma.goodsReceipt.findMany({
      where: receivingWhere(req.user.companyId!, q),
      orderBy: { receiptDate: 'desc' },
      include: { supplier: true, warehouse: true, purchaseOrder: { select: { id: true, poNo: true, status: true } }, items: { include: { item: true, purchaseOrderItem: true } } },
    });
    return ok(rows);
  });

  app.get('/receiving/:id', { preHandler: requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId: req.user.companyId! }, include: { supplier: true, warehouse: true, purchaseOrder: { select: { id: true, poNo: true, status: true } }, items: { include: { item: { include: { baseUnit: true, purchaseUnit: true } }, purchaseOrderItem: true } } } });
    return receipt ? ok(receipt) : reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบรายการรับของในบริษัทปัจจุบัน'));
  });

  app.get('/stock-issues', { preHandler: requirePermission('STOCK_ISSUE_VIEW', 'STOCK_ISSUE_CREATE') }, async (req) => ok(await prisma.stockIssue.findMany({
    where: { companyId: req.user.companyId! }, include: { order: { select: { orderNo: true, customer: { select: { name: true } } } }, createdBy: { select: { fullName: true } }, items: { include: { lotAllocations: true } } }, orderBy: [{ issueDate: 'desc' }, { createdAt: 'desc' }], take: 200,
  })));

  app.get('/stock-issues/:id', { preHandler: requirePermission('STOCK_ISSUE_VIEW', 'STOCK_ISSUE_CREATE') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const issue = await prisma.stockIssue.findFirst({ where: { id, companyId: req.user.companyId! }, include: { order: { include: { customer: true } }, createdBy: { select: { fullName: true } }, items: { include: { lotAllocations: { include: { lot: true } } } } } });
    if (!issue) return reply.status(404).send(fail('STOCK_ISSUE_NOT_FOUND', 'ไม่พบรายการเบิกของในบริษัทปัจจุบัน'));
    // เติมชื่อสินค้า/คลัง ให้หน้ารายละเอียดแสดงได้ครบโดยไม่ต้องยิงหลายรอบ
    const [warehouse, itemRows] = await Promise.all([
      prisma.warehouse.findUnique({ where: { id: issue.warehouseId }, select: { id: true, code: true, name: true } }),
      prisma.item.findMany({ where: { id: { in: issue.items.map((l) => l.itemId) } }, select: { id: true, code: true, name: true, type: true, baseUnit: { select: { code: true } } } }),
    ]);
    const itemOf = new Map(itemRows.map((i) => [i.id, i]));
    return ok({
      ...issue,
      warehouse,
      items: issue.items.map((l) => ({ ...l, item: itemOf.get(l.itemId) ?? null })),
    });
  });

  app.get('/company', { preHandler: requirePermission('SYSTEM_SETTINGS') }, async (req, reply) => {
    const company = await prisma.company.findUnique({ where: { id: req.user.companyId! } });
    if (!company) return reply.status(404).send(fail('COMPANY_NOT_FOUND', 'ไม่พบบริษัท'));
    return ok({ ...company, providers: { email: notificationChannels.email.configured(), line: notificationChannels.line.configured() } });
  });

  app.patch('/company', { preHandler: requirePermission('SYSTEM_SETTINGS') }, async (req) => {
    const body = z.object({ nameTh: z.string().trim().min(1).max(160), nameEn: z.string().trim().max(160).nullable().optional(), logoUrl: z.string().max(500).nullable().optional(), taxId: z.string().max(30).nullable().optional(), address: z.string().max(500).nullable().optional(), phone: z.string().max(40).nullable().optional(), email: z.string().email().nullable().optional(), website: z.string().max(250).nullable().optional(), lineId: z.string().max(120).nullable().optional(), authorizedName: z.string().max(160).nullable().optional(), documentFooter: z.string().max(500).nullable().optional() }).parse(req.body);
    const before = await prisma.company.findUniqueOrThrow({ where: { id: req.user.companyId! } });
    const company = await prisma.company.update({ where: { id: before.id }, data: body });
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId: before.id, action: 'UPDATE', entity: 'CompanySettings', entityId: before.id, before, after: company } });
    return ok(company);
  });

  app.get('/customers', { preHandler: requirePermission('CUSTOMER_VIEW') }, async (req) => {
    // hasOrders=1 → เฉพาะลูกค้าที่เคยมีออเดอร์จริง (ใช้ในหน้ารายชื่อลูกค้า) · ไม่ส่ง → คืนทั้งหมด (ใช้ในตัวเลือกตอนสร้างออเดอร์)
    const { hasOrders } = z.object({ hasOrders: z.enum(['0', '1']).optional() }).parse(req.query ?? {});
    const customers = await prisma.customer.findMany({
      where: { companyId: req.user.companyId!, isActive: true, ...(hasOrders === '1' ? { orders: { some: {} } } : {}) },
      include: { orders: { select: { id: true, orderNo: true, deliveryDate: true, status: true, totalAmount: true }, orderBy: { deliveryDate: 'desc' } } },
      orderBy: { name: 'asc' },
    });
    return ok(customers.map(({ orders, ...customer }) => ({ ...customer, orderCount: orders.length, lastOrder: orders[0] ?? null, deliveredSales: orders.filter((order) => order.status === 'DELIVERED').reduce((sum, order) => sum.plus(order.totalAmount), new Prisma.Decimal(0)), upcomingOrders: orders.filter((order) => !['DELIVERED','CANCELLED'].includes(order.status) && order.deliveryDate >= new Date()).length })));
  });
  app.post('/customers', { preHandler: requirePermission('CUSTOMER_CREATE') }, async (req, reply) => {
    const body = customerSchema.parse(req.body);
    const companyId = req.user.companyId!;
    // ออกรหัสอัตโนมัติเมื่อไม่ได้ระบุ (รองรับเพิ่มลูกค้าด่วนที่ใช้เพียงชื่อ) — ไม่ชนกับรหัสเดิมในบริษัท
    let code = body.code?.trim();
    if (!code) {
      const count = await prisma.customer.count({ where: { companyId } });
      code = `CUS-${String(count + 1).padStart(5, '0')}`;
    }
    const { code: _ignore, ...rest } = body;
    void _ignore;
    let customer;
    try {
      customer = await prisma.customer.create({ data: { ...rest, code, email: body.email || null, companyId } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // รหัสซ้ำในบริษัท: ถ้าเป็นรหัสที่ผู้ใช้กรอกเอง → แจ้งซ้ำ; ถ้าออกอัตโนมัติ → เติม suffix แล้วลองใหม่ครั้งเดียว
        if (body.code?.trim()) return reply.status(409).send(fail('DUPLICATE_CUSTOMER', 'มีรหัสลูกค้านี้อยู่แล้วในบริษัท'));
        customer = await prisma.customer.create({ data: { ...rest, code: `${code}-${Date.now().toString().slice(-4)}`, email: body.email || null, companyId } });
      } else throw error;
    }
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'CUSTOMER_CREATED', entity: 'Customer', entityId: customer.id, after: { code: customer.code, name: customer.name } } });
    return reply.status(201).send(ok(customer, 'เพิ่มลูกค้าสำเร็จ'));
  });

  // นำลูกค้าออกจากรายชื่อแบบปลอดภัย (soft archive) — ประวัติออเดอร์เดิมยังคงอยู่เสมอ
  app.post('/customers/:id/archive', { preHandler: requirePermission('CUSTOMER_EDIT') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const customer = await prisma.customer.findFirst({ where: { id, companyId } });
    if (!customer) return reply.status(404).send(fail('CUSTOMER_NOT_FOUND', 'ไม่พบลูกค้าในบริษัทปัจจุบัน'));
    if (!customer.isActive) return ok(customer);
    const orderCount = await prisma.salesOrder.count({ where: { customerId: id } });
    const archived = await prisma.customer.update({ where: { id }, data: { isActive: false } });
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'CUSTOMER_ARCHIVED', entity: 'Customer', entityId: id, before: { isActive: true }, after: { isActive: false, preservedOrders: orderCount } } });
    return ok(archived, 'นำลูกค้าออกจากรายชื่อแล้ว');
  });

  app.get('/orders', { preHandler: requirePermission('ORDER_VIEW') }, async (req) => ok(await prisma.salesOrder.findMany({ where: { companyId: req.user.companyId! }, include: { customer: true, items: true }, orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'desc' }] })));
  app.post('/orders', { preHandler: requirePermission('ORDER_CREATE') }, async (req, reply) => {
    const body = orderSchema.parse(req.body); const companyId = req.user.companyId!;
    const customer = await prisma.customer.findFirst({ where: { id: body.customerId, companyId } });
    if (!customer) return reply.status(404).send(fail('CUSTOMER_NOT_FOUND', 'ไม่พบลูกค้าในบริษัทปัจจุบัน'));
    if (body.idempotencyKey) { const existing = await prisma.salesOrder.findFirst({ where: { companyId, idempotencyKey: body.idempotencyKey }, include: { items: true } }); if (existing) return ok(existing); }
    const subtotal = body.items.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.quantity).mul(item.unitPrice)), new Prisma.Decimal(0));
    const totalAmount = Prisma.Decimal.max(0, subtotal.minus(body.discount).plus(body.tax));
    const order = await numberedTransaction(async (tx) => {
      /* PHASE 16 — เดิมออกเลขจาก count() ทำให้สองคำขอพร้อมกันได้เลขเดียวกันแล้วชน unique([companyId, orderNo])
         ต้องเป็นคำสั่งแรกของ transaction เสมอ ดูเหตุผลที่ allocateSeq ใน inventory-ledger */
      const orderNo = await nextOrderNo(tx, companyId);
      const created = await tx.salesOrder.create({ data: { companyId, orderNo, customerId: customer.id, deliveryDate: body.deliveryDate, deliveryTime: body.deliveryTime, contactName: body.contactName ?? customer.contactName, phone: body.phone ?? customer.phone, email: body.email || customer.email, deliveryAddress: body.deliveryAddress ?? customer.address, subtotal, discount: body.discount, tax: body.tax, totalAmount, note: body.note, priceTier: body.priceTier ?? null, idempotencyKey: body.idempotencyKey, createdByUserId: req.user.sub, items: { create: body.items.map((item) => ({ ...item, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: new Prisma.Decimal(item.quantity).mul(item.unitPrice) })) } }, include: { items: true, customer: true } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'CREATE', entity: 'SalesOrder', entityId: created.id } });
      return created;
    });
    return reply.status(201).send(ok(order));
  });

  // ============================================================
  // PHASE 8B — Customer / Order detail + update
  // เปิด contract ที่ frontend ต้องใช้ โดยไม่แตะ lifecycle และไม่แตะราคาที่บันทึกไว้แล้ว
  // ============================================================

  /** ข้อมูลลูกค้ารายเดียว + ออเดอร์ล่าสุดแบบเบา — ไม่ดึงออเดอร์ทั้งบริษัท */
  app.get('/customers/:id', { preHandler: requirePermission('CUSTOMER_VIEW') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const customer = await prisma.customer.findFirst({
      where: { id, companyId },
      include: {
        orders: {
          select: { id: true, orderNo: true, deliveryDate: true, status: true, totalAmount: true, priceTier: true },
          orderBy: { deliveryDate: 'desc' },
          take: 10,
        },
      },
    });
    if (!customer) return reply.status(404).send(fail('CUSTOMER_NOT_FOUND', 'ไม่พบข้อมูลลูกค้าในบริษัทปัจจุบัน'));

    // ตัวเลขสรุปนับจากฐานข้อมูลโดยตรง ไม่ใช่จากรายการ 10 ใบด้านบน
    const [orderCount, deliveredAgg, upcomingOrders] = await Promise.all([
      prisma.salesOrder.count({ where: { customerId: id, companyId } }),
      prisma.salesOrder.aggregate({ where: { customerId: id, companyId, status: 'DELIVERED' }, _sum: { totalAmount: true } }),
      prisma.salesOrder.count({ where: { customerId: id, companyId, status: { notIn: ['DELIVERED', 'CANCELLED'] }, deliveryDate: { gte: new Date() } } }),
    ]);

    const { orders, ...rest } = customer;
    return ok({
      ...rest,
      orderCount,
      upcomingOrders,
      deliveredSales: deliveredAgg._sum.totalAmount ?? 0,
      recentOrders: orders,
    });
  });

  /** แก้ไขข้อมูลทะเบียนลูกค้า — ไม่กระทบออเดอร์เดิม */
  app.patch('/customers/:id', { preHandler: requirePermission('CUSTOMER_EDIT') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = customerSchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);

    const current = await prisma.customer.findFirst({ where: { id, companyId } });
    if (!current) return reply.status(404).send(fail('CUSTOMER_NOT_FOUND', 'ไม่พบข้อมูลลูกค้าในบริษัทปัจจุบัน'));

    // รหัสลูกค้า unique ต่อบริษัท (@@unique([companyId, code]))
    const code = body.code?.trim();
    if (code && code !== current.code) {
      const dup = await prisma.customer.findFirst({ where: { companyId, code, id: { not: id } } });
      if (dup) return reply.status(409).send(fail('DUPLICATE_CUSTOMER', `มีรหัสลูกค้า ${code} อยู่แล้วในบริษัท`));
    }

    const data: Prisma.CustomerUpdateInput = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (code !== undefined) data.code = code;
    for (const key of ['customerType', 'contactName', 'phone', 'address', 'taxId', 'note', 'billingAddress', 'lineId', 'branch'] as const) {
      if (body[key] !== undefined) data[key] = body[key]?.trim() || null;
    }
    if (body.email !== undefined) data.email = body.email || null;
    if (body.isActive !== undefined) data.isActive = body.isActive;
    if (Object.keys(data).length === 0) return ok(current);

    let updated;
    try {
      updated = await prisma.customer.update({ where: { id }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return reply.status(409).send(fail('DUPLICATE_CUSTOMER', 'มีรหัสลูกค้านี้อยู่แล้วในบริษัท'));
      }
      throw error;
    }
    await prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'CUSTOMER_UPDATED', entity: 'Customer', entityId: id, before: { code: current.code, name: current.name, isActive: current.isActive }, after: { code: updated.code, name: updated.name, isActive: updated.isActive } } });
    return ok(updated, 'บันทึกข้อมูลลูกค้าแล้ว');
  });

  /** ออเดอร์ใบเดียวพร้อมรายการ — frontend ไม่ต้องโหลดออเดอร์ทั้งระบบอีกต่อไป */
  app.get('/orders/:id', { preHandler: requirePermission('ORDER_VIEW') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const order = await prisma.salesOrder.findFirst({
      where: { id, companyId: req.user.companyId! },
      include: { customer: true, items: true, createdBy: { select: { fullName: true } } },
    });
    if (!order) return reply.status(404).send(fail('ORDER_NOT_FOUND', 'ไม่พบออเดอร์ในบริษัทปัจจุบัน'));
    return ok(order);
  });

  /**
   * แก้ไขออเดอร์ที่ยังเป็นร่างเท่านั้น
   * - ใช้ id/orderNo/createdAt เดิม ไม่สร้างใบใหม่ ไม่ออกเลขใหม่
   * - ยอดทั้งหมดคำนวณฝั่ง server ด้วยสูตรเดียวกับตอนสร้าง ไม่เชื่อ lineTotal จาก frontend
   * - ทำใน transaction เดียว ไม่มีการบันทึกครึ่ง ๆ
   */
  app.patch('/orders/:id', { preHandler: requirePermission('ORDER_CREATE', 'ORDER_EDIT') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = orderSchema.partial().omit({ idempotencyKey: true }).parse(req.body);

    const current = await prisma.salesOrder.findFirst({ where: { id, companyId } });
    if (!current) return reply.status(404).send(fail('ORDER_NOT_FOUND', 'ไม่พบออเดอร์ในบริษัทปัจจุบัน'));
    // ยืนยันแล้วถือเป็นเอกสารทางการเงิน แก้รายการไม่ได้อีก
    if (current.status !== 'DRAFT') {
      return reply.status(409).send(fail('ORDER_NOT_EDITABLE', 'ออเดอร์นี้ยืนยันแล้ว จึงไม่สามารถแก้ไขรายการได้'));
    }

    if (body.customerId && body.customerId !== current.customerId) {
      const customer = await prisma.customer.findFirst({ where: { id: body.customerId, companyId } });
      if (!customer) return reply.status(404).send(fail('CUSTOMER_NOT_FOUND', 'ไม่พบข้อมูลลูกค้าในบริษัทปัจจุบัน'));
    }

    // ยอดเงิน: ถ้าส่งรายการมาใหม่ให้คิดจากรายการใหม่ ถ้าไม่ส่งให้คงยอดเดิมไว้
    const discount = new Prisma.Decimal(body.discount ?? current.discount);
    const tax = new Prisma.Decimal(body.tax ?? current.tax);
    let subtotal = new Prisma.Decimal(current.subtotal);
    if (body.items) {
      subtotal = body.items.reduce((sum, item) => sum.plus(new Prisma.Decimal(item.quantity).mul(item.unitPrice)), new Prisma.Decimal(0));
    }
    const totalAmount = Prisma.Decimal.max(0, subtotal.minus(discount).plus(tax));

    const updated = await prisma.$transaction(async (tx) => {
      if (body.items) {
        // ร่างยังไม่เป็นประวัติศาสตร์ จึงแทนที่ทั้งชุดได้ แล้วเขียน snapshot ใหม่จากที่ส่งมา
        await tx.salesOrderItem.deleteMany({ where: { orderId: id } });
        await tx.salesOrderItem.createMany({
          data: body.items.map((item) => ({
            orderId: id, menuId: item.menuId, menuNameSnapshot: item.menuNameSnapshot,
            quantity: new Prisma.Decimal(item.quantity), unit: item.unit,
            unitPrice: new Prisma.Decimal(item.unitPrice),
            lineTotal: new Prisma.Decimal(item.quantity).mul(item.unitPrice),
            note: item.note ?? null,
          })),
        });
      }
      const changed = await tx.salesOrder.update({
        where: { id },
        data: {
          ...(body.customerId ? { customerId: body.customerId } : {}),
          ...(body.deliveryDate ? { deliveryDate: body.deliveryDate } : {}),
          ...(body.deliveryTime !== undefined ? { deliveryTime: body.deliveryTime } : {}),
          ...(body.contactName !== undefined ? { contactName: body.contactName } : {}),
          ...(body.phone !== undefined ? { phone: body.phone } : {}),
          ...(body.email !== undefined ? { email: body.email || null } : {}),
          ...(body.deliveryAddress !== undefined ? { deliveryAddress: body.deliveryAddress } : {}),
          ...(body.note !== undefined ? { note: body.note } : {}),
          ...(body.priceTier !== undefined ? { priceTier: body.priceTier } : {}),
          subtotal, discount, tax, totalAmount,
        },
        include: { customer: true, items: true },
      });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'UPDATE', entity: 'SalesOrder', entityId: id, before: { subtotal: current.subtotal.toString(), totalAmount: current.totalAmount.toString() }, after: { subtotal: subtotal.toString(), totalAmount: totalAmount.toString() } } });
      return changed;
    });
    return ok(updated, 'บันทึกร่างออเดอร์แล้ว');
  });

  app.post('/orders/:id/transition', { preHandler: requirePermission('ORDER_CONFIRM', 'ORDER_SEND', 'ORDER_COMPLETE', 'ORDER_CANCEL') }, async (req, reply) => {
    const { id } = req.params as { id: string }; const { status, cancellationReason } = z.object({ status: z.nativeEnum(SalesOrderStatus), cancellationReason: z.string().max(500).optional() }).parse(req.body); const companyId = req.user.companyId!;
    const order = await prisma.salesOrder.findFirst({ where: { id, companyId } });
    if (!order) return reply.status(404).send(fail('ORDER_NOT_FOUND', 'ไม่พบออเดอร์ในบริษัทปัจจุบัน'));
    if (order.status === status) return ok(order);
    if (!transitions[order.status].includes(status)) return reply.status(409).send(fail('INVALID_TRANSITION', `ไม่สามารถเปลี่ยนสถานะจาก ${order.status} เป็น ${status}`));
    if (status === 'CANCELLED' && !cancellationReason?.trim()) return reply.status(400).send(fail('CANCELLATION_REASON_REQUIRED', 'กรุณาระบุเหตุผลการยกเลิก'));
    const updated = await prisma.$transaction(async (tx) => {
      const changed = await tx.salesOrder.update({ where: { id }, data: { status, cancellationReason, ...timestampFor(status) } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STATUS_CHANGE', entity: 'SalesOrder', entityId: id, before: { status: order.status }, after: { status } } });
      if (status === 'SENT_TO_PREP') {
        const recipients = await tx.companyMembership.findMany({ where: { companyId, isActive: true, role: { name: 'OPERATIONS' } } });
        if (recipients.length) await tx.notification.createMany({ data: recipients.map(({ userId }) => ({ companyId, userId, type: 'ORDER_SENT_TO_PREP', severity: 'ACTION_REQUIRED', title: 'มีออเดอร์ใหม่รอเตรียม', message: `${order.orderNo} ถูกส่งให้ฝ่ายปฏิบัติการ`, entityType: 'SalesOrder', entityId: id, actionUrl: `/orders/${id}` })) });
      }
      return changed;
    });
    return ok(updated);
  });

  app.get('/orders/:id/demand', { preHandler: requirePermission('ORDER_VIEW') }, async (req, reply) => {
    const { id } = req.params as { id: string }; const companyId = req.user.companyId!;
    const order = await prisma.salesOrder.findFirst({ where: { id, companyId }, include: { items: true } });
    if (!order) return reply.status(404).send(fail('ORDER_NOT_FOUND', 'ไม่พบออเดอร์ในบริษัทปัจจุบัน'));
    const demand = new Map<string, StockDemand>(); const warnings: string[] = [];
    for (const line of order.items) {
      const recipe = await prisma.recipe.findFirst({ where: { companyId, productId: line.menuId, deletedAt: null }, include: { versions: { where: { isActive: true }, take: 1, include: { ingredients: { include: { item: true, unit: true } } } } } });
      const version = recipe?.versions[0]; if (!version) { warnings.push(`เมนู ${line.menuNameSnapshot} ยังไม่มีสูตรที่ใช้งาน`); continue; }
      await expandRecipeDemand(companyId, recipe.id, line.quantity, demand, warnings);
    }
    return ok({ items: [...demand.values()].map((item) => ({ ...item, quantity: item.quantity.toString() })), warnings });
  });

  app.get('/kpi', { preHandler: requirePermission('KPI_VIEW', 'DASHBOARD_VIEW') }, async (req) => {
    const companyId = req.user.companyId!; const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1); const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const [totalOrders, todayOrders, monthOrders, deliveredToday, deliveredMonth, pending] = await Promise.all([
      prisma.salesOrder.count({ where: { companyId } }), prisma.salesOrder.count({ where: { companyId, deliveryDate: { gte: dayStart } } }), prisma.salesOrder.count({ where: { companyId, createdAt: { gte: monthStart } } }),
      prisma.salesOrder.aggregate({ where: { companyId, status: 'DELIVERED', deliveredAt: { gte: dayStart } }, _sum: { totalAmount: true } }), prisma.salesOrder.aggregate({ where: { companyId, status: 'DELIVERED', deliveredAt: { gte: monthStart } }, _sum: { totalAmount: true } }),
      prisma.salesOrder.aggregate({ where: { companyId, status: { notIn: ['DELIVERED', 'CANCELLED'] } }, _sum: { totalAmount: true } }),
    ]);
    return ok({ totalOrders, todayOrders, monthOrders, revenueToday: deliveredToday._sum.totalAmount ?? 0, revenueMonth: deliveredMonth._sum.totalAmount ?? 0, pendingRevenue: pending._sum.totalAmount ?? 0 });
  });

  app.get('/notifications', { preHandler: requirePermission('NOTIFICATION_VIEW') }, async (req) => ok(await prisma.notification.findMany({ where: { companyId: req.user.companyId!, userId: req.user.sub }, orderBy: { createdAt: 'desc' }, take: 50 })));
  app.post('/notifications/read-all', { preHandler: requirePermission('NOTIFICATION_VIEW') }, async (req) => ok(await prisma.notification.updateMany({ where: { companyId: req.user.companyId!, userId: req.user.sub, readAt: null }, data: { readAt: new Date() } })));

  /**
   * สร้างใบรับของ — เลข GR ออกโดย backend เท่านั้น
   * ค่าเริ่มต้นเป็น DRAFT (ยังไม่เพิ่มสต็อก ยังไม่อัปเดตต้นทุน) ส่ง confirm=true เพื่อยืนยันในคำขอเดียว
   */
  app.post('/receiving', { preHandler: requirePermission('RECEIVING_CREATE') }, async (req, reply) => {
    const body = z.object({
      warehouseId: z.string().min(1),
      supplierId: z.string().optional(),
      purchaseOrderId: z.string().optional(),
      supplierDocNo: z.string().max(60).optional(),
      receiptDate: z.coerce.date().default(() => new Date()),
      note: z.string().max(500).optional(),
      confirm: z.boolean().default(false),
      overReceiveAcknowledged: z.boolean().default(false),
      items: z.array(z.object({
        itemId: z.string().min(1),
        purchaseOrderItemId: z.string().optional(),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0),
        lotNo: z.string().optional(),
        manufactureDate: z.coerce.date().optional(),
        expiryDate: z.coerce.date().optional(),
      })).min(1),
    }).parse(req.body);
    const companyId = req.user.companyId!;

    try {
      const receipt = await numberedTransaction(async (tx) => {
        // PHASE 16 — ออกเลขเป็นคำสั่งแรกเสมอ ก่อนคำสั่งอ่านใด ๆ (ดูเหตุผลที่ allocateSeq ใน inventory-ledger)
        const receiptNo = await nextDocumentNo(tx, companyId, 'GOODS_RECEIPT');

        const warehouse = await tx.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
        if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');

        const itemIds = [...new Set(body.items.map((l) => l.itemId))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, deletedAt: null }, include: { baseUnit: true, purchaseUnit: true } });
        if (items.length !== itemIds.length) throw new Error('ITEM_NOT_IN_COMPANY');
        const itemOf = new Map(items.map((item) => [item.id, item]));
        const po = body.purchaseOrderId ? await tx.purchaseOrder.findFirst({ where: { id: body.purchaseOrderId, companyId }, include: { items: true } }) : null;
        if (body.purchaseOrderId && !po) throw new Error('PURCHASE_ORDER_NOT_FOUND');
        if (po && (!['CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status) || po.supplierId !== body.supplierId || po.warehouseId !== body.warehouseId)) throw new Error('PURCHASE_ORDER_MISMATCH');
        const poLineOf = new Map(po?.items.map((line) => [line.id, line]) ?? []);
        const savedLines = body.items.map((line) => {
          const item = itemOf.get(line.itemId)!; const poLine = line.purchaseOrderItemId ? poLineOf.get(line.purchaseOrderItemId) : null;
          if (po && (!poLine || poLine.itemId !== line.itemId)) throw new Error('PURCHASE_ORDER_MISMATCH');
          return { ...line, purchaseOrderItemId: poLine?.id ?? null, purchaseUnitCode: poLine?.purchaseUnitCode ?? item.purchaseUnit?.code ?? item.baseUnit.code, purchaseToBaseFactor: poLine?.purchaseToBaseFactor ?? item.purchaseToBaseFactor, totalCost: new Prisma.Decimal(line.quantity).mul(line.unitPrice) };
        });
        const created = await tx.goodsReceipt.create({
          data: {
            companyId, receiptNo, warehouseId: body.warehouseId, supplierId: body.supplierId,
            purchaseOrderId: body.purchaseOrderId ?? null,
            supplierDocNo: body.supplierDocNo, receiptDate: body.receiptDate, note: body.note,
            status: body.confirm ? 'CONFIRMED' : 'DRAFT',
            confirmedAt: body.confirm ? new Date() : null,
            createdById: req.user.sub,
            items: { create: savedLines },
          },
          include: { items: true },
        });

        if (body.confirm) { assertCanConfirm(req, 'RECEIVING_CONFIRM'); await validateReceiptOverage(tx, created.id, body.overReceiveAcknowledged); await confirmReceiptWithin(tx, created.id, companyId, req.user.sub); if (created.purchaseOrderId) await recomputePurchaseOrderStatus(tx, created.purchaseOrderId); }

        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: body.confirm ? 'GOODS_RECEIPT_CONFIRMED' : 'GOODS_RECEIPT_CREATED', entity: 'GoodsReceipt', entityId: created.id, after: { receiptNo: created.receiptNo, warehouseId: body.warehouseId, supplierId: body.supplierId ?? null, status: body.confirm ? 'CONFIRMED' : 'DRAFT' } } });
        return created;
      });
      return reply.status(201).send(ok(receipt, receipt.status === 'CONFIRMED' ? `ยืนยันรับของ ${receipt.receiptNo} และเพิ่มสต็อกแล้ว` : `บันทึกร่างใบรับของ ${receipt.receiptNo}`));
    } catch (error: unknown) {
      return receivingErrorReply(reply, error);
    }
  });

  /**
   * แก้ไขใบรับของที่ยังเป็นร่าง — อัปเดตเอกสารเดิม ไม่สร้างใบใหม่และไม่ออกเลข GR ใหม่
   * สถานะอื่น (CONFIRMED/REVERSED/CANCELLED) แก้ไม่ได้
   */
  app.patch('/receiving/:id', { preHandler: requirePermission('RECEIVING_CREATE') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      warehouseId: z.string().min(1),
      supplierId: z.string().optional().nullable(),
      purchaseOrderId: z.string().optional().nullable(),
      supplierDocNo: z.string().max(60).optional().nullable(),
      receiptDate: z.coerce.date().optional(),
      note: z.string().max(500).optional().nullable(),
      items: z.array(z.object({
        itemId: z.string().min(1),
        purchaseOrderItemId: z.string().optional().nullable(),
        quantity: z.coerce.number().positive(),
        unitPrice: z.coerce.number().min(0),
        lotNo: z.string().optional(),
        manufactureDate: z.coerce.date().optional(),
        expiryDate: z.coerce.date().optional(),
      })).min(1),
    }).parse(req.body);
    const companyId = req.user.companyId!;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const doc = await tx.goodsReceipt.findFirst({ where: { id, companyId } });
        if (!doc) throw new Error('RECEIPT_NOT_FOUND');
        if (doc.status !== 'DRAFT') throw new Error(`ALREADY_${doc.status}`);

        const warehouse = await tx.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
        if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');
        const itemIds = [...new Set(body.items.map((l) => l.itemId))];
        const found = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, deletedAt: null }, include: { baseUnit: true, purchaseUnit: true } });
        if (found.length !== itemIds.length) throw new Error('ITEM_NOT_IN_COMPANY');
        const itemOf = new Map(found.map((item) => [item.id, item]));
        const po = body.purchaseOrderId ? await tx.purchaseOrder.findFirst({ where: { id: body.purchaseOrderId, companyId }, include: { items: true } }) : null;
        if (body.purchaseOrderId && !po) throw new Error('PURCHASE_ORDER_NOT_FOUND');
        if (po && (!['CONFIRMED','PARTIALLY_RECEIVED'].includes(po.status) || po.supplierId !== body.supplierId || po.warehouseId !== body.warehouseId)) throw new Error('PURCHASE_ORDER_MISMATCH');
        const poLineOf = new Map(po?.items.map((line) => [line.id, line]) ?? []);
        const savedLines = body.items.map((line) => { const item = itemOf.get(line.itemId)!; const poLine = line.purchaseOrderItemId ? poLineOf.get(line.purchaseOrderItemId) : null; if (po && (!poLine || poLine.itemId !== line.itemId)) throw new Error('PURCHASE_ORDER_MISMATCH'); return { ...line, purchaseOrderItemId: poLine?.id ?? null, purchaseUnitCode: poLine?.purchaseUnitCode ?? item.purchaseUnit?.code ?? item.baseUnit.code, purchaseToBaseFactor: poLine?.purchaseToBaseFactor ?? item.purchaseToBaseFactor, totalCost: new Prisma.Decimal(line.quantity).mul(line.unitPrice) }; });

        // แทนที่บรรทัดทั้งชุด (ร่างยังไม่มี ledger จึงไม่กระทบสต็อก) · receiptNo คงเดิมเสมอ
        await tx.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: doc.id } });
        const saved = await tx.goodsReceipt.update({
          where: { id: doc.id },
          data: {
            warehouseId: body.warehouseId,
            supplierId: body.supplierId ?? null,
            purchaseOrderId: body.purchaseOrderId ?? null,
            supplierDocNo: body.supplierDocNo ?? null,
            ...(body.receiptDate ? { receiptDate: body.receiptDate } : {}),
            note: body.note ?? null,
            items: { create: savedLines },
          },
          include: { items: true },
        });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'GOODS_RECEIPT_UPDATED', entity: 'GoodsReceipt', entityId: doc.id, after: { receiptNo: doc.receiptNo, lines: body.items.length } } });
        return saved;
      });
      return ok(updated, `บันทึกร่าง ${updated.receiptNo} แล้ว`);
    } catch (error: unknown) {
      return receivingErrorReply(reply, error);
    }
  });

  /**
   * แก้ไขใบเบิกที่ยังเป็นร่าง — อัปเดตเอกสารเดิม ไม่ออกเลข RI ใหม่
   */
  app.patch('/stock-issues/:id', { preHandler: requirePermission('STOCK_ISSUE_CREATE') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z.object({
      warehouseId: z.string().min(1),
      orderId: z.string().optional().nullable(),
      note: z.string().max(500).optional().nullable(),
      items: z.array(z.object({
        itemId: z.string().min(1),
        requiredQty: z.coerce.number().min(0).default(0),
        issuedQty: z.coerce.number().positive(),
        unit: z.string().min(1),
        baseQty: z.coerce.number().positive(),
        note: z.string().optional(),
        allocations: z.array(z.object({ lotId: z.string().min(1), quantity: z.coerce.number().positive() })).default([]),
      })).min(1),
    }).parse(req.body);
    const companyId = req.user.companyId!;

    try {
      const updated = await prisma.$transaction(async (tx) => {
        const doc = await tx.stockIssue.findFirst({ where: { id, companyId } });
        if (!doc) throw new Error('ISSUE_NOT_FOUND');
        if (doc.status !== 'DRAFT') throw new Error(`ALREADY_${doc.status}`);

        const warehouse = await tx.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
        if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');
        const itemIds = [...new Set(body.items.map((l) => l.itemId))];
        const found = await tx.item.count({ where: { id: { in: itemIds }, companyId, deletedAt: null } });
        if (found !== itemIds.length) throw new Error('ITEM_NOT_IN_COMPANY');

        await tx.stockIssueItem.deleteMany({ where: { stockIssueId: doc.id } });
        const saved = await tx.stockIssue.update({
          where: { id: doc.id },
          data: {
            warehouseId: body.warehouseId,
            orderId: body.orderId ?? null,
            note: body.note ?? null,
            items: { create: body.items.map(({ allocations, ...line }) => ({ ...line, lotAllocations: { create: allocations } })) },
          },
          include: { items: { include: { lotAllocations: true } } },
        });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_ISSUE_UPDATED', entity: 'StockIssue', entityId: doc.id, after: { issueNo: doc.issueNo, lines: body.items.length } } });
        return saved;
      });
      return ok(updated, `บันทึกร่าง ${updated.issueNo} แล้ว`);
    } catch (error: unknown) {
      return issueErrorReply(reply, error);
    }
  });

  /** ยืนยันใบรับของที่เป็นร่าง เพิ่มสต็อกจริง + อัปเดตต้นทุน (กันยืนยันซ้ำด้วยการตรวจสถานะ) */
  app.post('/receiving/:id/confirm', { preHandler: requirePermission('RECEIVING_CONFIRM') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { overReceiveAcknowledged } = z.object({ overReceiveAcknowledged: z.boolean().default(false) }).parse(req.body ?? {});
    const companyId = req.user.companyId!;
    try {
      const receipt = await stockTransaction(async (tx) => {
        const doc = await tx.goodsReceipt.findFirst({ where: { id, companyId } });
        if (!doc) throw new Error('RECEIPT_NOT_FOUND');
        if (doc.status !== 'DRAFT') throw new Error(`ALREADY_${doc.status}`);
        await validateReceiptOverage(tx, doc.id, overReceiveAcknowledged);
        await confirmReceiptWithin(tx, doc.id, companyId, req.user.sub);
        const updated = await tx.goodsReceipt.update({ where: { id: doc.id }, data: { status: 'CONFIRMED', confirmedAt: new Date() }, include: { items: true } });
        if (doc.purchaseOrderId) await recomputePurchaseOrderStatus(tx, doc.purchaseOrderId);
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'GOODS_RECEIPT_CONFIRMED', entity: 'GoodsReceipt', entityId: doc.id, after: { receiptNo: doc.receiptNo, warehouseId: doc.warehouseId } } });
        return updated;
      });
      return ok(receipt, `ยืนยันรับของ ${receipt.receiptNo} และเพิ่มสต็อกแล้ว`);
    } catch (error: unknown) {
      return receivingErrorReply(reply, error);
    }
  });

  /** กลับรายการใบรับของ ลดสต็อกคืนด้วย movement ตรงข้าม (ไม่ลบ ledger เดิม เลข GR เดิมคงอยู่) */
  app.post('/receiving/:id/reverse', { preHandler: requirePermission('RECEIVING_CONFIRM') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    try {
      const receipt = await stockTransaction(async (tx) => {
        const doc = await tx.goodsReceipt.findFirst({ where: { id, companyId } });
        if (!doc) throw new Error('RECEIPT_NOT_FOUND');
        if (doc.status === 'DRAFT') throw new Error('NOT_CONFIRMED');
        if (doc.status === 'REVERSED' || doc.status === 'CANCELLED') throw new Error(`ALREADY_${doc.status}`);

        const restored = await reverseDocument(tx, 'GOODS_RECEIPT', doc.id, req.user.sub);
        if (restored === 0) throw new Error('ALREADY_REVERSED');
        const updated = await tx.goodsReceipt.update({ where: { id: doc.id }, data: { status: 'REVERSED', reversedAt: new Date() } });
        if (doc.purchaseOrderId) await recomputePurchaseOrderStatus(tx, doc.purchaseOrderId);
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'GOODS_RECEIPT_REVERSED', entity: 'GoodsReceipt', entityId: doc.id, after: { receiptNo: doc.receiptNo, restoredLines: restored, reason: body.reason ?? null } } });
        return updated;
      });
      return ok(receipt, `กลับรายการใบรับของ ${receipt.receiptNo} และลดสต็อกคืนแล้ว`);
    } catch (error: unknown) {
      return receivingErrorReply(reply, error);
    }
  });

  /** ส่งออก Excel ตาม filter ที่กำลังดู (ทุกผลลัพธ์ ไม่จำกัดหน้า) */
  app.get('/receiving/export.xlsx', { preHandler: requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE') }, async (req, reply) => {
    const q = receivingFilterSchema.parse(req.query ?? {});
    const companyId = req.user.companyId!;
    const receipts = await prisma.goodsReceipt.findMany({
      where: receivingWhere(companyId, q),
      orderBy: { receiptDate: 'desc' },
      include: { supplier: true, warehouse: true, items: { include: { item: { include: { baseUnit: true } } } } },
    });

    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'S2A ERP';
    workbook.company = company?.nameTh ?? 'S2A ERP';
    workbook.created = new Date();
    /* PHASE 13 — แถว 1-3 เป็นหัวรายงาน (ชื่อบริษัท / ชื่อรายงาน / วันที่ออก)
       หัวตารางจึงอยู่แถว 4 และตรึงไว้ที่ ySplit: 4 */
    const sheet = workbook.addWorksheet('รับของเข้า', { views: [{ state: 'frozen', ySplit: 4 }] });
    sheet.columns = [
      { header: 'เลขที่รับของ', key: 'receiptNo', width: 20 },
      { header: 'วันที่', key: 'date', width: 12 },
      { header: 'Supplier', key: 'supplier', width: 24 },
      { header: 'คลัง', key: 'warehouse', width: 20 },
      { header: 'รหัสสินค้า', key: 'itemCode', width: 16 },
      { header: 'ชื่อสินค้า', key: 'itemName', width: 30 },
      { header: 'ประเภท', key: 'itemType', width: 14 },
      { header: 'จำนวน', key: 'quantity', width: 12 },
      { header: 'หน่วย', key: 'unit', width: 10 },
      { header: 'ราคาต่อหน่วย', key: 'unitPrice', width: 14 },
      { header: 'ยอดรวม', key: 'total', width: 14 },
      { header: 'สถานะ', key: 'status', width: 16 },
      { header: 'ผู้รับ', key: 'receivedBy', width: 20 },
      { header: 'หมายเหตุ', key: 'note', width: 30 },
    ];
    /* หัวรายงาน — ใช้ข้อมูลบริษัทจริง ไม่มีก็ไม่ต้องขึ้นบรรทัด */
    sheet.spliceRows(1, 0, [], [], []);
    sheet.mergeCells('A1:N1'); sheet.mergeCells('A2:N2'); sheet.mergeCells('A3:N3');
    sheet.getCell('A1').value = company?.nameTh ?? 'รายงานรับของเข้า';
    sheet.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FF0B2A47' } };
    const subtitle = [company?.taxId ? `เลขประจำตัวผู้เสียภาษี ${company.taxId}` : null, company?.email].filter(Boolean).join('  ·  ');
    sheet.getCell('A2').value = subtitle || null;
    sheet.getCell('A2').font = { size: 9, color: { argb: 'FF5E6E80' } };
    sheet.getCell('A3').value = `รายงานรับของเข้า · ออกรายงาน ${new Date().toLocaleString('th-TH')}`;
    sheet.getCell('A3').font = { size: 9, color: { argb: 'FF5E6E80' } };
    sheet.getRow(1).height = 20;

    const head = sheet.getRow(4);
    head.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    head.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    head.height = 22;
    head.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0B2A47' } };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFB8934A' } } };
    });
    sheet.autoFilter = { from: 'A4', to: 'N4' };

    const userIds = [...new Set(receipts.map((r) => r.createdById).filter((x): x is string => Boolean(x)))];
    const users = userIds.length ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true } }) : [];
    const nameOf = new Map(users.map((u) => [u.id, u.fullName]));
    const statusTh: Record<string, string> = { DRAFT: 'ร่าง', CONFIRMED: 'รับเข้าสต็อกแล้ว', REVERSED: 'กลับรายการแล้ว', CANCELLED: 'ยกเลิก' };

    for (const r of receipts) {
      for (const line of r.items) {
        sheet.addRow({
          receiptNo: r.receiptNo,
          date: r.receiptDate.toISOString().slice(0, 10),
          supplier: r.supplier?.name ?? '—',
          warehouse: r.warehouse.name,
          itemCode: line.item.code,
          itemName: line.item.name,
          itemType: line.item.type === 'PACKAGING' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ',
          quantity: num(line.quantity),
          unit: line.item.baseUnit?.code ?? '',
          unitPrice: num(line.unitPrice),
          total: num(line.totalCost),
          status: statusTh[r.status] ?? r.status,
          receivedBy: r.createdById ? (nameOf.get(r.createdById) ?? '—') : '—',
          note: r.note ?? '',
        });
      }
    }
    sheet.getColumn('quantity').numFmt = '#,##0.####';
    sheet.getColumn('unitPrice').numFmt = '#,##0.00';
    sheet.getColumn('total').numFmt = '#,##0.00';
    sheet.getColumn('date').alignment = { horizontal: 'center' };

    /* สรุปท้ายรายงาน — รวมจากแถวที่ export จริงเท่านั้น */
    const lineCount = receipts.reduce((sum, r) => sum + r.items.length, 0);
    if (lineCount > 0) {
      const grand = receipts.reduce((sum, r) => sum + r.items.reduce((s, l) => s + num(l.totalCost), 0), 0);
      const totalRow = sheet.addRow({ itemName: `รวม ${lineCount} รายการ`, total: grand });
      totalRow.font = { bold: true };
      totalRow.getCell('total').numFmt = '#,##0.00';
      totalRow.eachCell((cell) => { cell.border = { top: { style: 'thin', color: { argb: 'FF0B2A47' } } }; });
    }

    const stamp = new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const buffer = await workbook.xlsx.writeBuffer();
    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', contentDisposition('attachment', `GR-receiving-${stamp.slice(0, 8)}-${stamp.slice(8, 12)}.xlsx`))
      .send(Buffer.from(buffer));
  });

  /**
   * สร้างใบเบิก — เลข RI ออกโดย backend เท่านั้น
   * ค่าเริ่มต้นเป็น DRAFT (ยังไม่ตัดสต็อก) ส่ง confirm=true เพื่อยืนยันและตัดสต็อกในคำขอเดียว
   */
  app.post('/stock-issues', { preHandler: requirePermission('STOCK_ISSUE_CREATE') }, async (req, reply) => {
    const body = z.object({
      warehouseId: z.string().min(1),
      orderId: z.string().optional(),
      note: z.string().max(500).optional(),
      idempotencyKey: z.string().min(1).max(100),
      confirm: z.boolean().default(false),
      items: z.array(z.object({
        itemId: z.string().min(1),
        requiredQty: z.coerce.number().min(0).default(0),
        issuedQty: z.coerce.number().positive(),
        unit: z.string().min(1),
        baseQty: z.coerce.number().positive(),
        note: z.string().optional(),
        allocations: z.array(z.object({ lotId: z.string().min(1), quantity: z.coerce.number().positive() })).default([]),
      })).min(1),
    }).parse(req.body);
    const companyId = req.user.companyId!;

    // idempotency: ยิงซ้ำหรือ refresh ต้องได้เอกสารเดิม ไม่สร้างใหม่และไม่ตัดสต็อกซ้ำ
    const existing = await prisma.stockIssue.findFirst({ where: { companyId, idempotencyKey: body.idempotencyKey }, include: { items: { include: { lotAllocations: true } } } });
    if (existing) return ok(existing);

    try {
      const issue = await numberedTransaction(async (tx) => {
        // PHASE 16 — ออกเลขเป็นคำสั่งแรกเสมอ ก่อนคำสั่งอ่านใด ๆ (ดูเหตุผลที่ allocateSeq ใน inventory-ledger)
        const issueNo = await nextDocumentNo(tx, companyId, 'STOCK_ISSUE');

        const warehouse = await tx.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
        if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');
        if (body.orderId && !await tx.salesOrder.findFirst({ where: { id: body.orderId, companyId } })) throw new Error('ORDER_NOT_FOUND');

        const itemIds = [...new Set(body.items.map((l) => l.itemId))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, deletedAt: null }, select: { id: true, lastCost: true, isLotTracked: true } });
        if (items.length !== itemIds.length) throw new Error('ITEM_NOT_IN_COMPANY');
        const costOf = new Map(items.map((it) => [it.id, num(it.lastCost)]));
        const created = await tx.stockIssue.create({
          data: {
            companyId, issueNo, warehouseId: body.warehouseId, orderId: body.orderId, note: body.note,
            idempotencyKey: body.idempotencyKey, createdByUserId: req.user.sub,
            status: body.confirm ? 'ISSUED' : 'DRAFT',
            issuedAt: body.confirm ? new Date() : null,
            items: { create: body.items.map(({ allocations, ...line }) => ({ ...line, lotAllocations: { create: allocations } })) },
          },
          include: { items: { include: { lotAllocations: true } } },
        });

        if (body.confirm) {
          assertCanConfirm(req, 'STOCK_ISSUE_CONFIRM');
          await lockBalancesInOrder(tx, body.warehouseId, body.items.map((line) => line.itemId));
          // ตัดสต็อกทั้งใบแบบ atomic รายการใดไม่พอ ทั้งเอกสาร rollback
          for (const line of body.items) {
            const item = items.find((row) => row.id === line.itemId)!;
            const allocations = item.isLotTracked
              ? await validateLotAllocations(tx, { companyId, warehouseId: body.warehouseId, itemId: line.itemId, requiredQty: line.baseQty, allocations: line.allocations })
              : line.allocations.length ? (() => { throw new LotPolicyError('LOT_NOT_ENABLED', 'สินค้านี้ไม่ได้เปิดการติดตาม Lot'); })() : [];
            const movements = item.isLotTracked ? allocations : [{ lotId: undefined, quantity: line.baseQty }];
            for (const allocation of movements) await applyMovement(tx, {
              companyId, warehouseId: body.warehouseId, itemId: line.itemId, lotId: allocation.lotId,
              movementType: 'PRODUCTION_ISSUE', changeQty: -allocation.quantity, unit: line.unit,
              refType: 'STOCK_ISSUE', refId: created.id, refNo: created.issueNo,
              unitCost: costOf.get(line.itemId) ?? 0, createdById: req.user.sub,
            });
          }
          if (body.orderId) await tx.salesOrder.update({ where: { id: body.orderId }, data: { status: 'ISSUED', issuedAt: new Date() } });
        }

        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: body.confirm ? 'STOCK_ISSUE_CONFIRMED' : 'STOCK_ISSUE_CREATED', entity: 'StockIssue', entityId: created.id, after: { issueNo: created.issueNo, warehouseId: body.warehouseId, status: created.status } } });
        return created;
      });
      return reply.status(201).send(ok(issue, issue.status === 'ISSUED' ? `ยืนยันใบเบิก ${issue.issueNo} และตัดสต็อกแล้ว` : `บันทึกร่างใบเบิก ${issue.issueNo}`));
    } catch (error: unknown) {
      return issueErrorReply(reply, error);
    }
  });

  /** ยืนยันใบเบิกที่เป็นร่าง ตัดสต็อกจริง (กันยืนยันซ้ำด้วยการตรวจสถานะ) */
  app.post('/stock-issues/:id/confirm', { preHandler: requirePermission('STOCK_ISSUE_CONFIRM') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    try {
      const issue = await stockTransaction(async (tx) => {
        const doc = await tx.stockIssue.findFirst({ where: { id, companyId }, include: { items: { include: { lotAllocations: true } } } });
        if (!doc) throw new Error('ISSUE_NOT_FOUND');
        if (doc.status !== 'DRAFT') throw new Error(`ALREADY_${doc.status}`);

        const costs = await tx.item.findMany({ where: { id: { in: doc.items.map((l) => l.itemId) } }, select: { id: true, lastCost: true, isLotTracked: true } });
        const costOf = new Map(costs.map((it) => [it.id, num(it.lastCost)]));
        await lockBalancesInOrder(tx, doc.warehouseId, doc.items.map((line) => line.itemId));
        for (const line of doc.items) {
          const item = costs.find((row) => row.id === line.itemId)!;
          const allocations = item.isLotTracked
            ? await validateLotAllocations(tx, { companyId, warehouseId: doc.warehouseId, itemId: line.itemId, requiredQty: num(line.baseQty), allocations: line.lotAllocations.map((row) => ({ lotId: row.lotId, quantity: num(row.quantity) })) })
            : line.lotAllocations.length ? (() => { throw new LotPolicyError('LOT_NOT_ENABLED', 'สินค้านี้ไม่ได้เปิดการติดตาม Lot'); })() : [];
          const movements = item.isLotTracked ? allocations : [{ lotId: undefined, quantity: num(line.baseQty) }];
          for (const allocation of movements) await applyMovement(tx, {
            companyId, warehouseId: doc.warehouseId, itemId: line.itemId, lotId: allocation.lotId,
            movementType: 'PRODUCTION_ISSUE', changeQty: -allocation.quantity, unit: line.unit,
            refType: 'STOCK_ISSUE', refId: doc.id, refNo: doc.issueNo,
            unitCost: costOf.get(line.itemId) ?? 0, createdById: req.user.sub,
          });
        }
        const updated = await tx.stockIssue.update({ where: { id: doc.id }, data: { status: 'ISSUED', issuedAt: new Date() }, include: { items: true } });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_ISSUE_CONFIRMED', entity: 'StockIssue', entityId: doc.id, after: { issueNo: doc.issueNo, warehouseId: doc.warehouseId } } });
        return updated;
      });
      return ok(issue, `ยืนยันใบเบิก ${issue.issueNo} และตัดสต็อกแล้ว`);
    } catch (error: unknown) {
      return issueErrorReply(reply, error);
    }
  });

  /** กลับรายการใบเบิกที่ยืนยันแล้ว คืนสต็อกด้วย movement ตรงข้าม (ไม่ลบ ledger เดิม เลขเอกสารเดิมคงอยู่) */
  app.post('/stock-issues/:id/reverse', { preHandler: requirePermission('STOCK_ISSUE_CONFIRM') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    try {
      const issue = await stockTransaction(async (tx) => {
        const doc = await tx.stockIssue.findFirst({ where: { id, companyId } });
        if (!doc) throw new Error('ISSUE_NOT_FOUND');
        if (doc.status === 'DRAFT') throw new Error('NOT_CONFIRMED');
        if (doc.status === 'REVERSED' || doc.status === 'CANCELLED') throw new Error(`ALREADY_${doc.status}`);

        const restored = await reverseDocument(tx, 'STOCK_ISSUE', doc.id, req.user.sub);
        if (restored === 0) throw new Error('ALREADY_REVERSED');
        const updated = await tx.stockIssue.update({ where: { id: doc.id }, data: { status: 'REVERSED' } });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_ISSUE_REVERSED', entity: 'StockIssue', entityId: doc.id, after: { issueNo: doc.issueNo, restoredLines: restored, reason: body.reason ?? null } } });
        return updated;
      });
      return ok(issue, `กลับรายการใบเบิก ${issue.issueNo} และคืนสต็อกแล้ว`);
    } catch (error: unknown) {
      return issueErrorReply(reply, error);
    }
  });

  /**
   * มุมมองสต็อกจริง (read-only) — ไม่มี endpoint แก้จำนวนตรง ๆ
   * available = onHand - reserved · stockValue = onHand × lastCost
   */
  app.get('/inventory', { preHandler: requirePermission('INVENTORY_VIEW', 'STOCK_VIEW') }, async (req) => {
    const q = z.object({
      warehouseId: z.string().optional(),
      type: z.nativeEnum(ItemType).optional(),
      keyword: z.string().trim().max(100).optional(),
      status: z.enum(['IN_STOCK', 'LOW', 'OUT', 'NEGATIVE']).optional(),
    }).parse(req.query ?? {});
    const companyId = req.user.companyId!;

    const balances = await prisma.stockBalance.findMany({
      where: {
        warehouse: { companyId },
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        item: {
          companyId, deletedAt: null,
          ...(q.type ? { type: q.type } : {}),
          ...(q.keyword ? { OR: [{ code: { contains: q.keyword } }, { name: { contains: q.keyword } }] } : {}),
        },
      },
      include: {
        item: { include: { baseUnit: true } },
        warehouse: { select: { id: true, code: true, name: true } },
      },
    });

    // movement ล่าสุดต่อ (item, warehouse) เพื่อแสดงคอลัมน์ "เคลื่อนไหวล่าสุด"
    const latest = await prisma.stockLedger.groupBy({
      by: ['itemId', 'warehouseId'],
      _max: { createdAt: true },
      where: { warehouse: { companyId } },
    });
    const latestOf = new Map(latest.map((l) => [`${l.itemId}|${l.warehouseId}`, l._max.createdAt?.toISOString() ?? null]));

    const rows = balances.map((b) => {
      const onHand = num(b.onHand), reserved = num(b.reserved);
      const available = onHand - reserved;
      const lastCost = num(b.item.lastCost);
      // reorderPoint/minQty เป็นค่าที่ผู้ใช้ตั้งเอง (ไม่ตั้งค่า = 0) จึงไม่เดา threshold ให้
      const threshold = Math.max(num(b.item.reorderPoint), num(b.item.minQty));
      const status = available < 0 ? 'NEGATIVE' : available === 0 ? 'OUT' : threshold > 0 && available <= threshold ? 'LOW' : 'IN_STOCK';
      return {
        itemId: b.itemId, code: b.item.code, name: b.item.name, type: b.item.type,
        warehouseId: b.warehouseId, warehouseCode: b.warehouse.code, warehouseName: b.warehouse.name,
        onHand, reserved, available,
        unit: b.item.baseUnit?.code ?? '',
        lastCost, stockValue: onHand * lastCost,
        threshold, status,
        lastMovementAt: latestOf.get(`${b.itemId}|${b.warehouseId}`) ?? null,
      };
    });

    const filtered = q.status ? rows.filter((r) => r.status === q.status) : rows;
    filtered.sort((a, b) => a.name.localeCompare(b.name, 'th'));

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    const movementsToday = await prisma.stockLedger.count({ where: { warehouse: { companyId }, createdAt: { gte: todayStart } } });

    return ok({
      rows: filtered,
      kpi: {
        itemCount: new Set(rows.map((r) => r.itemId)).size,
        totalValue: rows.reduce((s, r) => s + r.stockValue, 0),
        lowCount: rows.filter((r) => r.status === 'LOW').length,
        outCount: rows.filter((r) => r.status === 'OUT').length,
        negativeCount: rows.filter((r) => r.status === 'NEGATIVE').length,
        movementsToday,
        /** true = มีสินค้าที่ยังไม่ได้ตั้งจุดสั่งซื้อ จึงนับ "ใกล้หมด" ไม่ได้ทั้งหมด */
        thresholdMissing: rows.some((r) => r.threshold === 0),
      },
    });
  });

  /**
   * ปรับปรุงสต็อก — ทางเดียวที่แก้จำนวนได้ และต้องผ่าน ledger เสมอ
   * mode: INCREASE เพิ่ม | DECREASE ลด | SET ตั้งยอดตามที่นับจริง (ระบบคำนวณส่วนต่างเอง)
   */
  app.post('/inventory/adjustments', { preHandler: requirePermission('INVENTORY_ADJUST') }, async (req, reply) => {
    const body = z.object({
      warehouseId: z.string().min(1),
      reason: z.enum(['COUNT', 'DAMAGED', 'EXPIRED', 'LOST', 'OPENING', 'DOC_FIX', 'OTHER']),
      note: z.string().max(500).optional(),
      items: z.array(z.object({
        itemId: z.string().min(1),
        mode: z.enum(['INCREASE', 'DECREASE', 'SET']),
        quantity: z.coerce.number().min(0),
        lotId: z.string().min(1).optional().nullable(), lotNo: z.string().trim().max(80).optional().nullable(),
        manufactureDate: z.coerce.date().optional().nullable(), expiryDate: z.coerce.date().optional().nullable(),
      })).min(1),
    }).parse(req.body);
    const companyId = req.user.companyId!;

    try {
      const adjustment = await numberedTransaction(async (tx) => {
        // PHASE 16 — ออกเลขเป็นคำสั่งแรกเสมอ ก่อนคำสั่งอ่านใด ๆ (ดูเหตุผลที่ allocateSeq ใน inventory-ledger)
        const adjustmentNo = await nextDocumentNo(tx, companyId, 'STOCK_ADJUSTMENT');

        const warehouse = await tx.warehouse.findFirst({ where: { id: body.warehouseId, companyId } });
        if (!warehouse) throw new Error('WAREHOUSE_NOT_FOUND');
        const itemIds = [...new Set(body.items.map((l) => l.itemId))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, deletedAt: null }, include: { baseUnit: true } });
        if (items.length !== itemIds.length) throw new Error('ITEM_NOT_IN_COMPANY');
        const itemOf = new Map(items.map((i) => [i.id, i]));
        const doc = await tx.stockAdjustment.create({
          data: {
            companyId, adjustmentNo, warehouseId: body.warehouseId, reason: body.reason,
            note: body.note, status: 'CONFIRMED', createdById: req.user.sub,
          },
        });

        await lockBalancesInOrder(tx, body.warehouseId, body.items.map((line) => line.itemId));

        for (const line of body.items) {
          const item = itemOf.get(line.itemId)!;
          let lotId = line.lotId ?? null;
          if (item.isLotTracked) {
            if (lotId) {
              const lot = await tx.inventoryLot.findFirst({ where: { id: lotId, companyId, itemId: line.itemId } });
              if (!lot) throw new LotPolicyError('LOT_NOT_AVAILABLE', 'Lot ไม่อยู่ในบริษัทหรือสินค้าที่เลือก');
            } else {
              if (line.mode !== 'INCREASE') throw new LotPolicyError('LOT_REQUIRED', 'การลดหรือตั้งยอดสินค้าที่ติดตาม Lot ต้องเลือก Lot เดิม');
              const lotNo = assertLotPolicy(item, line.lotNo, line.manufactureDate, line.expiryDate);
              const lot = await ensureInventoryLot(tx, { companyId, itemId: line.itemId, warehouseId: body.warehouseId, lotNo: lotNo!, manufactureDate: line.manufactureDate, expiryDate: line.expiryDate, sourceType: 'ADJUSTMENT', createdById: req.user.sub });
              lotId = lot.id;
            }
          } else if (lotId || line.lotNo) throw new LotPolicyError('LOT_NOT_ENABLED', 'สินค้านี้ไม่ได้เปิดการติดตาม Lot');
          /* PHASE 17 — ต้องอ่านแบบล็อกแถว ไม่ใช่ findFirst
             โหมด SET คิดส่วนต่างจากยอดปัจจุบัน ถ้าอ่านจาก snapshot จะไปลบยอดที่คนอื่น commit ไปแล้วทิ้ง */
          const balance = await lockBalance(tx, line.itemId, body.warehouseId, lotId);
          const onHand = balance ? balance.onHand : 0;
          // SET = ตั้งยอดตามที่นับจริง → ส่วนต่างคำนวณจากยอดปัจจุบัน
          const change = line.mode === 'SET' ? line.quantity - onHand : line.mode === 'INCREASE' ? line.quantity : -line.quantity;
          if (change === 0) continue; // ไม่มีอะไรเปลี่ยน ไม่ต้องเขียน ledger

          await tx.stockAdjustmentItem.create({
            data: {
              stockAdjustmentId: doc.id, itemId: line.itemId,
              lotId,
              systemQty: new Prisma.Decimal(onHand),
              countedQty: new Prisma.Decimal(line.mode === 'SET' ? line.quantity : onHand + change),
              diffQty: new Prisma.Decimal(change),
            },
          });

          await applyMovement(tx, {
            companyId, warehouseId: body.warehouseId, itemId: line.itemId, lotId,
            movementType: change > 0 ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT',
            changeQty: change, unit: item.baseUnit?.code ?? null,
            refType: 'STOCK_ADJUSTMENT', refId: doc.id, refNo: doc.adjustmentNo,
            unitCost: num(item.lastCost), reason: body.reason, note: body.note,
            createdById: req.user.sub,
          });
        }

        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_ADJUSTED', entity: 'StockAdjustment', entityId: doc.id, after: { adjustmentNo: doc.adjustmentNo, warehouseId: body.warehouseId, reason: body.reason, lines: body.items.length } } });
        return doc;
      });
      return reply.status(201).send(ok(adjustment, `ปรับปรุงสต็อก ${adjustment.adjustmentNo} เรียบร้อย`));
    } catch (error: unknown) {
      return receivingErrorReply(reply, error);
    }
  });

  /** รายการปรับปรุงสต็อก */
  app.get('/inventory/adjustments', { preHandler: requirePermission('INVENTORY_VIEW', 'STOCK_VIEW') }, async (req) => {
    const rows = await prisma.stockAdjustment.findMany({
      where: { companyId: req.user.companyId! },
      orderBy: { adjustmentDate: 'desc' },
      take: 200,
      include: { warehouse: { select: { code: true, name: true } }, items: { include: { item: { select: { code: true, name: true } } } } },
    });
    return ok(rows);
  });

  /** กลับรายการปรับปรุงสต็อก — เขียน movement ตรงข้าม ไม่ลบประวัติ */
  app.post('/inventory/adjustments/:id/reverse', { preHandler: requirePermission('INVENTORY_ADJUST') }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const body = z.object({ reason: z.string().max(300).optional() }).parse(req.body ?? {});
    try {
      const doc = await stockTransaction(async (tx) => {
        const found = await tx.stockAdjustment.findFirst({ where: { id, companyId } });
        if (!found) throw new Error('ADJUSTMENT_NOT_FOUND');
        if (found.status === 'REVERSED') throw new Error('ALREADY_REVERSED');
        const restored = await reverseDocument(tx, 'STOCK_ADJUSTMENT', found.id, req.user.sub);
        if (restored === 0) throw new Error('ALREADY_REVERSED');
        const updated = await tx.stockAdjustment.update({ where: { id: found.id }, data: { status: 'REVERSED' } });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'STOCK_ADJUSTMENT_REVERSED', entity: 'StockAdjustment', entityId: found.id, after: { adjustmentNo: found.adjustmentNo, restoredLines: restored, reason: body.reason ?? null } } });
        return updated;
      });
      return ok(doc, `กลับรายการ ${doc.adjustmentNo} และคืนสต็อกแล้ว`);
    } catch (error: unknown) {
      return receivingErrorReply(reply, error);
    }
  });

  /** ประวัติการเคลื่อนไหวสต็อก (ledger) ดูย้อนหลังได้ตามสินค้า/คลัง/เอกสาร */
  app.get('/stock-movements', { preHandler: requirePermission('STOCK_VIEW', 'RECEIVING_VIEW') }, async (req) => {
    const q = z.object({ itemId: z.string().optional(), warehouseId: z.string().optional(), refId: z.string().optional(), take: z.coerce.number().min(1).max(500).default(200) }).parse(req.query ?? {});
    const companyId = req.user.companyId!;
    const rows = await prisma.stockLedger.findMany({
      where: {
        ...(q.itemId ? { itemId: q.itemId } : {}),
        ...(q.warehouseId ? { warehouseId: q.warehouseId } : {}),
        ...(q.refId ? { refId: q.refId } : {}),
        OR: [{ companyId }, { companyId: null, warehouse: { companyId } }],
      },
      orderBy: { createdAt: 'desc' },
      take: q.take,
      include: { item: { select: { code: true, name: true } }, warehouse: { select: { code: true, name: true } } },
    });
    return ok(rows.map((r) => ({
      id: r.id, createdAt: r.createdAt.toISOString(), movementType: r.movementType,
      refType: r.refType, refId: r.refId, refNo: r.refNo,
      itemCode: r.item.code, itemName: r.item.name,
      warehouseCode: r.warehouse.code, warehouseName: r.warehouse.name,
      beforeQty: r.beforeQty != null ? num(r.beforeQty) : null,
      qtyIn: num(r.qtyIn), qtyOut: num(r.qtyOut), balanceAfter: num(r.balanceAfter),
      unit: r.unit, reason: r.reason, note: r.note, createdById: r.createdById,
    })));
  });
}
