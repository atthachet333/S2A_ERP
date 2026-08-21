/**
 * การแปลงหน่วย (source of truth ของการคิดต้นทุน)
 *
 * มีสองชั้นตามที่ระบบออกแบบไว้เดิม:
 *  1) universal — ตาราง UnitConversion (kg↔g, l↔ml, ขีด↔g) ใช้ได้กับทุกวัตถุดิบ
 *  2) item-specific — Item.purchaseUnitId + purchaseToBaseFactor (1 purchaseUnit = factor baseUnit)
 *     ใช้กับอัตราที่ขึ้นกับความหนาแน่นของวัตถุดิบแต่ละชนิด เช่น 1 KG = 1000 ML
 *
 * จงใจ "ไม่" ใส่ kg→ml ลง universal เพราะแต่ละวัตถุดิบมี density ต่างกัน
 * ถ้าแปลงไม่ได้ให้คืน null เสมอ — ห้ามเดาอัตราแปลง เพราะกระทบต้นทุนจริง
 */

export type ConvEdge = { fromUnitId: string; toUnitId: string; factor: number };
/** ข้อมูลหน่วยของวัตถุดิบที่จำเป็นต่อการแปลงเป็นหน่วยฐาน */
export type ItemUnitInfo = { baseUnitId: string; purchaseUnitId: string | null; purchaseToBaseFactor: number };

const finite = (v: number | null | undefined) => (Number.isFinite(v) ? Number(v) : 0);

/**
 * ตัวคูณ m ที่ทำให้ qty(to) = qty(from) × m จากตารางแปลงหน่วยมาตรฐาน
 * ค้นแบบ BFS สองทิศ (สร้าง inverse ให้อัตโนมัติ ไม่ต้องมีแถวซ้ำใน DB)
 * และรองรับการต่อทอด เช่น 1 กระสอบ = 25 KG, 1 KG = 1000 G → 1 กระสอบ = 25,000 G
 */
export function universalFactor(fromId: string | null | undefined, toId: string | null | undefined, edges: ConvEdge[]): number | null {
  if (!fromId || !toId) return null;
  if (fromId === toId) return 1;
  const adj = new Map<string, { to: string; f: number }[]>();
  const push = (a: string, b: string, f: number) => { const list = adj.get(a) ?? []; list.push({ to: b, f }); adj.set(a, list); };
  for (const e of edges) {
    const f = finite(e.factor);
    if (f > 0) { push(e.fromUnitId, e.toUnitId, f); push(e.toUnitId, e.fromUnitId, 1 / f); }
  }
  const seen = new Set([fromId]);
  const queue: [string, number][] = [[fromId, 1]];
  while (queue.length) {
    const [node, acc] = queue.shift()!;
    if (node === toId) return acc;
    for (const edge of adj.get(node) ?? []) {
      if (!seen.has(edge.to)) { seen.add(edge.to); queue.push([edge.to, acc * edge.f]); }
    }
  }
  return null;
}

/**
 * แปลงปริมาณที่ผู้ใช้กรอก (หน่วย unitId) → หน่วยฐานของวัตถุดิบ เพื่อคูณกับ lastCost (ต้นทุนต่อหน่วยฐาน)
 * ลำดับการตัดสินใจ — item-specific ชนะ universal เสมอ:
 *   1. ไม่ระบุหน่วย หรือเป็นหน่วยฐานอยู่แล้ว → ×1 (พฤติกรรมเดิมของสูตรเก่า)
 *   2. เป็นหน่วยซื้อของวัตถุดิบนั้น → ×purchaseToBaseFactor (เช่น 1 KG = 1000 ML เฉพาะวัตถุดิบนี้)
 *   3. แปลงมาตรฐานตรงไปหน่วยฐานได้ → ใช้ค่านั้น
 *   4. แปลงมาตรฐานไปหน่วยซื้อได้ แล้วต่อด้วย purchaseToBaseFactor (เช่น กระสอบ→KG→ML)
 *   5. แปลงไม่ได้ → null (ผู้เรียกต้องปฏิเสธ ไม่ใช่เดา)
 */
export function toBaseQuantity(quantity: number, unitId: string | null | undefined, item: ItemUnitInfo, edges: ConvEdge[]): number | null {
  const qty = finite(quantity);
  if (!unitId || unitId === item.baseUnitId) return qty;

  const purchaseFactor = finite(item.purchaseToBaseFactor) > 0 ? finite(item.purchaseToBaseFactor) : 1;
  if (item.purchaseUnitId && unitId === item.purchaseUnitId) return qty * purchaseFactor;

  const direct = universalFactor(unitId, item.baseUnitId, edges);
  if (direct != null) return qty * direct;

  if (item.purchaseUnitId) {
    const viaPurchase = universalFactor(unitId, item.purchaseUnitId, edges);
    if (viaPurchase != null) return qty * viaPurchase * purchaseFactor;
  }
  return null;
}

/** โหมดผลผลิตของสูตร — ACTUAL รู้ผลผลิตจริง, BATCH คิดเป็น 1 Batch, null คือสูตรเก่าที่ยังไม่เลือก */
export type YieldMode = 'ACTUAL' | 'BATCH' | null | undefined;

/**
 * โหมดผลผลิต "ที่ใช้งานจริง" — รองรับสูตรเก่าที่ยังไม่มี yieldMode ในฐานข้อมูล
 *
 * ถ้ามีผลผลิตจริงครบอยู่แล้ว (yieldQty > 0 และมีหน่วยผลผลิต) ให้ถือเป็น ACTUAL
 * ไม่ต้องบังคับให้ผู้ใช้เลือกซ้ำ และไม่ต้องแก้ประวัติใน DB ย้อนหลัง
 * เหลือเป็น null (UNKNOWN) เฉพาะกรณีที่ยังไม่มีหน่วยผลผลิตเท่านั้น
 */
export function effectiveYieldMode(mode: YieldMode, yieldUnitId: string | null | undefined, yieldQty: number | null | undefined): 'ACTUAL' | 'BATCH' | null {
  if (mode === 'BATCH' || mode === 'ACTUAL') return mode;
  if (yieldUnitId && finite(yieldQty) > 0) return 'ACTUAL';
  return null;
}

/**
 * แปลงปริมาณสูตรย่อยเป็นหน่วยผลผลิตของสูตรลูก
 *
 * BATCH: ปริมาณคือ "จำนวน Batch" (0.5 = ครึ่งสูตร) — สูตรลูกมี yieldQty = 1 เสมอ
 *        ต้นทุนจึงเป็น จำนวน × ต้นทุนทั้งสูตร โดยไม่ต้องแปลงหน่วยใด ๆ
 *        และห้ามแปลงข้ามไป ML/KG/G เพราะยังไม่ทราบผลผลิตจริง → คืน null
 * ACTUAL: แปลงตามตารางหน่วยมาตรฐานเหมือนเดิม
 * null   : ยังไม่เลือกโหมด → ไม่เดา คืน null ให้ผู้ใช้เลือกก่อน
 */
export function toChildYieldQuantity(
  quantity: number, unitId: string | null | undefined, childYieldUnitId: string | null,
  edges: ConvEdge[], mode: YieldMode = undefined,
): number | null {
  if (mode === 'BATCH') return unitId ? null : finite(quantity);
  if (mode === 'ACTUAL' && !childYieldUnitId) return null;
  if (mode === undefined || mode === 'ACTUAL') {
    if (!unitId || !childYieldUnitId || unitId === childYieldUnitId) return finite(quantity);
    const factor = universalFactor(unitId, childYieldUnitId, edges);
    return factor == null ? null : finite(quantity) * factor;
  }
  return null; // mode === null → สูตรเก่าที่ยังไม่เลือกโหมด
}
