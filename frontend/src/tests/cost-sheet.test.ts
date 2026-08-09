import { describe, expect, it } from 'vitest';
import {
  purchaseTotalCost, purchaseBaseQuantity, costPerBaseUnit, lineCost,
  computeLine, computeSheet, priceFromMarkup, priceFromMargin, analyzePrice,
  EMPTY_OPERATING, type SheetLine,
} from '@/lib/cost-sheet';

function line(partial: Partial<SheetLine>): SheetLine {
  return {
    id: 'l', kind: 'ingredient', itemId: 'i', name: 'x',
    purchasePrice: 0, purchaseQty: 1, purchaseUnit: 'กก.', qtyPerPurchase: 1000,
    usage: 0, baseUnit: 'g', wastePercent: 0, ...partial,
  };
}

describe('Cost Sheet — การคำนวณต่อรายการ', () => {
  it('ยอดที่จ่ายตอนซื้อ = ราคา × จำนวน', () => {
    expect(purchaseTotalCost(150, 1)).toBe(150);
    expect(purchaseTotalCost(22, 8)).toBe(176);
  });

  it('ปริมาณรวมในหน่วยฐาน = จำนวนซื้อ × ปริมาณต่อหน่วย', () => {
    expect(purchaseBaseQuantity(8, 1000)).toBe(8000);
    expect(purchaseBaseQuantity(1, 4500)).toBe(4500);
  });

  it('ต้นทุน/หน่วยฐาน = ราคาที่ซื้อ ÷ ปริมาณต่อหน่วยซื้อ', () => {
    // EXAMPLE 1 — หมู 150 บาท / 1kg (1000g) => 0.15/g
    expect(costPerBaseUnit(150, 1000)).toBe(0.15);
    // EXAMPLE 3 — ผักชี 15 บาท / กำ (50g) => 0.30/g (item-specific conversion)
    expect(costPerBaseUnit(15, 50)).toBe(0.3);
  });

  it('ต้นทุนรายการ = ต้นทุน/หน่วยฐาน × ปริมาณที่ใช้', () => {
    // EXAMPLE 1 — ใช้ 500g => 75
    expect(lineCost(0.15, 500)).toBe(75);
    // EXAMPLE 3 — ใช้ 10g => 3
    expect(lineCost(0.3, 10)).toBe(3);
  });

  it('คิดของเสีย % ในต้นทุนรายการ', () => {
    expect(lineCost(0.15, 500, 10)).toBe(82.5);
  });

  it('computeLine ครบทุกค่าของหมู 150/kg ใช้ 500g', () => {
    const r = computeLine(line({ purchasePrice: 150, purchaseQty: 1, qtyPerPurchase: 1000, usage: 500 }));
    expect(r.costPerBase).toBe(0.15);
    expect(r.baseQty).toBe(1000);
    expect(r.cost).toBe(75);
    expect(r.hasPrice).toBe(true);
  });

  it('EXAMPLE 2 — กล่องอาหาร (บรรจุภัณฑ์): 350บาท/100กล่อง ใช้ 10 กล่อง => 35', () => {
    const r = computeLine(line({ kind: 'packaging', purchasePrice: 350, purchaseQty: 1, purchaseUnit: 'ลัง', qtyPerPurchase: 100, usage: 10, baseUnit: 'กล่อง' }));
    expect(r.costPerBase).toBe(3.5);
    expect(r.cost).toBe(35);
  });

  it('รายการไม่มีราคา => hasPrice=false', () => {
    const r = computeLine(line({ purchasePrice: 0, usage: 100 }));
    expect(r.hasPrice).toBe(false);
    expect(r.cost).toBe(0);
  });
});

describe('Cost Sheet — สรุปทั้งเมนู', () => {
  it('รวมวัตถุดิบ + บรรจุภัณฑ์ + ค่าใช้จ่าย และหารต่อหน่วย', () => {
    const lines: SheetLine[] = [
      line({ id: 'a', purchasePrice: 150, qtyPerPurchase: 1000, usage: 500 }),          // material 75
      line({ id: 'b', kind: 'packaging', purchasePrice: 350, qtyPerPurchase: 100, usage: 10 }), // packaging 35
    ];
    const s = computeSheet(lines, { ...EMPTY_OPERATING, laborCost: 20, gasCost: 5, waterCost: 5 }, 10);
    expect(s.materialCost).toBe(75);
    expect(s.packagingCost).toBe(35);
    expect(s.utilityCost).toBe(10);
    expect(s.operatingCost).toBe(30);
    expect(s.totalCost).toBe(140);
    expect(s.costPerUnit).toBe(14);
  });

  it('นับรายการที่ยังไม่มีราคา', () => {
    const lines: SheetLine[] = [
      line({ id: 'a', purchasePrice: 0, usage: 100 }),
      line({ id: 'b', purchasePrice: 150, qtyPerPurchase: 1000, usage: 100 }),
    ];
    const s = computeSheet(lines, EMPTY_OPERATING, 1);
    expect(s.linesMissingPrice).toBe(1);
  });

  it('batch output = 0 ไม่ทำให้พัง (ต้นทุน/หน่วย = 0)', () => {
    const s = computeSheet([line({ purchasePrice: 150, qtyPerPurchase: 1000, usage: 500 })], EMPTY_OPERATING, 0);
    expect(s.costPerUnit).toBe(0);
    expect(s.totalCost).toBe(75);
  });
});

describe('Cost Sheet — ราคาขายและกำไร', () => {
  it('markup: ต้นทุน 100 + 60% = 160', () => {
    expect(priceFromMarkup(100, 60)).toBe(160);
  });
  it('margin: ต้นทุน 100 ที่ margin 40% = 166.67', () => {
    expect(priceFromMargin(100, 40)).toBe(166.67);
  });
  it('margin >= 100% => 0 (กันหารศูนย์)', () => {
    expect(priceFromMargin(100, 100)).toBe(0);
  });
  it('analyzePrice: ต้นทุน 35 ขาย 59 => กำไร 24, margin ~40.7%', () => {
    const a = analyzePrice(35, 59);
    expect(a.profit).toBe(24);
    expect(a.marginPercent).toBe(40.68);
    expect(a.isLoss).toBe(false);
  });
  it('ราคาขายต่ำกว่าต้นทุน => isLoss', () => {
    expect(analyzePrice(50, 40).isLoss).toBe(true);
  });
});
