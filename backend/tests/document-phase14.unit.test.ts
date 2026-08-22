import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONTENT_W, PAGE_H, PAGE_SIZE, PAGE_W, S2A_LOGO, S2A_LOGO_IS_DEDICATED,
  columnsFor, renderBusinessPdf, type BusinessDocument, type DocumentLine,
} from '../src/modules/business/document.service.js';
import { decodePng, encodePng, shrinkPng } from '../src/lib/png-resize.js';
import { COMPANY_DOCUMENT_FIELDS } from '../src/modules/business/company-identity.js';

/**
 * PHASE 14 — เอกสารครึ่ง A4 + แบรนด์ S2A เป็นแบรนด์หลัก
 */

const route = fs.readFileSync(path.join(process.cwd(), 'src', 'modules/business/business.route.ts'), 'utf8');
const pageCount = (b: Buffer) => (b.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

const company = {
  nameTh: 'บริษัท ซื่อสดดี จำกัด', nameEn: 'ZUE SOD DEE CO., LTD.',
  logoUrl: '/company-logos/krua-suesoddee.png', taxId: '0735569004886',
  address: '96 หมู่ 1 ตำบลห้วยพลู อำเภอนครชัยศรี', email: 'zuesoddee@gmail.com',
  phone: null, website: null, lineId: '@zuesoddee', documentFooter: null,
};

const lines = (n: number): DocumentLine[] => Array.from({ length: n }, (_, i) => ({
  name: `วัตถุดิบทดสอบรายการที่ ${i + 1}`, quantity: 12.5, unit: 'KG', price: 25.5, total: 318.75,
}));

const doc = (over: Partial<BusinessDocument> = {}): BusinessDocument => ({
  type: 'GOODS_RECEIPT_SLIP', title: 'GOODS_RECEIPT_SLIP',
  documentNo: 'RI690818001', date: new Date('2026-08-18T00:00:00Z'), company,
  status: 'ยืนยันแล้ว', createdBy: 'วิน', lines: lines(2), total: 2078.9,
  ...over,
});

/* ============================================================
   ขนาดกระดาษครึ่ง A4
   ============================================================ */
describe('PHASE 14 — กระดาษครึ่ง A4', () => {
  it('ใช้ A5 ซึ่งเท่ากับครึ่ง A4 พอดี', () => {
    expect(PAGE_SIZE).toBe('A5');
    // A4 = 595.28 x 841.89 → ครึ่งหนึ่งคือ 419.53 (ปัดจาก 841.89/2) x 595.28
    expect(PAGE_W).toBeCloseTo(419.53, 2);
    expect(PAGE_H).toBeCloseTo(595.28, 2);
    expect(PAGE_H).toBeCloseTo(595.28, 2);
  });

  it('ไฟล์จริงมี MediaBox เป็น A5', async () => {
    const buf = await renderBusinessPdf(doc());
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('/MediaBox [0 0 419.53 595.28]');
    expect(buf.toString('latin1')).not.toContain('/MediaBox [0 0 595.28 841.89]');
  });

  it('เอกสารสั้นต้องอยู่หน้าเดียว — ไม่แตกหน้าเกินจำเป็น', async () => {
    for (const n of [1, 2, 3, 10]) {
      const buf = await renderBusinessPdf(doc({ lines: lines(n) }));
      expect(pageCount(buf), `${n} รายการควรอยู่หน้าเดียว`).toBe(1);
    }
  });

  it('รายการเยอะขึ้นหน้าใหม่ได้ ไม่ย่อตัวอักษรจนอ่านไม่ออก', async () => {
    const buf = await renderBusinessPdf(doc({ lines: lines(40) }));
    expect(pageCount(buf)).toBeGreaterThan(1);
  });

  it('ชื่อรายการยาวไม่ทำให้หน้าพัง', async () => {
    const long = 'ผัดเห็ดหอมจิ๋วพริกไทยดำ หมูสับ สูตรพิเศษของครัวกลางสาขาหลัก';
    const buf = await renderBusinessPdf(doc({ lines: [{ name: long, quantity: 1, unit: 'KG', price: 1, total: 1 }] }));
    expect(pageCount(buf)).toBe(1);
  });
});

/* ============================================================
   คอลัมน์ยังพอดีหน้าที่แคบลง
   ============================================================ */
describe('PHASE 14 — ตารางบนหน้าที่แคบลง', () => {
  it('ความกว้างรวมพอดีพื้นที่ในขอบกระดาษทุกชนิดเอกสาร', () => {
    for (const type of ['GOODS_RECEIPT_SLIP', 'STOCK_ISSUE_SLIP', 'STOCK_ADJUSTMENT_SLIP'] as const) {
      const total = columnsFor(type, lines(1)).reduce((s, c) => s + c.width, 0);
      expect(Math.round(total)).toBe(Math.round(CONTENT_W));
    }
  });

  it('คอลัมน์หน่วยยังกว้างพอสำหรับรหัสหน่วยจริง', () => {
    const unit = columnsFor('GOODS_RECEIPT_SLIP', lines(1)).find((c) => c.key === 'unit')!;
    expect(unit.width).toBeGreaterThanOrEqual(40);
  });

  it('คอลัมน์รายการยังเป็นคอลัมน์ที่กว้างที่สุด', () => {
    const cols = columnsFor('GOODS_RECEIPT_SLIP', lines(1));
    const name = cols.find((c) => c.key === 'name')!;
    expect(name.width).toBe(Math.max(...cols.map((c) => c.width)));
  });

  it('ตัวเลขชิดขวา หน่วยกึ่งกลาง เหมือนเดิม', () => {
    const cols = columnsFor('GOODS_RECEIPT_SLIP', lines(1));
    expect(cols.find((c) => c.key === 'total')?.align).toBe('right');
    expect(cols.find((c) => c.key === 'quantity')?.align).toBe('right');
    expect(cols.find((c) => c.key === 'unit')?.align).toBe('center');
  });

  it('ค่าในตารางห้ามตกบรรทัด — หน่วยจึงไม่แตกหลายบรรทัด', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src', 'modules/business/document.service.ts'), 'utf8');
    const table = src.slice(src.indexOf('function drawTable('), src.indexOf('function drawTotals('));
    expect(table).toContain('lineBreak: false');
    expect(table).toContain('ellipsis: true');
  });
});

/* ============================================================
   แบรนด์ S2A เป็นหลัก บริษัทเป็นผู้รับเอกสาร
   ============================================================ */
describe('PHASE 14 — ลำดับแบรนด์', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'modules/business/document.service.ts'), 'utf8');

  /* PHASE 14B — เอกสารไม่ได้ฝังไฟล์ต้นฉบับแล้ว แต่ฝังสำเนาที่ย่อไว้
     ข้อนี้จึงตรวจว่าไฟล์ที่จะฝังมีอยู่จริงและเป็น PNG */
  it('มีไฟล์โลโก้ S2A ให้ฝังจริง', () => {
    expect(S2A_LOGO).toBeTruthy();
    expect(S2A_LOGO).toMatch(/\.png$/);
    expect(fs.existsSync(S2A_LOGO!)).toBe(true);
  });

  it('หัวเอกสารเป็น S2A ไม่ใช่ชื่อบริษัทลูกค้า', () => {
    const header = src.slice(src.indexOf('function drawBrandHeader('), src.indexOf('function drawMeta('));
    expect(header).toContain("'S2A'");
    expect(header).toContain('S2 ACCOUNTING CONSULTANT');
    expect(header).not.toContain('company.nameTh');
  });

  it('ข้อมูลบริษัทอยู่ใต้แบรนด์ในบล็อก "เอกสารสำหรับ"', () => {
    const block = src.slice(src.indexOf('function drawCompanyBlock('), src.indexOf('function drawInfo('));
    expect(block).toContain('เอกสารสำหรับ');
    expect(block).toContain('c.nameTh');
  });

  it('metadata ของไฟล์ระบุ S2A เป็นผู้ออกเอกสาร', () => {
    expect(src).toContain("Author: 'S2A — S2 Accounting Consultant'");
  });

  it('ไม่ hardcode บริษัทใดบริษัทหนึ่งไว้ในตัว renderer', () => {
    const body = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(body).not.toContain('ซื่อสดดี');
    expect(body).not.toContain('ครัวสดดี');
    expect(body).not.toContain('krua-suesoddee');
  });

  it('ไม่มีโลโก้บริษัทก็ยังออกเอกสารได้ (แบรนด์ S2A ยังอยู่)', async () => {
    const buf = await renderBusinessPdf(doc({ company: { ...company, logoUrl: null } }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

/* ============================================================
   ช่องที่เป็น null ต้องไม่แสดง + ช่องทาง LINE
   ============================================================ */
describe('PHASE 14 — ข้อมูลติดต่อบนเอกสาร', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'modules/business/document.service.ts'), 'utf8');

  it('รองรับ LINE และแสดงเฉพาะเมื่อมีค่า', () => {
    const block = src.slice(src.indexOf('function drawCompanyBlock('), src.indexOf('function drawInfo('));
    expect(block).toContain('if (c.lineId) contact.push(`LINE ${c.lineId}`);');
    for (const f of ['taxId', 'phone', 'email', 'website']) {
      expect(block).toContain(`if (c.${f})`);
    }
  });

  it('API รับ lineId และ helper ส่งต่อให้เอกสาร', () => {
    expect(route).toContain('lineId: z.string().max(120).nullable().optional()');
    expect(COMPANY_DOCUMENT_FIELDS).toContain('lineId');
  });

  it('บริษัทที่มีแต่ชื่อ ก็ยัง render ได้', async () => {
    const buf = await renderBusinessPdf(doc({ company: { nameTh: 'บริษัท ทดสอบ จำกัด' } }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(pageCount(buf)).toBe(1);
  });
});

/* ============================================================
   regression ของเอกสารแต่ละชนิด
   ============================================================ */
describe('PHASE 14 — regression เอกสารเดิม', () => {
  it('GR ยังมีราคา/หน่วย และยอดรวม', async () => {
    const keys = columnsFor('GOODS_RECEIPT_SLIP', lines(1)).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'quantity', 'unit', 'price', 'total']);
    const buf = await renderBusinessPdf(doc());
    expect(pageCount(buf)).toBe(1);
  });

  it('RI ยังไม่มีคอลัมน์เงิน', () => {
    const keys = columnsFor('STOCK_ISSUE_SLIP', [{ name: 'x', quantity: 1, unit: 'KG' }]).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'quantity', 'unit']);
  });

  it('AJ ยังมี ก่อน/เปลี่ยน/หลัง และแสดงสมการใต้ชื่อรายการได้', async () => {
    const keys = columnsFor('STOCK_ADJUSTMENT_SLIP', []).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'before', 'change', 'after', 'unit']);
    const buf = await renderBusinessPdf(doc({
      type: 'STOCK_ADJUSTMENT_SLIP', total: undefined,
      lines: [{ name: 'ไส้หมู', detail: '100 KG − 6 KG = 94 KG', before: 100, change: -6, after: 94, unit: 'KG' }],
    }));
    expect(pageCount(buf)).toBe(1);
  });

  it('ORDER รองรับแถวสรุปก่อนยอดรวม (ส่วนลด/ภาษี) เมื่อมีจริง', async () => {
    const buf = await renderBusinessPdf(doc({
      type: 'ORDER_SLIP',
      summary: [{ label: 'ยอดก่อนภาษี', value: 1158.79 }, { label: 'ภาษี 7%', value: 81.11 }],
      total: 1239.9,
    }));
    expect(pageCount(buf)).toBe(1);
  });

  it('Order ยังใช้ราคาที่บันทึกไว้ ไม่คำนวณใหม่', () => {
    const branch = route.slice(route.indexOf("type === 'ORDER_SLIP'"), route.indexOf("type === 'GOODS_RECEIPT_SLIP'"));
    expect(branch).toContain('line.unitPrice.toString()');
    expect(branch).toContain('line.lineTotal.toString()');
  });

  it('ยังฝังฟอนต์ทั้ง regular และ bold', async () => {
    const buf = await renderBusinessPdf(doc());
    expect((buf.toString('latin1').match(/\/FontFile2/g) || []).length).toBeGreaterThanOrEqual(2);
  });
});

/* ============================================================
   PHASE 14B — ย่อรูปและขนาดไฟล์
   ============================================================ */
describe('PHASE 14B — การย่อรูปสำหรับเอกสาร', () => {
  const src = path.resolve(process.cwd(), '../frontend/public/s2a-logo.png');

  it('ถอดและเข้ารหัส PNG กลับได้ถูกต้อง', () => {
    const img = { width: 2, height: 2, data: Buffer.from([
      255, 0, 0, 255,   0, 255, 0, 255,
      0, 0, 255, 255,   255, 255, 255, 128,
    ]) };
    const round = decodePng(encodePng(img));
    expect(round).toBeTruthy();
    expect(round!.width).toBe(2);
    expect(round!.height).toBe(2);
    expect([...round!.data]).toEqual([...img.data]);
  });

  it('ย่อโลโก้จริงแล้วยังเป็น PNG ที่อ่านกลับได้ และเล็กลงมาก', () => {
    const raw = fs.readFileSync(src);
    const small = shrinkPng(raw, 160);
    expect(small).toBeTruthy();
    const img = decodePng(small!);
    expect(img!.width).toBe(160);
    expect(small!.length).toBeLessThan(raw.length * 0.1);   // เล็กลงอย่างน้อย 90%
  });

  it('รูปที่เล็กอยู่แล้วไม่ต้องย่อซ้ำ', () => {
    const tiny = encodePng({ width: 10, height: 10, data: Buffer.alloc(400, 200) });
    expect(shrinkPng(tiny, 160)).toBeNull();
  });

  it('ไฟล์ที่ไม่ใช่ PNG คืน null ให้ผู้เรียกใช้ไฟล์เดิม', () => {
    expect(shrinkPng(Buffer.from('not a png at all'), 100)).toBeNull();
    expect(decodePng(Buffer.from('nope'))).toBeNull();
  });

  it('ย่อแล้วภาพยังมีเนื้อหาจริง ไม่ใช่ภาพว่าง', () => {
    const small = shrinkPng(fs.readFileSync(src), 160)!;
    const img = decodePng(small)!;
    let nonBlank = 0;
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3] > 10 && (img.data[i] > 10 || img.data[i + 1] > 10 || img.data[i + 2] > 10)) nonBlank += 1;
    }
    expect(nonBlank).toBeGreaterThan(img.width * img.height * 0.1);
  });
});

describe('PHASE 14B — ขนาดไฟล์ PDF', () => {
  it('เอกสารหน้าเดียวต้องเล็กกว่า 300 KB', async () => {
    const buf = await renderBusinessPdf(doc());
    expect(buf.length).toBeLessThan(300 * 1024);
  });

  it('เอกสารหลายหน้าก็ยังไม่บวมขึ้นมาก (ฝังรูปครั้งเดียว)', async () => {
    const one = await renderBusinessPdf(doc());
    const many = await renderBusinessPdf(doc({ lines: lines(40) }));
    expect(many.length).toBeLessThan(one.length + 60 * 1024);
  });

  it('ไม่มีโลโก้บริษัทยิ่งเล็กลง', async () => {
    const withLogo = await renderBusinessPdf(doc());
    const without = await renderBusinessPdf(doc({ company: { ...company, logoUrl: null } }));
    expect(without.length).toBeLessThan(withLogo.length);
  });
});

/* ============================================================
   PHASE 14B — การเลือกไฟล์โลโก้เอกสาร
   ============================================================ */
describe('PHASE 14B — ไฟล์แบรนด์เอกสาร', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'modules/business/document.service.ts'), 'utf8');

  it('เลือก s2a-logo-mark.png ก่อนเสมอ แล้วค่อยถอยไปไฟล์เดิม', () => {
    const block = src.slice(src.indexOf('const S2A_LOGO_SOURCE'), src.indexOf('export const S2A_LOGO ='));
    const markIdx = block.indexOf('s2a-logo-mark.png');
    const fallbackIdx = block.indexOf('s2a-logo.png', markIdx + 5);
    expect(markIdx).toBeGreaterThan(-1);
    expect(fallbackIdx).toBeGreaterThan(markIdx);   // ไฟล์สำรองต้องอยู่หลัง
  });

  it('โลโก้ที่ใช้จริงถูกย่อแล้ว ไม่ใช่ไฟล์ต้นฉบับ', () => {
    expect(S2A_LOGO).toBeTruthy();
    expect(S2A_LOGO).toContain('.doc-assets');
  });

  it('รายงานได้ว่ายังใช้ไฟล์สำรองอยู่หรือไม่', () => {
    expect(typeof S2A_LOGO_IS_DEDICATED).toBe('boolean');
  });

  it('โลโก้บริษัทก็ผ่านการย่อเช่นกัน', () => {
    expect(src).toContain('documentImage(resolveLogoPath(c.logoUrl), 120)');
  });
});

/* ============================================================
   PHASE 14B — ลำดับความสำคัญของเลขที่เอกสาร
   ============================================================ */
describe('PHASE 14B — เลขที่เอกสารต้องเด่น', () => {
  const src = fs.readFileSync(path.join(process.cwd(), 'src', 'modules/business/document.service.ts'), 'utf8');
  const header = src.slice(src.indexOf('function drawBrandHeader('), src.indexOf('function drawMeta('));

  it('เลขที่เอกสารอยู่ในหัวกระดาษ และตัวใหญ่กว่าชนิดเอกสาร', () => {
    expect(header).toContain('input.documentNo');
    const docNoSize = Number(/fontSize\((\d+(?:\.\d+)?)\)[^;]*input\.documentNo/.exec(header)?.[1]);
    const typeSize = Number(/fontSize\((\d+(?:\.\d+)?)\)[^;]*t\.en/.exec(header)?.[1]);
    expect(docNoSize).toBeGreaterThan(typeSize);
  });

  it('แถวข้อมูลรองไม่ซ้ำเลขที่อีก', () => {
    const meta = src.slice(src.indexOf('function drawMeta('), src.indexOf('function drawCompanyBlock('));
    expect(meta).not.toContain("['เลขที่', input.documentNo]");
    expect(meta).toContain("'วันที่'");
  });

  it('ไม่มีบาร์โค้ด/QR ปลอม', () => {
    expect(src).not.toMatch(/barcode|qrcode|QRCode/i);
  });
});
