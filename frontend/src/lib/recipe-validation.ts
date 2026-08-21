import type { YieldMode } from '@/lib/catalog';

/**
 * เงื่อนไขที่ทำให้ "บันทึกสูตร" ไม่ผ่าน
 *
 * นี่คือกฎ *ชุดเดิม* ที่เคยเขียนอยู่ใน save() ของ RecipeBuilderPage แบบ if-return ต่อกัน
 * ย้ายออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้ทั้งปุ่มบันทึกและแผงสรุปใช้ "แหล่งเดียวกัน"
 * ไม่ได้เพิ่มกฎใหม่ และลำดับการตรวจต้องเหมือนเดิม เพราะ save() ใช้ข้อความของรายการแรก
 */

export type BlockerTarget = 'info' | 'yield' | 'ingredients' | 'sub' | 'packaging' | 'overhead' | 'price';

export type SaveBlocker = {
  /** ใช้เป็น key ตอน render และอ้างอิงในเทสต์ */
  id: 'mode' | 'unit' | 'qty' | 'rows' | 'sub';
  message: string;
  /** หัวข้อที่ต้องเลื่อนไปแก้ */
  target: BlockerTarget;
};

export type SaveBlockerInput = {
  yieldMode: YieldMode | null;
  yieldUnitId: string;
  yieldQty: number;
  rowCount: number;
  /** ชื่อสูตรย่อยที่ยังแปลงหน่วยไม่ได้ / ยังไม่รู้รูปแบบผลผลิต */
  unresolvedSubRecipeNames: string[];
  messages: {
    pickYieldMode: string;
    needYieldUnit: string;
    zeroYield: string;
    empty: string;
    fixSubFirst: string;
  };
};

export function recipeSaveBlockers(input: SaveBlockerInput): SaveBlocker[] {
  const { yieldMode, yieldUnitId, yieldQty, rowCount, unresolvedSubRecipeNames, messages } = input;
  const out: SaveBlocker[] = [];

  if (!yieldMode) out.push({ id: 'mode', message: messages.pickYieldMode, target: 'yield' });
  else if (yieldMode === 'ACTUAL' && !yieldUnitId) out.push({ id: 'unit', message: messages.needYieldUnit, target: 'yield' });

  if (yieldMode !== 'BATCH' && yieldQty <= 0) out.push({ id: 'qty', message: messages.zeroYield, target: 'yield' });
  if (rowCount === 0) out.push({ id: 'rows', message: messages.empty, target: 'ingredients' });
  if (unresolvedSubRecipeNames.length > 0) {
    out.push({ id: 'sub', message: `${messages.fixSubFirst}: ${unresolvedSubRecipeNames.join(', ')}`, target: 'sub' });
  }
  return out;
}

/** ข้อความที่ save() เคยแสดง = รายการแรกที่ติด (คงพฤติกรรมเดิมไว้ทุกประการ) */
export function firstBlockerMessage(input: SaveBlockerInput): string | null {
  return recipeSaveBlockers(input)[0]?.message ?? null;
}
