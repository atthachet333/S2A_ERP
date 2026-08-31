import PDFDocument from 'pdfkit';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { documentImage } from './document-assets.js';

/**
 * ตัวสร้างเอกสาร PDF ของบริษัท
 *
 * PHASE 13 วางโครงไว้ (โลโก้ / ข้อมูลบริษัท / ตาราง / ยอดรวม / ลายเซ็น / เลขหน้า)
 * PHASE 14 เปลี่ยนขนาดกระดาษเป็น A5 = ครึ่ง A4 พอดี (419.53 × 595.28 pt)
 *          เพื่อประหยัดกระดาษ และจัดลำดับแบรนด์ใหม่เป็น
 *            แบรนด์หลัก = S2A (ระบบ)
 *            รองลงมา    = บริษัทที่เอกสารนั้นออกให้ (มาจาก Company จริง)
 *          ความหนาแน่นข้อมูลอ้างอิงแบบใบส่งของเชิงพาณิชย์ทั่วไป ไม่ได้ลอกแบรนด์ผู้อื่น
 *
 * กติกาที่คงไว้: field ที่เป็น null จะไม่แสดง และไม่ใช้สีเป็นตัวสื่อความหมายเพียงอย่างเดียว
 */

export type DocumentType =
  | 'ORDER_SLIP' | 'KITCHEN_PREPARATION_SLIP' | 'STOCK_ISSUE_SLIP'
  | 'GOODS_RECEIPT_SLIP' | 'RECIPE_COST_SHEET' | 'SALES_REPORT'
  | 'STOCK_ADJUSTMENT_SLIP' | 'STOCK_TRANSFER_SLIP' | 'PRODUCTION_RUN_SLIP' | 'PURCHASE_PLAN' | 'PURCHASE_ORDER';

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
  expected?: string | number;
  actual?: string | number;
  variance?: string | number;
  reason?: string;
};

export type DocumentCompany = {
  nameTh: string; nameEn?: string | null; logoUrl?: string | null;
  address?: string | null; phone?: string | null; email?: string | null;
  taxId?: string | null; website?: string | null; lineId?: string | null; documentFooter?: string | null;
};

export type BusinessDocument = {
  type: DocumentType;
  title: string;
  documentNo: string;
  date: Date;
  company: DocumentCompany;
  createdBy?: string;
  status?: string;
  reference?: string | null;
  subject?: { label: string; value: string }[];
  lines: DocumentLine[];
  /** แถวสรุปเพิ่มเติมก่อนยอดรวม เช่น ส่วนลด / ภาษี — ใส่เฉพาะที่มีจริง */
  summary?: { label: string; value: string | number }[];
  total?: string | number;
  totalLabel?: string;
  note?: string | null;
};

const TITLES: Record<DocumentType, { en: string; th: string }> = {
  ORDER_SLIP: { en: 'ORDER SLIP', th: 'ใบสั่งซื้อ' },
  KITCHEN_PREPARATION_SLIP: { en: 'KITCHEN PREP', th: 'ใบเตรียมครัว' },
  STOCK_ISSUE_SLIP: { en: 'STOCK ISSUE', th: 'ใบเบิกสินค้า' },
  GOODS_RECEIPT_SLIP: { en: 'GOODS RECEIPT', th: 'ใบรับสินค้า' },
  RECIPE_COST_SHEET: { en: 'COST SHEET', th: 'ใบต้นทุนสูตรอาหาร' },
  SALES_REPORT: { en: 'SALES REPORT', th: 'รายงานการขาย' },
  STOCK_ADJUSTMENT_SLIP: { en: 'STOCK ADJUSTMENT', th: 'ใบปรับปรุงสต็อก' },
  // PHASE 18 — ใบโอนย้ายไม่มีตัวเลขการเงิน จึงใช้ชุดคอลัมน์แบบไม่มีราคาที่มีอยู่แล้ว
  STOCK_TRANSFER_SLIP: { en: 'STOCK TRANSFER', th: 'ใบโอนย้ายระหว่างคลัง' },
  PRODUCTION_RUN_SLIP: { en: 'PRODUCTION RUN', th: 'ใบผลิตสินค้า' },
  PURCHASE_PLAN: { en: 'PURCHASE PLAN', th: 'ใบวางแผนจัดซื้อ' },
  PURCHASE_ORDER: { en: 'PURCHASE ORDER', th: 'ใบสั่งซื้อ' },
};

/* ---------- โทนสีเอกสาร ---------- */
const NAVY = '#0B2A47';
const NAVY_SOFT = '#1E3F60';
const GOLD = '#B8934A';
const INK = '#1A2430';
const MUTED = '#5E6E80';
const RULE = '#C9D3DE';
const ZEBRA = '#F6F8FA';

/* ---------- กระดาษ A5 = ครึ่ง A4 ---------- */
export const PAGE_SIZE = 'A5';
export const PAGE_W = 419.53;
export const PAGE_H = 595.28;
const MARGIN = 26;                              // ≈9mm — ใบสลิปเล็กใช้ขอบแคบได้
export const CONTENT_W = PAGE_W - MARGIN * 2;   // 367.53
const FOOTER_TOP = PAGE_H - 34;

/* ---------- ฟอนต์ไทย ---------- */
const pickFont = (candidates: string[]) => candidates.find(existsSync);
const THAI_REGULAR = pickFont(['C:/Windows/Fonts/LeelawUI.ttf', 'C:/Windows/Fonts/leelawad.ttf', 'C:/Windows/Fonts/tahoma.ttf']);
const THAI_BOLD = pickFont(['C:/Windows/Fonts/leelawdb.ttf', 'C:/Windows/Fonts/tahomabd.ttf']);

/**
 * โลโก้แบรนด์หลักของระบบ — ใช้กับทุกเอกสาร ไม่ผูกกับบริษัทใดบริษัทหนึ่ง
 *
 * PHASE 14B ลำดับการเลือกไฟล์:
 *   1) s2a-logo-mark.png  = เครื่องหมายเฉพาะงานเอกสาร (ยังไม่มีในโปรเจกต์ รอผู้ใช้ส่งไฟล์จริง)
 *   2) s2a-logo.png       = โลโก้ที่ระบบใช้อยู่ ใช้ชั่วคราวไปก่อน
 * ไม่ว่าจะเจอไฟล์ไหน จะถูกย่อสำเนาไว้ใช้กับเอกสารเสมอ ต้นฉบับความละเอียดสูงไม่ถูกแตะ
 */
const S2A_LOGO_SOURCE = pickFont([
  path.resolve(process.cwd(), '../frontend/dist/s2a-logo-mark.png'),
  path.resolve(process.cwd(), '../frontend/public/s2a-logo-mark.png'),
  path.resolve(process.cwd(), '../frontend/dist/s2a-logo.png'),
  path.resolve(process.cwd(), '../frontend/public/s2a-logo.png'),
]) ?? null;

export const S2A_LOGO = documentImage(S2A_LOGO_SOURCE);
/** true เมื่อใช้ไฟล์เครื่องหมายเฉพาะเอกสารที่ผู้ใช้ส่งมาแล้ว */
export const S2A_LOGO_IS_DEDICATED = Boolean(S2A_LOGO_SOURCE && /s2a-logo-mark\.png$/i.test(S2A_LOGO_SOURCE));

/**
 * แปลง logoUrl (path บนเว็บ) เป็นไฟล์จริงบนดิสก์เพื่อให้ PDFKit ฝังภาพได้
 * PDFKit อ่านได้เฉพาะ PNG/JPEG และต้องเป็นไฟล์/บัฟเฟอร์ ไม่ใช่ URL
 * ถ้าหาไม่เจอคืน null แล้วหัวเอกสารจะใช้ตัวอักษรแทน (ไม่ล้ม)
 */
export function resolveLogoPath(logoUrl?: string | null): string | null {
  if (!logoUrl) return null;
  if (/^https?:\/\//i.test(logoUrl)) return null;
  if (!/\.(png|jpe?g)$/i.test(logoUrl)) return null;
  const uploadRel = logoUrl.replace(/^\/?api\/uploads\//, '');
  const rel = logoUrl.replace(/^\/+/, '');
  const roots = [
    process.env.DOCUMENT_ASSET_ROOT,
    path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './data/uploads'),
    path.resolve(process.cwd(), '../frontend/dist'),
    path.resolve(process.cwd(), '../frontend/public'),
  ].filter((x): x is string => Boolean(x));
  for (const root of roots) {
    const candidate = path.join(root, uploadRel);
    if (candidate.startsWith(root) && existsSync(candidate)) return candidate;
  }
  for (const root of roots) {
    const candidate = path.join(root, rel);
    if (candidate.startsWith(root) && existsSync(candidate)) return candidate;
  }
  return null;
}

const money = (v: string | number) =>
  Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = (v: string | number) =>
  Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });

export type Col = { key: string; label: string; width: number; align: 'left' | 'right' | 'center'; format?: 'money' | 'qty' };

/** คอลัมน์ของแต่ละชนิดเอกสาร — ความกว้างปรับให้พอดีหน้า A5 */
export function columnsFor(type: DocumentType, lines: DocumentLine[]): Col[] {
  const no: Col = { key: 'no', label: '#', width: 20, align: 'center' };
  const name: Col = { key: 'name', label: 'รายการ', width: 0, align: 'left' };
  const unit: Col = { key: 'unit', label: 'หน่วย', width: 42, align: 'center' };

  if (type === 'STOCK_ADJUSTMENT_SLIP') {
    /* StockAdjustmentItem ไม่มีเหตุผลรายบรรทัด (อยู่ที่หัวเอกสาร) จึงไม่ทำคอลัมน์เหตุผล */
    return sized([no, name,
      { key: 'before', label: 'ก่อน', width: 54, align: 'right', format: 'qty' },
      { key: 'change', label: 'เปลี่ยน', width: 54, align: 'right', format: 'qty' },
      { key: 'after', label: 'หลัง', width: 54, align: 'right', format: 'qty' },
      unit]);
  }
  if (type === 'PRODUCTION_RUN_SLIP') {
    return sized([no, name,
      { key: 'expected', label: 'คาดหมาย', width: 58, align: 'right', format: 'qty' },
      { key: 'actual', label: 'ใช้จริง', width: 58, align: 'right', format: 'qty' },
      { key: 'variance', label: 'ผลต่าง', width: 54, align: 'right', format: 'qty' },
      unit]);
  }
  // เอกสารที่ไม่มีราคา (ใบเบิก / ใบเตรียมครัว) ไม่ต้องมีคอลัมน์เงิน
  const hasPrice = lines.some((l) => l.price !== undefined || l.total !== undefined);
  if (!hasPrice) {
    return sized([no, name, { key: 'quantity', label: 'จำนวน', width: 60, align: 'right', format: 'qty' }, unit]);
  }
  return sized([no, name,
    { key: 'quantity', label: 'จำนวน', width: 48, align: 'right', format: 'qty' },
    unit,
    { key: 'price', label: 'ราคา/หน่วย', width: 60, align: 'right', format: 'money' },
    { key: 'total', label: 'มูลค่า', width: 66, align: 'right', format: 'money' }]);
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
    size: PAGE_SIZE, margin: MARGIN, bufferPages: true,
    info: {
      Title: `${t.en} ${input.documentNo}`,
      Author: 'S2A — S2 Accounting Consultant',
      Subject: `${t.th} ${input.documentNo} · ${input.company.nameTh}`,
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

  let y = drawBrandHeader(doc, input, t, R, B);
  y = drawMeta(doc, input, y, R, B);
  y = drawCompanyBlock(doc, input, y, R, B);
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
   1) แบรนด์หลัก S2A + ชื่อเอกสาร
   ============================================================ */
function drawBrandHeader(doc: Doc, input: BusinessDocument, t: { en: string; th: string }, R: string, B: string): number {
  const top = MARGIN;
  let x = MARGIN;

  if (S2A_LOGO) {
    try { doc.image(S2A_LOGO, x, top - 2, { fit: [30, 30] }); x += 36; }
    catch { /* ไฟล์เสีย → ใช้ตัวอักษรแทน */ }
  }
  doc.fillColor(NAVY).font(B).fontSize(15).text('S2A', x, top - 1, { lineBreak: false });
  doc.fillColor(MUTED).font(R).fontSize(6).text('S2 ACCOUNTING CONSULTANT', x, top + 15, { characterSpacing: 0.5, lineBreak: false });

  /* ชนิดเอกสาร → เลขที่ (เด่นสุด) เพื่อให้หยิบใบถูกได้ทันทีจากปึกเอกสาร */
  const rw = 165;
  const rx = PAGE_W - MARGIN - rw;
  doc.fillColor(MUTED).font(R).fontSize(6).text(t.en, rx, top - 2, { width: rw, align: 'right', characterSpacing: 0.6, lineBreak: false });
  doc.fillColor(NAVY).font(B).fontSize(11).text(t.th, rx, top + 5, { width: rw, align: 'right', lineBreak: false });
  doc.fillColor(NAVY).font(B).fontSize(14).text(input.documentNo, rx, top + 19, { width: rw, align: 'right', lineBreak: false });

  const bottom = top + 38;
  doc.moveTo(MARGIN, bottom).lineTo(PAGE_W - MARGIN, bottom).lineWidth(1.2).strokeColor(NAVY).stroke();
  doc.moveTo(MARGIN, bottom + 1.8).lineTo(MARGIN + 54, bottom + 1.8).lineWidth(1.2).strokeColor(GOLD).stroke();
  return bottom + 8;
}

/* ============================================================
   2) เลขที่ / วันที่ / สถานะ / อ้างอิง / ผู้จัดทำ
   ============================================================ */
function drawMeta(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  /* เลขที่เอกสารอยู่ในหัวกระดาษแล้ว ตรงนี้จึงเหลือข้อมูลรอง */
  const entries: [string, string][] = [
    ['วันที่', input.date.toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' })],
  ];
  if (input.status) entries.push(['สถานะ', input.status]);
  if (input.reference) entries.push(['เอกสารอ้างอิง', input.reference]);
  if (input.createdBy) entries.push(['ผู้จัดทำ', input.createdBy]);

  const perRow = 3;
  const colW = CONTENT_W / perRow;
  let maxY = y;
  entries.forEach((entry, i) => {
    const cx = MARGIN + (i % perRow) * colW;
    const ry = y + Math.floor(i / perRow) * 15;
    doc.fillColor(MUTED).font(R).fontSize(6.5).text(entry[0], cx, ry, { width: colW - 6, lineBreak: false });
    doc.fillColor(INK).font(B).fontSize(8.5).text(entry[1], cx, ry + 6.5, { width: colW - 6, lineBreak: false, ellipsis: true });
    maxY = Math.max(maxY, ry + 15);
  });
  return maxY + 5;
}

/* ============================================================
   3) บริษัทที่เอกสารออกให้ — ข้อมูลจริงจาก Company เท่านั้น
   ============================================================ */
function drawCompanyBlock(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  const c = input.company;
  doc.rect(MARGIN, y, CONTENT_W, 0.6).fill(RULE);

  let cy = y + 5;
  doc.fillColor(MUTED).font(R).fontSize(6).text('เอกสารสำหรับ', MARGIN, cy, { lineBreak: false });
  cy += 8;

  const logo = documentImage(resolveLogoPath(c.logoUrl), 120);
  let textX = MARGIN;
  if (logo) {
    try { doc.image(logo, MARGIN, cy, { fit: [26, 26] }); textX = MARGIN + 32; }
    catch { textX = MARGIN; }
  }
  const textW = CONTENT_W - (textX - MARGIN);

  doc.fillColor(NAVY).font(B).fontSize(9.5).text(c.nameTh, textX, cy, { width: textW, lineBreak: false, ellipsis: true });
  let ly = cy + 11;
  if (c.nameEn) {
    doc.fillColor(MUTED).font(R).fontSize(6.5).text(c.nameEn.toUpperCase(), textX, ly, { width: textW, lineBreak: false, ellipsis: true });
    ly += 8;
  }
  /* แสดงเฉพาะช่องที่มีค่าจริง — ว่างแล้วข้ามไปเลย ไม่เว้นบรรทัดทิ้งไว้ */
  if (c.address) {
    doc.fillColor(INK).font(R).fontSize(6.8).text(c.address.replace(/\s*\n\s*/g, ' '), textX, ly, { width: textW, lineGap: 0.5 });
    ly = doc.y + 1;
  }
  const contact: string[] = [];
  if (c.taxId) contact.push(`เลขภาษี ${c.taxId}`);
  if (c.phone) contact.push(`โทร. ${c.phone}`);
  if (c.email) contact.push(c.email);
  if (c.lineId) contact.push(`LINE ${c.lineId}`);
  if (c.website) contact.push(c.website);
  if (contact.length) {
    doc.fillColor(MUTED).font(R).fontSize(6.8).text(contact.join('  ·  '), textX, ly, { width: textW, lineGap: 0.5 });
    ly = doc.y + 1;
  }

  const bottom = Math.max(ly, logo ? cy + 28 : ly) + 4;
  doc.rect(MARGIN, bottom, CONTENT_W, 0.6).fill(RULE);
  return bottom + 7;
}

/* ============================================================
   4) ข้อมูลเฉพาะเอกสาร (ผู้จำหน่าย / คลัง / เหตุผล ฯลฯ)
   ============================================================ */
function drawInfo(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  const items = input.subject ?? [];
  if (!items.length) return y;
  const perRow = items.length <= 2 ? 2 : 3;
  const colW = CONTENT_W / perRow;
  let maxY = y;
  items.forEach((entry, i) => {
    const x = MARGIN + (i % perRow) * colW;
    const ry = y + Math.floor(i / perRow) * 15;
    doc.fillColor(MUTED).font(R).fontSize(6.5).text(entry.label, x, ry, { width: colW - 6, lineBreak: false });
    doc.fillColor(INK).font(B).fontSize(8).text(entry.value || '—', x, ry + 6.5, { width: colW - 6, lineBreak: false, ellipsis: true });
    maxY = Math.max(maxY, ry + 15);
  });
  return maxY + 5;
}

/* ============================================================
   5) ตาราง — หัวตารางซ้ำทุกหน้า
   ============================================================ */
function drawTableHead(doc: Doc, cols: Col[], y: number, B: string): number {
  const h = 15;
  doc.rect(MARGIN, y, CONTENT_W, h).fill(NAVY);
  let x = MARGIN;
  doc.fillColor('#FFFFFF').font(B).fontSize(7);
  for (const col of cols) {
    doc.text(col.label, x + 4, y + 4.5, { width: col.width - 8, align: col.align, lineBreak: false });
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
    return col.key === 'change' && n > 0 ? `+${qty(n)}` : qty(n);
  }
  return String(raw);
}

function drawTable(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  const cols = columnsFor(input.type, input.lines);
  y = drawTableHead(doc, cols, y, B);

  input.lines.forEach((line, i) => {
    const hasDetail = Boolean(line.detail);
    const rowH = hasDetail ? 21 : 14;
    /* ที่เหลือไม่พอ → ขึ้นหน้าใหม่แล้ววาดหัวตารางซ้ำ ไม่ตัดแถวกลางคัน */
    if (y + rowH > FOOTER_TOP - 8) {
      doc.addPage();
      y = drawTableHead(doc, cols, MARGIN, B);
    }
    if (i % 2 === 1) doc.rect(MARGIN, y, CONTENT_W, rowH).fill(ZEBRA);

    let x = MARGIN;
    for (const col of cols) {
      const isName = col.key === 'name';
      doc.fillColor(isName ? INK : NAVY_SOFT).font(isName ? B : R).fontSize(7.5);
      doc.text(cellValue(line, col, i), x + 4, y + 4, {
        width: col.width - 8,
        align: col.align,
        // รหัสหน่วยและตัวเลขห้ามตกบรรทัดเด็ดขาด ชื่อยาวให้ตัดด้วย ellipsis
        lineBreak: false,
        ellipsis: true,
      });
      x += col.width;
    }
    if (hasDetail) {
      doc.fillColor(MUTED).font(R).fontSize(6.2)
        .text(line.detail!, MARGIN + cols[0].width + 4, y + 13, { width: cols[1].width - 8, lineBreak: false, ellipsis: true });
    }
    doc.moveTo(MARGIN, y + rowH).lineTo(PAGE_W - MARGIN, y + rowH).lineWidth(0.3).strokeColor(RULE).stroke();
    y += rowH;
  });
  return y;
}

/* ============================================================
   6) ยอดรวม — บล็อกกระชับชิดขวา
   ============================================================ */
function drawTotals(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  const rows = input.summary ?? [];
  if (input.total === undefined && !rows.length) return y + 4;

  const blockW = 176;
  const x = PAGE_W - MARGIN - blockW;
  let ty = y + 6;
  if (ty + 22 + rows.length * 11 > FOOTER_TOP) { doc.addPage(); ty = MARGIN; }

  for (const row of rows) {
    doc.fillColor(MUTED).font(R).fontSize(7.5).text(row.label, x, ty, { width: blockW - 82, align: 'right', lineBreak: false });
    doc.fillColor(INK).font(R).fontSize(7.5).text(money(row.value), x + blockW - 78, ty, { width: 78, align: 'right', lineBreak: false });
    ty += 11;
  }
  if (input.total !== undefined) {
    /* ยอดรวมสุทธิ: แถบพื้นอ่อน + ตัวเลขใหญ่สุดในเอกสาร ให้เห็นก่อนตัวเลขอื่น */
    doc.rect(x, ty, blockW, 21).fill(ZEBRA);
    doc.moveTo(x, ty).lineTo(PAGE_W - MARGIN, ty).lineWidth(0.9).strokeColor(NAVY).stroke();
    doc.fillColor(NAVY).font(B).fontSize(8)
      .text(input.totalLabel ?? 'ยอดรวมทั้งสิ้น', x + 6, ty + 7, { width: blockW - 96, align: 'left', lineBreak: false });
    doc.fillColor(NAVY).font(B).fontSize(13.5)
      .text(money(input.total), x + blockW - 86, ty + 4, { width: 80, align: 'right', lineBreak: false });
    ty += 21;
    doc.moveTo(x, ty).lineTo(PAGE_W - MARGIN, ty).lineWidth(1.4).strokeColor(GOLD).stroke();
    ty += 5;
  }
  return ty;
}

function drawNote(doc: Doc, input: BusinessDocument, y: number, R: string, B: string): number {
  if (!input.note) return y;
  let ny = y + 5;
  if (ny + 22 > FOOTER_TOP) { doc.addPage(); ny = MARGIN; }
  doc.fillColor(MUTED).font(B).fontSize(6.5).text('หมายเหตุ', MARGIN, ny, { lineBreak: false });
  doc.fillColor(INK).font(R).fontSize(7).text(input.note, MARGIN, ny + 8, { width: CONTENT_W - 186 });
  return Math.max(doc.y, ny + 20);
}

/* ============================================================
   7) ลายเซ็น — กระชับ ไม่กินครึ่งหน้า
   ============================================================ */
function drawSignatures(doc: Doc, y: number, R: string, B: string) {
  const BLOCK_H = 34;

  /* PHASE 22 — ช่องลงนามต้องยึดกับ "ก้นกระดาษ" ไม่ใช่ลอยต่อจากเนื้อหา
     เดิมวางที่ y + 10 ทันที เอกสารสั้น ๆ จึงจบกลางหน้าแล้วเหลือที่ว่างครึ่งล่างทั้งแถบ
     ทำให้ดูเหมือนใบที่พิมพ์ไม่เสร็จ ทั้งที่ขนาดกระดาษเป็น A5 ถูกต้องอยู่แล้ว
     เอกสารจริงจะเซ็นชื่อที่ท้ายหน้าเสมอ */
  const anchored = FOOTER_TOP - BLOCK_H - 8;
  let sy = Math.max(y + 10, anchored);
  if (sy + BLOCK_H > FOOTER_TOP) { doc.addPage(); sy = FOOTER_TOP - BLOCK_H - 8; }

  // เส้นคั่นบาง ๆ เหนือช่องลงนาม เพื่อแยกส่วนท้ายออกจากเนื้อหาอย่างชัดเจน
  doc.moveTo(MARGIN, sy - 8).lineTo(PAGE_W - MARGIN, sy - 8).lineWidth(0.5).strokeColor(RULE).stroke();

  const roles = ['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'];
  const colW = CONTENT_W / roles.length;
  roles.forEach((role, i) => {
    const x = MARGIN + i * colW;
    const lineY = sy + 16;
    doc.moveTo(x + 8, lineY).lineTo(x + colW - 8, lineY).lineWidth(0.5).strokeColor(RULE).dash(1.5, { space: 1.5 }).stroke();
    doc.undash();
    doc.fillColor(INK).font(B).fontSize(7).text(role, x, lineY + 4, { width: colW, align: 'center', lineBreak: false });
    doc.fillColor(MUTED).font(R).fontSize(5.8)
      .text('...... / ...... / ......', x, lineY + 13, { width: colW, align: 'center', lineBreak: false });
  });
}

/* ============================================================
   8) ท้ายกระดาษ — เดินทุกหน้า พร้อมเลขหน้า
   ============================================================ */
function drawFooters(doc: Doc, input: BusinessDocument, R: string) {
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = 0; i < total; i += 1) {
    doc.switchToPage(range.start + i);
    /* PDFKit จะขึ้นหน้าใหม่ให้อัตโนมัติเมื่อเขียนข้อความล้ำเข้าไปในเขตขอบล่าง
       ท้ายกระดาษต้องอยู่ในเขตนั้นพอดี จึงปิด margin ล่างชั่วคราวระหว่างวาด
       (ไม่งั้นเอกสาร 2 บรรทัดจะกลายเป็น 3 หน้า) */
    doc.page.margins.bottom = 0;
    doc.moveTo(MARGIN, FOOTER_TOP).lineTo(PAGE_W - MARGIN, FOOTER_TOP).lineWidth(0.4).strokeColor(RULE).stroke();

    const left = input.company.documentFooter?.trim() || `${input.company.nameTh} · ออกโดยระบบ S2A`;
    doc.fillColor(MUTED).font(R).fontSize(6)
      .text(left, MARGIN, FOOTER_TOP + 5, { width: CONTENT_W - 120, lineBreak: false, ellipsis: true });

    doc.fillColor(MUTED).font(R).fontSize(6)
      .text(`${input.documentNo}  ·  ${i + 1}/${total}`, PAGE_W - MARGIN - 120, FOOTER_TOP + 5,
        { width: 120, align: 'right', lineBreak: false });
  }
  doc.flushPages();
}
