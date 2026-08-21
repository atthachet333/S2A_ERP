import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conversionPreview, receiptTotals } from '@/lib/receiving-preview';

/**
 * PHASE 6B — พรีวิวการแปลงหน่วยซื้อ → หน่วยฐาน ในหน้ารับของเข้า
 * เคสหลักคือเคสจริงที่เคยพลาด: ฿47 ต่อ 1 L ต้องไม่กลายเป็น ฿47 ต่อ 1 ML
 */

describe('purchase → base conversion preview', () => {
  it('1 เคสจริง: น้ำมันพืช 2 L ราคา ฿47/L, 1 L = 1000 ML', () => {
    const c = conversionPreview({ quantity: 2, unitPrice: 47, purchaseToBaseFactor: 1000, purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(c.equation).toBe('1 L = 1,000 ML');
    expect(c.baseQuantity).toBe(2000);
    expect(c.baseUnitCost).toBeCloseTo(0.047, 6);   // ไม่ใช่ 47
    expect(c.lineTotal).toBe(94);
    expect(c.sameUnit).toBe(false);
  });

  it('2 ต้นทุนหน่วยฐานต่างจากราคาซื้อ 1000 เท่า — จุดที่เคยพลาด', () => {
    const c = conversionPreview({ quantity: 1, unitPrice: 47, purchaseToBaseFactor: 1000, purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(c.baseUnitCost).not.toBe(47);
    expect((c.baseUnitCost as number) * 1000).toBeCloseTo(47, 6);
  });

  it('3 factor = 1 → บอกว่าใช้หน่วยเดียวกัน ไม่ต้องอธิบายการแปลง', () => {
    const c = conversionPreview({ quantity: 3, unitPrice: 170, purchaseToBaseFactor: 1, purchaseUnitCode: 'KG', baseUnitCode: 'KG' });
    expect(c.sameUnit).toBe(true);
    expect(c.equation).toBeNull();
    expect(c.baseUnitCost).toBe(170);
    expect(c.baseQuantity).toBe(3);
    expect(c.lineTotal).toBe(510);
  });

  it('4 KG → G ก็ต้องได้เหมือนกัน', () => {
    const c = conversionPreview({ quantity: 0.5, unitPrice: 120, purchaseToBaseFactor: 1000, purchaseUnitCode: 'KG', baseUnitCode: 'G' });
    expect(c.baseQuantity).toBe(500);
    expect(c.baseUnitCost).toBeCloseTo(0.12, 6);
    expect(c.lineTotal).toBe(60);
  });

  it('5 ซื้อเป็นลัง 1 BOX = 12 PCS', () => {
    const c = conversionPreview({ quantity: 2, unitPrice: 240, purchaseToBaseFactor: 12, purchaseUnitCode: 'BOX', baseUnitCode: 'PCS' });
    expect(c.equation).toBe('1 BOX = 12 PCS');
    expect(c.baseQuantity).toBe(24);
    expect(c.baseUnitCost).toBe(20);
    expect(c.lineTotal).toBe(480);
  });

  it('6 factor เป็น string จาก API ก็ต้องคำนวณได้ (Decimal มาเป็น string)', () => {
    const c = conversionPreview({ quantity: 2, unitPrice: 47, purchaseToBaseFactor: '1000', purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(c.baseUnitCost).toBeCloseTo(0.047, 6);
  });

  it('7 ยังไม่มี factor → ไม่เดาว่าเป็น 1 แต่บอกว่ายังไม่รู้', () => {
    const c = conversionPreview({ quantity: 2, unitPrice: 47, purchaseToBaseFactor: null, baseUnitCode: 'ML' });
    expect(c.factor).toBeNull();
    expect(c.baseUnitCost).toBeNull();
    expect(c.baseQuantity).toBeNull();
    expect(c.equation).toBeNull();
    expect(c.lineTotal).toBe(94);   // ยอดรวมยังคำนวณได้
  });

  it('8 factor = 0 ถือว่าใช้ไม่ได้ ไม่หารด้วยศูนย์', () => {
    const c = conversionPreview({ quantity: 1, unitPrice: 10, purchaseToBaseFactor: 0, baseUnitCode: 'ML' });
    expect(c.baseUnitCost).toBeNull();
    expect(Number.isFinite(c.lineTotal)).toBe(true);
  });

  it('9 ไม่ได้ตั้งหน่วยซื้อ → ถือว่าซื้อเป็นหน่วยฐาน', () => {
    const c = conversionPreview({ quantity: 5, unitPrice: 20, purchaseToBaseFactor: 1, baseUnitCode: 'KG' });
    expect(c.purchaseUnit).toBe('KG');
    expect(c.sameUnit).toBe(true);
  });

  it('10 ยอดรวมบรรทัด = จำนวน × ราคาซื้อ ไม่เกี่ยวกับการแปลงหน่วย', () => {
    const withConv = conversionPreview({ quantity: 2, unitPrice: 47, purchaseToBaseFactor: 1000, baseUnitCode: 'ML' });
    const noConv = conversionPreview({ quantity: 2, unitPrice: 47, purchaseToBaseFactor: 1, baseUnitCode: 'L' });
    expect(withConv.lineTotal).toBe(noConv.lineTotal);
  });
});

describe('receipt totals', () => {
  it('11 รวมจำนวนและมูลค่าจากทุกบรรทัด', () => {
    const t = receiptTotals([{ quantity: 2, unitPrice: 47 }, { quantity: 3, unitPrice: 170 }]);
    expect(t).toEqual({ lineCount: 2, totalQuantity: 5, totalValue: 94 + 510 });
  });

  it('12 ไม่มีบรรทัด → ศูนย์ ไม่ throw', () => {
    expect(receiptTotals([])).toEqual({ lineCount: 0, totalQuantity: 0, totalValue: 0 });
  });
});

/* ---------- โครงหน้า ---------- */
const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const ops = read('pages/OperationsPages.tsx');
const css = read('styles/operations-workspace.css');

describe('receiving workspace structure', () => {
  it('13 ใช้ workspace 72/28 พร้อม StickySummary', () => {
    expect(ops).toContain('ops-workspace');
    expect(ops).toContain('<StickySummary className="ops-summary-panel">');
    expect(css).toContain('grid-template-columns: minmax(0, 72fr) minmax(290px, 28fr)');
  });

  it('14 ใช้ primitive จาก Phase 2+3 ไม่ใช่ ops-section เดิม', () => {
    expect(ops).toContain('<PageContainer size="wide" className="ops-page receiving-workspace">');
    expect(ops).not.toContain('<WorkspaceHero eyebrow="GOODS RECEIPT WORKSPACE"');
    expect(ops).not.toContain('ops-form-layout');
  });

  it('15 create แสดงว่าระบบออกเลขให้ / edit แสดง GR จริง และไม่สร้างใบใหม่', () => {
    expect(ops).toContain('ระบบจะออกเลข GR ให้อัตโนมัติ');
    expect(ops).toContain('แก้ไขใบรับสินค้า ${editDoc.receiptNo}');
    // โหมดแก้ไขยังใช้เอกสารเดิม (editingId) ไม่ได้เปลี่ยนไปสร้างใหม่
    expect(ops).toContain('editingId');
  });

  it('16 แถวสินค้าแสดงการแปลงหน่วยและต้นทุนหน่วยฐานในแถวเลย', () => {
    expect(ops).toContain('conversionPreview(');
    expect(ops).toContain('rr-basecost');
    expect(ops).toContain('cv.equation');
    expect(ops).toContain('ใช้หน่วยเดียวกัน');
    expect(ops).toContain('ยังไม่ได้ตั้งอัตราแปลงหน่วย');
  });

  it('17 ฟอร์มข้อมูลเอกสารเป็น 2 คอลัมน์ ไม่กว้างเต็มหน้าทุกช่อง', () => {
    expect(ops).toContain('ops-field-grid');
    expect(css).toMatch(/\.ops-field-grid \{[^}]*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.ops-field-grid \{ grid-template-columns: 1fr; \}/);
  });

  it('18 สรุปมีเลขที่ / supplier / คลัง / จำนวน / มูลค่า / สถานะ', () => {
    for (const label of ['เลขที่', 'Supplier', 'คลัง', 'จำนวนรายการ', 'จำนวนรวม', 'สถานะ', 'มูลค่ารับรวม']) {
      expect(ops).toContain(label);
    }
  });

  it('19 ยืนยันผ่าน ConfirmDialog ที่บอก GR / คลัง / จำนวน / มูลค่า / ผลกระทบ', () => {
    expect(ops).toContain('<ConfirmDialog');
    expect(ops).toContain('op-confirm-impact');
    expect(ops).toContain('เพิ่มสต็อกจริง');
    expect(ops).toContain('ไม่สามารถแก้ไขรายการโดยตรงได้');
    expect(ops).not.toContain('window.confirm(');
  });

  it('20 ใช้ vocab กลางสำหรับสถานะ ไม่ map เอง', () => {
    expect(ops).toContain("statusLabel('receiving'");
    expect(ops).toContain("statusInfo('receiving'");
  });

  it('21 ตัวเลขเงิน/จำนวนใช้ tabular-nums ชิดขวา', () => {
    expect(css).toContain('font-variant-numeric: tabular-nums');
    expect(css).toContain('text-align: right');
  });
});

describe('receiving workspace css', () => {
  it('22 ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('23 breakpoint ตรงมาตรฐานระบบ', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('24 มือถือ: แถวเป็นการ์ด + ปุ่มยืนยันติดขอบล่าง + touch target 44px', () => {
    expect(css).toMatch(/@media \(max-width: 430px\)[\s\S]*?\.recv-row \{ grid-template-columns: 1fr; \}/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?position: sticky; bottom: 0/);
    expect(css).toContain('min-width: var(--control-h); min-height: var(--control-h)');
  });
});
