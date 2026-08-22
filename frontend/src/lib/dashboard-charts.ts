import type { MenuRow } from '@/lib/catalog';
import type { DocRow, InventoryKpi } from '@/hooks/useDashboardData';

/**
 * PHASE 14 — ข้อมูลสำหรับกราฟบนแดชบอร์ด
 *
 * สำรวจข้อมูลจริงใน production ก่อนออกแบบ พบว่า:
 *   - stock_ledgers มี 2 แถว และอยู่ในวันเดียวกันทั้งคู่
 *   → ไม่มีอนุกรมเวลาของสต็อกที่ใช้ได้จริง
 * จึง **ไม่ทำกราฟเส้น / sparkline / trend ใด ๆ** เพราะจะเป็นการแต่งข้อมูล
 * ทุกกราฟในไฟล์นี้เป็น "องค์ประกอบของสถานะปัจจุบัน" ที่นับจากข้อมูลจริงล้วน
 * และคำนวณจากชุดข้อมูลที่แดชบอร์ดโหลดอยู่แล้ว ไม่เพิ่ม endpoint ใหม่
 */

export interface Slice {
  key: string;
  label: string;
  value: number;
  /** ชื่อ token สีใน tokens.css — ไม่ hardcode ค่าสี */
  tone: 'ok' | 'warn' | 'bad' | 'info' | 'muted';
}

/** ตัดชิ้นที่เป็นศูนย์ออก เพื่อไม่ให้ legend รกด้วยค่าที่ไม่มีอยู่ */
const used = (slices: Slice[]) => slices.filter((s) => s.value > 0);

export const sliceTotal = (slices: Slice[]) => slices.reduce((sum, s) => sum + s.value, 0);

/**
 * PHASE 14B — โดนัทจะสื่อความหมายก็ต่อเมื่อมีอย่างน้อยสองกลุ่มให้เทียบกัน
 * ถ้าเหลือกลุ่มเดียว (เช่น สินค้าทุกตัวสถานะปกติ) วงกลม 100% ไม่ได้บอกอะไร
 * และดูเหมือนกราฟหลอกตา จึงให้ผู้เรียกไปแสดงข้อความสรุปสั้น ๆ แทน
 */
export const hasDistribution = (slices: Slice[]) => slices.length >= 2 && sliceTotal(slices) > 0;

/** true เมื่อยังไม่มีเอกสารเลยสักชนิด — ใช้ตัดสินใจแสดงสถานะว่างแทนแท่งเปล่า */
export const barsAreEmpty = (bars: DocBar[]) => bars.every((b) => b.total === 0);

/* ============================================================
   สถานะสต็อก — จาก InventoryKpi ที่การ์ดคลังโหลดอยู่แล้ว
   ============================================================ */
export function inventoryComposition(kpi: InventoryKpi | undefined): Slice[] {
  if (!kpi) return [];
  const healthy = kpi.itemCount - kpi.lowCount - kpi.outCount - kpi.negativeCount;
  return used([
    { key: 'ok', label: 'ปกติ', value: Math.max(0, healthy), tone: 'ok' },
    { key: 'low', label: 'ใกล้หมด', value: kpi.lowCount, tone: 'warn' },
    { key: 'out', label: 'หมด', value: kpi.outCount, tone: 'bad' },
    { key: 'neg', label: 'ติดลบ', value: kpi.negativeCount, tone: 'bad' },
  ]);
}

/* ============================================================
   ความพร้อมของเมนู — จาก MenuRow ที่การ์ดต้นทุน/ราคาโหลดอยู่แล้ว
   เรียงตามลำดับงานที่ต้องทำ: ไม่มีสูตร → ไม่มีต้นทุน → ยังไม่ตั้งราคา → พร้อมขาย
   ============================================================ */
export function menuReadiness(menus: MenuRow[] | undefined): Slice[] {
  const active = (menus ?? []).filter((m) => m.isActive);
  const noRecipe = active.filter((m) => !m.hasRecipe).length;
  const noCost = active.filter((m) => m.hasRecipe && m.unitCost == null).length;
  const noPrice = active.filter((m) => m.hasRecipe && m.unitCost != null && m.sellingPrice == null).length;
  const ready = active.filter((m) => m.hasRecipe && m.unitCost != null && m.sellingPrice != null).length;
  return used([
    { key: 'ready', label: 'พร้อมขาย', value: ready, tone: 'ok' },
    { key: 'noPrice', label: 'ยังไม่ตั้งราคา', value: noPrice, tone: 'warn' },
    { key: 'noCost', label: 'ยังไม่มีต้นทุน', value: noCost, tone: 'info' },
    { key: 'noRecipe', label: 'ยังไม่มีสูตร', value: noRecipe, tone: 'bad' },
  ]);
}

/* ============================================================
   เอกสารปฏิบัติการตามสถานะ — นับจากรายการที่โหลดมาแล้วทั้งสามชนิด
   ============================================================ */
export interface DocBar {
  key: string;
  label: string;
  draft: number;
  confirmed: number;
  total: number;
}

const isDraft = (status: string) => status === 'DRAFT';

export function documentBars(sources: {
  receiving?: DocRow[]; issues?: DocRow[]; adjustments?: DocRow[];
}): DocBar[] {
  const build = (key: string, label: string, rows: DocRow[] | undefined): DocBar => {
    const list = rows ?? [];
    const draft = list.filter((r) => isDraft(r.status)).length;
    return { key, label, draft, confirmed: list.length - draft, total: list.length };
  };
  return [
    build('receiving', 'รับของ', sources.receiving),
    build('issue', 'เบิก', sources.issues),
    build('adjustment', 'ปรับปรุง', sources.adjustments),
  ];
}

/* ============================================================
   ส่วนโค้งของโดนัท — คืนค่า path ที่วาดได้เลย
   ============================================================ */
export interface Arc extends Slice {
  path: string;
  percent: number;
}

const polar = (cx: number, cy: number, r: number, deg: number) => {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
};

/**
 * สร้าง path ของโดนัทจากสัดส่วนจริง
 * ชิ้นเดียว 100% วาดเป็นวงแหวนเต็มวง (arc 360° วาดไม่ได้ใน SVG)
 */
export function donutArcs(slices: Slice[], size = 108, thickness = 16): Arc[] {
  const total = sliceTotal(slices);
  if (total <= 0) return [];
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 1;
  const rInner = rOuter - thickness;
  let angle = 0;

  return slices.map((s) => {
    const percent = (s.value / total) * 100;
    const sweep = (s.value / total) * 360;
    const start = angle;
    const end = angle + Math.min(sweep, 359.999);
    angle = end;

    const p1 = polar(cx, cy, rOuter, start);
    const p2 = polar(cx, cy, rOuter, end);
    const p3 = polar(cx, cy, rInner, end);
    const p4 = polar(cx, cy, rInner, start);
    const large = sweep > 180 ? 1 : 0;

    return {
      ...s,
      percent: Math.round(percent * 10) / 10,
      path: [
        `M ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`,
        `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`,
        `L ${p3.x.toFixed(2)} ${p3.y.toFixed(2)}`,
        `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x.toFixed(2)} ${p4.y.toFixed(2)}`,
        'Z',
      ].join(' '),
    };
  });
}

/** ความยาวแท่งเป็น % ของค่าสูงสุด — ไม่มีข้อมูลคืน 0 ไม่ใช่ค่าเดา */
export function barPercent(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.round((value / max) * 1000) / 10;
}
