import { describe, it, expect } from 'vitest';
import { calcRecipeCost, wouldCreateCycle, overheadFromRecord, validateComponentRef, RecipeCostError, type RecipeNode } from '../src/lib/recipe-cost.js';

const node = (over: Partial<RecipeNode> & Pick<RecipeNode, 'id'>): RecipeNode => ({
  components: [], overhead: {}, yieldQty: 1, yieldPercent: 100, portionQty: null, ...over,
});
const map = (...n: RecipeNode[]) => new Map(n.map((x) => [x.id, x]));

describe('recipe cost engine', () => {
  it('1. item-only recipe cost', () => {
    const r = calcRecipeCost('A', map(node({ id: 'A', yieldQty: 100, components: [
      { type: 'ITEM', quantityBase: 1000, unitCostPerBase: 0.035 }, // 35
      { type: 'ITEM', quantityBase: 500, unitCostPerBase: 0.05 },   // 25
    ] })));
    expect(r.ingredientCost).toBeCloseTo(60, 4);
    expect(r.totalCost).toBeCloseTo(60, 4);
    expect(r.costPerYieldUnit).toBeCloseTo(0.6, 4);
  });

  it('2. packaging is separated from ingredients', () => {
    const r = calcRecipeCost('A', map(node({ id: 'A', yieldQty: 10, components: [
      { type: 'ITEM', quantityBase: 100, unitCostPerBase: 1 },      // 100
      { type: 'PACKAGING', quantityBase: 10, unitCostPerBase: 3.5 },// 35
    ] })));
    expect(r.ingredientCost).toBeCloseTo(100, 4);
    expect(r.packagingCost).toBeCloseTo(35, 4);
    expect(r.totalCost).toBeCloseTo(135, 4);
  });

  it('3. sub-recipe flows child cost/yield-unit into parent (chef sauce example)', () => {
    // ซอสผัดเชฟ: ingredient 64.67, +20% = 12.934, total 77.604, yield 1500 ml
    const sauce = node({ id: 'SAUCE', yieldQty: 1500, overhead: { mode: 'PERCENTAGE', base: 'INGREDIENT', percent: 20 },
      components: [{ type: 'ITEM', quantityBase: 1, unitCostPerBase: 64.67 }] });
    const parent = node({ id: 'DISH', yieldQty: 1, components: [{ type: 'SUB_RECIPE', childRecipeId: 'SAUCE', quantity: 35 }] });
    const sc = calcRecipeCost('SAUCE', map(sauce));
    expect(sc.totalCost).toBeCloseTo(77.604, 3);
    expect(sc.costPerYieldUnit).toBeCloseTo(0.051736, 5);
    const pc = calcRecipeCost('DISH', map(sauce, parent));
    expect(pc.subRecipeCost).toBeCloseTo(35 * 0.0517360, 3); // ≈ 1.8108
  });

  it('4. nested A -> B -> C accumulates', () => {
    const c = node({ id: 'C', yieldQty: 10, components: [{ type: 'ITEM', quantityBase: 10, unitCostPerBase: 1 }] }); // total 10, /10 = 1/unit
    const b = node({ id: 'B', yieldQty: 10, components: [{ type: 'SUB_RECIPE', childRecipeId: 'C', quantity: 5 }] });  // 5*1=5 total, /10=0.5
    const a = node({ id: 'A', yieldQty: 1, components: [{ type: 'SUB_RECIPE', childRecipeId: 'B', quantity: 4 }] });   // 4*0.5=2
    const r = calcRecipeCost('A', map(a, b, c));
    expect(r.subRecipeCost).toBeCloseTo(2, 4);
  });

  it('5. A -> A is rejected', () => {
    const a = node({ id: 'A', components: [{ type: 'SUB_RECIPE', childRecipeId: 'A', quantity: 1 }] });
    expect(() => calcRecipeCost('A', map(a))).toThrow(RecipeCostError);
    expect(wouldCreateCycle('A', 'A', new Map())).toBe(true);
  });

  it('6. A -> B -> A cycle is rejected', () => {
    const a = node({ id: 'A', components: [{ type: 'SUB_RECIPE', childRecipeId: 'B', quantity: 1 }] });
    const b = node({ id: 'B', components: [{ type: 'SUB_RECIPE', childRecipeId: 'A', quantity: 1 }] });
    expect(() => calcRecipeCost('A', map(a, b))).toThrow(/Circular/);
    // wouldCreateCycle: adding B as child of A, where B already -> A
    expect(wouldCreateCycle('A', 'B', new Map([['B', ['A']]]))).toBe(true);
    expect(wouldCreateCycle('A', 'B', new Map([['B', ['C']]]))).toBe(false);
  });

  it('7. zero-yield child is rejected (no divide-by-zero)', () => {
    const child = node({ id: 'Z', yieldQty: 0, components: [{ type: 'ITEM', quantityBase: 1, unitCostPerBase: 5 }] });
    const a = node({ id: 'A', components: [{ type: 'SUB_RECIPE', childRecipeId: 'Z', quantity: 1 }] });
    expect(() => calcRecipeCost('A', map(a, child))).toThrow(/yield/i);
  });

  it('8. overhead TOTAL', () => {
    const r = calcRecipeCost('A', map(node({ id: 'A', yieldQty: 1, overhead: { mode: 'TOTAL', total: 180 },
      components: [{ type: 'ITEM', quantityBase: 1, unitCostPerBase: 100 }] })));
    expect(r.overheadCost).toBeCloseTo(180, 4);
    expect(r.totalCost).toBeCloseTo(280, 4);
  });

  it('9. overhead PERCENTAGE of ingredient cost (20% chef workflow)', () => {
    const r = calcRecipeCost('A', map(node({ id: 'A', yieldQty: 1, overhead: { mode: 'PERCENTAGE', base: 'INGREDIENT', percent: 20 },
      components: [{ type: 'ITEM', quantityBase: 1, unitCostPerBase: 707.46 }] })));
    expect(r.overheadCost).toBeCloseTo(141.492, 3);
    expect(r.totalCost).toBeCloseTo(848.952, 3);
  });

  it('10. overhead DETAILED sums lines', () => {
    const r = calcRecipeCost('A', map(node({ id: 'A', yieldQty: 1, overhead: { mode: 'DETAILED', details: [
      { label: 'ค่าแรง', amount: 100 }, { label: 'น้ำ', amount: 10 }, { label: 'ไฟ', amount: 40 }, { label: 'แก๊ส', amount: 30 },
    ] }, components: [{ type: 'ITEM', quantityBase: 1, unitCostPerBase: 0 }] })));
    expect(r.overheadCost).toBeCloseTo(180, 4);
  });

  it('11. portion cost (9180 g / 180 g = 51 cups)', () => {
    const r = calcRecipeCost('A', map(node({ id: 'A', yieldQty: 9180, portionQty: 180,
      overhead: { mode: 'PERCENTAGE', base: 'INGREDIENT', percent: 20 },
      components: [{ type: 'ITEM', quantityBase: 1, unitCostPerBase: 707.46 }] })));
    expect(r.portionCount).toBeCloseTo(51, 4);
    expect(r.costPerPortion).toBeCloseTo(16.646, 2); // 848.952 / 51
  });

  it('12. legacy overhead fields still work (backward compat)', () => {
    const r = calcRecipeCost('A', map(node({ id: 'A', yieldQty: 1,
      overhead: { legacy: { laborCost: 20, electricCost: 5, waterCost: 3, gasCost: 12, overheadCost: 0, otherCost: 0 } },
      components: [{ type: 'ITEM', quantityBase: 1, unitCostPerBase: 100 }] })));
    expect(r.overheadCost).toBeCloseTo(40, 4);
    expect(r.totalCost).toBeCloseTo(140, 4);
  });

  it('13. overheadFromRecord maps modes and legacy', () => {
    expect(overheadFromRecord({ overheadMode: 'PERCENTAGE', overheadPercent: 20, overheadBase: 'INGREDIENT' })).toMatchObject({ mode: 'PERCENTAGE', percent: 20, base: 'INGREDIENT' });
    expect(overheadFromRecord({ overheadMode: 'TOTAL', overheadTotal: 180 })).toMatchObject({ mode: 'TOTAL', total: 180 });
    expect(overheadFromRecord({ overheadMode: 'DETAILED', overheadDetails: [{ label: 'x', amount: 5 }] }).details).toHaveLength(1);
    const legacy = overheadFromRecord({ overheadMode: null, laborCost: 10, gasCost: 5 });
    expect(legacy.legacy?.laborCost).toBe(10);
  });

  it('14. validateComponentRef enforces exactly-one reference', () => {
    expect(validateComponentRef({ componentType: 'ITEM', itemId: 'i1' })).toBe(true);
    expect(validateComponentRef({ componentType: 'ITEM', itemId: null })).toBe(false);
    expect(validateComponentRef({ componentType: 'SUB_RECIPE', childRecipeId: 'r1' })).toBe(true);
    expect(validateComponentRef({ componentType: 'SUB_RECIPE', childRecipeId: 'r1', itemId: 'i1' })).toBe(false);
    expect(validateComponentRef({ componentType: 'PACKAGING', itemId: 'p1' })).toBe(true);
    expect(validateComponentRef({ componentType: 'BOGUS', itemId: 'x' })).toBe(false);
  });
});
