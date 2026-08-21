import { describe, expect, it } from 'vitest';
import { effectiveYieldMode, toBaseQuantity, toChildYieldQuantity, universalFactor, type ConvEdge, type ItemUnitInfo } from '../src/lib/unit-convert.js';

/** ตารางแปลงหน่วยมาตรฐาน (universal) — ไม่มี kg→ml โดยเจตนา เพราะขึ้นกับ density ของวัตถุดิบ */
const universal: ConvEdge[] = [
  { fromUnitId: 'KG', toUnitId: 'G', factor: 1000 },
  { fromUnitId: 'L', toUnitId: 'ML', factor: 1000 },
  { fromUnitId: 'KHEED', toUnitId: 'G', factor: 100 },
];

/** วัตถุดิบที่ซื้อเป็น KG แต่สูตรคีย์เป็น ML → item-specific 1 KG = 1000 ML */
const liquidItem: ItemUnitInfo = { baseUnitId: 'ML', purchaseUnitId: 'KG', purchaseToBaseFactor: 1000 };
/** วัตถุดิบทั่วไป ฐานเป็นกรัม ซื้อเป็นกิโล */
const dryItem: ItemUnitInfo = { baseUnitId: 'G', purchaseUnitId: 'KG', purchaseToBaseFactor: 1000 };

describe('unit conversion', () => {
  it('1 KG = 1000 ML ผ่าน item-specific factor', () => {
    expect(toBaseQuantity(1, 'KG', liquidItem, universal)).toBe(1000);
  });

  it('0.5 KG = 500 ML', () => {
    expect(toBaseQuantity(0.5, 'KG', liquidItem, universal)).toBe(500);
  });

  it('inverse: 500 ML = 0.5 KG (ตัวคูณกลับด้านคำนวณได้โดยไม่ต้องมีแถวใน DB)', () => {
    const perKg = toBaseQuantity(1, 'KG', liquidItem, universal)!;
    expect(500 / perKg).toBe(0.5);
  });

  it('1 L = 1000 ML ผ่านตารางมาตรฐาน', () => {
    expect(universalFactor('L', 'ML', universal)).toBe(1000);
    expect(toBaseQuantity(1, 'L', liquidItem, universal)).toBe(1000);
  });

  it('1 ML = 0.001 L (inverse อัตโนมัติ)', () => {
    expect(universalFactor('ML', 'L', universal)).toBeCloseTo(0.001, 12);
  });

  it('1 KG = 1000 G', () => {
    expect(toBaseQuantity(1, 'KG', dryItem, universal)).toBe(1000);
  });

  it('1 ขีด = 100 G', () => {
    expect(toBaseQuantity(1, 'KHEED', dryItem, universal)).toBe(100);
  });

  it('chained: 1 กระสอบ = 25 KG = 25,000 G', () => {
    const withSack: ConvEdge[] = [...universal, { fromUnitId: 'SACK', toUnitId: 'KG', factor: 25 }];
    expect(universalFactor('SACK', 'G', withSack)).toBe(25000);
    expect(toBaseQuantity(1, 'SACK', dryItem, withSack)).toBe(25000);
  });

  it('chained ผ่านหน่วยซื้อ: 1 กระสอบ = 25 KG และ 1 KG = 1000 ML (item-specific) → 25,000 ML', () => {
    const withSack: ConvEdge[] = [...universal, { fromUnitId: 'SACK', toUnitId: 'KG', factor: 25 }];
    expect(toBaseQuantity(1, 'SACK', liquidItem, withSack)).toBe(25000);
  });

  it('รองรับทศนิยม เช่น 1 KG = 950.5 ML', () => {
    const dense: ItemUnitInfo = { baseUnitId: 'ML', purchaseUnitId: 'KG', purchaseToBaseFactor: 950.5 };
    expect(toBaseQuantity(2, 'KG', dense, universal)).toBeCloseTo(1901, 6);
    expect(toBaseQuantity(0.25, 'KG', dense, universal)).toBeCloseTo(237.625, 6);
  });

  it('ไม่ระบุหน่วย หรือเป็นหน่วยฐานอยู่แล้ว → ใช้ค่าเดิม (สูตรเก่ายังถูกต้อง)', () => {
    expect(toBaseQuantity(250, null, dryItem, universal)).toBe(250);
    expect(toBaseQuantity(250, 'G', dryItem, universal)).toBe(250);
  });

  it('ห้ามเดา: KG→ML ของวัตถุดิบที่ไม่ได้ตั้ง item-specific ต้องคืน null', () => {
    const noPurchase: ItemUnitInfo = { baseUnitId: 'ML', purchaseUnitId: null, purchaseToBaseFactor: 1 };
    expect(toBaseQuantity(1, 'KG', noPurchase, universal)).toBeNull();
  });

  it('หน่วยที่ไม่มีเส้นทางแปลงเลย → null', () => {
    expect(universalFactor('G', 'ML', universal)).toBeNull();
    expect(toBaseQuantity(1, 'PCS', dryItem, universal)).toBeNull();
  });

  it('factor ที่ไม่ถูกต้อง (0 หรือ ติดลบ) ถูกข้าม ไม่ทำให้ได้ผลลัพธ์มั่ว', () => {
    const bad: ConvEdge[] = [{ fromUnitId: 'A', toUnitId: 'B', factor: 0 }, { fromUnitId: 'B', toUnitId: 'C', factor: -5 }];
    expect(universalFactor('A', 'B', bad)).toBeNull();
    expect(universalFactor('B', 'C', bad)).toBeNull();
  });

  it('สูตรย่อย: 0.8 L → 800 ML ตามหน่วยผลผลิตของสูตรลูก', () => {
    expect(toChildYieldQuantity(0.8, 'L', 'ML', universal)).toBe(800);
    expect(toChildYieldQuantity(35, 'ML', 'ML', universal)).toBe(35);
    expect(toChildYieldQuantity(1, 'G', 'ML', universal)).toBeNull();
  });
  // ---- Yield Mode: BATCH / ACTUAL ----
  it('BATCH: 1 Batch = ทั้งสูตร, 0.5 Batch = ครึ่งสูตร (ไม่ต้องแปลงหน่วย)', () => {
    expect(toChildYieldQuantity(1, null, null, universal, 'BATCH')).toBe(1);
    expect(toChildYieldQuantity(0.5, null, null, universal, 'BATCH')).toBe(0.5);
    expect(toChildYieldQuantity(2, null, null, universal, 'BATCH')).toBe(2);
  });

  it('BATCH: ต้นทุน 0.5 Batch ของสูตร 77.60 = 38.80 (yieldQty = 1 ทำให้ unitCost = ต้นทุนรวม)', () => {
    const totalCost = 77.6, unitCostPerBatch = totalCost / 1;
    expect(toChildYieldQuantity(0.5, null, null, universal, 'BATCH')! * unitCostPerBatch).toBeCloseTo(38.8, 4);
    expect(toChildYieldQuantity(1, null, null, universal, 'BATCH')! * unitCostPerBatch).toBeCloseTo(77.6, 4);
  });

  it('BATCH: ห้ามแปลงเป็น ML/KG/G — ต้องคืน null', () => {
    expect(toChildYieldQuantity(800, 'ML', null, universal, 'BATCH')).toBeNull();
    expect(toChildYieldQuantity(5, 'KG', null, universal, 'BATCH')).toBeNull();
  });

  it('ACTUAL: รู้ผลผลิต 1500 ML แล้ว 800 ML คิดต้นทุนได้ (≈41.39)', () => {
    const unitCost = 77.6 / 1500;
    expect(toChildYieldQuantity(800, 'ML', 'ML', universal, 'ACTUAL')).toBe(800);
    expect(toChildYieldQuantity(800, 'ML', 'ML', universal, 'ACTUAL')! * unitCost).toBeCloseTo(41.39, 2);
    expect(toChildYieldQuantity(0.8, 'L', 'ML', universal, 'ACTUAL')! * unitCost).toBeCloseTo(41.39, 2);
  });

  it('ACTUAL ที่ยังไม่มีหน่วยผลผลิต → null (ไม่เดา)', () => {
    expect(toChildYieldQuantity(800, 'ML', null, universal, 'ACTUAL')).toBeNull();
  });

  it('ยังไม่เลือกโหมด (null) → null เพื่อบังคับให้ผู้ใช้เลือกก่อน ห้ามตีความเป็น unit', () => {
    expect(toChildYieldQuantity(800, 'ML', null, universal, null)).toBeNull();
    expect(toChildYieldQuantity(800, null, null, universal, null)).toBeNull();
  });

  it('สูตรเก่าที่ไม่ส่ง mode มาเลย ยังทำงานแบบเดิม (backward compatible)', () => {
    expect(toChildYieldQuantity(35, 'ML', 'ML', universal)).toBe(35);
    expect(toChildYieldQuantity(800, null, 'ML', universal)).toBe(800);
  });
  // ---- effectiveYieldMode: legacy rows with real yield must not block ----
  it('legacy: yieldMode=null + 1500 ML => ACTUAL (ไม่บล็อก)', () => {
    expect(effectiveYieldMode(null, 'ML', 1500)).toBe('ACTUAL');
    expect(toChildYieldQuantity(800, 'ML', 'ML', universal, effectiveYieldMode(null, 'ML', 1500))).toBe(800);
  });

  it('legacy: yieldMode=null + ไม่มีหน่วย => UNKNOWN (ยังบล็อก)', () => {
    expect(effectiveYieldMode(null, null, 1)).toBeNull();
    expect(toChildYieldQuantity(800, 'ML', null, universal, effectiveYieldMode(null, null, 1))).toBeNull();
  });

  it('legacy: yieldMode=null + มีหน่วยแต่ qty=0 => UNKNOWN', () => {
    expect(effectiveYieldMode(null, 'ML', 0)).toBeNull();
  });

  it('โหมดที่ระบุไว้ชนะเสมอ (BATCH/ACTUAL ไม่ถูกเดาทับ)', () => {
    expect(effectiveYieldMode('BATCH', 'ML', 1500)).toBe('BATCH');
    expect(effectiveYieldMode('ACTUAL', 'ML', 1500)).toBe('ACTUAL');
  });

  it('ซอสผัดเชฟจริง: yieldMode=null, 1500 ML, 800 ML => ฿41.36', () => {
    const mode = effectiveYieldMode(null, 'ML', 1500);
    const qty = toChildYieldQuantity(800, 'ML', 'ML', universal, mode)!;
    expect(qty * 0.0517).toBeCloseTo(41.36, 2);
  });
});
