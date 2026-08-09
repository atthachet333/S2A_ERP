import { describe, expect, it } from 'vitest';
import { ItemType } from '@prisma/client';
import { computeRecipeCost, priceFromMarkup, priceFromMargin, analyzePrice } from '../src/lib/costing.js';

/** ทดสอบเครื่องคำนวณต้นทุน/ราคา (pure — ไม่พึ่งฐานข้อมูล) */
describe('costing engine', () => {
  it('แยกต้นทุนวัตถุดิบกับบรรจุภัณฑ์ และหารด้วย yield ที่แท้จริง', () => {
    const result = computeRecipeCost({
      ingredients: [
        { itemType: ItemType.RAW_MATERIAL, quantityBase: 1000, unitCostPerBase: 0.15, wastePercent: 0 }, // 150
        { itemType: ItemType.RAW_MATERIAL, quantityBase: 100, unitCostPerBase: 0.5, wastePercent: 10 }, // 55
        { itemType: ItemType.PACKAGING, quantityBase: 10, unitCostPerBase: 3.5, wastePercent: 0 }, // 35
      ],
      yieldQty: 10,
      yieldPercent: 100,
      laborCost: 20, electricCost: 5, waterCost: 2, gasCost: 3, overheadCost: 10, otherCost: 0,
    });
    expect(result.materialCost).toBe(205); // 150 + 55
    expect(result.packagingCost).toBe(35);
    expect(result.utilityCost).toBe(10); // 5+2+3
    expect(result.totalCost).toBe(205 + 35 + 20 + 10 + 10); // 280
    expect(result.unitCost).toBe(28); // 280 / 10
  });

  it('yieldPercent ลดผลผลิตจริงและเพิ่มต้นทุนต่อหน่วย', () => {
    const full = computeRecipeCost({ ingredients: [], yieldQty: 10, yieldPercent: 100, laborCost: 100 });
    const half = computeRecipeCost({ ingredients: [], yieldQty: 10, yieldPercent: 50, laborCost: 100 });
    expect(full.unitCost).toBe(10);
    expect(half.unitCost).toBe(20);
  });

  it('markup และ margin คำนวณราคาขายตามสูตรที่ถูกต้อง', () => {
    expect(priceFromMarkup(100, 30)).toBe(130); // 100 × 1.3
    expect(priceFromMargin(100, 20)).toBe(125); // 100 ÷ 0.8
  });

  it('analyzePrice ตรวจจับการขาดทุน', () => {
    expect(analyzePrice(100, 130)).toMatchObject({ profit: 30, isLoss: false });
    const loss = analyzePrice(100, 80);
    expect(loss.isLoss).toBe(true);
    expect(loss.profit).toBe(-20);
  });

  it('กัน divide-by-zero เมื่อ yield เป็น 0', () => {
    const r = computeRecipeCost({ ingredients: [], yieldQty: 0, laborCost: 50 });
    expect(r.unitCost).toBe(0);
    expect(r.totalCost).toBe(50);
  });
});
