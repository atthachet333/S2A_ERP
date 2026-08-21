import type { MenuRow } from '@/lib/catalog';
import type { DocRow } from '@/hooks/useDashboardData';
import type { DocKind } from '@/lib/operations-vocab';

/**
 * PHASE 11 — รายการย่อยของ Dashboard V2
 *
 * Phase 10 วัดได้ว่าการ์ดคู่กันเนื้อหาไม่สมดุล:
 *   - "เอกสารปฏิบัติการ" มีแต่ตัวเลข ส่วนคู่ของมัน (คลังสินค้า) มีตัวเลข+รายการ
 *   - "ต้นทุนและสูตร" มีแต่ตัวเลข ส่วนคู่ของมัน (ราคาขาย) มีตัวเลข+รายการ
 *
 * ไฟล์นี้จึงสร้าง "รายการ" ให้ฝั่งที่ขาด โดยใช้ field ที่ API ส่งมาจริงเท่านั้น
 * ไม่มีการสร้างตัวเลขปลอม ไม่มี trend และไม่เติมแถวหลอกเพื่อให้การ์ดสูงเท่ากัน
 */

/* ============================================================
   เอกสารปฏิบัติการล่าสุด (รับของ / เบิก / ปรับปรุงสต็อก)
   ============================================================ */
/** ใช้ DocKind ชุดเดียวกับ operations-vocab เพื่อให้ badge สถานะแปลถูกตามชนิดเอกสาร */
export type DashDocKind = Extract<DocKind, 'receiving' | 'issue' | 'adjustment'>;

export interface RecentDoc {
  id: string;
  kind: DashDocKind;
  /** เลขที่เอกสารตามชนิดของมัน — ไม่มีก็แสดงขีด ไม่เดา */
  docNo: string;
  status: string;
  /** ISO string ที่ใช้เรียงลำดับ — ว่างได้ */
  at: string;
  to: string;
}

/** ชื่อ field ของแต่ละชนิดเอกสาร ตามที่ backend ส่งมาจริง */
const DOC_FIELDS: Record<DashDocKind, { no: string; date: string[]; to: string }> = {
  receiving: { no: 'receiptNo', date: ['receiptDate', 'createdAt'], to: '/receiving' },
  issue: { no: 'issueNo', date: ['issueDate', 'createdAt'], to: '/stock-issues' },
  adjustment: { no: 'adjustmentNo', date: ['adjustmentDate', 'createdAt'], to: '/inventory/adjustments' },
};

const readString = (row: DocRow, key: string): string => {
  const v = row[key];
  return typeof v === 'string' ? v : '';
};

/** อ่านวันที่จาก field แรกที่มีค่าจริง — ไม่มีเลยก็คืนค่าว่าง */
const readDate = (row: DocRow, keys: string[]): string => {
  for (const k of keys) {
    const v = readString(row, k);
    if (v) return v;
  }
  return '';
};

export function toRecentDocs(rows: DocRow[] | undefined, kind: DashDocKind): RecentDoc[] {
  const f = DOC_FIELDS[kind];
  return (rows ?? []).map((r) => ({
    id: `${kind}_${r.id}`,
    kind,
    docNo: readString(r, f.no) || '—',
    status: r.status,
    at: readDate(r, f.date),
    to: f.to,
  }));
}

/**
 * รวมเอกสารทั้งสามชนิดแล้วเรียงล่าสุดก่อน
 * เอกสารที่ไม่มีวันที่จะไปอยู่ท้ายสุด (ไม่เดาเวลาให้)
 */
export function recentDocuments(
  sources: { receiving?: DocRow[]; issues?: DocRow[]; adjustments?: DocRow[] },
  limit = 5,
): RecentDoc[] {
  return [
    ...toRecentDocs(sources.receiving, 'receiving'),
    ...toRecentDocs(sources.issues, 'issue'),
    ...toRecentDocs(sources.adjustments, 'adjustment'),
  ]
    .sort((a, b) => {
      if (!a.at && !b.at) return 0;
      if (!a.at) return 1;
      if (!b.at) return -1;
      return b.at.localeCompare(a.at);
    })
    .slice(0, limit);
}

export const DOC_KIND_LABEL: Record<DashDocKind, string> = {
  receiving: 'ใบรับของ',
  issue: 'ใบเบิก',
  adjustment: 'ใบปรับปรุงสต็อก',
};

/* ============================================================
   สูตร/เมนูที่ควรตรวจสอบ
   ============================================================ */
export type RecipeIssue = 'NO_RECIPE' | 'NO_COST';

export interface RecipeAttention {
  id: string;
  code: string;
  name: string;
  issue: RecipeIssue;
  label: string;
}

export const RECIPE_ISSUE_LABEL: Record<RecipeIssue, string> = {
  NO_RECIPE: 'ยังไม่มีสูตร',
  NO_COST: 'ยังไม่มีต้นทุน',
};

/**
 * เมนูที่ยังคิดต้นทุนไม่ได้ — มาจาก field จริงของ MenuRow
 *   hasRecipe = false  → ยังไม่ได้ผูกสูตร
 *   unitCost = null    → มีสูตรแล้วแต่ยังไม่เคยคำนวณต้นทุน
 * เรียง "ยังไม่มีสูตร" ก่อน เพราะเป็นงานที่ต้องทำก่อน
 */
export function recipesNeedingAttention(menus: MenuRow[] | undefined, limit = 5): RecipeAttention[] {
  const rank: Record<RecipeIssue, number> = { NO_RECIPE: 0, NO_COST: 1 };
  return (menus ?? [])
    .filter((m) => m.isActive)
    .map((m): RecipeAttention | null => {
      const issue: RecipeIssue | null = !m.hasRecipe ? 'NO_RECIPE' : m.unitCost == null ? 'NO_COST' : null;
      if (!issue) return null;
      return { id: m.id, code: m.code, name: m.name, issue, label: RECIPE_ISSUE_LABEL[issue] };
    })
    .filter((x): x is RecipeAttention => x !== null)
    .sort((a, b) => rank[a.issue] - rank[b.issue] || a.name.localeCompare(b.name, 'th'))
    .slice(0, limit);
}

/** สรุปตัวเลขของการ์ดต้นทุน — นับจากเมนูที่ใช้งานอยู่จริง */
export function costingSummary(menus: MenuRow[] | undefined) {
  const active = (menus ?? []).filter((m) => m.isActive);
  return {
    total: active.length,
    withRecipe: active.filter((m) => m.hasRecipe).length,
    noRecipe: active.filter((m) => !m.hasRecipe).length,
    noCost: active.filter((m) => m.hasRecipe && m.unitCost == null).length,
  };
}

/** สรุปตัวเลขของการ์ดราคาขาย — margin ต่ำกว่า 0 = ขายต่ำกว่าทุน */
export function pricingSummary(menus: MenuRow[] | undefined) {
  const active = (menus ?? []).filter((m) => m.isActive);
  const priced = active.filter((m) => m.sellingPrice != null);
  return {
    total: active.length,
    priced: priced.length,
    unpriced: active.length - priced.length,
    belowCost: priced.filter((m) => (m.margin ?? 0) < 0).length,
  };
}

/** เมนูที่ควรตรวจราคา — ขายต่ำกว่าทุนก่อน แล้วค่อยเมนูที่ยังไม่ตั้งราคา */
export function pricingAttention(menus: MenuRow[] | undefined, limit = 5): MenuRow[] {
  const active = (menus ?? []).filter((m) => m.isActive);
  const below = active.filter((m) => m.sellingPrice != null && (m.margin ?? 0) < 0);
  const unpriced = active.filter((m) => m.sellingPrice == null);
  return [...below, ...unpriced].slice(0, limit);
}
