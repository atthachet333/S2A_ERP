/**
 * PHASE 35 — นำเข้าสต็อกจากหน้าวัตถุดิบ (โดเมนล้วน ไม่มี React)
 *
 * ที่นี่รับผิดชอบสามเรื่อง
 *   1. เลขจำนวน/ราคาต้องแม่นระดับสตางค์ — คิดด้วยจำนวนเต็มที่ scale ไว้ ไม่ใช้ float
 *   2. แปลงสิ่งที่ผู้ใช้กรอกเป็น payload ของ API รับของที่มีอยู่แล้ว (ไม่มี endpoint ลัด)
 *   3. บอกว่าใครทำอะไรได้ ตามสิทธิ์จริงของ backend
 *
 * frontend ไม่เคยเขียนสต็อกเอง — ทุกอย่างไปที่ POST /business/receiving
 * ซึ่งเดินผ่าน ledger เดียวของระบบเหมือนใบรับของทุกใบ
 */

export type ReceiveReason = 'PURCHASE' | 'OPENING' | 'ADJUST' | 'OTHER';

export const RECEIVE_REASONS: ReceiveReason[] = ['PURCHASE', 'OPENING', 'ADJUST', 'OTHER'];

export const RECEIVE_REASON_LABEL: Record<ReceiveReason, string> = {
  PURCHASE: 'รับเข้าจากการซื้อ',
  OPENING: 'ยอดตั้งต้น',
  ADJUST: 'ปรับยอด / พบสต็อกเพิ่ม',
  OTHER: 'อื่น ๆ',
};

export const RECEIVE_REASON_HINT: Record<ReceiveReason, string> = {
  PURCHASE: 'ของที่เพิ่งซื้อเข้ามาใหม่',
  OPENING: 'ของที่มีอยู่จริงก่อนเริ่มใช้ระบบ',
  ADJUST: 'นับแล้วพบว่ามีมากกว่าที่ระบบบันทึกไว้',
  OTHER: 'กรณีอื่น — อธิบายเพิ่มในหมายเหตุ',
};

/* ============================================================
   เลขทศนิยมแบบไม่ใช้ float
   0.1 + 0.2 ของ JavaScript ได้ 0.30000000000000004 ซึ่งใช้กับเงินไม่ได้
   จึงเก็บเป็น { units: bigint, scale: number } แล้วคิดด้วยจำนวนเต็มล้วน
   ============================================================ */

export interface Decimal { units: bigint; scale: number }

const DECIMAL_PATTERN = /^-?\d*(\.\d*)?$/;

/** แปลงข้อความที่ผู้ใช้พิมพ์เป็นเลขทศนิยมแม่นยำ — คืน null เมื่อรูปแบบไม่ถูกต้อง */
export function parseDecimal(input: string | number | null | undefined): Decimal | null {
  if (input === null || input === undefined) return null;
  const text = String(input).trim();
  if (!text || !DECIMAL_PATTERN.test(text) || text === '-' || text === '.' || text === '-.') return null;
  const negative = text.startsWith('-');
  const [whole = '', fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const digits = `${whole || '0'}${fraction}`;
  if (!/^\d+$/.test(digits)) return null;
  const units = BigInt(digits) * (negative ? -1n : 1n);
  return { units, scale: fraction.length };
}

const scaleUp = (value: Decimal, scale: number): bigint => value.units * 10n ** BigInt(scale - value.scale);

export function decimalToString(value: Decimal): string {
  const negative = value.units < 0n;
  const digits = (negative ? -value.units : value.units).toString().padStart(value.scale + 1, '0');
  const whole = digits.slice(0, digits.length - value.scale) || '0';
  const fraction = value.scale > 0 ? digits.slice(digits.length - value.scale).replace(/0+$/, '') : '';
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

export const decimalToNumber = (value: Decimal): number => Number(decimalToString(value));

export const isZero = (value: Decimal): boolean => value.units === 0n;

export function multiplyDecimal(a: Decimal, b: Decimal): Decimal {
  return { units: a.units * b.units, scale: a.scale + b.scale };
}

/**
 * หารแบบปัดครึ่งขึ้น (half-up) ที่ทศนิยม dp ตำแหน่ง
 * คืน exact = false เมื่อผลหารลงตัวไม่พอดี ผู้ใช้จะได้เห็นว่ามีเศษก่อนกดยืนยัน
 */
export function divideDecimal(a: Decimal, b: Decimal, dp = 4): { value: Decimal; exact: boolean } | null {
  if (b.units === 0n) return null;
  const commonScale = Math.max(a.scale, b.scale);
  const numerator = scaleUp(a, commonScale) * 10n ** BigInt(dp + 1);
  const denominator = scaleUp(b, commonScale);
  const negative = (numerator < 0n) !== (denominator < 0n);
  const absNumerator = numerator < 0n ? -numerator : numerator;
  const absDenominator = denominator < 0n ? -denominator : denominator;
  const scaled = absNumerator / absDenominator;
  const remainder = absNumerator % absDenominator;
  const lastDigit = scaled % 10n;
  const rounded = scaled / 10n + (lastDigit >= 5n ? 1n : 0n);
  return {
    value: { units: negative ? -rounded : rounded, scale: dp },
    exact: remainder === 0n && lastDigit === 0n,
  };
}

/** เท่ากันเชิงค่า (2.50 = 2.5) ไม่ใช่เท่ากันเชิงข้อความ */
export function decimalEquals(a: Decimal, b: Decimal): boolean {
  const commonScale = Math.max(a.scale, b.scale);
  return scaleUp(a, commonScale) === scaleUp(b, commonScale);
}

/* ============================================================
   สิทธิ์
   ============================================================ */

export interface ReceivingAccess {
  /** สร้างใบรับของได้ */
  canCreate: boolean;
  /** ยืนยันใบรับของได้ = เป็นคนที่ทำให้สต็อกขยับได้จริง */
  canConfirm: boolean;
  /** เห็นประวัติรับเข้า */
  canViewReceipts: boolean;
  /** เห็นยอดคงเหลือ/มูลค่า */
  canViewStock: boolean;
}

/**
 * สิทธิ์สร้างวัตถุดิบกับสิทธิ์รับของเป็นคนละเรื่องกันโดยเจตนา
 * ที่นี่ทำได้แค่ "ซ่อนปุ่มที่กดไปก็ไม่ผ่าน" — backend ยังเป็นผู้ตัดสินเสมอ
 */
export function receivingAccess(roles: string[] = [], permissions: string[] = []): ReceivingAccess {
  const has = (code: string) => roles.includes('SUPER_ADMIN') || permissions.includes(code);
  return {
    canCreate: has('RECEIVING_CREATE'),
    canConfirm: has('RECEIVING_CONFIRM'),
    canViewReceipts: has('RECEIVING_VIEW') || has('RECEIVING_CREATE'),
    canViewStock: has('INVENTORY_VIEW') || has('STOCK_VIEW'),
  };
}

/** รับเข้าให้สต็อกขยับจริงได้ ต้องทั้งสร้างและยืนยันได้ */
export const canReceiveStock = (access: ReceivingAccess): boolean => access.canCreate && access.canConfirm;

/* ============================================================
   คำนวณจำนวน/ราคาในฟอร์ม
   ============================================================ */

export type PriceMode = 'UNIT' | 'TOTAL';

export interface ReceivingMathInput {
  quantity: string;
  /** โหมด UNIT ผู้ใช้กรอกราคาต่อหน่วย · โหมด TOTAL ผู้ใช้กรอกราคารวม */
  mode: PriceMode;
  unitPrice: string;
  totalPrice: string;
}

export interface ReceivingMath {
  quantity: Decimal | null;
  unitPrice: Decimal | null;
  totalPrice: Decimal | null;
  /** ราคาต่อหน่วยหารไม่ลงตัว — ยอดรวมที่บันทึกจริงจะต่างจากที่กรอกเล็กน้อย */
  roundedUnitPrice: boolean;
  error: string | null;
}

/**
 * ด้านเดียวเสมอ: ผู้ใช้กรอกด้านหนึ่ง ระบบคำนวณอีกด้าน
 * ไม่ปล่อยให้จำนวน · ราคาต่อหน่วย · ราคารวม ขัดกันเองแบบเงียบ ๆ
 */
export function receivingMath(input: ReceivingMathInput): ReceivingMath {
  const quantity = parseDecimal(input.quantity);
  const empty: ReceivingMath = { quantity, unitPrice: null, totalPrice: null, roundedUnitPrice: false, error: null };
  if (!quantity) return { ...empty, error: input.quantity.trim() ? 'จำนวนไม่ถูกต้อง' : null };
  if (quantity.units <= 0n) return { ...empty, error: 'จำนวนต้องมากกว่า 0' };

  if (input.mode === 'UNIT') {
    const unitPrice = parseDecimal(input.unitPrice);
    if (!unitPrice) return { ...empty, error: input.unitPrice.trim() ? 'ราคาต่อหน่วยไม่ถูกต้อง' : null };
    if (unitPrice.units < 0n) return { ...empty, error: 'ราคาต่อหน่วยติดลบไม่ได้' };
    return { quantity, unitPrice, totalPrice: multiplyDecimal(quantity, unitPrice), roundedUnitPrice: false, error: null };
  }

  const totalPrice = parseDecimal(input.totalPrice);
  if (!totalPrice) return { ...empty, error: input.totalPrice.trim() ? 'ราคารวมไม่ถูกต้อง' : null };
  if (totalPrice.units < 0n) return { ...empty, error: 'ราคารวมติดลบไม่ได้' };
  const derived = divideDecimal(totalPrice, quantity, 4);
  if (!derived) return { ...empty, error: 'คำนวณราคาต่อหน่วยไม่ได้' };
  /* ราคาที่บันทึกจริงคือราคาต่อหน่วย ยอดรวมของเอกสารจึงมาจาก จำนวน x ราคาต่อหน่วย เสมอ
     ถ้าหารไม่ลงตัวต้องแสดงยอดรวมที่คำนวณกลับ ไม่ใช่ยอดที่ผู้ใช้พิมพ์ */
  return {
    quantity,
    unitPrice: derived.value,
    totalPrice: multiplyDecimal(quantity, derived.value),
    roundedUnitPrice: !derived.exact,
    error: null,
  };
}

/* ============================================================
   payload ของ API
   ============================================================ */

export interface ReceivingFormValues {
  itemId: string;
  warehouseId: string;
  supplierId?: string;
  /** วันที่ในรูปแบบ YYYY-MM-DD (ปฏิทินไทยแสดงผล แต่เก็บเป็น ค.ศ.) */
  date: string;
  /** เวลาในรูปแบบ HH:mm ตามเวลาไทย */
  time: string;
  quantity: string;
  mode: PriceMode;
  unitPrice: string;
  totalPrice: string;
  reason: ReceiveReason;
  remark?: string;
  supplierDocNo?: string;
  lotNo?: string;
  manufactureDate?: string;
  expiryDate?: string;
}

const BANGKOK_OFFSET_MINUTES = 7 * 60;

/**
 * วันที่+เวลาที่ผู้ใช้เห็นเป็นเวลาไทยเสมอ แปลงเป็น ISO (UTC) ก่อนส่ง
 * backend เก็บ DateTime ตามสถาปัตยกรรมเดิม — ไม่มีการเก็บ timezone แยกใหม่
 */
export function bangkokToIso(date: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [hours, minutes] = /^\d{2}:\d{2}$/.test(time) ? time.split(':').map(Number) : [0, 0];
  const [year, month, day] = date.split('-').map(Number);
  const utcMs = Date.UTC(year, month - 1, day, hours, minutes) - BANGKOK_OFFSET_MINUTES * 60 * 1000;
  const result = new Date(utcMs);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

/** วันที่/เวลาปัจจุบันตามเวลาไทย สำหรับเป็นค่าเริ่มต้นของฟอร์ม */
export function bangkokNow(now = new Date()): { date: string; time: string } {
  const shifted = new Date(now.getTime() + BANGKOK_OFFSET_MINUTES * 60 * 1000);
  return {
    date: shifted.toISOString().slice(0, 10),
    time: shifted.toISOString().slice(11, 16),
  };
}

export interface ReceivingRequest {
  path: '/business/receiving';
  body: Record<string, unknown>;
}

export interface ReceivingValidation {
  request: ReceivingRequest | null;
  math: ReceivingMath;
  error: string | null;
}

export interface ReceivingItemContext {
  isLotTracked: boolean;
  isExpiryTracked: boolean;
}

/**
 * สร้างคำขอรับของจากค่าในฟอร์ม
 *
 * ส่ง confirm: true เพราะผู้ใช้ตั้งใจ "นำเข้าสต็อกตอนนี้"
 * ไม่ใช่การร่างเอกสารไว้ก่อน — และ backend จะตรวจสิทธิ์ RECEIVING_CONFIRM ซ้ำอยู่ดี
 */
export function buildReceivingRequest(values: ReceivingFormValues, item: ReceivingItemContext): ReceivingValidation {
  const math = receivingMath(values);
  const fail = (error: string): ReceivingValidation => ({ request: null, math, error });

  if (!values.itemId) return fail('เลือกวัตถุดิบก่อน');
  if (!values.warehouseId) return fail('เลือกคลังที่รับเข้า');
  if (math.error) return fail(math.error);
  if (!math.quantity || !math.unitPrice) return fail('กรอกจำนวนและราคาให้ครบ');

  const receiptDate = bangkokToIso(values.date, values.time);
  if (!receiptDate) return fail('วันที่หรือเวลารับเข้าไม่ถูกต้อง');

  const lotNo = values.lotNo?.trim();
  if (item.isLotTracked && !lotNo) return fail('วัตถุดิบนี้ติดตาม Lot จึงต้องระบุเลข Lot');
  if (!item.isLotTracked && (lotNo || values.expiryDate || values.manufactureDate)) {
    return fail('วัตถุดิบนี้ยังไม่ได้เปิดการติดตาม Lot จึงระบุ Lot หรือวันหมดอายุไม่ได้');
  }
  if (item.isExpiryTracked && !values.expiryDate) return fail('วัตถุดิบนี้ติดตามวันหมดอายุ จึงต้องระบุวันหมดอายุ');

  return {
    request: {
      path: '/business/receiving',
      body: {
        warehouseId: values.warehouseId,
        ...(values.supplierId ? { supplierId: values.supplierId } : {}),
        ...(values.supplierDocNo?.trim() ? { supplierDocNo: values.supplierDocNo.trim() } : {}),
        receiptDate,
        receiveReason: values.reason,
        confirm: true,
        items: [{
          itemId: values.itemId,
          // ส่งเป็นข้อความที่แม่นตามที่ผู้ใช้กรอก ไม่ผ่าน float ระหว่างทาง
          quantity: decimalToString(math.quantity),
          unitPrice: decimalToString(math.unitPrice),
          ...(lotNo ? { lotNo } : {}),
          ...(values.manufactureDate ? { manufactureDate: values.manufactureDate } : {}),
          ...(values.expiryDate ? { expiryDate: values.expiryDate } : {}),
          ...(values.remark?.trim() ? { note: values.remark.trim() } : {}),
        }],
      },
    },
    math,
    error: null,
  };
}

/* ============================================================
   ข้อความสรุป (แสดงผลอย่างเดียว)
   ============================================================ */

const TH_MONTH = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** "1 ก.ย. 2569 09:32 น." — เวลาไทยเสมอ ไม่ขึ้นกับ timezone ของเครื่องผู้ใช้ */
export function thaiReceivedAt(iso: string): string {
  const d = new Date(new Date(iso).getTime() + BANGKOK_OFFSET_MINUTES * 60 * 1000);
  if (Number.isNaN(d.getTime())) return '—';
  const time = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
  return `${d.getUTCDate()} ${TH_MONTH[d.getUTCMonth()]} ${d.getUTCFullYear() + 543} ${time} น.`;
}

/** "ก.ย. 2569" จากคีย์เดือน YYYY-MM */
export function thaiMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  if (!year || !month) return monthKey;
  return `${TH_MONTH[month - 1]} ${year + 543}`;
}
