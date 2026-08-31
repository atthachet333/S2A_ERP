import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Prisma } from '@prisma/client';
import PDFDocument from 'pdfkit';
import { describe, expect, it } from 'vitest';
import {
  canonicalUnitText, convertExtractedLineToPurchase, extractPdfText, normalizeDocumentText, parseDocumentText,
} from '../src/modules/business/document-extraction.service.js';

const fixture = (name: string) => readFile(path.resolve(process.cwd(), 'tests/fixtures/phase23', name), 'utf8');

describe('Phase 23 document extraction parser', () => {
  it('uses embedded PDF text locally for text-based PDFs', async () => {
    const buffer = await new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A5' }); const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
      doc.text('Supplier: Safe Fixture Ltd.\nP23-RICE Jasmine Rice 2 KG 47.50 95.00'); doc.end();
    });
    const directory = await mkdtemp(path.join(os.tmpdir(), 's2a-p23-'));
    const file = path.join(directory, 'controlled.pdf');
    try {
      await writeFile(file, buffer);
      const text = await extractPdfText(file);
      expect(text).toContain('Safe Fixture Ltd.');
      expect(text).toContain('P23-RICE');
    } finally { await rm(directory, { recursive: true, force: true }); }
  });

  it('extracts a controlled text invoice without changing its numbers', async () => {
    const parsed = parseDocumentText(await fixture('text-invoice-source.txt'));
    expect(parsed.supplierName).toBe('บริษัท ทดสอบวัตถุดิบ จำกัด');
    expect(parsed.supplierTaxId).toBe('0105566123456');
    expect(parsed.supplierDocumentNo).toBe('INV-P23-001');
    expect(parsed.documentDate?.toISOString().slice(0, 10)).toBe('2026-08-24');
    expect(parsed.currency).toBe('THB');
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0]).toMatchObject({ extractedItemCode: 'RM-RICE', rawDescription: 'ข้าวหอมมะลิ', quantity: '2', unitText: 'KG', unitPrice: '47.50', lineTotal: '95.00' });
    expect(parsed.grandTotal).toBe('191.53');
    expect(parsed.warnings.join(' ')).toContain('ตรงกับยอดสุทธิ');
  });

  it('preserves mixed Thai/English text, leaves unknown items for matching, and warns on totals', async () => {
    const parsed = parseDocumentText(await fixture('mixed-unknown-source.txt'));
    expect(parsed.lines[0].rawDescription).toBe('วัตถุดิบ Unknown');
    expect(parsed.lines[0].unitText).toBe('กก.');
    expect(parsed.warnings.join(' ')).toContain('ยอดรวมต่างจากเอกสาร 1.00 บาท');
  });

  it('returns no fabricated lines for an unreadable/unsupported layout', async () => {
    const parsed = parseDocumentText(await fixture('unreadable.txt'));
    expect(parsed.lines).toEqual([]);
    expect(parsed.warnings.join(' ')).toContain('ไม่พบตารางรายการ');
  });

  it('normalizes common Thai and English unit aliases only', () => {
    for (const value of ['kg', 'KG', 'กก.', 'กิโล', 'กิโลกรัม']) expect(canonicalUnitText(value)).toBe('KG');
    expect(canonicalUnitText('กรัม')).toBe('G');
    expect(canonicalUnitText('ลิตร')).toBe('L');
    expect(canonicalUnitText('ชิ้น')).toBe('PCS');
    expect(canonicalUnitText('กล่อง')).toBe('BOX');
  });

  it('uses the existing purchase-to-base direction and preserves line total', () => {
    const converted = convertExtractedLineToPurchase({
      quantity: new Prisma.Decimal('7400'), unitPrice: new Prisma.Decimal('0.047'),
      sourceToBaseFactor: new Prisma.Decimal(1), purchaseToBaseFactor: new Prisma.Decimal(1000),
    });
    expect(converted.quantity.toString()).toBe('7.4');
    expect(converted.unitPrice.toString()).toBe('47');
    expect(converted.totalCost.toString()).toBe('347.8');
  });

  it('normalizes names for conservative exact matching without translating them', () => {
    expect(normalizeDocumentText('บริษัท A-B จำกัด')).toBe(normalizeDocumentText('บริษัท A B จำกัด'));
    expect(normalizeDocumentText('น้ำตาล')).not.toBe(normalizeDocumentText('Sugar'));
  });
});
