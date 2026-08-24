import type { DashboardAlert } from './dashboard-alerts';

/**
 * PHASE 22 — การ์ดหลัก 4 ใบของหน้าภาพรวม
 *
 * ตอบสี่คำถามที่ผู้บริหารถามก่อนเสมอ:
 *   1) ต้องจัดการอะไรตอนนี้     2) ข้อมูลต้นทุนครบหรือยัง
 *   3) สต็อกเป็นอย่างไร          4) งานปฏิบัติการเดินอยู่แค่ไหน
 *
 * ทุกตัวเลขมาจากข้อมูลจริงที่ backend ส่งมาแล้วทั้งหมด
 * ไม่มีการสร้างแนวโน้ม ไม่มีการพยากรณ์ ไม่มีตัวเลขสมมติ
 * ถ้าข้อมูลชุดไหนยังไม่มี การ์ดนั้นจะบอกว่าไม่มีข้อมูล แทนที่จะเดา
 */

export type PrimaryTone = 'danger' | 'costing' | 'inventory' | 'operations' | 'healthy';

export interface PrimaryCard {
  id: 'attention' | 'costing' | 'inventory' | 'operations';
  label: string;
  /** ตัวเลขหลัก — null เมื่อยังไม่มีข้อมูลจริงให้แสดง */
  value: number | null;
  unit?: string;
  tone: PrimaryTone;
  /** บรรทัดย่อยที่อธิบายที่มาของตัวเลข ทุกบรรทัดมาจากข้อมูลจริง */
  breakdown: { label: string; value: number }[];
  hint: string;
  to?: string;
}

export interface PrimaryInput {
  alerts: DashboardAlert[];
  /** วัตถุดิบที่ยังไม่มีข้อมูลต้นทุน (MISSING เท่านั้น ไม่รวมที่ยืนยันว่าเป็นศูนย์) */
  itemsMissingCost?: number;
  costing?: { totalMenus: number; withCost: number };
  inventory?: { itemCount: number; outCount: number; lowCount: number; negativeCount: number; totalValue: number };
  operations?: { receivingDrafts: number; issueDrafts: number; todayMovements: number };
  /* สิทธิ์ของผู้ใช้ — การ์ดยังมีครบสี่ใบเสมอตามที่ออกแบบไว้
     แต่ใบที่ผู้ใช้ไม่มีสิทธิ์ดูต้องบอกตรง ๆ ว่าไม่มีสิทธิ์ ไม่ใช่ขึ้น "—" ให้เข้าใจผิดว่าไม่มีข้อมูล
     (ข้อมูลจริงไม่เคยถูกดึงมาอยู่แล้วเมื่อไม่มีสิทธิ์ จึงไม่มีการรั่วของข้อมูล) */
  permissions?: { canInventory: boolean; canOperations: boolean };
}

const NO_PERMISSION = 'ไม่มีสิทธิ์ดูข้อมูลนี้';

const sum = (alerts: DashboardAlert[], severities: DashboardAlert['severity'][]) =>
  alerts.filter((a) => severities.includes(a.severity)).reduce((total, a) => total + a.count, 0);

/**
 * การ์ด "ต้องจัดการตอนนี้" — ต้องเด่นที่สุดเมื่อมีเรื่องค้าง
 * ไม่มีเรื่องค้าง = เปลี่ยนเป็นสถานะสงบ ไม่ใช่ค้างสีแดงไว้ตลอด
 */
export function attentionCard(input: PrimaryInput): PrimaryCard {
  const urgent = sum(input.alerts, ['critical', 'warning']);

  /* สรุปเป็น "หมวด" ไม่ใช่ก๊อบชื่อเรื่องจากรายการด้านล่างมาซ้ำ
     การ์ดตอบว่า "ค้างกี่เรื่อง แต่ละด้านเท่าไร" ส่วนรายการด้านล่างบอกว่า "เรื่องอะไรบ้าง" */
  const inv = input.inventory;
  const ops = input.operations;
  const breakdown = [
    { label: 'วัตถุดิบยังไม่มีต้นทุน', value: input.itemsMissingCost ?? 0 },
    { label: 'สต็อกหมด/ติดลบ', value: (inv?.outCount ?? 0) + (inv?.negativeCount ?? 0) },
    { label: 'เอกสารรอยืนยัน', value: (ops?.receivingDrafts ?? 0) + (ops?.issueDrafts ?? 0) },
  ];

  return {
    id: 'attention',
    label: 'ต้องจัดการตอนนี้',
    value: urgent,
    unit: 'เรื่อง',
    tone: urgent > 0 ? 'danger' : 'healthy',
    breakdown,
    hint: urgent > 0 ? 'เรียงจากเรื่องที่กระทบมากที่สุด' : 'สต็อก ต้นทุน และเอกสารไม่มีเรื่องค้าง',
    to: input.alerts.find((a) => a.severity !== 'info')?.ctaTo,
  };
}

/** การ์ดความครบถ้วนของต้นทุน — ตัวเลขเดียวที่บอกว่าต้นทุนที่เห็นเชื่อได้แค่ไหน */
export function costingCard(input: PrimaryInput): PrimaryCard {
  const missing = input.itemsMissingCost;
  const menus = input.costing;
  const breakdown: { label: string; value: number }[] = [];
  if (missing != null) breakdown.push({ label: 'วัตถุดิบยังไม่มีต้นทุน', value: missing });
  if (menus) {
    breakdown.push({ label: 'เมนูที่คิดต้นทุนได้', value: menus.withCost });
    breakdown.push({ label: 'เมนูทั้งหมด', value: menus.totalMenus });
  }
  return {
    id: 'costing',
    label: 'ความครบถ้วนของต้นทุน',
    value: missing ?? null,
    unit: missing != null ? 'รายการที่ยังขาด' : undefined,
    tone: missing && missing > 0 ? 'costing' : 'healthy',
    breakdown,
    hint: missing == null ? 'ยังไม่มีข้อมูล'
      : missing > 0 ? 'ต้นทุนสูตรที่ใช้ของเหล่านี้จะต่ำกว่าความจริง'
        : 'วัตถุดิบทุกรายการมีข้อมูลต้นทุนแล้ว',
    to: '/ingredients/cost-completion',
  };
}

/** การ์ดสถานะสต็อก */
export function inventoryCard(input: PrimaryInput): PrimaryCard {
  /* ตรวจสิทธิ์ก่อนเสมอ ไม่รอให้ข้อมูลว่างเอง
     ถ้าพึ่งแค่ "ข้อมูลไม่มา" การ์ดจะแสดงตัวเลขทันทีที่มีข้อมูลหลุดเข้ามาด้วยเหตุใดก็ตาม */
  const denied = input.permissions ? !input.permissions.canInventory : false;
  const inv = denied ? undefined : input.inventory;
  if (!inv) {
    return {
      id: 'inventory', label: 'สถานะสต็อก', value: null, tone: 'inventory', breakdown: [],
      hint: denied ? NO_PERMISSION : 'ยังไม่มีข้อมูล',
    };
  }
  const needsAction = inv.outCount + inv.lowCount + inv.negativeCount;
  return {
    id: 'inventory',
    label: 'สถานะสต็อก',
    value: needsAction,
    unit: 'รายการต้องดู',
    tone: inv.negativeCount > 0 || inv.outCount > 0 ? 'danger' : needsAction > 0 ? 'inventory' : 'healthy',
    breakdown: [
      { label: 'หมดสต็อก', value: inv.outCount },
      { label: 'ใกล้หมด', value: inv.lowCount },
      { label: 'ติดลบ', value: inv.negativeCount },
    ],
    hint: `ทั้งคลัง ${inv.itemCount.toLocaleString()} รายการ`,
    to: '/inventory',
  };
}

/** การ์ดงานปฏิบัติการและเอกสาร */
export function operationsCard(input: PrimaryInput): PrimaryCard {
  const denied = input.permissions ? !input.permissions.canOperations : false;
  const ops = denied ? undefined : input.operations;
  if (!ops) {
    return {
      id: 'operations', label: 'งานปฏิบัติการ', value: null, tone: 'operations', breakdown: [],
      hint: denied ? NO_PERMISSION : 'ยังไม่มีข้อมูล',
    };
  }
  const drafts = ops.receivingDrafts + ops.issueDrafts;
  return {
    id: 'operations',
    label: 'งานปฏิบัติการ',
    value: drafts,
    unit: 'เอกสารรอยืนยัน',
    tone: drafts > 0 ? 'operations' : 'healthy',
    breakdown: [
      { label: 'ใบรับของร่าง', value: ops.receivingDrafts },
      { label: 'ใบเบิกร่าง', value: ops.issueDrafts },
      // บอกที่มาของตัวเลขไว้ในป้ายเลย ผู้ใช้จะได้ไม่เข้าใจว่าเป็นจำนวนเอกสาร
      { label: 'รายการเคลื่อนไหวสต็อกวันนี้', value: ops.todayMovements },
    ],
    hint: drafts > 0
      ? 'ร่างยังไม่มีผลต่อสต็อกจนกว่าจะยืนยัน · รายการเคลื่อนไหวนับจากบัญชีเดินสต็อก (ledger)'
      : 'ไม่มีเอกสารค้างรอยืนยัน · รายการเคลื่อนไหวนับจากบัญชีเดินสต็อก (ledger)',
    to: drafts > 0 && ops.receivingDrafts >= ops.issueDrafts ? '/receiving' : '/stock-issues',
  };
}

/** การ์ดหลักทั้งสี่ใบ เรียงตามลำดับที่ต้องอ่าน — ต้องได้ 4 ใบเสมอ ไม่มากไม่น้อย */
export function primaryCards(input: PrimaryInput): PrimaryCard[] {
  return [attentionCard(input), costingCard(input), inventoryCard(input), operationsCard(input)];
}

/* ---------- แผนภูมิสถานะปัจจุบัน (ไม่ใช่แนวโน้มย้อนหลัง) ---------- */

export interface Slice { label: string; value: number; tone: PrimaryTone }

/**
 * สัดส่วนความครบถ้วนของข้อมูลต้นทุน — มีต้นทุน / ยืนยันศูนย์ / ยังไม่มีข้อมูล
 * เป็นภาพ "สถานะ ณ ตอนนี้" ไม่ใช่แนวโน้มตามเวลา เพราะระบบไม่มีประวัติย้อนหลังของค่านี้
 */
export function costCompletenessSlices(summary?: { priced: number; explicitZero: number; missing: number }): Slice[] {
  if (!summary) return [];
  const slices: Slice[] = [
    { label: 'มีต้นทุนแล้ว', value: summary.priced, tone: 'healthy' },
    { label: 'ยืนยันต้นทุน 0', value: summary.explicitZero, tone: 'inventory' },
    { label: 'ยังไม่มีข้อมูล', value: summary.missing, tone: 'costing' },
  ];
  return slices.filter((s) => s.value > 0);
}

/** มีข้อมูลพอจะวาดแผนภูมิไหม — ไม่พอให้แสดงสถานะข้อมูลน้อยแทนการวาดวงกลมว่าง */
export const hasSliceData = (slices: Slice[]): boolean =>
  slices.length > 0 && slices.reduce((total, s) => total + s.value, 0) > 0;
