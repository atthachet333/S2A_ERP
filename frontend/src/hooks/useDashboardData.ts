import { useQueries } from '@tanstack/react-query';
import { apiClient } from '@/lib/api-client';
import { catalogApi, type MenuRow } from '@/lib/catalog';

/**
 * PHASE 5 — แหล่งข้อมูลของ Dashboard
 *
 * กติกา: ใช้เฉพาะ endpoint ที่มีอยู่จริง และเรียกเฉพาะที่ผู้ใช้มีสิทธิ์
 * แต่ละแหล่งเป็น query แยกกัน ถ้าอันหนึ่งล้ม การ์ดอื่นต้องยังทำงานได้
 * ไม่มีการสร้างตัวเลขปลอมหรือ trend ที่ไม่มีข้อมูลย้อนหลังรองรับ
 */

export interface InventoryKpi {
  itemCount: number; totalValue: number; lowCount: number; outCount: number;
  negativeCount: number; movementsToday: number; thresholdMissing: boolean;
}
export interface InventoryRow {
  itemId: string; code: string; name: string; type: string;
  warehouseId: string; warehouseCode: string; warehouseName: string;
  onHand: number; reserved: number; available: number; unit: string;
  lastCost: number; stockValue: number; threshold: number;
  status: 'IN_STOCK' | 'LOW' | 'OUT' | 'NEGATIVE';
  lastMovementAt: string | null;
}
export interface OrderKpi {
  totalOrders: number; todayOrders: number; monthOrders: number;
  revenueToday: number; revenueMonth: number; pendingAmount: number;
}
export interface DocRow { id: string; status: string; [k: string]: unknown }
export interface OrderRow {
  id: string; orderNo: string; status: string;
  /** Prisma Decimal ถูก serialize เป็น string — ต้องแปลงก่อนใช้เสมอ */
  totalAmount: string | number;
  deliveryDate?: string | null; createdAt?: string;
  customer?: { name: string } | null;
}

/** มีสิทธิ์ข้อใดข้อหนึ่งไหม (SUPER_ADMIN ผ่านหมด เหมือนที่ backend ทำ) */
export function canAny(roles: string[], permissions: string[], ...needed: string[]) {
  if (roles.includes('SUPER_ADMIN')) return true;
  return needed.some((p) => permissions.includes(p));
}

const STALE = 30_000;

export function useDashboardData(roles: string[], permissions: string[]) {
  const may = (...p: string[]) => canAny(roles, permissions, ...p);

  const canInventory = may('INVENTORY_VIEW', 'STOCK_VIEW');
  const canOrders = may('ORDER_VIEW');
  const canOrderKpi = may('KPI_VIEW', 'DASHBOARD_VIEW');
  const canReceiving = may('RECEIVING_VIEW', 'RECEIVING_CREATE');
  const canIssues = may('STOCK_ISSUE_VIEW', 'STOCK_ISSUE_CREATE');

  const results = useQueries({
    queries: [
      {
        queryKey: ['dash', 'inventory'],
        queryFn: () => apiClient.get<{ rows: InventoryRow[]; kpi: InventoryKpi }>('/business/inventory'),
        enabled: canInventory, staleTime: STALE, retry: false,
      },
      {
        queryKey: ['dash', 'order-kpi'],
        queryFn: () => apiClient.get<OrderKpi>('/business/kpi'),
        enabled: canOrderKpi, staleTime: STALE, retry: false,
      },
      {
        queryKey: ['dash', 'orders'],
        queryFn: () => apiClient.get<OrderRow[]>('/business/orders'),
        enabled: canOrders, staleTime: STALE, retry: false,
      },
      {
        queryKey: ['dash', 'receiving'],
        queryFn: () => apiClient.get<DocRow[]>('/business/receiving'),
        enabled: canReceiving, staleTime: STALE, retry: false,
      },
      {
        queryKey: ['dash', 'issues'],
        queryFn: () => apiClient.get<DocRow[]>('/business/stock-issues'),
        enabled: canIssues, staleTime: STALE, retry: false,
      },
      {
        queryKey: ['dash', 'adjustments'],
        queryFn: () => apiClient.get<DocRow[]>('/business/inventory/adjustments'),
        enabled: canInventory, staleTime: STALE, retry: false,
      },
      {
        queryKey: ['dash', 'menus'],
        queryFn: () => catalogApi.menus(),
        staleTime: STALE, retry: false,
      },
    ],
  });

  const [inventory, orderKpi, orders, receiving, issues, adjustments, menus] = results;

  return {
    inventory, orderKpi, orders, receiving, issues, adjustments,
    menus: menus as { data?: MenuRow[]; isLoading: boolean; isError: boolean; refetch: () => unknown },
    permissions: { canInventory, canOrders, canOrderKpi, canReceiving, canIssues },
    /** refetch ทุกแหล่งพร้อมกัน — ไม่ reload ทั้งหน้า */
    refetchAll: () => { for (const r of results) void r.refetch(); },
    isFetching: results.some((r) => r.isFetching),
    /** เวลาที่ข้อมูลชุดล่าสุดถูกดึงสำเร็จจริง — 0 แปลว่ายังไม่เคยโหลดสำเร็จ */
    lastUpdatedAt: Math.max(0, ...results.map((r) => r.dataUpdatedAt ?? 0)),
  };
}

/** นับเอกสารของวันนี้จากรายการที่ backend ส่งมา — ไม่ได้เพิ่ม endpoint ใหม่ */
export function countToday(rows: DocRow[] | undefined, dateKey: string, now = new Date()) {
  if (!rows) return { total: 0, draft: 0, confirmed: 0, reversed: 0 };
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  const today = rows.filter((r) => {
    const raw = r[dateKey];
    if (typeof raw !== 'string') return false;
    const d = new Date(raw);
    return !Number.isNaN(d.getTime()) && d >= start;
  });
  return {
    total: today.length,
    draft: today.filter((r) => r.status === 'DRAFT').length,
    confirmed: today.filter((r) => r.status === 'CONFIRMED' || r.status === 'ISSUED').length,
    reversed: today.filter((r) => r.status === 'REVERSED').length,
  };
}

/** ร่างที่ยังรอยืนยัน (ทุกวัน ไม่ใช่เฉพาะวันนี้) — เป็น action ที่ค้างอยู่จริง */
export function draftCount(rows: DocRow[] | undefined) {
  return (rows ?? []).filter((r) => r.status === 'DRAFT').length;
}
