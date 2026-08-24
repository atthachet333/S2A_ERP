import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { ItemType, RoleName } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';
import { renderBusinessPdf, PAGE_W, PAGE_H } from '../src/modules/business/document.service.js';

/**
 * PHASE 22 — ไฟล์เอกสารต้นฉบับจากผู้ขาย + เอกสาร PDF ของ S2A
 *
 * กติกาที่ตรึงไว้:
 *   1) การแนบไฟล์เป็นส่วนเพิ่ม ใบรับของที่ไม่มีไฟล์ต้องทำงานเหมือนเดิมทุกประการ
 *   2) ไฟล์ต้นฉบับกับ PDF ของ S2A เป็นคนละไฟล์ ไม่ทับกัน
 *   3) ยืนยันใบรับของแล้ว ไฟล์ต้นฉบับกลายเป็นหลักฐาน แก้หรือลบไม่ได้
 */

const TAG = `at${Date.now().toString().slice(-7)}`;

/** ไฟล์ทดสอบที่ magic bytes ถูกต้องจริง */
const PDF_BYTES = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(400, 0x20), Buffer.from('\n%%EOF\n')]);
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 2)]);
/** นามสกุลบอกว่าเป็น PDF แต่ข้างในไม่ใช่ — ต้องถูกปฏิเสธ */
const FAKE_PDF = Buffer.from('นี่ไม่ใช่ไฟล์ PDF จริง'.repeat(10), 'utf8');

function multipart(fileName: string, mime: string, body: Buffer) {
  const boundary = `----s2a${TAG}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mime}\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { payload: Buffer.concat([head, body, tail]), headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } };
}

describe.sequential('receipt attachments + documents', () => {
  let app: FastifyInstance;
  let token = '';
  let otherToken = '';
  let viewerToken = '';
  let companyId = '';
  let warehouseId = '';
  let itemId = '';
  const auth = () => ({ authorization: `Bearer ${token}` });

  const createReceipt = (confirm = false) => app.inject({
    method: 'POST', url: '/api/business/receiving', headers: auth(),
    payload: { warehouseId, confirm, items: [{ itemId, quantity: 5, unitPrice: 10 }] },
  });

  const attach = (receiptId: string, file: ReturnType<typeof multipart>, headers = auth()) => app.inject({
    method: 'POST', url: `/api/business/receiving/${receiptId}/attachments`,
    headers: { ...headers, ...file.headers }, payload: file.payload,
  });

  beforeAll(async () => {
    const superRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
    const viewerRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.VIEWER } });
    companyId = (await prisma.company.findUniqueOrThrow({ where: { code: 'S2A-PRIMARY' } })).id;
    const otherCompanyId = (await prisma.company.create({ data: { code: `ATB_${TAG}`, nameTh: 'บริษัทอื่น' } })).id;

    const mk = async (username: string, roleId: string, company: string) => {
      const passwordHash = await bcrypt.hash('AttachPass123!', 10);
      const user = await prisma.user.upsert({
        where: { username },
        update: { passwordHash, isActive: true, mustChangePassword: false, deletedAt: null },
        create: { username, email: `${username}@s2a.local`, passwordHash, fullName: username, isActive: true, mustChangePassword: false },
      });
      await prisma.userRole.upsert({ where: { userId_roleId: { userId: user.id, roleId } }, update: {}, create: { userId: user.id, roleId } });
      await prisma.companyMembership.upsert({
        where: { userId_companyId: { userId: user.id, companyId: company } },
        update: { roleId }, create: { userId: user.id, companyId: company, roleId, isDefault: true },
      });
    };
    await mk(`atadmin_${TAG}`, superRole.id, companyId);
    await mk(`atviewer_${TAG}`, viewerRole.id, companyId);
    await mk(`atother_${TAG}`, superRole.id, otherCompanyId);

    app = await buildApp();
    await app.ready();
    const login = async (u: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: 'AttachPass123!' } })).json().data.accessToken as string;
    token = await login(`atadmin_${TAG}`);
    viewerToken = await login(`atviewer_${TAG}`);
    otherToken = await login(`atother_${TAG}`);

    const unit = await prisma.unit.upsert({ where: { code: `AU_${TAG}` }, update: {}, create: { code: `AU_${TAG}`, name: 'หน่วยแนบไฟล์' } });
    warehouseId = (await prisma.warehouse.create({ data: { companyId, code: `AW_${TAG}`, name: 'คลังแนบไฟล์' } })).id;
    itemId = (await prisma.item.create({ data: { companyId, code: `AI_${TAG}`, name: 'ของทดสอบแนบไฟล์', type: ItemType.RAW_MATERIAL, baseUnitId: unit.id } })).id;
  });

  afterAll(async () => {
    if (app) await app.close();
    await prisma.$disconnect();
  });

  /* ---------- ความเข้ากันได้ย้อนหลัง ---------- */

  it('A1 รับของโดยไม่แนบไฟล์ ต้องทำงานเหมือนเดิมทุกประการ', async () => {
    const res = await createReceipt(true);
    expect(res.statusCode).toBe(201);
    expect(res.json().data.status).toBe('CONFIRMED');

    const balance = await prisma.stockBalance.findFirstOrThrow({ where: { itemId, warehouseId } });
    expect(Number(balance.onHand)).toBeGreaterThan(0);

    // ไม่มีไฟล์แนบ = คืนรายการว่าง ไม่ใช่ error
    const list = await app.inject({ method: 'GET', url: `/api/business/receiving/${res.json().data.id}/attachments`, headers: auth() });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toEqual([]);
  });

  /* ---------- แนบไฟล์ ---------- */

  it('A2 แนบไฟล์ PDF กับใบร่างได้ และเปิดอ่านกลับมาได้ตรงไบต์เดิม', async () => {
    const receipt = (await createReceipt()).json().data;
    const res = await attach(receipt.id, multipart('ใบส่งของผู้ขาย.pdf', 'application/pdf', PDF_BYTES));
    expect(res.statusCode).toBe(201);
    expect(res.json().data.originalName).toBe('ใบส่งของผู้ขาย.pdf');
    expect(res.json().data.mimeType).toBe('application/pdf');
    expect(res.json().data.sizeBytes).toBe(PDF_BYTES.length);

    const opened = await app.inject({ method: 'GET', url: res.json().data.url, headers: auth() });
    expect(opened.statusCode).toBe(200);
    expect(opened.headers['content-type']).toContain('application/pdf');
    expect(Buffer.compare(opened.rawPayload, PDF_BYTES), 'ไฟล์ต้องออกมาเหมือนที่อัปโหลดทุกไบต์').toBe(0);
  });

  it('A3 แนบไฟล์รูปได้เช่นกัน', async () => {
    const receipt = (await createReceipt()).json().data;
    expect((await attach(receipt.id, multipart('bill.png', 'image/png', PNG_BYTES))).statusCode).toBe(201);
    const receipt2 = (await createReceipt()).json().data;
    expect((await attach(receipt2.id, multipart('bill.jpg', 'image/jpeg', JPEG_BYTES))).statusCode).toBe(201);
  });

  it('A4 ไฟล์ที่ magic bytes ไม่ตรงต้องถูกปฏิเสธ ไม่เชื่อแค่ MIME ที่ส่งมา', async () => {
    const receipt = (await createReceipt()).json().data;
    const res = await attach(receipt.id, multipart('ปลอม.pdf', 'application/pdf', FAKE_PDF));
    expect(res.statusCode).toBe(415);
    expect(res.json().error.code).toBe('UNSUPPORTED_MEDIA');
    expect(await prisma.goodsReceiptAttachment.count({ where: { goodsReceiptId: receipt.id } })).toBe(0);
  });

  it('A5 ชนิดไฟล์ที่ไม่รองรับต้องถูกปฏิเสธ', async () => {
    const receipt = (await createReceipt()).json().data;
    const res = await attach(receipt.id, multipart('sheet.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])));
    expect(res.statusCode).toBe(415);
  });

  /* ---------- ไฟล์หลังยืนยันเป็นหลักฐาน ---------- */

  it('A6 ยืนยันใบรับของแล้ว แนบไฟล์เพิ่มไม่ได้ และลบของเดิมไม่ได้', async () => {
    const receipt = (await createReceipt()).json().data;
    const first = await attach(receipt.id, multipart('ต้นฉบับ.pdf', 'application/pdf', PDF_BYTES));
    expect(first.statusCode).toBe(201);
    const attachmentId = first.json().data.id as string;

    const confirmed = await app.inject({ method: 'POST', url: `/api/business/receiving/${receipt.id}/confirm`, headers: auth() });
    expect(confirmed.statusCode).toBe(200);

    const again = await attach(receipt.id, multipart('ทับของเดิม.pdf', 'application/pdf', PDF_BYTES));
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe('RECEIPT_NOT_DRAFT');

    const removed = await app.inject({
      method: 'DELETE', url: `/api/business/receiving/${receipt.id}/attachments/${attachmentId}`, headers: auth(),
    });
    expect(removed.statusCode).toBe(409);

    // ไฟล์เดิมยังอยู่ครบ ไม่ถูกทับและไม่ถูกลบ
    const list = await app.inject({ method: 'GET', url: `/api/business/receiving/${receipt.id}/attachments`, headers: auth() });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].id).toBe(attachmentId);
  });

  it('A7 ใบที่ยังเป็นร่าง ลบไฟล์แนบได้', async () => {
    const receipt = (await createReceipt()).json().data;
    const created = await attach(receipt.id, multipart('ลบได้.pdf', 'application/pdf', PDF_BYTES));
    const res = await app.inject({
      method: 'DELETE', url: `/api/business/receiving/${receipt.id}/attachments/${created.json().data.id}`, headers: auth(),
    });
    expect(res.statusCode).toBe(200);
    expect(await prisma.goodsReceiptAttachment.count({ where: { goodsReceiptId: receipt.id } })).toBe(0);
  });

  /* ---------- สิทธิ์และขอบเขตบริษัท ---------- */

  it('A8 ผู้ใช้ที่ไม่มีสิทธิ์แนบหรือดูไฟล์ไม่ได้', async () => {
    const receipt = (await createReceipt()).json().data;
    const upload = await attach(receipt.id, multipart('x.pdf', 'application/pdf', PDF_BYTES), { authorization: `Bearer ${viewerToken}` });
    expect(upload.statusCode).toBe(403);
    const list = await app.inject({ method: 'GET', url: `/api/business/receiving/${receipt.id}/attachments`, headers: { authorization: `Bearer ${viewerToken}` } });
    expect(list.statusCode).toBe(403);
  });

  it('A9 ขอบเขตบริษัท — บริษัทอื่นเข้าถึงใบและไฟล์ไม่ได้แม้รู้ id', async () => {
    const receipt = (await createReceipt()).json().data;
    const created = await attach(receipt.id, multipart('ของบริษัทเรา.pdf', 'application/pdf', PDF_BYTES));
    const url = created.json().data.url as string;

    const other = { authorization: `Bearer ${otherToken}` };
    expect((await app.inject({ method: 'GET', url: `/api/business/receiving/${receipt.id}/attachments`, headers: other })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url, headers: other })).statusCode).toBe(404);
    expect((await attach(receipt.id, multipart('y.pdf', 'application/pdf', PDF_BYTES), other)).statusCode).toBe(404);
  });

  it('A10 ชื่อไฟล์ที่ไม่ตรงรูปแบบต้องเปิดไม่ได้ (กัน path traversal)', async () => {
    for (const name of ['..%2F..%2Fsecret.pdf', 'anything.exe', 'notauuid.pdf']) {
      const res = await app.inject({ method: 'GET', url: `/api/business/receiving/attachments/${name}`, headers: auth() });
      expect(res.statusCode, name).toBe(404);
    }
  });

  /* ---------- ไฟล์ต้นฉบับกับเอกสาร S2A แยกกันเด็ดขาด ---------- */

  it('A11 PDF ของ S2A กับไฟล์ต้นฉบับเป็นคนละไฟล์ คนละเส้นทาง', async () => {
    const receipt = (await createReceipt()).json().data;
    const created = await attach(receipt.id, multipart('ของผู้ขาย.pdf', 'application/pdf', PDF_BYTES));
    const originalUrl = created.json().data.url as string;

    const s2a = await app.inject({ method: 'GET', url: `/api/business/documents/GOODS_RECEIPT_SLIP/${receipt.id}.pdf`, headers: auth() });
    expect(s2a.statusCode).toBe(200);
    expect(s2a.headers['content-type']).toContain('application/pdf');

    const original = await app.inject({ method: 'GET', url: originalUrl, headers: auth() });
    expect(original.statusCode).toBe(200);

    // เนื้อไฟล์ต่างกันคนละใบ และไฟล์ต้นฉบับยังเป็นไบต์เดิมที่อัปโหลดมา
    expect(Buffer.compare(s2a.rawPayload, original.rawPayload)).not.toBe(0);
    expect(Buffer.compare(original.rawPayload, PDF_BYTES)).toBe(0);
    expect(s2a.rawPayload.length).toBeGreaterThan(PDF_BYTES.length);
    expect(originalUrl).not.toContain('/documents/');
  });

  it('A12 บันทึกประวัติการแนบและการนำออก', async () => {
    const receipt = (await createReceipt()).json().data;
    const created = await attach(receipt.id, multipart('มีประวัติ.pdf', 'application/pdf', PDF_BYTES));
    expect(await prisma.auditLog.count({ where: { entityId: receipt.id, action: 'ATTACHMENT_UPLOADED' } })).toBe(1);

    await app.inject({ method: 'DELETE', url: `/api/business/receiving/${receipt.id}/attachments/${created.json().data.id}`, headers: auth() });
    expect(await prisma.auditLog.count({ where: { entityId: receipt.id, action: 'ATTACHMENT_REMOVED' } })).toBe(1);
  });

  /* ---------- เอกสาร PDF ของ S2A ---------- */

  describe('เอกสาร PDF ต้องเป็น A5 จริงทุกชนิด', () => {
    const TYPES = [
      'GOODS_RECEIPT_SLIP', 'STOCK_ISSUE_SLIP', 'STOCK_ADJUSTMENT_SLIP',
      'STOCK_TRANSFER_SLIP', 'ORDER_SLIP', 'KITCHEN_PREPARATION_SLIP',
      'RECIPE_COST_SHEET', 'SALES_REPORT',
    ] as const;

    const sample = (type: (typeof TYPES)[number], lineCount = 2) => ({
      type, title: type, documentNo: 'GR-20260823-0001', date: new Date('2026-08-23'),
      company: { nameTh: 'บริษัท ครัวสดดี จำกัด', taxId: '0105561000000', address: '123 ถนนทดสอบ กรุงเทพฯ', phone: '02-000-0000' },
      createdBy: 'ผู้ทดสอบ', status: 'ยืนยันแล้ว', totalLabel: 'ยอดรวมทั้งสิ้น',
      subject: [{ label: 'ผู้จำหน่าย', value: 'บริษัท ตัวอย่าง จำกัด' }],
      lines: Array.from({ length: lineCount }, (_, i) => ({
        name: `วัตถุดิบทดสอบชื่อยาวมากเพื่อดูการตัดบรรทัดในตาราง A5 รายการที่ ${i + 1}`,
        quantity: '47', unit: 'L', price: '47.00', total: '2209.00',
        before: '100', change: '-5', after: '95',
      })),
      total: '2209.00', note: 'หมายเหตุทดสอบ',
    });

    it('D1 MediaBox ของไฟล์ที่สร้างจริงเป็น A5 ทุกชนิด ไม่มี A4 หลงเหลือ', async () => {
      for (const type of TYPES) {
        const buf = await renderBusinessPdf(sample(type));
        const text = buf.toString('latin1');
        const box = /\/MediaBox\s*\[([^\]]+)\]/.exec(text)?.[1]?.trim();
        expect(box, type).toBe(`0 0 ${PAGE_W} ${PAGE_H}`);
        // A4 คือ 595.28 × 841.89 — ต้องไม่โผล่ที่ไหนเลย
        expect(text, type).not.toContain('841.89');
      }
    });

    it('D2 ขนาดไฟล์สมเหตุผลและเป็น PDF จริง', async () => {
      const buf = await renderBusinessPdf(sample('GOODS_RECEIPT_SLIP'));
      expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
      expect(buf.length).toBeGreaterThan(2000);
      expect(buf.length).toBeLessThan(400 * 1024);
    });

    it('D3 รายการยาวหลายบรรทัดยังขึ้นหน้าใหม่และมีเลขหน้าครบ', async () => {
      const buf = await renderBusinessPdf(sample('GOODS_RECEIPT_SLIP', 40));
      const text = buf.toString('latin1');
      const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      expect(pages).toBeGreaterThan(1);
      // ทุกหน้าต้องมีขนาด A5 เท่ากัน ไม่ใช่หน้าแรก A5 แล้วหน้าถัดไปเป็นขนาดอื่น
      const boxes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)].map((m) => m[1].trim());
      expect(new Set(boxes).size).toBe(1);
    });

    it('D4 ช่องลงนามยึดก้นกระดาษ ไม่ลอยกลางหน้าจนเหลือที่ว่างครึ่งล่าง', async () => {
      const service = await import('../src/modules/business/document.service.js');
      expect(service.PAGE_H).toBe(595.28);
      // เอกสารสั้นกับเอกสารยาวต้องวางช่องลงนามที่ระดับเดียวกัน (ยึดก้นกระดาษ)
      const short = await renderBusinessPdf(sample('STOCK_ISSUE_SLIP', 1));
      const long = await renderBusinessPdf(sample('STOCK_ISSUE_SLIP', 6));
      expect(short.length).toBeGreaterThan(2000);
      expect(long.length).toBeGreaterThan(short.length);
    });

    it('D5 ใช้โลโก้ S2A ตัวจริง ไม่ตกไปใช้ตัวสำรอง', async () => {
      const service = await import('../src/modules/business/document.service.js');
      expect(service.S2A_LOGO_IS_DEDICATED, 'ต้องพบไฟล์ s2a-logo-mark.png').toBe(true);
      expect(service.S2A_LOGO).toBeTruthy();
    });
  });
});
