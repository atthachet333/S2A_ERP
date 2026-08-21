import type { InventoryKpi, InventoryRow } from '@/hooks/useDashboardData';
import type { MenuRow } from '@/lib/catalog';

/**
 * PHASE 5 — "ต้องจัดการตอนนี้"
 *
 * รวมเฉพาะเรื่องที่ทำอะไรต่อได้จริง และมาจากข้อมูลจริงเท่านั้น
 * ไม่มีการเดา threshold: ถ้าผู้ใช้ไม่ได้ตั้ง reorderPoint/minQty backend จะส่ง status
 * เป็น IN_STOCK อยู่แล้ว (ดู business.route.ts) ที่นี่จึงแค่นับตามสถานะที่ backend ตัดสิน
 */

export type Severity = 'critical' | 'warning' | 'info';

export interface DashboardAlert {
  id: string;
  severity: Severity;
  title: string;
  detail: string;
  ctaLabel: string;
  ctaTo: string;
  count: number;
}

export interface AlertInput {
  inventoryKpi?: InventoryKpi;
  inventoryRows?: InventoryRow[];
  menus?: MenuRow[];
  receivingDrafts: number;
  issueDrafts: number;
  /** สูตรที่ยังไม่มีราคาซื้อของวัตถุดิบ — มาจาก /dashboard/summary */
  itemsWithoutPrice?: number;
}

export function buildDashboardAlerts(input: AlertInput): DashboardAlert[] {
  const out: DashboardAlert[] = [];
  const { inventoryKpi, inventoryRows, menus, receivingDrafts, issueDrafts, itemsWithoutPrice } = input;

  // สต็อกติดลบ = ผิดปกติที่สุด ควรอยู่บนสุดเสมอ
  if (inventoryKpi && inventoryKpi.negativeCount > 0) {
    out.push({
      id: 'stock-negative', severity: 'critical', count: inventoryKpi.negativeCount,
      title: `สต็อกติดลบ ${inventoryKpi.negativeCount} รายการ`,
      detail: 'ยอดคงเหลือน้อยกว่าศูนย์ — ต้องตรวจการเบิก/รับเข้าย้อนหลัง',
      ctaLabel: 'ดูคลังสินค้า', ctaTo: '/inventory?status=NEGATIVE',
    });
  }

  if (inventoryKpi && inventoryKpi.outCount > 0) {
    const names = (inventoryRows ?? []).filter((r) => r.status === 'OUT').slice(0, 3).map((r) => r.name);
    out.push({
      id: 'stock-out', severity: 'critical', count: inventoryKpi.outCount,
      title: `สินค้าหมดสต็อก ${inventoryKpi.outCount} รายการ`,
      detail: names.length ? names.join(', ') + (inventoryKpi.outCount > names.length ? ' และอื่น ๆ' : '') : 'ยอดคงเหลือเป็นศูนย์',
      ctaLabel: 'ดูคลังสินค้า', ctaTo: '/inventory?status=OUT',
    });
  }

  if (inventoryKpi && inventoryKpi.lowCount > 0) {
    out.push({
      id: 'stock-low', severity: 'warning', count: inventoryKpi.lowCount,
      title: `ใกล้ถึงจุดสั่งซื้อ ${inventoryKpi.lowCount} รายการ`,
      detail: 'คงเหลือต่ำกว่าหรือเท่ากับจุดสั่งซื้อที่ตั้งไว้',
      ctaLabel: 'ดูคลังสินค้า', ctaTo: '/inventory?status=LOW',
    });
  }

  // ราคาขายต่ำกว่าต้นทุน — margin ติดลบคือขาดทุนจริง ไม่ได้ตั้งเกณฑ์เอง
  const belowCost = (menus ?? []).filter((m) => m.sellingPrice != null && m.margin != null && m.margin < 0);
  if (belowCost.length > 0) {
    out.push({
      id: 'price-below-cost', severity: 'critical', count: belowCost.length,
      title: `ราคาขายต่ำกว่าต้นทุน ${belowCost.length} เมนู`,
      detail: belowCost.slice(0, 3).map((m) => m.name).join(', ') + (belowCost.length > 3 ? ' และอื่น ๆ' : ''),
      ctaLabel: 'จัดการราคาขาย', ctaTo: '/pricing',
    });
  }

  if (receivingDrafts > 0) {
    out.push({
      id: 'receiving-draft', severity: 'warning', count: receivingDrafts,
      title: `ใบรับของรอยืนยัน ${receivingDrafts} ใบ`,
      detail: 'ร่างที่ยังไม่ยืนยันจะยังไม่เพิ่มสต็อกและยังไม่อัปเดตต้นทุน',
      ctaLabel: 'ไปที่รับของเข้า', ctaTo: '/receiving',
    });
  }

  if (issueDrafts > 0) {
    out.push({
      id: 'issue-draft', severity: 'warning', count: issueDrafts,
      title: `ใบเบิกรอยืนยัน ${issueDrafts} ใบ`,
      detail: 'ร่างที่ยังไม่ยืนยันจะยังไม่ตัดสต็อก',
      ctaLabel: 'ไปที่เบิกครัวกลาง', ctaTo: '/stock-issues',
    });
  }

  // เมนูที่ยังไม่ได้ตั้งราคาเลย
  const unpriced = (menus ?? []).filter((m) => m.sellingPrice == null);
  if (unpriced.length > 0) {
    out.push({
      id: 'menu-unpriced', severity: 'info', count: unpriced.length,
      title: `ยังไม่ได้ตั้งราคาขาย ${unpriced.length} เมนู`,
      detail: 'เมนูที่ยังไม่มีราคาจะคำนวณกำไรไม่ได้',
      ctaLabel: 'ตั้งราคาขาย', ctaTo: '/pricing',
    });
  }

  if (itemsWithoutPrice && itemsWithoutPrice > 0) {
    out.push({
      id: 'item-no-price', severity: 'info', count: itemsWithoutPrice,
      title: `วัตถุดิบยังไม่มีราคาซื้อ ${itemsWithoutPrice} รายการ`,
      detail: 'ต้นทุนสูตรที่ใช้วัตถุดิบเหล่านี้จะต่ำกว่าความจริง',
      ctaLabel: 'ดูวัตถุดิบ', ctaTo: '/ingredients',
    });
  }

  const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** รายการที่ควรเติมสต็อก — เรียงจากวิกฤตที่สุด ใช้ status ที่ backend ตัดสินแล้ว */
export function restockList(rows: InventoryRow[] | undefined, limit = 6): InventoryRow[] {
  const rank: Record<string, number> = { NEGATIVE: 0, OUT: 1, LOW: 2 };
  return (rows ?? [])
    .filter((r) => r.status === 'NEGATIVE' || r.status === 'OUT' || r.status === 'LOW')
    .sort((a, b) => (rank[a.status] - rank[b.status]) || (a.available - b.available))
    .slice(0, limit);
}

/**
 * PHASE 12 — แดชบอร์ดเคยมีตารางแปล action ของตัวเอง (ACTIVITY_TH) ซึ่ง:
 *   1) ครอบคลุมแค่ 3 จาก 21 action ที่มีอยู่จริงใน audit_logs
 *   2) เขียน PRICE_UPDATED ผิด (ของจริงคือ PRICE_UPDATE)
 *   3) ให้คำแปลไม่ตรงกับหน้า "ประวัติการใช้งาน" ที่ใช้ auditActionLabel
 * ผลคือหน้าแดชบอร์ดโชว์ SWITCH_COMPANY / PRICE_UPDATE / RECIPE_UPDATED เป็นอังกฤษดิบ
 * จึงเลิกใช้ตารางซ้ำ แล้วอ้าง auditActionLabel ที่เดียวทั้งระบบ
 */
export { auditActionLabel as activityLabel } from '@/lib/admin-vocab';
