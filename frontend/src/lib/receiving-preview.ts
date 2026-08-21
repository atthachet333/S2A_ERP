/**
 * PHASE 6B — พรีวิวการแปลงหน่วยซื้อ → หน่วยฐาน ในหน้ารับของเข้า
 *
 * นี่คือการ "แสดงผล" ของกฎที่ backend ใช้อยู่แล้วเท่านั้น ไม่ได้คิดสูตรใหม่:
 *   ปริมาณหน่วยฐาน   = quantity × purchaseToBaseFactor
 *   ต้นทุนต่อหน่วยฐาน = unitPrice ÷ purchaseToBaseFactor
 *   ยอดรวมบรรทัด     = quantity × unitPrice
 *
 * ที่ต้องโชว์ให้เห็นชัด เพราะเคยมีเคสจริงที่ ฿47 ต่อ 1 L ถูกบันทึกเป็น ฿47 ต่อ 1 ML
 * (ต่างกัน 1000 เท่า) โดยผู้ใช้ไม่เห็นตอนคีย์
 *
 * ห้ามให้ UI เขียนค่าที่ derive ที่นี่กลับเข้า DB — ใช้แสดงผลอย่างเดียว
 */

export interface ConversionInput {
  quantity: number;
  unitPrice: number;
  /** อัตราส่วน 1 หน่วยซื้อ = factor หน่วยฐาน */
  purchaseToBaseFactor: number | string | null | undefined;
  purchaseUnitCode?: string | null;
  baseUnitCode?: string | null;
}

export interface ConversionPreview {
  /** ใช้หน่วยเดียวกัน (factor = 1) — ไม่ต้องอธิบายการแปลงให้รก */
  sameUnit: boolean;
  /** factor ที่ใช้จริง (null = ยังไม่รู้ เช่นยังไม่เลือกสินค้า) */
  factor: number | null;
  purchaseUnit: string;
  baseUnit: string;
  /** ข้อความอธิบาย เช่น "1 L = 1,000 ML" */
  equation: string | null;
  /** ปริมาณเมื่อแปลงเป็นหน่วยฐาน */
  baseQuantity: number | null;
  /** ต้นทุนต่อหน่วยฐาน = unitPrice / factor */
  baseUnitCost: number | null;
  /** ยอดรวมบรรทัด = quantity × unitPrice */
  lineTotal: number;
}

const num = (v: number | string | null | undefined): number => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : 0;
};

const fmt = (v: number, max = 4) => v.toLocaleString('en-US', { maximumFractionDigits: max });

export function conversionPreview(input: ConversionInput): ConversionPreview {
  const quantity = num(input.quantity);
  const unitPrice = num(input.unitPrice);
  const factorRaw = num(input.purchaseToBaseFactor);
  const base = input.baseUnitCode ?? '';
  // ถ้าไม่ได้ตั้งหน่วยซื้อไว้ ถือว่าซื้อเป็นหน่วยฐาน (ตรงกับที่ระบบทำอยู่)
  const purchase = input.purchaseUnitCode || base;

  const lineTotal = quantity * unitPrice;

  // factor <= 0 หรือไม่มีข้อมูล = ยังบอกไม่ได้ ไม่เดาเป็น 1
  if (!factorRaw || factorRaw <= 0) {
    return {
      sameUnit: false, factor: null, purchaseUnit: purchase, baseUnit: base,
      equation: null, baseQuantity: null, baseUnitCost: null, lineTotal,
    };
  }

  const sameUnit = factorRaw === 1;
  return {
    sameUnit,
    factor: factorRaw,
    purchaseUnit: purchase,
    baseUnit: base,
    equation: sameUnit ? null : `1 ${purchase} = ${fmt(factorRaw)} ${base}`,
    baseQuantity: quantity * factorRaw,
    baseUnitCost: unitPrice / factorRaw,
    lineTotal,
  };
}

/** ยอดรวมทั้งใบ — บวกจากยอดรวมของแต่ละบรรทัดตรง ๆ ไม่ผ่านการแปลงหน่วย */
export function receiptTotals(lines: { quantity: number; unitPrice: number }[]) {
  return {
    lineCount: lines.length,
    totalQuantity: lines.reduce((s, l) => s + num(l.quantity), 0),
    totalValue: lines.reduce((s, l) => s + num(l.quantity) * num(l.unitPrice), 0),
  };
}
