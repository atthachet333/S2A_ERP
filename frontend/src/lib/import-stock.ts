export type ImportStockReason = 'OPENING' | 'PURCHASE' | 'ADJUST';
export type ImportStockFlow = 'RECEIVING' | 'ADJUSTMENT';

export interface ImportStockPermissions {
  canReceive: boolean;
  canAdjust: boolean;
}

export interface ImportStockItem {
  id: string;
  code: string;
  name: string;
  lastCost: number | string;
  purchaseToBaseFactor: number | string;
  isLotTracked?: boolean;
  isExpiryTracked?: boolean;
  baseUnit: { code: string; name: string };
  purchaseUnit?: { code: string; name: string } | null;
  stockBalances: { warehouseId: string; onHand: number | string; reserved: number | string }[];
}

export const IMPORT_REASON_LABEL: Record<ImportStockReason, string> = {
  OPENING: 'ยอดตั้งต้น',
  PURCHASE: 'รับเข้าจากการซื้อ',
  ADJUST: 'ปรับยอด',
};

export function importStockPermissions(roles: string[] = [], permissions: string[] = []): ImportStockPermissions {
  const superAdmin = roles.includes('SUPER_ADMIN');
  return {
    canReceive: superAdmin || (permissions.includes('RECEIVING_CREATE') && permissions.includes('RECEIVING_CONFIRM')),
    canAdjust: superAdmin || permissions.includes('INVENTORY_ADJUST'),
  };
}

export function availableImportReasons(access: ImportStockPermissions): ImportStockReason[] {
  if (access.canReceive) return ['OPENING', 'PURCHASE', 'ADJUST'];
  return access.canAdjust ? ['OPENING', 'ADJUST'] : [];
}

export function importFlow(access: ImportStockPermissions): ImportStockFlow {
  return access.canReceive ? 'RECEIVING' : 'ADJUSTMENT';
}

export function itemStock(item: ImportStockItem | undefined, warehouseId?: string) {
  const balances = item?.stockBalances ?? [];
  const relevant = warehouseId ? balances.filter((row) => row.warehouseId === warehouseId) : balances;
  return {
    hasHistory: relevant.length > 0,
    onHand: relevant.reduce((sum, row) => sum + Number(row.onHand), 0),
  };
}

export function importUnit(item: ImportStockItem, flow: ImportStockFlow) {
  if (flow === 'RECEIVING') return item.purchaseUnit ?? item.baseUnit;
  return item.baseUnit;
}

export function buildImportStockRequest(input: {
  access: ImportStockPermissions;
  item: ImportStockItem;
  warehouseId: string;
  quantity: number;
  unitCode: string;
  unitPrice: number;
  reason: ImportStockReason;
  lotNo?: string;
  manufactureDate?: string;
  expiryDate?: string;
  note?: string;
}) {
  const flow = importFlow(input.access);
  const reasonNote = `นำเข้าสต็อก: ${IMPORT_REASON_LABEL[input.reason]}`;
  const note = [reasonNote, input.note?.trim()].filter(Boolean).join(' · ');
  const lot = {
    ...(input.lotNo?.trim() ? { lotNo: input.lotNo.trim() } : {}),
    ...(input.manufactureDate ? { manufactureDate: input.manufactureDate } : {}),
    ...(input.expiryDate ? { expiryDate: input.expiryDate } : {}),
  };

  if (flow === 'RECEIVING') {
    return {
      flow,
      path: '/business/receiving',
      body: {
        warehouseId: input.warehouseId,
        confirm: true,
        note,
        items: [{ itemId: input.item.id, quantity: input.quantity, unitPrice: input.unitPrice, ...lot }],
      },
    } as const;
  }

  const purchaseCode = input.item.purchaseUnit?.code;
  const baseQuantity = purchaseCode && input.unitCode === purchaseCode
    ? input.quantity * Number(input.item.purchaseToBaseFactor)
    : input.quantity;
  return {
    flow,
    path: '/business/inventory/adjustments',
    body: {
      warehouseId: input.warehouseId,
      reason: input.reason === 'OPENING' ? 'OPENING' : 'COUNT',
      note,
      items: [{ itemId: input.item.id, mode: 'INCREASE', quantity: baseQuantity, ...lot }],
    },
  } as const;
}
