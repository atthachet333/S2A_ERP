import { Prisma } from '@prisma/client';

/**
 * Recipe Builder 2.0 — เครื่องคิดต้นทุนสูตรแบบ recursive (รองรับสูตรย่อย/overhead หลายโหมด/yield+portion)
 * โมดูลนี้ "บริสุทธิ์" (ไม่พึ่ง prisma/env) เพื่อให้ unit-test ได้โดยไม่ต้องต่อฐานข้อมูล
 * ใช้ Prisma.Decimal เพื่อความแม่นยำของเงิน — ปัดเฉพาะตอนแสดงผล/ส่งออกเท่านั้น
 */
const D = (v: Prisma.Decimal.Value = 0) => new Prisma.Decimal(v);

export type OverheadMode = 'TOTAL' | 'PERCENTAGE' | 'DETAILED';
export type OverheadBase = 'INGREDIENT' | 'DIRECT' | 'TOTAL';

export interface OverheadInput {
  mode?: OverheadMode | null;
  total?: number | null;
  percent?: number | null;
  base?: OverheadBase | null;
  details?: { label: string; amount: number }[] | null;
  /** โหมดเดิม (แยก ค่าแรง/น้ำ/ไฟ/แก๊ส) — ใช้ตอนสูตรเก่าไม่มี overheadMode */
  legacy?: { laborCost: number; electricCost: number; waterCost: number; gasCost: number; overheadCost: number; otherCost: number } | null;
}

export type ItemComponent = {
  type: 'ITEM' | 'PACKAGING';
  quantityBase: number;
  unitCostPerBase: number;
  wastePercent?: number;
};

export type SubRecipeComponent = {
  type: 'SUB_RECIPE';
  childRecipeId: string;
  quantity: number;
  wastePercent?: number;
};

export type Component = ItemComponent | SubRecipeComponent;

export interface RecipeNode {
  id: string;
  components: Component[];
  overhead: OverheadInput;
  yieldQty: number;
  yieldPercent?: number | null; // ค่าเริ่มต้น 100 (ผลผลิตจริง = yieldQty * yieldPercent/100)
  portionQty?: number | null;
}

export interface RecipeCostResult {
  ingredientCost: number;
  packagingCost: number;
  subRecipeCost: number;
  directCost: number;
  overheadCost: number;
  totalCost: number;
  effectiveYield: number;
  costPerYieldUnit: number;
  portionCount: number | null;
  costPerPortion: number | null;
}

export class RecipeCostError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'RecipeCostError'; }
}

const MAX_DEPTH = 20;
const num = (d: Prisma.Decimal, dp = 6) => Number(d.toDecimalPlaces(dp).toString());

function overheadOf(direct: Prisma.Decimal, ingredient: Prisma.Decimal, o: OverheadInput): Prisma.Decimal {
  if (o.mode === 'TOTAL') return D(o.total ?? 0);
  if (o.mode === 'DETAILED') return (o.details ?? []).reduce((s, d) => s.plus(D(d.amount || 0)), D(0));
  if (o.mode === 'PERCENTAGE') {
    const base = o.base === 'DIRECT' || o.base === 'TOTAL' ? direct : ingredient;
    return base.mul(D(o.percent ?? 0)).div(100);
  }
  // legacy (ไม่มี mode) — รวมค่าใช้จ่ายแยกแบบเดิม
  const l = o.legacy;
  if (!l) return D(0);
  return D(l.laborCost).plus(l.electricCost).plus(l.waterCost).plus(l.gasCost).plus(l.overheadCost).plus(l.otherCost);
}

/** ต้นทุนรวมของสูตร (ยังไม่หาร yield) — recursive + ป้องกันวนซ้ำ */
function totalCostOf(id: string, nodes: Map<string, RecipeNode>, path: string[]): { total: Prisma.Decimal; node: RecipeNode } {
  if (path.includes(id)) throw new RecipeCostError('CIRCULAR_SUBRECIPE', 'Circular sub-recipe reference is not allowed.');
  if (path.length >= MAX_DEPTH) throw new RecipeCostError('MAX_DEPTH', 'Sub-recipe nesting is too deep.');
  const node = nodes.get(id);
  if (!node) throw new RecipeCostError('MISSING_RECIPE', `Recipe ${id} not found or unavailable.`);

  let ingredient = D(0), packaging = D(0), sub = D(0);
  const nextPath = [...path, id];
  for (const c of node.components) {
    const waste = D(1).plus(D(c.wastePercent ?? 0).div(100));
    if (c.type === 'SUB_RECIPE') {
      const child = totalCostOf(c.childRecipeId, nodes, nextPath);
      const childYield = D(child.node.yieldQty).mul(D(child.node.yieldPercent ?? 100)).div(100);
      if (childYield.lte(0)) throw new RecipeCostError('ZERO_CHILD_YIELD', `Sub-recipe ${c.childRecipeId} has no yield.`);
      const perUnit = child.total.div(childYield);
      sub = sub.plus(D(c.quantity).mul(waste).mul(perUnit));
    } else {
      const line = D(c.quantityBase).mul(waste).mul(D(c.unitCostPerBase));
      if (c.type === 'PACKAGING') packaging = packaging.plus(line); else ingredient = ingredient.plus(line);
    }
  }
  const direct = ingredient.plus(packaging).plus(sub);
  const overhead = overheadOf(direct, ingredient, node.overhead);
  return { total: direct.plus(overhead), node };
}

/** คำนวณต้นทุนสูตร root แบบครบถ้วน (breakdown + ต่อหน่วย + ต่อ portion) */
export function calcRecipeCost(rootId: string, nodes: Map<string, RecipeNode>): RecipeCostResult {
  const node = nodes.get(rootId);
  if (!node) throw new RecipeCostError('MISSING_RECIPE', `Recipe ${rootId} not found.`);

  let ingredient = D(0), packaging = D(0), sub = D(0);
  for (const c of node.components) {
    const waste = D(1).plus(D(c.wastePercent ?? 0).div(100));
    if (c.type === 'SUB_RECIPE') {
      const child = totalCostOf(c.childRecipeId, nodes, [rootId]);
      const childYield = D(child.node.yieldQty).mul(D(child.node.yieldPercent ?? 100)).div(100);
      if (childYield.lte(0)) throw new RecipeCostError('ZERO_CHILD_YIELD', `Sub-recipe ${c.childRecipeId} has no yield.`);
      sub = sub.plus(D(c.quantity).mul(waste).mul(child.total.div(childYield)));
    } else {
      const line = D(c.quantityBase).mul(waste).mul(D(c.unitCostPerBase));
      if (c.type === 'PACKAGING') packaging = packaging.plus(line); else ingredient = ingredient.plus(line);
    }
  }
  const direct = ingredient.plus(packaging).plus(sub);
  const overhead = overheadOf(direct, ingredient, node.overhead);
  const total = direct.plus(overhead);

  const effYield = D(node.yieldQty).mul(D(node.yieldPercent ?? 100)).div(100);
  const costPerYieldUnit = effYield.gt(0) ? total.div(effYield) : D(0);
  const portionCount = node.portionQty && node.portionQty > 0 && effYield.gt(0) ? effYield.div(D(node.portionQty)) : null;
  const costPerPortion = portionCount ? total.div(portionCount) : null;

  return {
    ingredientCost: num(ingredient, 4), packagingCost: num(packaging, 4), subRecipeCost: num(sub, 4),
    directCost: num(direct, 4), overheadCost: num(overhead, 4), totalCost: num(total, 4),
    effectiveYield: num(effYield, 4), costPerYieldUnit: num(costPerYieldUnit, 6),
    portionCount: portionCount ? num(portionCount, 4) : null,
    costPerPortion: costPerPortion ? num(costPerPortion, 4) : null,
  };
}

/** แปลงเรคคอร์ด RecipeVersion → OverheadInput (รองรับโหมดใหม่ + สูตรเดิม) — pure, unit-testable */
export function overheadFromRecord(r: {
  overheadMode?: string | null; overheadTotal?: number | null; overheadPercent?: number | null;
  overheadBase?: string | null; overheadDetails?: unknown;
  laborCost?: number; electricCost?: number; waterCost?: number; gasCost?: number; overheadCost?: number; otherCost?: number;
}): OverheadInput {
  if (r.overheadMode === 'TOTAL' || r.overheadMode === 'PERCENTAGE' || r.overheadMode === 'DETAILED') {
    return {
      mode: r.overheadMode,
      total: r.overheadTotal ?? null,
      percent: r.overheadPercent ?? null,
      base: (r.overheadBase === 'DIRECT' || r.overheadBase === 'TOTAL' || r.overheadBase === 'INGREDIENT') ? r.overheadBase : null,
      details: Array.isArray(r.overheadDetails) ? (r.overheadDetails as { label: string; amount: number }[]) : null,
    };
  }
  return { legacy: { laborCost: r.laborCost ?? 0, electricCost: r.electricCost ?? 0, waterCost: r.waterCost ?? 0, gasCost: r.gasCost ?? 0, overheadCost: r.overheadCost ?? 0, otherCost: r.otherCost ?? 0 } };
}

/** ตรวจความถูกต้องของ component ก่อนบันทึก — pure */
export function validateComponentRef(c: { componentType: string; itemId?: string | null; childRecipeId?: string | null }): boolean {
  if (c.componentType === 'SUB_RECIPE') return Boolean(c.childRecipeId) && !c.itemId;
  if (c.componentType === 'ITEM' || c.componentType === 'PACKAGING') return Boolean(c.itemId) && !c.childRecipeId;
  return false;
}

/** ตรวจ cycle ก่อนบันทึก: การเพิ่ม child ให้ parent จะทำให้อ้างอิงวนหรือไม่ (edges = parent→childList) */
export function wouldCreateCycle(parentId: string, childId: string, edges: Map<string, string[]>): boolean {
  if (parentId === childId) return true;
  // ถ้าเดินจาก childId ตาม edges แล้วไปถึง parentId → เพิ่มแล้ววน
  const stack = [childId];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === parentId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of edges.get(cur) ?? []) stack.push(next);
  }
  return false;
}
