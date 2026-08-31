import { existsSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { writeAudit } from '../../lib/http.js';
import { requirePermission } from '../auth/auth.guard.js';
import { receiptAttachmentDir } from './receipt-attachment.route.js';
import {
  canonicalUnitText, convertExtractedLineToPurchase, ExtractionFailure, extractPdfText, normalizeDocumentText,
  normalizeTaxId, parseDocumentText, withExtractionTimeout,
} from './document-extraction.service.js';

const READ = requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE');
const WRITE = requirePermission('RECEIVING_CREATE', 'RECEIVING_EDIT');
const activeAttachments = new Set<string>();

const lineReviewSchema = z.object({
  id: z.string().min(1),
  matchedItemId: z.string().min(1).nullable(),
  matchedUnitId: z.string().min(1).nullable(),
  quantity: z.coerce.number().positive().nullable(),
  unitPrice: z.coerce.number().min(0).nullable(),
  lineTotal: z.coerce.number().min(0).nullable(),
});

const extractionInclude = {
  attachment: { select: { id: true, originalName: true, storedName: true, mimeType: true } },
  matchedSupplier: { select: { id: true, code: true, name: true } },
  lines: {
    orderBy: { position: 'asc' as const },
    include: {
      matchedItem: { select: { id: true, code: true, name: true, baseUnitId: true, purchaseUnitId: true, purchaseToBaseFactor: true, baseUnit: { select: { id: true, code: true } }, purchaseUnit: { select: { id: true, code: true } } } },
      matchedUnit: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

function diceSimilarity(a: string, b: string) {
  if (a === b) return 1;
  const grams = (value: string) => {
    const result = new Map<string, number>();
    for (let i = 0; i < value.length - 1; i += 1) result.set(value.slice(i, i + 2), (result.get(value.slice(i, i + 2)) ?? 0) + 1);
    return result;
  };
  const aa = grams(a); const bb = grams(b);
  let intersection = 0;
  for (const [gram, count] of aa) intersection += Math.min(count, bb.get(gram) ?? 0);
  const total = [...aa.values()].reduce((s, n) => s + n, 0) + [...bb.values()].reduce((s, n) => s + n, 0);
  return total ? (2 * intersection) / total : 0;
}

function matchSupplier(extracted: { supplierName?: string; supplierTaxId?: string }, suppliers: { id: string; name: string; taxId: string | null }[]) {
  const taxId = normalizeTaxId(extracted.supplierTaxId ?? '');
  if (taxId) {
    const taxMatches = suppliers.filter((supplier) => normalizeTaxId(supplier.taxId ?? '') === taxId);
    if (taxMatches.length === 1) return taxMatches[0].id;
  }
  const name = normalizeDocumentText(extracted.supplierName ?? '');
  if (!name) return null;
  const exact = suppliers.filter((supplier) => normalizeDocumentText(supplier.name) === name);
  if (exact.length === 1) return exact[0].id;
  const ranked = suppliers.map((supplier) => ({ id: supplier.id, score: diceSimilarity(name, normalizeDocumentText(supplier.name)) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 0.92 && ranked[0].score - (ranked[1]?.score ?? 0) >= 0.08 ? ranked[0].id : null;
}

function matchItem(line: { extractedItemCode?: string; rawDescription: string }, items: { id: string; code: string; name: string }[]) {
  const code = normalizeDocumentText(line.extractedItemCode ?? '');
  if (code) {
    const matches = items.filter((item) => normalizeDocumentText(item.code) === code);
    if (matches.length === 1) return { itemId: matches[0].id, status: 'MATCHED' };
    if (matches.length > 1) return { itemId: null, status: 'AMBIGUOUS' };
  }
  const name = normalizeDocumentText(line.rawDescription);
  const exact = items.filter((item) => normalizeDocumentText(item.name) === name);
  if (exact.length === 1) return { itemId: exact[0].id, status: 'MATCHED' };
  if (exact.length > 1) return { itemId: null, status: 'AMBIGUOUS' };
  const plausible = items.filter((item) => {
    const itemName = normalizeDocumentText(item.name);
    return itemName.length >= 4 && (name.includes(itemName) || itemName.includes(name));
  });
  return { itemId: null, status: plausible.length ? 'AMBIGUOUS' : 'UNMATCHED' };
}

function matchUnit(unitText: string | undefined, units: { id: string; code: string; name: string }[]) {
  const canonical = canonicalUnitText(unitText);
  const matches = units.filter((unit) => canonicalUnitText(unit.code) === canonical || canonicalUnitText(unit.name) === canonical);
  return matches.length === 1 ? matches[0].id : null;
}

function jsonWarnings(value: Prisma.JsonValue | null) {
  return Array.isArray(value) ? value.filter((warning): warning is string => typeof warning === 'string') : [];
}

function serializeExtraction(row: Prisma.GoodsReceiptExtractionGetPayload<{ include: typeof extractionInclude }>) {
  return {
    ...row,
    subtotal: row.subtotal?.toString() ?? null,
    discount: row.discount?.toString() ?? null,
    vat: row.vat?.toString() ?? null,
    grandTotal: row.grandTotal?.toString() ?? null,
    warnings: jsonWarnings(row.warnings),
    originalUrl: `/api/business/receiving/attachments/${row.attachment.storedName}`,
    lines: row.lines.map((line) => ({
      ...line,
      quantity: line.quantity?.toString() ?? null,
      unitPrice: line.unitPrice?.toString() ?? null,
      lineTotal: line.lineTotal?.toString() ?? null,
      warnings: jsonWarnings(line.warnings),
      matchedItem: line.matchedItem ? { ...line.matchedItem, purchaseToBaseFactor: line.matchedItem.purchaseToBaseFactor.toString() } : null,
    })),
  };
}

async function scopedExtraction(id: string, receiptId: string, companyId: string) {
  return prisma.goodsReceiptExtraction.findFirst({ where: { id, goodsReceiptId: receiptId, companyId }, include: extractionInclude });
}

export default async function documentExtractionRoutes(app: FastifyInstance) {
  app.get('/receiving/:id/extractions', { preHandler: READ }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId: req.user.companyId! }, select: { id: true } });
    if (!receipt) return reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบใบรับของนี้'));
    const rows = await prisma.goodsReceiptExtraction.findMany({ where: { goodsReceiptId: id }, orderBy: { createdAt: 'desc' }, include: extractionInclude });
    return ok(rows.map(serializeExtraction));
  });

  app.post('/receiving/:id/attachments/:attachmentId/extractions', { preHandler: WRITE }, async (req, reply) => {
    const { id, attachmentId } = req.params as { id: string; attachmentId: string };
    const companyId = req.user.companyId!;
    if (activeAttachments.has(attachmentId)) return reply.status(409).send(fail('EXTRACTION_IN_PROGRESS', 'ระบบกำลังอ่านไฟล์นี้อยู่'));
    if (activeAttachments.size >= 1) return reply.status(429).send(fail('EXTRACTION_BUSY', 'ระบบกำลังอ่านเอกสารอื่นอยู่ กรุณาลองอีกครั้ง'));
    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId }, select: { id: true, receiptNo: true, status: true, updatedAt: true } });
    if (!receipt) return reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบใบรับของนี้'));
    if (receipt.status !== 'DRAFT') return reply.status(409).send(fail('RECEIPT_NOT_DRAFT', 'อ่านและนำข้อมูลมาใช้ได้เฉพาะใบรับของที่เป็นร่าง'));
    const attachment = await prisma.goodsReceiptAttachment.findFirst({ where: { id: attachmentId, goodsReceiptId: id, companyId } });
    if (!attachment) return reply.status(404).send(fail('ATTACHMENT_NOT_FOUND', 'ไม่พบไฟล์ต้นฉบับของใบรับของนี้'));

    activeAttachments.add(attachmentId);
    let extractionId: string | undefined;
    try {
      const latest = await prisma.goodsReceiptExtraction.aggregate({ where: { attachmentId }, _max: { version: true } });
      const created = await prisma.goodsReceiptExtraction.create({ data: {
        companyId, goodsReceiptId: id, attachmentId, version: (latest._max.version ?? 0) + 1,
        status: 'PROCESSING', sourceReceiptUpdatedAt: receipt.updatedAt, createdById: req.user.sub,
      } });
      extractionId = created.id;
      await writeAudit(req, { action: 'DOCUMENT_EXTRACTION_STARTED', entity: 'GoodsReceipt', entityId: id, after: { receiptNo: receipt.receiptNo, attachmentId, extractionId: created.id, version: created.version } });

      if (attachment.mimeType !== 'application/pdf') {
        throw new ExtractionFailure('OCR_UNAVAILABLE', 'ไฟล์รูปภาพต้องใช้ OCR ภายในเครื่อง ซึ่งยังไม่มีบนเซิร์ฟเวอร์นี้');
      }
      const filePath = path.join(receiptAttachmentDir, attachment.storedName);
      if (!filePath.startsWith(receiptAttachmentDir) || !existsSync(filePath)) throw new ExtractionFailure('SOURCE_FILE_MISSING', 'ไม่พบไฟล์ต้นฉบับบนเซิร์ฟเวอร์');
      const parsed = parseDocumentText(await withExtractionTimeout(extractPdfText(filePath)));
      if (!parsed.lines.length) throw new ExtractionFailure('DOCUMENT_LAYOUT_UNSUPPORTED', 'ไม่พบตารางรายการที่ระบบรองรับในเอกสารนี้');
      const [suppliers, items, units] = await Promise.all([
        prisma.supplier.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, name: true, taxId: true } }),
        prisma.item.findMany({ where: { companyId, isActive: true, deletedAt: null }, select: { id: true, code: true, name: true } }),
        prisma.unit.findMany({ where: { isActive: true, deletedAt: null }, select: { id: true, code: true, name: true } }),
      ]);
      const matchedSupplierId = matchSupplier(parsed, suppliers);
      const matchedLines = parsed.lines.map((line, index) => {
        const item = matchItem(line, items);
        const matchedUnitId = matchUnit(line.unitText, units);
        const matchStatus = item.status === 'AMBIGUOUS' ? 'AMBIGUOUS' : item.itemId && matchedUnitId ? 'MATCHED' : 'UNMATCHED';
        return { line, index, itemId: item.itemId, matchedUnitId, matchStatus };
      });
      const matchedCount = matchedLines.filter((line) => line.matchStatus === 'MATCHED').length;
      const quality = matchedLines.length && matchedCount === matchedLines.length && matchedSupplierId ? 'HIGH' : matchedCount ? 'MEDIUM' : 'LOW';
      const status = matchedLines.length && matchedCount === matchedLines.length ? 'READY' : 'REVIEW_REQUIRED';
      await prisma.goodsReceiptExtraction.update({ where: { id: created.id }, data: {
        status, quality, supplierName: parsed.supplierName, supplierTaxId: parsed.supplierTaxId,
        supplierDocumentNo: parsed.supplierDocumentNo, documentDate: parsed.documentDate, currency: parsed.currency,
        matchedSupplierId, subtotal: parsed.subtotal, discount: parsed.discount, vat: parsed.vat,
        grandTotal: parsed.grandTotal, warnings: parsed.warnings, rawText: parsed.rawText, extractedAt: new Date(),
        lines: { create: matchedLines.map(({ line, index, itemId, matchedUnitId, matchStatus }) => ({
          position: index + 1, rawDescription: line.rawDescription, extractedItemCode: line.extractedItemCode,
          quantity: line.quantity, unitText: line.unitText, unitPrice: line.unitPrice, lineTotal: line.lineTotal,
          matchedItemId: itemId, matchedUnitId, matchStatus, warnings: line.warnings,
        })) },
      } });
      const result = await scopedExtraction(created.id, id, companyId);
      return reply.status(201).send(ok(serializeExtraction(result!), 'อ่านข้อมูลจากไฟล์ต้นฉบับแล้ว กรุณาตรวจสอบก่อนนำไปใช้'));
    } catch (error) {
      const known = error instanceof ExtractionFailure;
      const failureCode = known ? error.code : 'EXTRACTION_FAILED';
      const failureMessage = known ? error.message : 'ระบบอ่านเอกสารนี้อัตโนมัติไม่ได้ คุณยังสามารถกรอกใบรับเข้าสินค้าตามปกติได้';
      if (extractionId) {
        await prisma.goodsReceiptExtraction.update({ where: { id: extractionId }, data: { status: 'FAILED', quality: 'LOW', failureCode, failureMessage, extractedAt: new Date() } });
        await writeAudit(req, { action: 'DOCUMENT_EXTRACTION_FAILED', entity: 'GoodsReceipt', entityId: id, after: { attachmentId, extractionId, failureCode } });
        const failed = await scopedExtraction(extractionId, id, companyId);
        return reply.status(422).send(fail(failureCode, failureMessage, serializeExtraction(failed!)));
      }
      throw error;
    } finally { activeAttachments.delete(attachmentId); }
  });

  app.patch('/receiving/:id/extractions/:extractionId', { preHandler: WRITE }, async (req, reply) => {
    const { id, extractionId } = req.params as { id: string; extractionId: string };
    const companyId = req.user.companyId!;
    const body = z.object({ matchedSupplierId: z.string().min(1).nullable(), lines: z.array(lineReviewSchema).min(1) }).parse(req.body);
    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId }, select: { status: true } });
    if (!receipt) return reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบใบรับของนี้'));
    if (receipt.status !== 'DRAFT') return reply.status(409).send(fail('RECEIPT_NOT_DRAFT', 'แก้ผลอ่านได้เฉพาะใบรับของที่เป็นร่าง'));
    const current = await scopedExtraction(extractionId, id, companyId);
    if (!current) return reply.status(404).send(fail('EXTRACTION_NOT_FOUND', 'ไม่พบผลอ่านเอกสารนี้'));
    if (body.matchedSupplierId) {
      const supplier = await prisma.supplier.findFirst({ where: { id: body.matchedSupplierId, companyId, isActive: true, deletedAt: null } });
      if (!supplier) return reply.status(400).send(fail('SUPPLIER_NOT_IN_COMPANY', 'ไม่พบผู้ขายที่เลือกในบริษัทปัจจุบัน'));
    }
    const itemIds = body.lines.flatMap((line) => line.matchedItemId ? [line.matchedItemId] : []);
    const unitIds = body.lines.flatMap((line) => line.matchedUnitId ? [line.matchedUnitId] : []);
    const [itemCount, unitCount] = await Promise.all([
      prisma.item.count({ where: { id: { in: [...new Set(itemIds)] }, companyId, isActive: true, deletedAt: null } }),
      prisma.unit.count({ where: { id: { in: [...new Set(unitIds)] }, isActive: true, deletedAt: null } }),
    ]);
    if (itemCount !== new Set(itemIds).size) return reply.status(400).send(fail('ITEM_NOT_IN_COMPANY', 'มีสินค้าที่ไม่อยู่ในบริษัทปัจจุบัน'));
    if (unitCount !== new Set(unitIds).size) return reply.status(400).send(fail('UNIT_NOT_FOUND', 'ไม่พบหน่วยที่เลือก'));
    const lineIds = new Set(current.lines.map((line) => line.id));
    if (body.lines.some((line) => !lineIds.has(line.id))) return reply.status(400).send(fail('INVALID_EXTRACTION_LINE', 'มีรายการที่ไม่อยู่ในผลอ่านนี้'));
    const ready = body.lines.every((line) => line.matchedItemId && line.matchedUnitId && line.quantity && line.unitPrice !== null && line.lineTotal !== null);
    await prisma.$transaction(body.lines.map((line) => prisma.goodsReceiptExtractionLine.update({ where: { id: line.id }, data: {
      matchedItemId: line.matchedItemId, matchedUnitId: line.matchedUnitId,
      quantity: line.quantity, unitPrice: line.unitPrice, lineTotal: line.lineTotal,
      matchStatus: line.matchedItemId && line.matchedUnitId ? 'MATCHED' : 'UNMATCHED',
    } })));
    await prisma.goodsReceiptExtraction.update({ where: { id: extractionId }, data: { matchedSupplierId: body.matchedSupplierId, status: ready ? 'READY' : 'REVIEW_REQUIRED' } });
    return ok(serializeExtraction((await scopedExtraction(extractionId, id, companyId))!), 'บันทึกการตรวจทานแล้ว');
  });

  app.post('/receiving/:id/extractions/:extractionId/apply', { preHandler: WRITE }, async (req, reply) => {
    const { id, extractionId } = req.params as { id: string; extractionId: string };
    const companyId = req.user.companyId!;
    const body = z.object({ replaceLinesConfirmed: z.boolean().default(false) }).parse(req.body ?? {});
    try {
      const result = await prisma.$transaction(async (tx) => {
        const receipt = await tx.goodsReceipt.findFirst({ where: { id, companyId }, include: { items: true, purchaseOrder: { include: { items: true } } } });
        if (!receipt) throw new Error('RECEIPT_NOT_FOUND');
        if (receipt.status !== 'DRAFT') throw new Error('RECEIPT_NOT_DRAFT');
        const extraction = await tx.goodsReceiptExtraction.findFirst({ where: { id: extractionId, goodsReceiptId: id, companyId }, include: { lines: { orderBy: { position: 'asc' } } } });
        if (!extraction) throw new Error('EXTRACTION_NOT_FOUND');
        if (!['READY', 'REVIEW_REQUIRED'].includes(extraction.status)) throw new Error('EXTRACTION_NOT_READY');
        if (receipt.items.length && !body.replaceLinesConfirmed) throw new Error('REPLACE_CONFIRMATION_REQUIRED');
        if (!extraction.lines.length || extraction.lines.some((line) => line.matchStatus !== 'MATCHED' || !line.matchedItemId || !line.matchedUnitId || !line.quantity || line.unitPrice === null)) throw new Error('UNRESOLVED_LINES');
        if (extraction.matchedSupplierId) {
          const supplier = await tx.supplier.findFirst({ where: { id: extraction.matchedSupplierId, companyId, isActive: true, deletedAt: null } });
          if (!supplier) throw new Error('SUPPLIER_NOT_IN_COMPANY');
          if (receipt.purchaseOrder && receipt.purchaseOrder.supplierId !== supplier.id) throw new Error('PURCHASE_ORDER_MISMATCH');
        }
        const itemIds = [...new Set(extraction.lines.map((line) => line.matchedItemId!))];
        const items = await tx.item.findMany({ where: { id: { in: itemIds }, companyId, isActive: true, deletedAt: null }, include: { baseUnit: true, purchaseUnit: true } });
        if (items.length !== itemIds.length) throw new Error('ITEM_NOT_IN_COMPANY');
        const itemMap = new Map(items.map((item) => [item.id, item]));
        const conversions = await tx.unitConversion.findMany({ where: { OR: extraction.lines.map((line) => ({ fromUnitId: line.matchedUnitId!, toUnitId: itemMap.get(line.matchedItemId!)!.baseUnitId })) } });
        const conversionMap = new Map(conversions.map((conversion) => [`${conversion.fromUnitId}:${conversion.toUnitId}`, conversion.factor]));
        const savedLines = extraction.lines.map((line) => {
          const item = itemMap.get(line.matchedItemId!)!;
          const sourceToBase = line.matchedUnitId === item.baseUnitId ? new Prisma.Decimal(1)
            : line.matchedUnitId === item.purchaseUnitId ? item.purchaseToBaseFactor
              : conversionMap.get(`${line.matchedUnitId}:${item.baseUnitId}`);
          if (!sourceToBase || sourceToBase.lte(0)) throw new Error('UNIT_CONVERSION_MISSING');
          const purchaseToBase = item.purchaseUnitId ? item.purchaseToBaseFactor : new Prisma.Decimal(1);
          if (purchaseToBase.lte(0)) throw new Error('UNIT_CONVERSION_MISSING');
          const converted = convertExtractedLineToPurchase({ quantity: line.quantity!, unitPrice: line.unitPrice!, sourceToBaseFactor: sourceToBase, purchaseToBaseFactor: purchaseToBase });
          const poLine = receipt.purchaseOrder?.items.find((candidate) => candidate.itemId === item.id);
          if (receipt.purchaseOrder && !poLine) throw new Error('PURCHASE_ORDER_MISMATCH');
          return { itemId: item.id, purchaseOrderItemId: poLine?.id ?? null, purchaseUnitCode: poLine?.purchaseUnitCode ?? item.purchaseUnit?.code ?? item.baseUnit.code, purchaseToBaseFactor: poLine?.purchaseToBaseFactor ?? purchaseToBase, ...converted };
        });
        await tx.goodsReceiptItem.deleteMany({ where: { goodsReceiptId: id } });
        const updated = await tx.goodsReceipt.update({ where: { id }, data: {
          supplierId: extraction.matchedSupplierId,
          supplierDocNo: extraction.supplierDocumentNo ?? receipt.supplierDocNo,
          items: { create: savedLines },
        }, include: { items: true } });
        await tx.goodsReceiptExtraction.update({ where: { id: extraction.id }, data: { status: 'APPLIED', appliedAt: new Date() } });
        await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'DOCUMENT_EXTRACTION_APPLIED', entity: 'GoodsReceipt', entityId: id, after: { receiptNo: receipt.receiptNo, extractionId, attachmentId: extraction.attachmentId, lines: savedLines.length } } });
        return updated;
      });
      return ok(result, `นำข้อมูลไปใช้กับร่าง ${result.receiptNo} แล้ว — ยังไม่มีการเพิ่มสต็อก`);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'APPLY_FAILED';
      const messages: Record<string, [number, string]> = {
        RECEIPT_NOT_FOUND: [404, 'ไม่พบใบรับของนี้'], RECEIPT_NOT_DRAFT: [409, 'นำข้อมูลไปใช้ได้เฉพาะใบรับของที่เป็นร่าง'],
        EXTRACTION_NOT_FOUND: [404, 'ไม่พบผลอ่านเอกสารนี้'], EXTRACTION_NOT_READY: [409, 'ผลอ่านนี้ยังไม่พร้อมนำไปใช้'],
        REPLACE_CONFIRMATION_REQUIRED: [409, 'ร่างมีรายการเดิมหรือการแก้ไขของผู้ใช้ กรุณายืนยันก่อนแทนที่รายการ'],
        UNRESOLVED_LINES: [409, 'กรุณาแก้รายการที่ยังไม่ตรงกันให้ครบก่อน'], SUPPLIER_NOT_IN_COMPANY: [400, 'ไม่พบผู้ขายในบริษัทปัจจุบัน'],
        ITEM_NOT_IN_COMPANY: [400, 'มีสินค้าที่ไม่อยู่ในบริษัทปัจจุบัน'], UNIT_CONVERSION_MISSING: [409, 'ไม่พบกฎแปลงหน่วยสำหรับบางรายการ กรุณาเลือกหน่วยซื้อหรือหน่วยฐานของสินค้า'],
        PURCHASE_ORDER_MISMATCH: [409, 'ข้อมูลจากเอกสารไม่ตรงกับผู้ขายหรือรายการในใบสั่งซื้อ กรุณาตรวจทานด้วยตนเอง'],
      };
      const mapped = messages[code];
      if (mapped) return reply.status(mapped[0]).send(fail(code, mapped[1]));
      throw error;
    }
  });
}
