import { ItemType } from '@prisma/client';

/**
 * เครื่องคำนวณต้นทุนสูตร (pure function) — ใช้ทั้งตอน preview และตอน save
 * Backend เป็น source of truth: ทุกครั้งที่บันทึกจะคำนวณซ้ำที่นี่ ไม่เชื่อผลจาก browser
 * ปริมาณวัตถุดิบคิดเป็น "หน่วยฐาน" ของ item (frontend แปลงหน่วยซื้อ→ฐานก่อนส่ง)
 */
export interface CostIngredientInput {
  itemType: ItemType;
  quantityBase: number; // ปริมาณในหน่วยฐาน
  unitCostPerBase: number; // ต้นทุนต่อหน่วยฐาน (item.lastCost)
  wastePercent?: number; // % ของเสียเฉพาะวัตถุดิบ
}

export interface CostExpenseInput {
  laborCost?: number;
  electricCost?: number;
  waterCost?: number;
  gasCost?: number;
  overheadCost?: number;
  wasteCost?: number;
  otherCost?: number;
}

export interface CostCalcInput extends CostExpenseInput {
  ingredients: CostIngredientInput[];
  yieldQty: number; // ผลผลิตมาตรฐาน (หน่วยขาย/เสิร์ฟ)
  yieldPercent?: number; // % yield จริง (ค่าเริ่มต้น 100)
}

export interface CostBreakdown {
  materialCost: number;
  packagingCost: number;
  laborCost: number;
  utilityCost: number;
  overheadCost: number;
  wasteCost: number;
  otherCost: number;
  totalCost: number;
  effectiveYield: number;
  unitCost: number;
}

const round = (n: number, dp = 4) => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

export function computeRecipeCost(input: CostCalcInput): CostBreakdown {
  let materialCost = 0;
  let packagingCost = 0;
  for (const ing of input.ingredients) {
    const qty = Number(ing.quantityBase) || 0;
    const unit = Number(ing.unitCostPerBase) || 0;
    const waste = Number(ing.wastePercent) || 0;
    const line = qty * (1 + waste / 100) * unit;
    if (ing.itemType === ItemType.PACKAGING) packagingCost += line;
    else materialCost += line;
  }

  const laborCost = Number(input.laborCost) || 0;
  const utilityCost = (Number(input.electricCost) || 0) + (Number(input.waterCost) || 0) + (Number(input.gasCost) || 0);
  const overheadCost = Number(input.overheadCost) || 0;
  const wasteCost = Number(input.wasteCost) || 0;
  const otherCost = Number(input.otherCost) || 0;

  const totalCost = materialCost + packagingCost + laborCost + utilityCost + overheadCost + wasteCost + otherCost;
  const yieldPercent = input.yieldPercent === undefined ? 100 : Number(input.yieldPercent) || 0;
  const effectiveYield = (Number(input.yieldQty) || 0) * (yieldPercent / 100);
  const unitCost = effectiveYield > 0 ? totalCost / effectiveYield : 0;

  return {
    materialCost: round(materialCost),
    packagingCost: round(packagingCost),
    laborCost: round(laborCost),
    utilityCost: round(utilityCost),
    overheadCost: round(overheadCost),
    wasteCost: round(wasteCost),
    otherCost: round(otherCost),
    totalCost: round(totalCost),
    effectiveYield: round(effectiveYield),
    unitCost: round(unitCost),
  };
}

/**
 * ราคาขาย/กำไร (PART 17)
 * Markup: price = cost × (1 + markup%)
 * Margin: price = cost ÷ (1 − margin%)
 */
export function priceFromMarkup(cost: number, markupPercent: number): number {
  return round(cost * (1 + markupPercent / 100), 2);
}
export function priceFromMargin(cost: number, marginPercent: number): number {
  const m = marginPercent / 100;
  if (m >= 1) return 0;
  return round(cost / (1 - m), 2);
}
export function analyzePrice(cost: number, sellingPrice: number) {
  const profit = round(sellingPrice - cost, 2);
  const marginPercent = sellingPrice > 0 ? round((profit / sellingPrice) * 100, 2) : 0;
  const markupPercent = cost > 0 ? round((profit / cost) * 100, 2) : 0;
  return { profit, marginPercent, markupPercent, isLoss: sellingPrice < cost };
}
