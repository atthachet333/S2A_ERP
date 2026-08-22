import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import {
  CONTENT_W, cellValue, columnsFor, renderBusinessPdf, resolveLogoPath,
  type BusinessDocument, type DocumentLine,
} from '../src/modules/business/document.service.js';
import { contentDisposition } from '../src/modules/business/business.route.js';

/**
 * PHASE 13 — เทสต์เอกสาร PDF และไฟล์ Excel
 * ไม่แตะฐานข้อมูล ใช้ข้อมูลตัวอย่างที่มีรูปร่างเดียวกับของจริง
 */

const company = {
  nameTh: 'บริษัท ซื่อสดดี จำกัด',
  nameEn: 'ZUE SOD DEE CO., LTD.',
  logoUrl: '/company-logos/krua-suesoddee.png',
  taxId: '0735569004886',
  address: '96 หมู่ 1 ตำบลห้วยพลู อำเภอนครชัยศรี\nจังหวัดนครปฐม 73120',
  email: 'zuesoddee@gmail.com',
  phone: null,
  website: null,
  documentFooter: null,
};

const grLines: DocumentLine[] = [
  { name: 'ไส้หมู', quantity: 7.4, unit: 'KG', price: 130, total: 962 },
  { name: 'กระเพาะหมู', quantity: 65.7, unit: 'KG', price: 17, total: 1116.9 },
];

const baseDoc = (over: Partial<BusinessDocument> = {}): BusinessDocument => ({
  type: 'GOODS_RECEIPT_SLIP', title: 'GOODS_RECEIPT_SLIP',
  documentNo: 'RI690818001', date: new Date('2026-08-18T00:00:00Z'),
  company, status: 'ยืนยันแล้ว', lines: grLines, total: 2078.9,
  ...over,
});

/* ============================================================
   §26 โลโก้
   ============================================================ */
describe('PHASE 13 — โลโก้เอกสาร', () => {
  it('หา logo จริงบนดิสก์เจอจาก logoUrl ของบริษัท', () => {
    const p = resolveLogoPath('/company-logos/krua-suesoddee.png');
    expect(p).toBeTruthy();
    expect(p).toMatch(/krua-suesoddee\.png$/);
  });

  it('ไม่มี logoUrl → คืน null เพื่อให้ถอยไปใช้ text mark', () => {
    expect(resolveLogoPath(null)).toBeNull();
    expect(resolveLogoPath(undefined)).toBeNull();
    expect(resolveLogoPath('')).toBeNull();
  });

  it('ปฏิเสธ URL ภายนอกและไฟล์ที่ PDFKit ฝังไม่ได้', () => {
    expect(resolveLogoPath('https://cdn.example.com/logo.png')).toBeNull();  // CORS/ออฟไลน์ → ฝังไม่ได้
    expect(resolveLogoPath('/company-logos/logo.svg')).toBeNull();           // PDFKit ไม่รองรับ SVG
  });

  it('ไฟล์ที่ไม่มีอยู่จริง → null ไม่โยน error', () => {
    expect(resolveLogoPath('/company-logos/ไม่มีไฟล์นี้.png')).toBeNull();
  });
});

/* ============================================================
   §5 §6 §11 §12 §13 คอลัมน์ของตาราง
   ============================================================ */
describe('PHASE 13 — คอลัมน์ตารางตามชนิดเอกสาร', () => {
  it('ใบรับสินค้ามีลำดับ ราคา/หน่วย และมูลค่า ครบ', () => {
    const keys = columnsFor('GOODS_RECEIPT_SLIP', grLines).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'quantity', 'unit', 'price', 'total']);
  });

  it('ใบเบิกไม่มีคอลัมน์เงิน เพราะเอกสารเดิมไม่มีราคา', () => {
    const issue: DocumentLine[] = [{ name: 'ไส้หมู', quantity: 2, unit: 'KG' }];
    const keys = columnsFor('STOCK_ISSUE_SLIP', issue).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'quantity', 'unit']);
    expect(keys).not.toContain('price');
    expect(keys).not.toContain('total');
  });

  /* PHASE 13B — ตัดคอลัมน์ "เหตุผล" ออก เพราะ StockAdjustmentItem ไม่มีเหตุผลรายบรรทัด
     (เหตุผลอยู่ที่หัวเอกสาร) การมีคอลัมน์นี้จะซ้ำค่าเดิมทุกแถวหรือว่างทั้งคอลัมน์ */
  it('ใบปรับปรุงสต็อกมี ก่อน / เปลี่ยน / หลัง / หน่วย', () => {
    const keys = columnsFor('STOCK_ADJUSTMENT_SLIP', []).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'before', 'change', 'after', 'unit']);
  });

  it('ความกว้างรวมพอดีกับพื้นที่ในขอบกระดาษเสมอ', () => {
    for (const type of ['GOODS_RECEIPT_SLIP', 'STOCK_ISSUE_SLIP', 'STOCK_ADJUSTMENT_SLIP'] as const) {
      const total = columnsFor(type, grLines).reduce((s, c) => s + c.width, 0);
      expect(Math.round(total)).toBe(Math.round(CONTENT_W));
    }
  });

  it('ตัวเลขชิดขวา หน่วยอยู่กึ่งกลาง ชื่อรายการชิดซ้าย', () => {
    const cols = columnsFor('GOODS_RECEIPT_SLIP', grLines);
    expect(cols.find((c) => c.key === 'quantity')?.align).toBe('right');
    expect(cols.find((c) => c.key === 'total')?.align).toBe('right');
    expect(cols.find((c) => c.key === 'unit')?.align).toBe('center');
    expect(cols.find((c) => c.key === 'name')?.align).toBe('left');
  });

  it('คอลัมน์หน่วยกว้างพอสำหรับรหัสหน่วยจริง ไม่บีบจนตกบรรทัด', () => {
    const unit = columnsFor('GOODS_RECEIPT_SLIP', grLines).find((c) => c.key === 'unit')!;
    expect(unit.width).toBeGreaterThanOrEqual(40);
  });
});

/* ============================================================
   §6 ค่าที่แสดงในเซลล์
   ============================================================ */
describe('PHASE 13 — การจัดรูปแบบค่าในตาราง', () => {
  const cols = columnsFor('GOODS_RECEIPT_SLIP', grLines);
  const col = (k: string) => cols.find((c) => c.key === k)!;

  it('ลำดับเริ่มที่ 1', () => {
    expect(cellValue(grLines[0], col('no'), 0)).toBe('1');
    expect(cellValue(grLines[1], col('no'), 1)).toBe('2');
  });

  it('เงินสองตำแหน่ง มีคั่นหลักพัน', () => {
    expect(cellValue({ name: 'x', total: 1116.9 }, col('total'), 0)).toBe('1,116.90');
    expect(cellValue({ name: 'x', price: 130 }, col('price'), 0)).toBe('130.00');
  });

  it('จำนวนไม่บังคับทศนิยม', () => {
    expect(cellValue({ name: 'x', quantity: 7.4 }, col('quantity'), 0)).toBe('7.4');
    expect(cellValue({ name: 'x', quantity: 65.7 }, col('quantity'), 0)).toBe('65.7');
  });

  it('หน่วยแสดงรหัสหน่วยตามที่ส่งมา ไม่ตัดค่า', () => {
    expect(cellValue({ name: 'x', unit: 'KG' }, col('unit'), 0)).toBe('KG');
    expect(cellValue({ name: 'x', unit: 'ML' }, col('unit'), 0)).toBe('ML');
  });

  it('ค่าที่ไม่มีแสดงขีด ไม่แสดง undefined', () => {
    expect(cellValue({ name: 'x' }, col('total'), 0)).toBe('—');
    expect(cellValue({ name: 'x' }, col('unit'), 0)).toBe('—');
  });

  it('ใบปรับปรุงสต็อกแสดงเครื่องหมายบวกให้เห็นทิศทาง', () => {
    const ajCols = columnsFor('STOCK_ADJUSTMENT_SLIP', []);
    const change = ajCols.find((c) => c.key === 'change')!;
    expect(cellValue({ name: 'x', change: 1.6 }, change, 0)).toBe('+1.6');
    expect(cellValue({ name: 'x', change: -5.7 }, change, 0)).toBe('-5.7');
  });
});

/* ============================================================
   §16 §17 ไฟล์ PDF ที่ได้จริง
   ============================================================ */
describe('PHASE 13 — ไฟล์ PDF', () => {
  const pageCount = (buf: Buffer) => (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;

  /* PHASE 14 — เปลี่ยนกระดาษเป็น A5 (ครึ่ง A4) เพื่อประหยัดกระดาษ
     ข้อนี้จึงตรวจว่าเป็น PDF จริงและใช้ขนาดที่ตั้งใจไว้ ณ ปัจจุบัน */
  it('เป็นไฟล์ PDF จริงและขนาดครึ่ง A4', async () => {
    const buf = await renderBusinessPdf(baseDoc());
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('/MediaBox [0 0 419.53 595.28]');
  });

  it('ฝังโลโก้ลงในไฟล์จริง', async () => {
    const buf = await renderBusinessPdf(baseDoc());
    expect(buf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
  });

  /* PHASE 14 — แบรนด์ S2A ถูกฝังทุกเอกสารเสมอ ดังนั้นจะมีภาพอยู่แล้วหนึ่งรูป
     ข้อนี้จึงตรวจแค่ว่า "ไม่มีโลโก้บริษัท" แล้วยังสร้างเอกสารได้ตามปกติ */
  it('ไม่มีโลโก้บริษัทก็ยังสร้างเอกสารได้', async () => {
    const buf = await renderBusinessPdf(baseDoc({ company: { ...company, logoUrl: null } }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('ฝังฟอนต์ทั้ง regular และ bold — เอกสารจึงมีน้ำหนักตัวอักษรจริง', async () => {
    const buf = await renderBusinessPdf(baseDoc());
    expect((buf.toString('latin1').match(/\/FontFile2/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('เอกสารสั้นอยู่หน้าเดียว เอกสารยาวขึ้นหน้าใหม่เอง', async () => {
    const short = await renderBusinessPdf(baseDoc());
    expect(pageCount(short)).toBe(1);

    const many: DocumentLine[] = Array.from({ length: 40 }, (_, i) => ({
      name: `วัตถุดิบทดสอบรายการที่ ${i + 1}`, quantity: 12.5, unit: 'KG', price: 25.5, total: 318.75,
    }));
    const long = await renderBusinessPdf(baseDoc({ lines: many, total: 12750 }));
    expect(pageCount(long)).toBeGreaterThan(1);
  });

  it('เอกสารไม่มียอดรวม (ใบเบิก) ก็สร้างได้', async () => {
    const buf = await renderBusinessPdf(baseDoc({
      type: 'STOCK_ISSUE_SLIP',
      lines: [{ name: 'ไส้หมู', quantity: 2, unit: 'KG' }],
      total: undefined,
    }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('ฟิลด์บริษัทที่เป็น null ไม่ทำให้ render ล้ม', async () => {
    const bare = { nameTh: 'บริษัท ทดสอบ จำกัด' };
    const buf = await renderBusinessPdf(baseDoc({ company: bare }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

/* ============================================================
   §25 ชื่อไฟล์
   ============================================================ */
describe('PHASE 13 — ชื่อไฟล์ดาวน์โหลด', () => {
  it('ส่งทั้ง filename ASCII และ filename* สำหรับชื่อไทย', () => {
    const h = contentDisposition('attachment', 'GR-รับของ-001.xlsx');
    expect(h).toMatch(/^attachment; filename="[\x20-\x7E]+"/);
    expect(h).toContain("filename*=UTF-8''");
    expect(decodeURIComponent(h.split("filename*=UTF-8''")[1])).toBe('GR-รับของ-001.xlsx');
  });

  it('ชื่อ ASCII ล้วนไม่ถูกแปลง', () => {
    expect(contentDisposition('inline', 'GR-RI690818001.pdf'))
      .toContain('filename="GR-RI690818001.pdf"');
  });

  it('ตัดอักขระที่ทำให้ header เสีย', () => {
    expect(contentDisposition('attachment', 'a"b\\c.xlsx')).toContain('filename="a_b_c.xlsx"');
  });
});

/* ============================================================
   §21 §22 ไฟล์ Excel ต้องเป็น XLSX จริง
   ============================================================ */
describe('PHASE 13 — ไฟล์ Excel', () => {
  const buildWorkbook = async () => {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'S2A ERP';
    const sheet = wb.addWorksheet('รับของเข้า', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'เลขที่รับของ', key: 'receiptNo', width: 20 },
      { header: 'จำนวน', key: 'quantity', width: 12 },
      { header: 'หน่วย', key: 'unit', width: 10 },
      { header: 'ยอดรวม', key: 'total', width: 14 },
    ];
    sheet.addRow({ receiptNo: 'RI690818001', quantity: 7.4, unit: 'KG', total: 962 });
    sheet.getColumn('quantity').numFmt = '#,##0.####';
    sheet.getColumn('total').numFmt = '#,##0.00';
    return Buffer.from(await wb.xlsx.writeBuffer());
  };

  it('ขึ้นต้นด้วย magic bytes PK ของ ZIP/OOXML', async () => {
    const buf = await buildWorkbook();
    expect(buf.length).toBeGreaterThan(0);
    expect(buf.subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('ข้างในมีไฟล์มาตรฐาน OOXML ครบ', async () => {
    const raw = (await buildWorkbook()).toString('latin1');
    expect(raw).toContain('[Content_Types].xml');
    expect(raw).toContain('xl/workbook.xml');
    expect(raw).toContain('xl/worksheets/');
  });

  it('โหลดกลับด้วย ExcelJS ได้ และอ่านค่าเซลล์ตรง', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook());
    const ws = wb.getWorksheet('รับของเข้า');
    expect(ws).toBeTruthy();
    expect(ws!.getCell('A1').value).toBe('เลขที่รับของ');
    expect(ws!.getCell('A2').value).toBe('RI690818001');
    expect(ws!.getCell('B2').value).toBe(7.4);
    expect(ws!.getCell('C2').value).toBe('KG');
    expect(ws!.getCell('D2').value).toBe(962);
  });

  it('เก็บรูปแบบตัวเลขและการตรึงหัวตารางไว้จริง', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook());
    const ws = wb.getWorksheet('รับของเข้า')!;
    expect(ws.getColumn(2).numFmt).toBe('#,##0.####');
    expect(ws.getColumn(4).numFmt).toBe('#,##0.00');
    expect(ws.views?.[0]?.state).toBe('frozen');
  });

  it('ไฟล์ HTML ไม่ผ่านการตรวจ — กันเคสที่ทำให้เปิดไม่ได้', async () => {
    const html = Buffer.from('<!doctype html><html lang="th"></html>', 'utf8');
    expect(html.subarray(0, 2).toString('latin1')).not.toBe('PK');
    const wb = new ExcelJS.Workbook();
    await expect(wb.xlsx.load(html)).rejects.toBeTruthy();
  });
});
