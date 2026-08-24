/**
 * PHASE 20 — หาอัตราแปลงหน่วยมาตรฐานสำหรับหน้าวัตถุดิบ
 *
 * ความหมายเดียวที่ระบบใช้ ตรงกับ backend (src/lib/unit-convert.ts) ทุกประการ:
 *
 *     purchaseToBaseFactor = "หนึ่งหน่วยซื้อ มีกี่หน่วยฐาน"
 *     baseQuantity = purchaseQuantity × purchaseToBaseFactor
 *     baseUnitCost = purchasePrice ÷ purchaseQuantity ÷ purchaseToBaseFactor
 *
 * ตัวอย่าง: ซื้อ 350 บาท ได้ 1 KG และสูตรใช้ G → 1 KG = 1,000 G → factor = 1000
 *           350 ÷ 1 ÷ 1000 = 0.35 บาท/G
 *
 * ห้ามใส่ 0.001 (นั่นคือทิศกลับ "1 G = 0.001 KG" ซึ่งเป็นคนละความหมาย)
 *
 * อัตราอ่านจากตาราง UnitConversion เดียวกับที่ backend ใช้ ไม่ได้เก็บซ้ำในฟอร์ม
 * ค้นแบบ BFS สองทิศเหมือน universalFactor ของ backend จึงต่อทอดได้ เช่น กระสอบ→KG→G
 */

export interface ConversionEdge {
  fromUnitId: string;
  toUnitId: string;
  factor: number | string;
}

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
};

/**
 * ตัวคูณ m ที่ทำให้ ปริมาณ(to) = ปริมาณ(from) × m
 * คืน null เมื่อแปลงไม่ได้ — ห้ามเดา เพราะกระทบต้นทุนจริง
 */
export function resolveFactor(
  fromUnitId: string | null | undefined,
  toUnitId: string | null | undefined,
  edges: ConversionEdge[],
): number | null {
  if (!fromUnitId || !toUnitId) return null;
  if (fromUnitId === toUnitId) return 1;

  const adjacency = new Map<string, { to: string; factor: number }[]>();
  const link = (a: string, b: string, factor: number) => {
    const list = adjacency.get(a) ?? [];
    list.push({ to: b, factor });
    adjacency.set(a, list);
  };
  for (const edge of edges) {
    const factor = n(edge.factor);
    // ทิศกลับสร้างเองเสมอ ฐานข้อมูลจึงเก็บแถวเดียวพอ (1 KG = 1000 G ⇒ 1 G = 0.001 KG)
    if (factor > 0) { link(edge.fromUnitId, edge.toUnitId, factor); link(edge.toUnitId, edge.fromUnitId, 1 / factor); }
  }

  const seen = new Set([fromUnitId]);
  const queue: [string, number][] = [[fromUnitId, 1]];
  while (queue.length) {
    const [node, accumulated] = queue.shift()!;
    if (node === toUnitId) return accumulated;
    for (const edge of adjacency.get(node) ?? []) {
      if (!seen.has(edge.to)) { seen.add(edge.to); queue.push([edge.to, accumulated * edge.factor]); }
    }
  }
  return null;
}

export type ConversionSource = 'same' | 'standard' | 'manual';

export interface ResolvedConversion {
  /** อัตราที่ควรใช้ — null เมื่อเป็นอัตราเฉพาะวัตถุดิบที่ผู้ใช้ต้องกรอกเอง */
  factor: number | null;
  source: ConversionSource;
  /** "1 KG = 1,000 G" — null เมื่อหน่วยซื้อและหน่วยฐานเป็นหน่วยเดียวกัน */
  text: string | null;
  /** "1 G = 0.001 KG" — ด้านกลับที่คำนวณจาก 1/factor เสมอ */
  reverseText: string | null;
}

export const formatFactor = (value: number): string =>
  value.toLocaleString('en-US', { maximumFractionDigits: 6 });

/**
 * สรุปการแปลงหน่วยของวัตถุดิบหนึ่งรายการ
 *
 * - หน่วยเดียวกัน           → factor 1 ผู้ใช้ไม่ต้องกรอก
 * - มีอัตรามาตรฐานในระบบ    → เติมให้อัตโนมัติและล็อกไม่ให้พิมพ์ผิดทิศ
 * - ไม่มีอัตรามาตรฐาน       → เป็นอัตราเฉพาะวัตถุดิบ ผู้ใช้กรอกเอง (เช่น 1 กระสอบ = 25 KG)
 */
export function resolveConversion(input: {
  purchaseUnitId: string | null | undefined;
  baseUnitId: string | null | undefined;
  purchaseUnitCode?: string | null;
  baseUnitCode?: string | null;
  edges: ConversionEdge[];
  /** อัตราที่ผู้ใช้กรอกเอง ใช้เฉพาะกรณีไม่มีอัตรามาตรฐาน */
  manualFactor?: number | string | null;
}): ResolvedConversion {
  const purchaseCode = input.purchaseUnitCode || '';
  const baseCode = input.baseUnitCode || '';
  const sameUnit = !input.purchaseUnitId || input.purchaseUnitId === input.baseUnitId;

  if (sameUnit) return { factor: 1, source: 'same', text: null, reverseText: null };

  const standard = resolveFactor(input.purchaseUnitId, input.baseUnitId, input.edges);
  const factor = standard ?? (n(input.manualFactor) > 0 ? n(input.manualFactor) : null);
  const source: ConversionSource = standard != null ? 'standard' : 'manual';

  if (factor == null || factor <= 0) return { factor: null, source, text: null, reverseText: null };

  const text = purchaseCode && baseCode ? `1 ${purchaseCode} = ${formatFactor(factor)} ${baseCode}` : null;
  // ด้านกลับต้องมาจากคณิตศาสตร์เสมอ ไม่ใช่การสลับตัวเลขเดิม
  const reverseText = purchaseCode && baseCode ? `1 ${baseCode} = ${formatFactor(1 / factor)} ${purchaseCode}` : null;
  return { factor, source, text, reverseText };
}

/**
 * ตรวจว่าอัตราที่ส่งมาขัดกับอัตรามาตรฐานหรือไม่ — ใช้เตือนผู้ใช้ก่อนบันทึก
 * คืน null เมื่อไม่มีอัตรามาตรฐานให้เทียบ (อัตราเฉพาะวัตถุดิบ ตรวจแบบนี้ไม่ได้)
 */
export function conflictsWithStandard(input: {
  purchaseUnitId: string | null | undefined;
  baseUnitId: string | null | undefined;
  edges: ConversionEdge[];
  factor: number | string;
}): { expected: number; received: number } | null {
  const standard = resolveFactor(input.purchaseUnitId, input.baseUnitId, input.edges);
  if (standard == null) return null;
  const received = n(input.factor);
  if (received <= 0) return { expected: standard, received };
  // ยอมให้คลาดเคลื่อนได้เล็กน้อยจากการปัดเศษ แต่ทิศกลับ (0.001 แทน 1000) จะไม่ผ่านแน่นอน
  const closeEnough = Math.abs(received - standard) <= Math.abs(standard) * 1e-9;
  return closeEnough ? null : { expected: standard, received };
}
