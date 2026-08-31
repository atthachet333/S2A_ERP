import { readFile } from 'node:fs/promises';
import { Prisma } from '@prisma/client';

export const EXTRACTION_LIMITS = {
  timeoutMs: 20_000,
  maxPdfPages: 20,
  maxTextChars: 250_000,
  maxLines: 200,
} as const;

export type ParsedLine = {
  rawDescription: string;
  extractedItemCode?: string;
  quantity?: string;
  unitText?: string;
  unitPrice?: string;
  lineTotal?: string;
  warnings: string[];
};

export type ParsedDocument = {
  supplierName?: string;
  supplierTaxId?: string;
  supplierDocumentNo?: string;
  documentDate?: Date;
  currency?: string;
  subtotal?: string;
  discount?: string;
  vat?: string;
  grandTotal?: string;
  lines: ParsedLine[];
  warnings: string[];
  rawText: string;
};

export class ExtractionFailure extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

const compact = (value: string) => value.replace(/\s+/g, ' ').trim();
export const normalizeDocumentText = (value: string) => compact(value)
  .normalize('NFKC').toLocaleLowerCase('th-TH')
  .replace(/[\p{P}\p{S}\s]+/gu, '');
export const normalizeTaxId = (value: string) => value.replace(/\D/g, '');

const UNIT_ALIASES: Record<string, string[]> = {
  KG: ['kg', 'kgs', 'กก', 'กก.', 'กิโล', 'กิโลกรัม'],
  G: ['g', 'gm', 'gram', 'grams', 'กรัม'],
  L: ['l', 'lt', 'liter', 'litre', 'ลิตร'],
  ML: ['ml', 'milliliter', 'millilitre', 'มล', 'มล.'],
  PCS: ['pc', 'pcs', 'piece', 'pieces', 'ชิ้น', 'อัน'],
  BAG: ['bag', 'bags', 'ถุง'],
  BOX: ['box', 'boxes', 'กล่อง'],
};

export function canonicalUnitText(value?: string | null) {
  if (!value) return '';
  const normalized = normalizeDocumentText(value);
  for (const [canonical, aliases] of Object.entries(UNIT_ALIASES)) {
    if (aliases.some((alias) => normalizeDocumentText(alias) === normalized)) return canonical;
  }
  return compact(value).toUpperCase();
}

const amount = (value?: string) => {
  if (!value) return undefined;
  const cleaned = value.replace(/[,\s]/g, '').replace(/^\((.+)\)$/, '-$1');
  return /^-?\d+(?:\.\d+)?$/.test(cleaned) ? cleaned : undefined;
};

function valueAfterLabel(lines: string[], labels: RegExp[]) {
  for (const line of lines) {
    for (const label of labels) {
      const match = line.match(label);
      if (match?.[1]) return compact(match[1]);
    }
  }
  return undefined;
}

function parseDate(value?: string) {
  if (!value) return undefined;
  const match = value.match(/(\d{1,4})[./-](\d{1,2})[./-](\d{1,4})/);
  if (!match) return undefined;
  let [, a, b, c] = match;
  let year: number; let month: number; let day: number;
  if (a.length === 4) [year, month, day] = [Number(a), Number(b), Number(c)];
  else [day, month, year] = [Number(a), Number(b), Number(c)];
  if (year < 100) year += 2000;
  if (year > 2400) year -= 543;
  const date = new Date(Date.UTC(year, month - 1, day));
  return Number.isNaN(date.valueOf()) || date.getUTCMonth() !== month - 1 ? undefined : date;
}

const SUMMARY_LABEL = /^(?:sub\s*total|subtotal|รวมก่อน|รวมรายการ|discount|ส่วนลด|vat|ภาษี|grand\s*total|net\s*total|ยอดสุทธิ|รวมทั้งสิ้น)\b/i;
const LINE_PATTERN = /^(?:(?<code>[A-Z0-9][A-Z0-9._/-]{1,39})\s+)?(?<description>.+?)\s+(?<qty>-?\d[\d,]*(?:\.\d+)?)\s+(?<unit>[A-Za-zก-๙.]+)\s+(?<price>-?\d[\d,]*(?:\.\d+)?)\s+(?<total>-?\d[\d,]*(?:\.\d+)?)$/iu;

export function parseDocumentText(raw: string): ParsedDocument {
  const rawText = raw.slice(0, EXTRACTION_LIMITS.maxTextChars);
  const lines = rawText.split(/\r?\n/).map(compact).filter(Boolean);
  const warnings: string[] = [];
  const parsedLines: ParsedLine[] = [];

  for (const line of lines) {
    if (SUMMARY_LABEL.test(line)) continue;
    const match = line.match(LINE_PATTERN);
    if (!match?.groups) continue;
    const quantity = amount(match.groups.qty);
    const unitPrice = amount(match.groups.price);
    const lineTotal = amount(match.groups.total);
    if (!quantity || !unitPrice || !lineTotal) continue;
    const lineWarnings: string[] = [];
    const calculated = new Prisma.Decimal(quantity).mul(unitPrice);
    const delta = calculated.minus(lineTotal).abs();
    if (delta.gt('0.02')) lineWarnings.push(`ยอดบรรทัดต่างจากจำนวน × ราคา ${delta.toFixed(2)} บาท`);
    parsedLines.push({
      rawDescription: compact(match.groups.description),
      ...(match.groups.code ? { extractedItemCode: match.groups.code } : {}),
      quantity, unitText: match.groups.unit, unitPrice, lineTotal, warnings: lineWarnings,
    });
    if (parsedLines.length >= EXTRACTION_LIMITS.maxLines) {
      warnings.push(`อ่านสูงสุด ${EXTRACTION_LIMITS.maxLines} รายการ กรุณาตรวจสอบเอกสาร`);
      break;
    }
  }

  // ต้องยึดต้นบรรทัดเสมอ มิฉะนั้นคำว่า "ผู้เสียภาษี" ใน Tax ID จะถูกอ่านผิดเป็นยอด VAT
  const subtotal = amount(valueAfterLabel(lines, [/^(?:sub\s*total|subtotal|รวมก่อน(?:ภาษี)?|รวมรายการ)\s*[:：]?\s*([\d,.]+)/i]));
  const discount = amount(valueAfterLabel(lines, [/^(?:discount|ส่วนลด)\s*[:：]?\s*([\d,.]+)/i]));
  const vat = amount(valueAfterLabel(lines, [/^(?:vat(?:\s*7\s*%)?|ภาษี(?:มูลค่าเพิ่ม)?)\s*[:：]?\s*([\d,.]+)/i]));
  const grandTotal = amount(valueAfterLabel(lines, [/^(?:grand\s*total|net\s*total|ยอดสุทธิ|รวมทั้งสิ้น)\s*[:：]?\s*([\d,.]+)/i]));
  const lineSum = parsedLines.reduce((sum, line) => sum.plus(line.lineTotal ?? 0), new Prisma.Decimal(0));
  if (grandTotal) {
    const expected = lineSum.minus(discount ?? 0).plus(vat ?? 0);
    const delta = expected.minus(grandTotal).abs();
    if (delta.lte('0.02')) warnings.push(`ยอดรวมจากรายการ ${lineSum.toFixed(2)} บาท ตรงกับยอดสุทธิในเอกสาร`);
    else warnings.push(`ยอดรวมต่างจากเอกสาร ${delta.toFixed(2)} บาท — กรุณาตรวจสอบ`);
  }
  if (!parsedLines.length) warnings.push('ไม่พบตารางรายการที่ระบบรองรับ กรุณากรอกข้อมูลตามปกติ');

  const supplierName = valueAfterLabel(lines, [/(?:supplier|vendor|ผู้ขาย|ผู้จำหน่าย)\s*[:：]\s*(.+)$/i]);
  const supplierTaxId = valueAfterLabel(lines, [/(?:tax\s*id|taxpayer\s*id|เลขประจำตัวผู้เสียภาษี)\s*[:：]?\s*([\d\s-]{10,20})/i]);
  const supplierDocumentNo = valueAfterLabel(lines, [/(?:invoice\s*(?:no\.?|number)|document\s*no\.?|เลขที่เอกสาร|เลขที่ใบกำกับ)\s*[:：]?\s*([^\s]+)/i]);
  const dateText = valueAfterLabel(lines, [/(?:document\s*date|invoice\s*date|date|วันที่)\s*[:：]?\s*([\d./-]+)/i]);
  const currencyText = valueAfterLabel(lines, [/(?:currency|สกุลเงิน)\s*[:：]?\s*([A-Z]{3}|บาท|THB)/i]);
  const currency = currencyText ? (/บาท/i.test(currencyText) ? 'THB' : currencyText.toUpperCase()) : (/฿|บาท/.test(rawText) ? 'THB' : undefined);

  return {
    supplierName,
    supplierTaxId: supplierTaxId ? normalizeTaxId(supplierTaxId) : undefined,
    supplierDocumentNo,
    documentDate: parseDate(dateText), currency,
    subtotal, discount, vat, grandTotal,
    lines: parsedLines, warnings, rawText,
  };
}

export async function extractPdfText(filePath: string) {
  const data = new Uint8Array(await readFile(filePath));
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = pdfjs.getDocument({ data, useSystemFonts: true, disableFontFace: true });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > EXTRACTION_LIMITS.maxPdfPages) {
      throw new ExtractionFailure('PDF_PAGE_LIMIT', `เอกสารเกิน ${EXTRACTION_LIMITS.maxPdfPages} หน้า`);
    }
    const pages: string[] = [];
    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const rows = new Map<number, { x: number; text: string }[]>();
      for (const item of content.items) {
        if (!('str' in item) || !item.str.trim()) continue;
        const y = Math.round(item.transform[5] * 2) / 2;
        const row = rows.get(y) ?? [];
        row.push({ x: item.transform[4], text: item.str });
        rows.set(y, row);
      }
      pages.push([...rows.entries()].sort((a, b) => b[0] - a[0])
        .map(([, row]) => row.sort((a, b) => a.x - b.x).map((part) => part.text).join(' ')).join('\n'));
    }
    const text = pages.join('\n');
    if (normalizeDocumentText(text).length < 20) {
      throw new ExtractionFailure('OCR_UNAVAILABLE', 'PDF นี้เป็นภาพสแกนหรือไม่มีข้อความ และเซิร์ฟเวอร์ยังไม่มี OCR ภายในเครื่อง');
    }
    return text.slice(0, EXTRACTION_LIMITS.maxTextChars);
  } finally {
    await pdf.destroy();
  }
}

export async function withExtractionTimeout<T>(operation: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new ExtractionFailure('EXTRACTION_TIMEOUT', 'ใช้เวลาอ่านเอกสารนานเกินกำหนด')), EXTRACTION_LIMITS.timeoutMs);
      }),
    ]);
  } finally { if (timer) clearTimeout(timer); }
}

/**
 * แปลงเลขที่อ่านได้จากหน่วยในเอกสารให้กลับเข้า contract เดิมของ Receiving
 * (quantity/unitPrice ในหน่วยซื้อ) โดยรักษายอดรวมเดิมไว้
 */
export function convertExtractedLineToPurchase(input: {
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  sourceToBaseFactor: Prisma.Decimal;
  purchaseToBaseFactor: Prisma.Decimal;
}) {
  if (input.sourceToBaseFactor.lte(0) || input.purchaseToBaseFactor.lte(0)) {
    throw new ExtractionFailure('UNIT_CONVERSION_MISSING', 'อัตราแปลงหน่วยต้องมากกว่าศูนย์');
  }
  const quantity = input.quantity.mul(input.sourceToBaseFactor).div(input.purchaseToBaseFactor);
  const unitPrice = input.unitPrice.mul(input.purchaseToBaseFactor).div(input.sourceToBaseFactor);
  return { quantity, unitPrice, totalCost: quantity.mul(unitPrice) };
}
