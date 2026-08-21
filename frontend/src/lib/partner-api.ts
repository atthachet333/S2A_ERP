import { apiClient } from '@/lib/api-client';

/**
 * PHASE 7B — Supplier / Warehouse master API
 *
 * มาแทนการอ่านผ่าน /business/operations/lookups ซึ่งคืนแค่ {id, code, name}
 * และเห็นเฉพาะรายการที่ใช้งานอยู่
 *
 * field ทั้งหมดในนี้ตรงกับ schema จริง (ตรวจแล้วใน schema.prisma)
 * Supplier ไม่มี contactName / note · Warehouse ไม่มี description / location
 */

export type PartnerStatus = 'active' | 'inactive' | 'all';

export interface Supplier {
  id: string; code: string; name: string;
  taxId: string | null; phone: string | null; email: string | null; address: string | null;
  isActive: boolean;
  /** จำนวนใบรับของที่อ้างถึงผู้จำหน่ายรายนี้ (นับจาก relation จริง) */
  receivingCount: number;
  createdAt: string; updatedAt: string;
}

export interface Warehouse {
  id: string; code: string; name: string;
  /** ItemType | null — คลังเฉพาะทาง เช่น RAW_MATERIAL */
  type: string | null;
  isActive: boolean;
  itemCount: number;
  onHand: number;
  reserved: number;
  stockValue: number;
  createdAt: string; updatedAt: string;
}

const listQuery = (params: { keyword?: string; status?: PartnerStatus }) => {
  const q = new URLSearchParams();
  if (params.keyword?.trim()) q.set('keyword', params.keyword.trim());
  if (params.status) q.set('status', params.status);
  const s = q.toString();
  return s ? `?${s}` : '';
};

export interface SupplierPatch {
  name?: string; code?: string; phone?: string; taxId?: string; email?: string; address?: string; isActive?: boolean;
}
export interface WarehousePatch {
  name?: string; code?: string; type?: string | null; isActive?: boolean;
}

export const partnerApi = {
  suppliers: (params: { keyword?: string; status?: PartnerStatus } = {}) =>
    apiClient.get<Supplier[]>(`/business/suppliers${listQuery(params)}`),
  supplier: (id: string) => apiClient.get<Supplier>(`/business/suppliers/${id}`),
  createSupplier: (body: SupplierPatch) => apiClient.post<{ id: string; code: string; name: string }>('/business/suppliers', body),
  updateSupplier: (id: string, body: SupplierPatch) => apiClient.patch<Supplier>(`/business/suppliers/${id}`, body),

  warehouses: (params: { keyword?: string; status?: PartnerStatus } = {}) =>
    apiClient.get<Warehouse[]>(`/business/warehouses${listQuery(params)}`),
  warehouse: (id: string) => apiClient.get<Warehouse>(`/business/warehouses/${id}`),
  createWarehouse: (body: WarehousePatch) => apiClient.post<{ id: string; code: string; name: string }>('/business/warehouses', body),
  updateWarehouse: (id: string, body: WarehousePatch) => apiClient.patch<Warehouse>(`/business/warehouses/${id}`, body),
};

/* ============================================================
   ข้อความ error ของเฟสนี้
   ============================================================ */
const qty = (v: unknown) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });

/**
 * คลังปิดใช้งานไม่ได้เพราะยังมีของ
 * backend ส่งยอดจริงมาใน details — ใช้เลขนั้นเท่านั้น ห้ามแต่งเอง
 * ถ้าไม่ส่งมา ก็บอกแบบไม่มีตัวเลข
 */
export function warehouseStockBlockMessage(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const code = String((error as { code?: unknown }).code ?? '');
  if (code !== 'WAREHOUSE_HAS_STOCK') return null;

  const details = (error as { details?: { onHand?: number; reserved?: number; itemCount?: number } }).details;
  if (!details || typeof details.onHand !== 'number') {
    return 'คลังนี้ยังมีสินค้าอยู่ จึงยังไม่สามารถปิดใช้งานได้';
  }
  const parts: string[] = [];
  if (details.onHand !== 0) parts.push(`คงเหลือ ${qty(details.onHand)}`);
  if (details.reserved) parts.push(`จองแล้ว ${qty(details.reserved)}`);
  const detail = parts.length ? ` (${parts.join(' · ')}${details.itemCount ? ` จาก ${details.itemCount} รายการ` : ''})` : '';
  return `คลังนี้ยังมีสินค้าอยู่${detail} จึงยังไม่สามารถปิดใช้งานได้`;
}
