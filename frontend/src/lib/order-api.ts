import { apiClient } from '@/lib/api-client';

/**
 * PHASE 8 — Orders / Customers API
 *
 * ทุก field ตรงกับ schema.prisma และ business.route.ts จริง
 *
 * PHASE 8B เปิด contract ที่เคยขาดครบแล้ว:
 *   GET/PATCH /orders/:id · GET/PATCH /customers/:id · SalesOrder.priceTier
 *
 * สิ่งที่ยังต้องระวัง:
 *   - priceTier บอกว่าราคา "เริ่มมาจาก" ระดับไหน
 *     ความจริงทางการเงินคือ OrderLine.unitPrice / lineTotal ซึ่งแช่แข็งไว้ตอนสร้าง
 *   - ออเดอร์ที่สร้างก่อนเฟสนี้ priceTier เป็น null และห้ามเดาย้อนหลัง
 */

export interface OrderCustomer {
  id: string; code: string; name: string;
  customerType?: string | null; contactName?: string | null;
  phone?: string | null; email?: string | null;
  address?: string | null; billingAddress?: string | null;
  lineId?: string | null; branch?: string | null; taxId?: string | null; note?: string | null;
  isActive: boolean; createdAt?: string; updatedAt?: string;
  /** เติมโดย GET /business/customers เท่านั้น */
  orderCount?: number;
  upcomingOrders?: number;
  deliveredSales?: string | number;
  lastOrder?: { id: string; orderNo: string; deliveryDate: string; status: string; totalAmount: string } | null;
  /** เติมโดย GET /business/customers/:id เท่านั้น (สูงสุด 10 ใบล่าสุด) */
  recentOrders?: { id: string; orderNo: string; deliveryDate: string; status: string; totalAmount: string; priceTier?: string | null }[];
}

export interface OrderLine {
  id: string;
  /** ที่จริงคือ id ของ Item ที่ type = FINISHED_GOOD */
  menuId: string;
  /** ชื่อ ณ เวลาที่สร้างออเดอร์ — snapshot ห้ามแทนที่ด้วยชื่อปัจจุบัน */
  menuNameSnapshot: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  lineTotal: string;
  note?: string | null;
}

export interface Order {
  id: string; orderNo: string; status: string;
  customerId: string; customer: OrderCustomer;
  contactName?: string | null; phone?: string | null; email?: string | null;
  deliveryAddress?: string | null;
  deliveryDate: string; deliveryTime?: string | null;
  subtotal: string; discount: string; tax: string; totalAmount: string;
  /** ระดับราคาที่ใช้ตั้งต้นราคา — null สำหรับออเดอร์เก่าที่สร้างก่อนมีฟีเจอร์นี้ */
  priceTier?: string | null;
  note?: string | null;
  cancellationReason?: string | null;
  createdByUserId?: string;
  /** timestamp รายขั้นที่ schema มีจริง — ไม่มี pickingAt */
  confirmedAt?: string | null;
  sentToOperationsAt?: string | null;
  issuedAt?: string | null;
  readyAt?: string | null;
  deliveredAt?: string | null;
  cancelledAt?: string | null;
  createdAt: string; updatedAt: string;
  items: OrderLine[];
}

export interface NewOrderLine {
  menuId: string; menuNameSnapshot: string;
  quantity: number; unit: string; unitPrice: number; note?: string;
}
export interface NewOrder {
  customerId: string;
  deliveryDate: string; deliveryTime?: string;
  contactName?: string; phone?: string; email?: string; deliveryAddress?: string;
  discount?: number; tax?: number; note?: string;
  priceTier?: string;
  idempotencyKey?: string;
  items: NewOrderLine[];
}

/** แก้ร่างออเดอร์ — ส่งเฉพาะส่วนที่เปลี่ยน */
export type OrderPatch = Partial<Omit<NewOrder, 'idempotencyKey'>>;

export interface CustomerPatch {
  name?: string; code?: string; customerType?: string; contactName?: string;
  phone?: string; email?: string; address?: string; billingAddress?: string;
  lineId?: string; branch?: string; taxId?: string; note?: string; isActive?: boolean;
}

export const orderApi = {
  orders: () => apiClient.get<Order[]>('/business/orders'),
  /** ใบเดียว — ไม่ต้องโหลดออเดอร์ทั้งระบบเพื่อหาใบเดียวอีกต่อไป */
  order: (id: string) => apiClient.get<Order>(`/business/orders/${id}`),
  createOrder: (body: NewOrder) => apiClient.post<Order>('/business/orders', body),
  /** แก้ได้เฉพาะร่าง — backend คืน 409 ORDER_NOT_EDITABLE ถ้าไม่ใช่ */
  updateOrder: (id: string, body: OrderPatch) => apiClient.patch<Order>(`/business/orders/${id}`, body),
  transition: (id: string, status: string, cancellationReason?: string) =>
    apiClient.post<Order>(`/business/orders/${id}/transition`, { status, ...(cancellationReason ? { cancellationReason } : {}) }),

  /** hasOrders=1 → เฉพาะลูกค้าที่เคยสั่งจริง (ใช้ในหน้ารายชื่อ) */
  customers: (hasOrders?: boolean) =>
    apiClient.get<OrderCustomer[]>(`/business/customers${hasOrders ? '?hasOrders=1' : ''}`),
  customer: (id: string) => apiClient.get<OrderCustomer>(`/business/customers/${id}`),
  updateCustomer: (id: string, body: CustomerPatch) => apiClient.patch<OrderCustomer>(`/business/customers/${id}`, body),
  archiveCustomer: (id: string) => apiClient.post<OrderCustomer>(`/business/customers/${id}/archive`),
};

/* ============================================================
   ข้อความ error ของเฟสนี้ — ห้ามโชว์ error ดิบจาก Prisma
   ============================================================ */
const ORDER_ERROR_TH: Record<string, string> = {
  ORDER_NOT_EDITABLE: 'ออเดอร์นี้ยืนยันแล้ว จึงแก้ไขไม่ได้',
  ORDER_NOT_FOUND: 'ไม่พบออเดอร์นี้ในบริษัทปัจจุบัน',
  CUSTOMER_NOT_FOUND: 'ไม่พบข้อมูลลูกค้า',
  DUPLICATE_CUSTOMER: 'มีรหัสลูกค้านี้อยู่แล้วในบริษัท',
  INVALID_PRICE_TIER: 'ระดับราคานี้ไม่ถูกต้อง',
  FORBIDDEN: 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้',
  VALIDATION_ERROR: 'ข้อมูลยังไม่ครบหรือรูปแบบไม่ถูกต้อง',
};

export function orderErrorMessage(error: unknown, fallback = 'ทำรายการไม่สำเร็จ'): string {
  if (!error || typeof error !== 'object') return fallback;
  const code = String((error as { code?: unknown }).code ?? '');
  if (ORDER_ERROR_TH[code]) return ORDER_ERROR_TH[code];
  const msg = error instanceof Error ? error.message : '';
  // กัน error ดิบของ Prisma/SQL หลุดถึงผู้ใช้
  if (/prisma|P\d{4}|invalid `|Argument /i.test(msg)) return fallback;
  return msg || fallback;
}

export const isNotEditable = (error: unknown): boolean =>
  Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ORDER_NOT_EDITABLE');

/* ============================================================
   ตัวช่วยที่ใช้ร่วมกันหลายหน้า
   ============================================================ */

/** ออเดอร์ของลูกค้ารายหนึ่ง เรียงล่าสุดก่อน */
export const ordersOfCustomer = (orders: Order[], customerId: string) =>
  orders.filter((o) => o.customerId === customerId)
    .slice()
    .sort((a, b) => b.deliveryDate.localeCompare(a.deliveryDate));

/** ค้นหาลูกค้าจากชื่อ รหัส เบอร์ อีเมล — ตาม field ที่ API ส่งมาจริง */
export function searchCustomers(rows: OrderCustomer[], keyword: string): OrderCustomer[] {
  const q = keyword.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((c) => [c.name, c.code, c.phone, c.email, c.contactName]
    .some((v) => (v ?? '').toLowerCase().includes(q)));
}
