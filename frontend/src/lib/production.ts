export interface ProductionMaterialRow {
  id?: string;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  isLotTracked?: boolean;
  unitCode: string | null;
  plannedQty: number;
  actualQty: number;
  availableQty?: number;
  plannedUnitCost: number;
  plannedTotalCost: number;
  unitCost?: number;
  totalCost?: number;
  item?: { code: string; name: string; baseUnit?: { code: string } | null };
  lotAllocations?: { lotId:string; quantity:number; lotNo?:string; expiryDate?:string|null; available?:number }[];
}

export interface ProductionWasteRow {
  id?: string;
  itemId: string | null;
  quantity: number;
  unitCode?: string | null;
  reason: 'TRIM_LOSS' | 'SPILLAGE' | 'DAMAGED' | 'OVERCOOKED' | 'EXPIRED_DURING_PRODUCTION' | 'QUALITY_REJECT' | 'OTHER';
  note?: string | null;
  unitCost?: number | null;
  totalCost?: number | null;
  item?: { code: string; name: string; baseUnit?: { code: string } | null } | null;
}

export const WASTE_REASON_LABELS: Record<ProductionWasteRow['reason'], string> = {
  TRIM_LOSS: 'เศษตัดแต่ง', SPILLAGE: 'หก / รั่วไหล', DAMAGED: 'เสียหาย', OVERCOOKED: 'สุกเกิน',
  EXPIRED_DURING_PRODUCTION: 'หมดอายุระหว่างผลิต', QUALITY_REJECT: 'ไม่ผ่านคุณภาพ', OTHER: 'อื่น ๆ',
};

export const productionVariance = (expected: number, actual: number) => {
  const quantity = Number(actual || 0) - Number(expected || 0);
  const percent = expected > 0 ? quantity / expected * 100 : null;
  return { quantity, percent };
};

export const productionOutputPerformance = (planned: number, actual: number, yieldMode?: string | null) => {
  const measurable = yieldMode !== 'BATCH' && planned > 0;
  if (!measurable) return { measurable: false, variance: null, variancePercent: null, yieldPercent: null };
  const variance = actual - planned;
  return { measurable: true, variance, variancePercent: variance / planned * 100, yieldPercent: actual / planned * 100 };
};

export const productionCostSummary = (materials: ProductionMaterialRow[], actualOutput: number) => {
  const standardCost = materials.reduce((sum, line) => sum + Number(line.plannedTotalCost || 0), 0);
  const actualCost = materials.reduce((sum, line) => sum + Number(line.actualQty || 0) * Number(line.unitCost ?? line.plannedUnitCost ?? 0), 0);
  return {
    standardCost,
    actualCost,
    variance: actualCost - standardCost,
    actualUnitCost: actualOutput > 0 ? actualCost / actualOutput : 0,
    insufficientCount: materials.filter((line) => line.availableQty !== undefined && line.actualQty > line.availableQty).length,
  };
};

export const productionStatus = (status: string) => ({
  DRAFT: { label: 'ร่าง', tone: 'muted' },
  COMPLETED: { label: 'ยืนยันแล้ว', tone: 'success' },
  CANCELLED: { label: 'กลับรายการแล้ว', tone: 'danger' },
}[status] ?? { label: status, tone: 'muted' });
