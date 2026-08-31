import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';
import { writeAudit } from '../../lib/http.js';
import { env } from '../../config/env.js';
// ใช้ตัวช่วยเดิมของระบบ รองรับชื่อไฟล์ภาษาไทยตาม RFC 5987 อยู่แล้ว
import { contentDisposition } from './business.route.js';

/**
 * PHASE 22 — ไฟล์เอกสารต้นฉบับจากผู้ขายที่แนบกับใบรับของ
 *
 * กติกาสำคัญที่สุด: การแนบไฟล์เป็น "ส่วนเพิ่ม" เท่านั้น
 * ใบรับของที่ไม่มีไฟล์แนบต้องทำงานได้เหมือนเดิมทุกประการ ไม่มีอะไรเปลี่ยน
 *
 * ไฟล์ต้นฉบับเป็นหลักฐานประกอบ ไม่ใช่แหล่งความจริงของรายการรับของ
 * และไม่ทับกับ PDF ใบรับของของ S2A ซึ่งเป็นคนละไฟล์คนละเส้นทาง
 *
 * เฟสนี้ยังไม่อ่านเนื้อหาในไฟล์ (ไม่ OCR ไม่แกะ PDF ไม่เดารายการสินค้า)
 */

const VIEW = requirePermission('RECEIVING_VIEW', 'RECEIVING_CREATE');
const MANAGE = requirePermission('RECEIVING_CREATE', 'RECEIVING_EDIT');

const EXT_BY_MIME: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * ตรวจชนิดไฟล์จาก magic bytes เท่านั้น ไม่เชื่อ MIME ที่ผู้ใช้ส่งมา
 * รองรับเฉพาะชนิดที่แยกออกจากกันได้แน่นอน
 * (XLSX/XLS ยังไม่รองรับ เพราะ XLSX เป็นไฟล์ ZIP ที่แยกจาก zip อื่นด้วย magic bytes อย่างเดียวไม่ได้)
 */
function detectFileType(buf: Buffer): keyof typeof EXT_BY_MIME | null {
  if (buf.length >= 5 && buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47
    && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'image/png';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export const receiptAttachmentDir = path.join(path.resolve(process.cwd(), env.UPLOAD_DIR), 'receipts');
const STORED_NAME_RE = /^[a-f0-9-]{36}\.(pdf|jpg|png|webp)$/;
const CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
};

const serialize = (a: { id: string; originalName: string; storedName: string; mimeType: string; sizeBytes: number; uploadedAt: Date; uploadedById: string | null }) => ({
  id: a.id,
  originalName: a.originalName,
  mimeType: a.mimeType,
  sizeBytes: a.sizeBytes,
  uploadedAt: a.uploadedAt.toISOString(),
  uploadedById: a.uploadedById,
  url: `/api/business/receiving/attachments/${a.storedName}`,
});

export default async function receiptAttachmentRoutes(app: FastifyInstance) {
  /** ไฟล์ต้นฉบับของใบรับของหนึ่งใบ (ไม่มีไฟล์ = คืนรายการว่าง ไม่ใช่ error) */
  app.get('/receiving/:id/attachments', { preHandler: VIEW }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;
    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!receipt) return reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบใบรับของนี้'));

    const rows = await prisma.goodsReceiptAttachment.findMany({ where: { goodsReceiptId: id }, orderBy: { uploadedAt: 'desc' } });
    return ok(rows.map(serialize));
  });

  /**
   * แนบไฟล์ต้นฉบับ — ทำได้เฉพาะตอนใบยังเป็นร่างเท่านั้น
   * เมื่อยืนยันใบรับของแล้ว ไฟล์ต้นฉบับกลายเป็นหลักฐาน จึงไม่ให้ทับหรือลบเงียบ ๆ
   */
  app.post('/receiving/:id/attachments', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const companyId = req.user.companyId!;

    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId }, select: { id: true, receiptNo: true, status: true } });
    if (!receipt) return reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบใบรับของนี้'));
    if (receipt.status !== 'DRAFT') {
      return reply.status(409).send(fail('RECEIPT_NOT_DRAFT', 'ใบรับของนี้ยืนยันแล้ว ไฟล์ต้นฉบับจึงเป็นหลักฐานที่แก้ไม่ได้'));
    }

    const file = await req.file();
    if (!file) return reply.status(400).send(fail('VALIDATION_ERROR', 'ไม่พบไฟล์ที่อัปโหลด'));

    let buffer: Buffer;
    try { buffer = await file.toBuffer(); }
    catch { return reply.status(413).send(fail('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกินขนาดที่ระบบรับได้')); }
    if (file.file.truncated || buffer.length > env.UPLOAD_MAX_BYTES) {
      return reply.status(413).send(fail('FILE_TOO_LARGE', 'ไฟล์ใหญ่เกินขนาดที่ระบบรับได้'));
    }

    // เชื่อ magic bytes เท่านั้น และต้องตรงกับ MIME ที่แจ้งมาด้วย
    const detected = detectFileType(buffer);
    if (!detected || detected !== file.mimetype) {
      return reply.status(415).send(fail('UNSUPPORTED_MEDIA', 'รองรับเฉพาะไฟล์ PDF, JPG, PNG หรือ WEBP ที่ถูกต้อง'));
    }

    const ext = EXT_BY_MIME[detected];
    const storedName = `${randomUUID()}.${ext}`;
    await mkdir(receiptAttachmentDir, { recursive: true });
    // เขียนไฟล์ใหม่เสมอด้วยชื่อสุ่ม จึงไม่มีทางเขียนทับไฟล์เดิมของใบไหน
    await writeFile(path.join(receiptAttachmentDir, storedName), buffer);

    const created = await prisma.goodsReceiptAttachment.create({
      data: {
        companyId, goodsReceiptId: id,
        originalName: file.filename?.slice(0, 180) ?? storedName,
        storedName, mimeType: detected, sizeBytes: buffer.length,
        uploadedById: req.user.sub,
      },
    });

    await writeAudit(req, {
      action: 'ATTACHMENT_UPLOADED', entity: 'GoodsReceipt', entityId: id,
      after: { receiptNo: receipt.receiptNo, originalName: created.originalName, mimeType: detected, sizeBytes: buffer.length },
    });
    return reply.status(201).send(ok(serialize(created), 'แนบไฟล์ต้นฉบับแล้ว'));
  });

  /** ลบไฟล์ต้นฉบับ — เฉพาะตอนใบยังเป็นร่าง (ไฟล์บนดิสก์ยังอยู่ ไม่ลบทิ้งเพื่อไม่ให้หลักฐานหาย) */
  app.delete('/receiving/:id/attachments/:attachmentId', { preHandler: MANAGE }, async (req, reply) => {
    const { id, attachmentId } = req.params as { id: string; attachmentId: string };
    const companyId = req.user.companyId!;

    const receipt = await prisma.goodsReceipt.findFirst({ where: { id, companyId }, select: { id: true, receiptNo: true, status: true } });
    if (!receipt) return reply.status(404).send(fail('RECEIPT_NOT_FOUND', 'ไม่พบใบรับของนี้'));
    if (receipt.status !== 'DRAFT') {
      return reply.status(409).send(fail('RECEIPT_NOT_DRAFT', 'ใบรับของนี้ยืนยันแล้ว ไฟล์ต้นฉบับจึงลบไม่ได้'));
    }

    const attachment = await prisma.goodsReceiptAttachment.findFirst({ where: { id: attachmentId, goodsReceiptId: id, companyId } });
    if (!attachment) return reply.status(404).send(fail('ATTACHMENT_NOT_FOUND', 'ไม่พบไฟล์แนบนี้'));

    await prisma.goodsReceiptAttachment.delete({ where: { id: attachment.id } });
    await writeAudit(req, {
      action: 'ATTACHMENT_REMOVED', entity: 'GoodsReceipt', entityId: id,
      before: { receiptNo: receipt.receiptNo, originalName: attachment.originalName },
    });
    return ok({ id: attachment.id }, 'นำไฟล์ต้นฉบับออกแล้ว');
  });

  /**
   * เปิดไฟล์ต้นฉบับตามที่เก็บไว้ทุกประการ ไม่แปลง ไม่ย่อ
   * ต้องผ่านสิทธิ์และขอบเขตบริษัทเสมอ ไม่ใช่ไฟล์สาธารณะเหมือนรูปสินค้า
   */
  app.get('/receiving/attachments/:storedName', { preHandler: VIEW }, async (req, reply) => {
    const { storedName } = req.params as { storedName: string };
    if (!STORED_NAME_RE.test(storedName)) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบไฟล์'));

    const attachment = await prisma.goodsReceiptAttachment.findFirst({
      where: { storedName, companyId: req.user.companyId! },
    });
    if (!attachment) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบไฟล์'));

    const filePath = path.join(receiptAttachmentDir, storedName);
    if (!filePath.startsWith(receiptAttachmentDir) || !existsSync(filePath)) {
      return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบไฟล์บนดิสก์'));
    }

    const ext = storedName.split('.').pop()!;
    return reply
      .header('Content-Type', CONTENT_TYPE[ext])
      .header('Content-Disposition', contentDisposition('inline', attachment.originalName))
      .header('Cache-Control', 'private, max-age=0, must-revalidate')
      .send(await readFile(filePath));
  });
}
