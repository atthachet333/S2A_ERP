/**
 * Cost Sheet — เครื่องคำนวณต้นทุน 1 เมนู (pure functions, ใช้เป็น live preview)
 * อิง workflow จากสเปรดชีตของผู้ใช้:
 *   ต้นทุน/หน่วยฐาน = ราคาที่ซื้อ ÷ ปริมาณต่อหน่วยซื้อ
 *   ต้นทุนรายการ  = ต้นทุน/หน่วยฐาน × ปริมาณที่ใช้
 * Backend เป็น source of truth — ทุกครั้งที่บันทึกจะคำนวณซ้ำที่ฝั่งเซิร์ฟเวอร์
 */

export type LineKind = 'ingredient' | 'packaging';

export interface SheetLine {
  id: string;
  kind: LineKind;
  itemId: string | null;
  name: string;
  /** ราคาที่ซื้อ (ต่อ 1 หน่วยซื้อ) */
  purchasePrice: number;
  /** จำนวนที่ซื้อ (หน่วยซื้อ) — ใช้แสดงยอดที่จ่าย ไม่กระทบต้นทุน/หน่วย */
  purchaseQty: number;
  /** ป้ายหน่วยซื้อ เช่น กก., ถุง, กล่อง */
  purchaseUnit: string;
  /** ปริมาณต่อ 1 หน่วยซื้อ ในหน่วยฐาน เช่น 1 กก. = 1000 (g) */
  qtyPerPurchase: number;
  /** ปริมาณที่ใช้จริงในสูตร (หน่วยฐาน) */
  usage: number;
  /** ป้ายหน่วยฐาน เช่น g, ml, ชิ้น */
  baseUnit: string;
  /** % ของเสียเฉพาะรายการ */
  wastePercent: number;
}

export interface OperatingCost {
  laborCost: number;
  electricCost: number;
  waterCost: number;
  gasCost: number;
  overheadCost: number;
  wasteCost: number;
  otherCost: number;
}

export const EMPTY_OPERATING: OperatingCost = {
  laborCost: 0, electricCost: 0, waterCost: 0, gasCost: 0, overheadCost: 0, wasteCost: 0, otherCost: 0,
};

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};

/** ปัดทศนิยมแบบ decimal-safe (ตัด floating error) */
export function round(value: number, dp = 4): number {
  if (!Number.isFinite(value)) return 0;
  const f = 10 ** dp;
  return Math.round((value + Number.EPSILON) * f) / f;
}

/** ยอดที่จ่ายจริงตอนซื้อ = ราคา × จำนวน */
export function purchaseTotalCost(price: number, qty: number): number {
  return round(n(price) * n(qty), 2);
}

/** ปริมาณรวมที่ได้ในหน่วยฐาน = จำนวนซื้อ × ปริมาณต่อหน่วย */
export function purchaseBaseQuantity(qty: number, qtyPerPurchase: number): number {
  return round(n(qty) * n(qtyPerPurchase), 4);
}

/** ต้นทุนต่อหน่วยฐาน = ราคาที่ซื้อ ÷ ปริมาณต่อหน่วยซื้อ (จำนวนซื้อตัดกันในสูตร) */
export function costPerBaseUnit(price: number, qtyPerPurchase: number): number {
  const factor = n(qtyPerPurchase);
  if (factor <= 0) return 0;
  return round(n(price) / factor, 6);
}

/** ต้นทุนของรายการ = ต้นทุน/หน่วยฐาน × ปริมาณที่ใช้ × (1 + ของเสีย%) */
export function lineCost(costPerBase: number, usage: number, wastePercent = 0): number {
  return round(n(costPerBase) * n(usage) * (1 + n(wastePercent) / 100), 4);
}

export interface LineResult {
  purchaseTotal: number;
  baseQty: number;
  costPerBase: number;
  cost: number;
  hasPrice: boolean;
}

export function computeLine(line: SheetLine): LineResult {
  const costPerBase = costPerBaseUnit(line.purchasePrice, line.qtyPerPurchase);
  return {
    purchaseTotal: purchaseTotalCost(line.purchasePrice, line.purchaseQty),
    baseQty: purchaseBaseQuantity(line.purchaseQty, line.qtyPerPurchase),
    costPerBase,
    cost: lineCost(costPerBase, line.usage, line.wastePercent),
    hasPrice: n(line.purchasePrice) > 0 && n(line.qtyPerPurchase) > 0,
  };
}

export interface SheetSummary {
  materialCost: number;
  packagingCost: number;
  laborCost: number;
  utilityCost: number;
  overheadCost: number;
  wasteCost: number;
  otherCost: number;
  operatingCost: number;
  totalCost: number;
  batchOutput: number;
  costPerUnit: number;
  linesMissingPrice: number;
}

export function computeSheet(lines: SheetLine[], ops: OperatingCost, batchOutput: number): SheetSummary {
  let materialCost = 0;
  let packagingCost = 0;
  let linesMissingPrice = 0;
  for (const line of lines) {
    const r = computeLine(line);
    if (n(line.usage) > 0 && !r.hasPrice) linesMissingPrice += 1;
    if (line.kind === 'packaging') packagingCost += r.cost;
    else materialCost += r.cost;
  }
  const utilityCost = n(ops.electricCost) + n(ops.waterCost) + n(ops.gasCost);
  const operatingCost = n(ops.laborCost) + utilityCost + n(ops.overheadCost) + n(ops.wasteCost) + n(ops.otherCost);
  const totalCost = materialCost + packagingCost + operatingCost;
  const output = n(batchOutput);
  const costPerUnit = output > 0 ? totalCost / output : 0;
  return {
    materialCost: round(materialCost, 2),
    packagingCost: round(packagingCost, 2),
    laborCost: round(n(ops.laborCost), 2),
    utilityCost: round(utilityCost, 2),
    overheadCost: round(n(ops.overheadCost), 2),
    wasteCost: round(n(ops.wasteCost), 2),
    otherCost: round(n(ops.otherCost), 2),
    operatingCost: round(operatingCost, 2),
    totalCost: round(totalCost, 2),
    batchOutput: round(output, 2),
    costPerUnit: round(costPerUnit, 4),
    linesMissingPrice,
  };
}

/* ---------- ราคาขาย / กำไร (มิเรอร์ backend costing) ---------- */
export function priceFromMarkup(cost: number, markupPercent: number): number {
  return round(n(cost) * (1 + n(markupPercent) / 100), 2);
}
export function priceFromMargin(cost: number, marginPercent: number): number {
  const m = n(marginPercent) / 100;
  if (m >= 1) return 0;
  return round(n(cost) / (1 - m), 2);
}
export interface PriceAnalysis { sellingPrice: number; profit: number; marginPercent: number; markupPercent: number; isLoss: boolean }
export function analyzePrice(cost: number, sellingPrice: number): PriceAnalysis {
  const price = n(sellingPrice);
  const profit = round(price - n(cost), 2);
  const marginPercent = price > 0 ? round((profit / price) * 100, 2) : 0;
  const markupPercent = n(cost) > 0 ? round((profit / n(cost)) * 100, 2) : 0;
  return { sellingPrice: round(price, 2), profit, marginPercent, markupPercent, isLoss: price > 0 && price < n(cost) };
}
