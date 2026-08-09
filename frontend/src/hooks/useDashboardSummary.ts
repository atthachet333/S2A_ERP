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
}

/** ตัวเลขสรุปจากฐานข้อมูลจริง (System Overview + Setup Progress) */
export function useDashboardSummary() {
  return useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: () => apiClient.get<DashboardSummary>('/dashboard/summary'),
    staleTime: 30_000,
  });
}
