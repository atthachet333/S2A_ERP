import { useQuery } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';

export interface DashboardSummary {
  users: number;
  activeUsers: number;
  units: number;
  warehouses: number;
  items: number;
  recipes: number;
  rawMaterials: number;
  menus: number;
  activeRecipes: number;
  itemsWithoutPrice: number;
  production: { runs: number; averageYieldPercent: number | null; costVariance: number; recordedWaste: { unitCode: string; quantity: number }[]; lowSample: boolean };
  purchasePlanning: { plans: number; draftPlans: number; shortageItems: number; estimatedCost: number };
  purchaseOrders?: { draft: number; awaitingDelivery: number; partial: number; overdue: number };
  inventoryValuation?: { knownValue: number; unknownCostStockCount: number; history: { snapshotId: string; businessDate: string; knownValue: number; completeness: number }[] };
  costInsights?: { productionVariance: number; productionRunCount: number; movers: { itemId: string; itemCode: string; itemName: string; previousCost: number; latestCost: number; change: number; latestAt: string; latestSource: string }[] };
}

/** ตัวเลขสรุปจากฐานข้อมูลจริง (System Overview + Setup Progress) */
export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient.get<DashboardSummary>('/dashboard/summary'),
    staleTime: 30_000,
  });
}
