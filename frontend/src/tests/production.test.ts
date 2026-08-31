import { describe, expect, it } from 'vitest';
import { productionCostSummary, productionOutputPerformance, productionStatus, productionVariance, WASTE_REASON_LABELS } from '@/lib/production';

describe('production UI calculations', () => {
  it('keeps expected and actual quantities separate and calculates variance', () => {
    const result = productionVariance(15, 15.8);
    expect(result.quantity).toBeCloseTo(0.8, 8); expect(result.percent).toBeCloseTo(5.333333, 6);
  });

  it('summarizes standard/actual cost and output unit cost', () => {
    const result = productionCostSummary([{ itemId: 'a', unitCode: 'KG', plannedQty: 15, actualQty: 15.8, availableQty: 15, plannedUnitCost: 100, plannedTotalCost: 1500 }], 19.4);
    expect(result.standardCost).toBe(1500); expect(result.actualCost).toBe(1580); expect(result.variance).toBe(80);
    expect(result.actualUnitCost).toBeCloseTo(81.4433, 4); expect(result.insufficientCount).toBe(1);
  });

  it('uses lifecycle wording that makes stock impact explicit', () => {
    expect(productionStatus('DRAFT').label).toBe('ร่าง');
    expect(productionStatus('COMPLETED').label).toBe('ยืนยันแล้ว');
    expect(productionStatus('CANCELLED').label).toBe('กลับรายการแล้ว');
  });

  it('calculates output performance only when planned and actual units are comparable', () => {
    const result = productionOutputPerformance(20, 19.4, 'ACTUAL'); expect(result.measurable).toBe(true); expect(result.variance).toBeCloseTo(-0.6, 8); expect(result.variancePercent).toBeCloseTo(-3, 8); expect(result.yieldPercent).toBeCloseTo(97, 8);
    expect(productionOutputPerformance(2, 19.4, 'BATCH')).toEqual({ measurable: false, variance: null, variancePercent: null, yieldPercent: null });
  });

  it('keeps recorded waste as a controlled, separately labelled concept', () => {
    expect(WASTE_REASON_LABELS.TRIM_LOSS).toBe('เศษตัดแต่ง'); expect(WASTE_REASON_LABELS.OTHER).toBe('อื่น ๆ');
  });
});
