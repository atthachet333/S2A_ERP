/**
 * PHASE 6D — Inventory Inspector
 * สมการสต็อกที่แสดงใน drawer: คงเหลือ − จองแล้ว = พร้อมใช้
 *
 * แยกออกมาเป็นฟังก์ชันเพื่อให้ทดสอบได้ และเพื่อให้ "พร้อมใช้" มีที่มาที่เดียว
 * หมายเหตุสำคัญ: available มาจาก backend เสมอ ไม่คำนวณใหม่ทับ
 * ฟังก์ชันนี้แค่ตรวจว่าเลขที่ได้มาสอดคล้องกันไหม เพื่อไม่แสดงสมการที่ขัดกับข้อมูลจริง
 */

const num = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 4 });

export interface StockEquation {
  /** ข้อความสมการเต็ม เช่น "70 KG − 4.3 KG = 65.7 KG" — null เมื่อไม่ควรแสดง */
  equation: string | null;
  /** ไม่มีของจอง → ไม่ต้องแสดงสมการ แสดงข้อความสั้นแทน */
  allAvailable: boolean;
  /** backend ส่ง available มาไม่ตรงกับ คงเหลือ − จองแล้ว → ไม่แต่งเลขเอง */
  mismatch: boolean;
  /** คำอธิบายสั้นใต้ตัวเลข */
  note: string;
}

export function stockEquation(onHand: number, reserved: number, available: number, unit = ''): StockEquation {
  const u = unit ? ` ${unit}` : '';
  const diff = Math.abs(onHand - reserved - available);
  const mismatch = diff > 0.0001;

  if (mismatch) {
    return {
      equation: null, allAvailable: false, mismatch: true,
      note: 'ยอดพร้อมใช้มาจากระบบโดยตรง',
    };
  }
  if (reserved === 0) {
    return {
      equation: null, allAvailable: true, mismatch: false,
      note: 'ยังไม่มีของถูกจอง จึงพร้อมใช้ทั้งหมด',
    };
  }
  return {
    equation: `${num(onHand)}${u} − ${num(reserved)}${u} = ${num(available)}${u}`,
    allAvailable: false, mismatch: false,
    note: 'คงเหลือ หักของที่ถูกจองไว้แล้ว เหลือที่หยิบใช้ได้จริง',
  };
}

/** ของที่จองไว้เกินของที่มี — เตือนให้ตรวจ ไม่ใช่บล็อก */
export const isOverReserved = (onHand: number, reserved: number) => reserved > onHand;
