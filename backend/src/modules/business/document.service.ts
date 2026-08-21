import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * PHASE 13 — ตัวสร้างเอกสาร PDF ของบริษัท
 *
 * ปัญหาเดิมที่ตรวจพบและแก้ในรอบนี้:
 *   1) ไม่เคยวาดโลโก้เลย ทั้งที่ Company.logoUrl มีไฟล์จริงอยู่
 *   2) ใช้แค่ nameTh + address ส่วน taxId / email / phone / website ไม่เคยแสดง
 *   3) ตารางไม่มีคอลัมน์ "ลำดับ" และ "ราคาต่อหน่วย" ทั้งที่ข้อมูลมีอยู่
 *   4) ขึ้นหน้าใหม่แล้วหัวตารางไม่ซ้ำ ทำให้หน้า 2 อ่านไม่รู้เรื่อง
 *   5) TOTAL ลอย ไม่มีเส้นคั่นและไม่มีบล็อกสรุป
 *   6) ไม่มีพื้นที่ลงนามเลย
 *   7) ไม่มีเลขหน้า
 *   8) ใช้ฟอนต์ตัวเดียวทั้ง regular และ bold จึงไม่มีน้ำหนักตัวอักษรจริง
 *
 * หลักการจัดหน้า: A4 แนวตั้ง ขอบ 14mm ใช้เส้นบาง เว้นวรรคเยอะ
 * สีที่ใช้เป็น navy + gold accent บนพื้นขาว และไม่ใช้สีเป็นตัวสื่อความหมายเพียงอย่างเดียว
 * (สถานะมีข้อความกำกับเสมอ) เพื่อให้พิมพ์ขาวดำแล้วยังอ่านได้
 */

export type DocumentType =
  | 'ORDER_SLIP' | 'KITCHEN_PREPARATION_SLIP' | 'STOCK_ISSUE_SLIP'
  | 'GOODS_RECEIPT_SLIP' | 'RECIPE_COST_SHEET' | 'SALES_REPORT'
  | 'STOCK_ADJUSTMENT_SLIP';

export type DocumentLine = {
  name: string;
  detail?: string;
  quantity?: string | number;
  unit?: string;
  price?: string | number;
  total?: string | number;
  /** ใช้กับใบปรับปรุงสต็อก: ยอดก่อน / เปลี่ยน / หลัง */
  before?: string | number;
  change?: string | number;
  after?: string | number;
  reason?: string;
};

export type DocumentCompany = {
  nameTh: string; nameEn?: string | null; logoUrl?: string | null;
  address?: string | null; phone?: string | null; email?: string | null;
  taxId?: string | null; website?: string | null; documentFooter?: string | null;
};

export type BusinessDocument = {
  type: DocumentType;
  title: string;
  documentNo: string;
  date: Date;
  company: DocumentCompany;
  createdBy?: string;
  status?: string;
  subject?: { label: string; value: string }[];
  lines: DocumentLine[];
  /** แถวสรุปเพิ่มเติมก่อน TOTAL เช่น ส่วนลด / ภาษี — ใส่เฉพาะที่มีจริง */
  summary?: { label: string; value: string | number }[];
  total?: string | number;
  totalLabel?: string;
  note?: string | null;
};

/** ชื่อเอกสารสองภาษา — อังกฤษเป็นหัว ไทยเป็นบรรทัดรอง */
const TITLES: Record<DocumentType, { en: string; th: string }> = {
  ORDER_SLIP: { en: 'ORDER SLIP', th: 'ใบสั่งซื้อ' },
  KITCHEN_PREPARATION_SLIP: { en: 'KITCHEN PREPARATION SLIP', th: 'ใบเตรียมครัว' },
  STOCK_ISSUE_SLIP: { en: 'STOCK ISSUE SLIP', th: 'ใบเบิกสินค้า' },
  GOODS_RECEIPT_SLIP: { en: 'GOODS RECEIPT', th: 'ใบรับสินค้า' },
  RECIPE_COST_SHEET: { en: 'RECIPE COST SHEET', th: 'ใบต้นทุนสูตรอาหาร' },
  SALES_REPORT: { en: 'SALES REPORT', th: 'รายงานการขาย' },
  STOCK_ADJUSTMENT_SLIP: { en: 'STOCK ADJUSTMENT', th: 'ใบปรับปรุงสต็อก' },
};

/* ---------- โทนสีเอกสาร ---------- */
const NAVY = '#0B2A47';
const NAVY_SOFT = '#1E3F60';
const GOLD = '#B8934A';
const INK = '#1A2430';
const MUTED = '#5E6E80';
const RULE = '#C9D3DE';
const ZEBRA = '#F6F8FA';

/* ---------- หน้ากระดาษ ---------- */
const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 40;                     // ≈14mm
export const CONTENT_W = PAGE_W - MARGIN * 2; // 515.28
const FOOTER_TOP = PAGE_H - 58;

/* ---------- ฟอนต์ไทย ---------- */
const pickFont = (candidates: string[]) => candidates.find(existsSync);
const THAI_REGULAR = pickFont(['C:/Windows/Fonts/LeelawUI.ttf', 'C:/Windows/Fonts/leelawad.ttf', 'C:/Windows/Fonts/tahoma.ttf']);
/** ของเดิมใช้ไฟล์เดียวกับ regular จึงไม่มีน้ำหนักตัวหนาจริง */
const THAI_BOLD = pickFont(['C:/Windows/Fonts/leelawdb.ttf', 'C:/Windows/Fonts/tahomabd.ttf']);

/**
 * แปลง logoUrl (path บนเว็บ) เป็นไฟล์จริงบนดิสก์เพื่อให้ PDFKit ฝังภาพได้
 * PDFKit อ่านได้เฉพาะ PNG/JPEG และต้องเป็นไฟล์/บัฟเฟอร์ ไม่ใช่ URL
 * ถ้าหาไม่เจอจะคืน null แล้วหัวเอกสารจะใช้ text mark แทน (ไม่ล้ม)
 */
export function resolveLogoPath(logoUrl?: string | null): string | null {
  if (!logoUrl) return null;
  if (/^https?:\/\//i.test(logoUrl)) return null;          // URL ภายนอกฝังไม่ได้ตอน render
  if (!/\.(png|jpe?g)$/i.test(logoUrl)) return null;        // SVG ฝังใน PDFKit ไม่ได้
  const rel = logoUrl.replace(/^\/+/, '');
  const roots = [
    process.env.DOCUMENT_ASSET_ROOT,
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), '../frontend/public'),
  ].filter((x): x is string => Boolean(x));
  for (const root of roots) {
    const candidate = path.join(root, rel);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const money = (v: string | number) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number) =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

export type Col = { key: string; label: string; width: number; align: 'left' | 'right' | 'center'; format?: 'money' | 'qty' };

/** คอลัมน์ของแต่ละชนิดเอกสาร — ต่างกันตามข้อมูลที่เอกสารนั้นมีจริง */
export function columnsFor(type: DocumentType, lines: DocumentLine[]): Col[] {
  const no: Col = { key: 'no', label: 'ลำดับ', width: 34, align: 'center' };
  const name: Col = { key: 'name', label: 'รายการ', width: 0, align: 'left' };
  const unit: Col = { key: 'unit', label: 'หน่วย', width: 48, align: 'center' };

  if (type === 'STOCK_ADJUSTMENT_SLIP') {
    return sized([no, name, { key: 'before', label: 'ก่อนปรับ', width: 62, align: 'right', format: 'qty' },
      { key: 'change', label: 'เปลี่ยน', width: 62, align: 'right', format: 'qty' },
      { key: 'after', label: 'หลังปรับ', width: 62, align: 'right', format: 'qty' },
      unit, { key: 'reason', label: 'เหตุผล', width: 86, align: 'left' }]);
  }
  // เอกสารที่ไม่มีราคา (ใบเบิก / ใบเตรียมครัว) ไม่ต้องมีคอลัมน์เงิน
  const hasPrice = lines.some((l) => l.price !== undefined || l.total !== undefined);
  if (!hasPrice) {
    return sized([no, name, { key: 'quantity', label: 'จำนวน', width: 76, align: 'right', format: 'qty' }, unit]);
  }
  return sized([no, name,
    { key: 'quantity', label: 'จำนวน', width: 62, align: 'right', format: 'qty' },
    unit,
    { key: 'price', label: 'ราคา/หน่วย', width: 74, align: 'right', format: 'money' },
    { key: 'total', label: 'มูลค่า', width: 84, align: 'right', format: 'money' }]);
}

/** คอลัมน์ "รายการ" กินพื้นที่ที่เหลือทั้งหมด */
function sized(cols: Col[]): Col[] {
  const fixed = cols.reduce((s, c) => s + c.width, 0);
  return cols.map((c) => (c.width === 0 ? { ...c, width: CONTENT_W - fixed } : c));
}

type Doc = PDFKit.PDFDocument;

export async function renderBusinessPdf(input: BusinessDocument): Promise<Buffer> {
  const t = TITLES[input.type];
  const doc = new PDFDocument({
    size: 'A4', margin: MARGIN, bufferPages: true,
    info: {
      Title: `${t.en} ${input.documentNo}`,
      Author: input.company.nameTh,
      Subject: `${t.th} ${input.documentNo}`,
      Creator: 'S2A ERP',
      CreationDate: new Date(),
    },
  });

  const chunks: Buffer[] = [];
  doc.on('data', (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  if (THAI_REGULAR) doc.registerFont('Thai', THAI_REGULAR);
  if (THAI_BOLD) doc.registerFont('ThaiBold', THAI_BOLD);
  const R = THAI_REGULAR ? 'Thai' : 'Helvetica';
  const B = THAI_BOLD ? 'ThaiBold' : 'Helvetica-Bold';

  let y = drawHeader(doc, input, t, R, B);
  y = drawInfo(doc, input, y, R, B);
  y = drawTable(doc, input, y, R, B);
  y = drawTotals(doc, input, y, R, B);
  y = drawNote(doc, input, y, R, B);
  drawSignatures(doc, y, R, B);
  drawFooters(doc, input, R);

  doc.end();
  return done;
}

/* ============================================================
   HEADER — โลโก้ + ตัวตนบริษัท ซ้าย / ชื่อเอกสาร + meta ขวา
   ============================================================ */
function drawHeader(doc: Doc, input: BusinessDocument, t: { en: string; th: string }, R: string, B: string): number {
  const c = input.company;
  const logo = resolveLogoPath(c.logoUrl);
  let leftX = MARGIN;
  const top = MARGIN;

  if (logo) {
    try {
      doc.image(logo, MARGIN, top, { fit: [56, 56] });
      leftX = MARGIN + 68;
    } catch { leftX = MARGIN; }   // ไฟล์เสีย → ถอยไปใช้ text mark
  }
  if (!logo) {
    // fallback text mark: อักษรย่อในกรอบ ไม่ใช่รูปปลอม
    doc.rect(MARGIN, top, 56, 56).lineWidth(1).strokeColor(NAVY).stroke();
    doc.fillColor(NAVY).font(B).fontSize(20)
      .text('S2A', MARGIN, top + 18, { width: 56, align: 'center' });
    leftX = MARGIN + 68;
  }

  const leftW = 300;
  doc.fillColor(NAVY).font(B).fontSize(15).text(c.nameTh, leftX, top + 1, { width: leftW });
  let ly = doc.y + 1;
  if (c.nameEn) {
    doc.fillColor(MUTED).font(R).fontSize(8).text(c.nameEn.toUpperCase(), leftX, ly, { width: leftW, characterSpacing: 0.6 });
    ly = doc.y + 2;
  }
  // แสดงเฉพาะ field ที่มีค่าจริง — ไม่มีก็ไม่ต้องขึ้นบรรทัด
  const contact: string[] = [];
  if (c.address) contact.push(c.address.replace(/\s*\n\s*/g, ' '));
  if (c.phone) contact.push(`โทร. ${c.phone}`);
  if (c.email) contact.push(c.email);
  if (c.website) contact.push(c.website);
  if (c.taxId) contact.push(`เลขประจำตัวผู้เสียภาษี ${c.taxId}`);
  if (contact.length) {
    doc.fillColor(MUTED).font(R).fontSize(8).text(contact.join('\n'), leftX, ly, { width: leftW, lineGap: 1.5 });
  }

  /* ---- ขวา: ชื่อเอกสาร + ข้อมูลอ้างอิง ---- */
  const rx = PAGE_W - MARGIN - 200;
  doc.fillColor(NAVY).font(B).fontSize(20).text(t.en, rx, top, { width: 200, align: 'right' });
  doc.fillColor(GOLD).font(B).fontSize(11).text(t.th, rx, doc.y, { width: 200, align: 'right' });

  const meta: [string, string][] = [
    ['เลขที่', input.documentNo],
    ['วันที่', input.date.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: 'numeric' })],
  ];
  if (input.createdBy) meta.push(['ผู้จัดทำ', input.createdBy]);
  if (input.status) meta.push(['สถานะ', input.status]);

  let my = doc.y + 6;
  for (const [label, value] of meta) {
    doc.fillColor(MUTED).font(R).fontSize(8).text(label, rx, my, { width: 66, align: 'right' });
    doc.fillColor(INK).font(B).fontSize(9).text(value, rx + 70, my - 1, { width: 130, align: 'right' });
    my += 13;
  }

  const headerBottom = Math.max(doc.y, my, top + 74) + 8;
  doc.moveTo(MARGIN, headerBottom).lineTo(PAGE_W - MARGIN, headerBottom).lineWidth(1.6).strokeColor(NAVY).stroke();
  doc.moveTo(MARGIN, headerBottom + 2.6).lineTo(MARGIN + 92, headerBottom + 2.6).lineWidth(1.6).strokeColor(GOLD).stroke();
  return headerBottom + 16;
}

/* ============================================================
   INFO — ตารางข้อมูลเอกสารแบบเบา ไม่ใช่การ์ดแบบหน้าเว็บ
   ============================================================ */
function drawInfo(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  const items = input.subject ?? [];
  if (!items.length) return y;
  const perRow = items.length <= 2 ? 2 : items.length <= 6 ? 3 : 4;
  const colW = CONTENT_W / perRow;
  let maxY = y;
  items.forEach((entry, i) => {
    const x = MARGIN + (i % perRow) * colW;
    const rowY = y + Math.floor(i / perRow) * 34;
    doc.fillColor(MUTED).font(R).fontSize(7.5).text(entry.label.toUpperCase(), x, rowY, { width: colW - 12, characterSpacing: 0.4 });
    doc.fillColor(INK).font(B).fontSize(10).text(entry.value || '—', x, rowY + 11, { width: colW - 12 });
    maxY = Math.max(maxY, rowY + 30);
  });
  doc.moveTo(MARGIN, maxY).lineTo(PAGE_W - MARGIN, maxY).lineWidth(0.5).strokeColor(RULE).stroke();
  return maxY + 14;
}

/* ============================================================
   TABLE — หัวตารางซ้ำทุกหน้า
   ============================================================ */
function drawTableHead(doc: Doc, cols: Col[], y: number, B: string): number {
  const h = 22;
  doc.rect(MARGIN, y, CONTENT_W, h).fill(NAVY);
  let x = MARGIN;
  doc.fillColor('#FFFFFF').font(B).fontSize(8.5);
  for (const col of cols) {
    doc.text(col.label, x + 6, y + 7, { width: col.width - 12, align: col.align, lineBreak: false });
    x += col.width;
  }
  return y + h;
}

export function cellValue(line: DocumentLine, col: Col, index: number): string {
  if (col.key === 'no') return String(index + 1);
  const raw = (line as unknown as Record<string, unknown>)[col.key];
  if (raw === undefined || raw === null || raw === '') return col.key === 'name' ? line.name : '—';
  if (col.format === 'money') return money(raw as string | number);
  if (col.format === 'qty') {
    const n = Number(raw);
    // ใบปรับปรุงสต็อก: แสดงเครื่องหมายให้เห็นทิศทางชัด
    return col.key === 'change' && n > 0 ? `+${qty(n)}` : qty(n);
  }
  return String(raw);
}

function drawTable(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  const cols = columnsFor(input.type, input.lines);
  y = drawTableHead(doc, cols, y, B);

  input.lines.forEach((line, i) => {
    const hasDetail = Boolean(line.detail);
    const rowH = hasDetail ? 30 : 21;
    // เหลือที่ไม่พอ → ขึ้นหน้าใหม่แล้ววาดหัวตารางซ้ำ
    if (y + rowH > FOOTER_TOP - 10) {
      doc.addPage();
      y = drawTableHead(doc, cols, MARGIN, B);
    }
    if (i % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(ZEBRA);

    let x = MARGIN;
    for (const col of cols) {
      const isName = col.key === 'name';
      doc.fillColor(isName ? INK : NAVY_SOFT).font(isName ? B : R).fontSize(9);
      doc.text(cellValue(line, col, i), x + 6, y + 6, {
        width: col.width - 12,
        align: col.align,
        // หน่วย/ตัวเลขห้ามตัดบรรทัด ชื่อรายการตัดได้บรรทัดเดียว
        lineBreak: isName,
        ellipsis: !isName,
        height: isName ? rowH - 8 : undefined,
      });
      x += col.width;
    }
    if (hasDetail) {
      doc.fillColor(MUTED).font(R).fontSize(7.5)
        .text(line.detail!, MARGIN + cols[0].width + 6, y + 18, { width: cols[1].width - 12, lineBreak: false, ellipsis: true });
    }
    doc.moveTo(MARGIN, y + rowH).lineTo(PAGE_W - MARGIN, y + rowH).lineWidth(0.4).strokeColor(RULE).stroke();
    y += rowH;
  });
  return y;
}

/* ============================================================
   TOTALS — บล็อกสรุปชิดขวา
   ============================================================ */
function drawTotals(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  const rows = input.summary ?? [];
  if (input.total === undefined && !rows.length) return y + 6;

  const blockW = 240;
  const x = PAGE_W - MARGIN - blockW;
  let ty = y + 12;
  if (ty + 30 + rows.length * 16 > FOOTER_TOP) { doc.addPage(); ty = MARGIN; }

  for (const row of rows) {
    doc.fillColor(MUTED).font(R).fontSize(9).text(row.label, x, ty, { width: blockW - 110, align: 'right' });
    doc.fillColor(INK).font(R).fontSize(9).text(money(row.value), x + blockW - 106, ty, { width: 106, align: 'right' });
    ty += 16;
  }
  if (input.total !== undefined) {
    doc.moveTo(x, ty + 2).lineTo(PAGE_W - MARGIN, ty + 2).lineWidth(1).strokeColor(NAVY).stroke();
    ty += 8;
    doc.fillColor(NAVY).font(B).fontSize(10)
      .text(input.totalLabel ?? 'ยอดรวมทั้งสิ้น', x, ty + 4, { width: blockW - 116, align: 'right' });
    doc.fillColor(NAVY).font(B).fontSize(15)
      .text(money(input.total), x + blockW - 112, ty, { width: 112, align: 'right' });
    ty += 26;
    doc.moveTo(x + blockW - 112, ty).lineTo(PAGE_W - MARGIN, ty).lineWidth(0.8).strokeColor(GOLD).stroke();
    ty += 6;
  }
  return ty;
}

function drawNote(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  if (!input.note) return y;
  let ny = y + 10;
  if (ny + 34 > FOOTER_TOP) { doc.addPage(); ny = MARGIN; }
  doc.fillColor(MUTED).font(B).fontSize(8).text('หมายเหตุ', MARGIN, ny);
  doc.fillColor(INK).font(R).fontSize(9).text(input.note, MARGIN, ny + 11, { width: CONTENT_W - 260 });
  return Math.max(doc.y, ny + 30);
}

/* ============================================================
   SIGNATURES — ไม่ให้ถูกตัดข้ามหน้า
   ============================================================ */
function drawSignatures(doc: Doc, y: number, R: string, B: string) {
  const BLOCK_H = 76;
  let sy = y + 26;
  if (sy + BLOCK_H > FOOTER_TOP) { doc.addPage(); sy = MARGIN + 10; }

  const roles = ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'];
  const colW = CONTENT_W / roles.length;
  roles.forEach((role, i) => {
    const x = MARGIN + i * colW;
    const lineY = sy + 34;
    doc.moveTo(x + 14, lineY).lineTo(x + colW - 14, lineY).lineWidth(0.7).strokeColor(RULE).dash(2, { space: 2 }).stroke();
    doc.undash();
    doc.fillColor(INK).font(B).fontSize(9).text(role, x, lineY + 7, { width: colW, align: 'center' });
    doc.fillColor(MUTED).font(R).fontSize(7.5)
      .text('วันที่ ......... / ......... / .........', x, lineY + 20, { width: colW, align: 'center' });
  });
}

/* ============================================================
   FOOTER — เดินทุกหน้า ใส่เลขหน้า X / Y
   ============================================================ */
function drawFooters(doc: Doc, input: BusinessDocument, R: string) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(range.start + i);
    doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE_W - MARGIN, FOOTER_TOP).lineWidth(0.5).strokeColor(RULE).stroke();

    const left: string[] = [input.company.nameTh];
    if (input.company.phone) left.push(`โทร. ${input.company.phone}`);
    if (input.company.email) left.push(input.company.email);
    doc.fillColor(MUTED).font(R).fontSize(7.5)
      .text(left.join('  ·  '), MARGIN, FOOTER_TOP + 7, { width: CONTENT_W - 170, lineBreak: false, ellipsis: true });

    doc.fillColor(MUTED).font(R).fontSize(7.5)
      .text(`${input.documentNo}   ·   หน้า ${i + 1} / ${total}`, PAGE_W - MARGIN - 170, FOOTER_TOP + 7,
        { width: 170, align: 'right', lineBreak: false });

    if (input.company.documentFooter) {
      doc.fillColor(MUTED).font(R).fontSize(7)
        .text(input.company.documentFooter, MARGIN, FOOTER_TOP + 20, { width: CONTENT_W, align: 'center', lineBreak: false, ellipsis: true });
    }
  }
  doc.flushPages();
}
