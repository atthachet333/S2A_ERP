import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { conflictsWithStandard, formatFactor, resolveConversion, resolveFactor, type ConversionEdge } from '@/lib/standard-conversion';
import { unitPricePreview } from '@/lib/item-unit-price';

/**
 * PHASE 20 — อัตราแปลงหน่วยและต้นทุนต่อหน่วยฐาน
 *
 * ความหมายเดียวที่ถูกต้อง: purchaseToBaseFactor = "หนึ่งหน่วยซื้อ มีกี่หน่วยฐาน"
 *   1 KG = 1,000 G  → factor = 1000  (ไม่ใช่ 0.001)
 *   ต้นทุน = ราคา ÷ จำนวนที่ซื้อ ÷ factor
 */

const U = { KG: 'u-kg', G: 'u-g', L: 'u-l', ML: 'u-ml', KHIT: 'u-khit', SACK: 'u-sack', PCS: 'u-pcs', BOX: 'u-box' };

/** เก็บแถวเดียวต่อคู่หน่วย ทิศกลับให้ระบบสร้างเอง — ตรงกับข้อมูลจริงในฐานผลิต */
const EDGES: ConversionEdge[] = [
  { fromUnitId: U.KG, toUnitId: U.G, factor: 1000 },
  { fromUnitId: U.L, toUnitId: U.ML, factor: 1000 },
  { fromUnitId: U.KHIT, toUnitId: U.G, factor: 100 },
  { fromUnitId: U.BOX, toUnitId: U.PCS, factor: 12 },
];

describe('อัตราแปลงมาตรฐาน — ทิศต้องถูกเสมอ', () => {
  it('D · E · F · G · I — ทิศไปและทิศกลับของหน่วยฟิสิกส์', () => {
    expect(resolveFactor(U.KG, U.G, EDGES)).toBe(1000);
    expect(resolveFactor(U.G, U.KG, EDGES)).toBeCloseTo(0.001, 12);
    expect(resolveFactor(U.L, U.ML, EDGES)).toBe(1000);
    expect(resolveFactor(U.ML, U.L, EDGES)).toBeCloseTo(0.001, 12);
    expect(resolveFactor(U.KHIT, U.G, EDGES)).toBe(100);
    expect(resolveFactor(U.G, U.KHIT, EDGES)).toBeCloseTo(0.01, 12);
    // I — หน่วยเดียวกัน
    expect(resolveFactor(U.KG, U.KG, EDGES)).toBe(1);
  });

  it('ต่อทอดหลายขั้นได้ เช่น กระสอบ → KG → G', () => {
    const withSack: ConversionEdge[] = [...EDGES, { fromUnitId: U.SACK, toUnitId: U.KG, factor: 25 }];
    expect(resolveFactor(U.SACK, U.G, withSack)).toBe(25_000);
    expect(resolveFactor(U.G, U.SACK, withSack)).toBeCloseTo(1 / 25_000, 12);
  });

  it('ไม่มีเส้นทางแปลงต้องคืน null ไม่เดา', () => {
    // KG → PCS ไม่มีความสัมพันธ์ทางฟิสิกส์ ต้องไม่เดาให้
    expect(resolveFactor(U.KG, U.PCS, EDGES)).toBeNull();
    expect(resolveFactor(null, U.G, EDGES)).toBeNull();
    expect(resolveFactor(U.KG, undefined, EDGES)).toBeNull();
  });

  it('อัตราที่เสียหายในฐานข้อมูลต้องถูกข้าม ไม่ทำให้ผลเพี้ยน', () => {
    const broken: ConversionEdge[] = [
      { fromUnitId: U.KG, toUnitId: U.G, factor: 1000 },
      { fromUnitId: U.L, toUnitId: U.ML, factor: 0 },
      { fromUnitId: U.KHIT, toUnitId: U.G, factor: Number.NaN },
    ];
    expect(resolveFactor(U.KG, U.G, broken)).toBe(1000);
    expect(resolveFactor(U.L, U.ML, broken)).toBeNull();
    expect(resolveFactor(U.KHIT, U.G, broken)).toBeNull();
  });
});

describe('สรุปการแปลงหน่วยที่แสดงบนฟอร์ม', () => {
  const base = { edges: EDGES, purchaseUnitCode: 'KG', baseUnitCode: 'G' };

  it('หน่วยมาตรฐาน — เติมให้เองและอ่านเป็นประโยคถูกทิศ', () => {
    const r = resolveConversion({ ...base, purchaseUnitId: U.KG, baseUnitId: U.G });
    expect(r.source).toBe('standard');
    expect(r.factor).toBe(1000);
    expect(r.text).toBe('1 KG = 1,000 G');
    expect(r.reverseText).toBe('1 G = 0.001 KG');
    // ข้อความที่เคยผิดต้องไม่ปรากฏอีก
    expect(r.text).not.toBe('1 KG = 0.001 G');
    expect(r.reverseText).not.toBe('1 G = 1,000 KG');
  });

  it('ผู้ใช้กรอกผิดทิศมา ระบบยังยึดอัตรามาตรฐานเสมอ', () => {
    const r = resolveConversion({ ...base, purchaseUnitId: U.KG, baseUnitId: U.G, manualFactor: 0.001 });
    expect(r.factor).toBe(1000);
    expect(r.source).toBe('standard');
  });

  it('หน่วยเดียวกัน = ไม่ต้องแปลง', () => {
    const r = resolveConversion({ ...base, purchaseUnitId: U.KG, baseUnitId: U.KG, baseUnitCode: 'KG' });
    expect(r.source).toBe('same');
    expect(r.factor).toBe(1);
    expect(r.text).toBeNull();
  });

  it('ไม่ระบุหน่วยซื้อแยก = ซื้อด้วยหน่วยฐานตรง ๆ', () => {
    const r = resolveConversion({ ...base, purchaseUnitId: null, baseUnitId: U.G });
    expect(r.source).toBe('same');
    expect(r.factor).toBe(1);
  });

  it('H — อัตราเฉพาะวัตถุดิบยังกรอกเองได้ 1 กระสอบ = 25 KG', () => {
    const r = resolveConversion({
      edges: EDGES, purchaseUnitId: U.SACK, baseUnitId: U.KG,
      purchaseUnitCode: 'กระสอบ', baseUnitCode: 'KG', manualFactor: 25,
    });
    expect(r.source).toBe('manual');
    expect(r.factor).toBe(25);
    expect(r.text).toBe('1 กระสอบ = 25 KG');
    expect(r.reverseText).toBe('1 KG = 0.04 กระสอบ');
  });

  it('อัตราเฉพาะวัตถุดิบที่ยังไม่กรอก ต้องไม่เดาให้', () => {
    const r = resolveConversion({
      edges: EDGES, purchaseUnitId: U.SACK, baseUnitId: U.KG,
      purchaseUnitCode: 'กระสอบ', baseUnitCode: 'KG', manualFactor: 0,
    });
    expect(r.factor).toBeNull();
    expect(r.text).toBeNull();
  });

  it('จัดรูปตัวเลขอ่านง่ายทุกขนาด', () => {
    expect(formatFactor(1000)).toBe('1,000');
    expect(formatFactor(100)).toBe('100');
    expect(formatFactor(25)).toBe('25');
    expect(formatFactor(0.001)).toBe('0.001');
    expect(formatFactor(0.01)).toBe('0.01');
    expect(formatFactor(1)).toBe('1');
  });
});

describe('ต้นทุนต่อหน่วยฐาน — เคสจริงจากหน้าจอ', () => {
  it('A — 350 บาท ซื้อ 1 KG สูตรใช้ G → 0.35 บาท/G', () => {
    const p = unitPricePreview({ purchasePrice: 350, purchaseQuantity: 1, purchaseToBaseFactor: 1000, purchaseUnitCode: 'KG', baseUnitCode: 'G' });
    expect(p.pricePerPurchaseUnit).toBe(350);
    expect(p.baseUnitCost).toBeCloseTo(0.35, 10);
    expect(p.conversionText).toBe('1 KG = 1,000 G');
    // อาการเดิมที่ต้องไม่กลับมา
    expect(p.baseUnitCost).not.toBe(350_000);
  });

  it('B — 700 บาท ซื้อ 2 KG สูตรใช้ G → ยังเป็น 0.35 บาท/G และอัตรายังเป็น 1000', () => {
    const p = unitPricePreview({ purchasePrice: 700, purchaseQuantity: 2, purchaseToBaseFactor: 1000, purchaseUnitCode: 'KG', baseUnitCode: 'G' });
    expect(p.pricePerPurchaseUnit).toBe(350);
    expect(p.baseUnitCost).toBeCloseTo(0.35, 10);
    // จำนวนที่ซื้อต้องไม่ถูกกลืนเข้าไปในอัตราแปลง
    expect(p.conversionText).toBe('1 KG = 1,000 G');
  });

  it('C — 47 บาท ซื้อ 1 L สูตรใช้ ML → 0.047 บาท/ML (regression เดิมของระบบ)', () => {
    const p = unitPricePreview({ purchasePrice: 47, purchaseQuantity: 1, purchaseToBaseFactor: 1000, purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(p.baseUnitCost).toBeCloseTo(0.047, 10);
    expect(p.conversionText).toBe('1 L = 1,000 ML');
  });

  it('ถ้าอัตราผิดทิศหลุดเข้ามา ต้นทุนจะระเบิด — ยืนยันว่านี่คือต้นเหตุเดิม', () => {
    const wrong = unitPricePreview({ purchasePrice: 350, purchaseQuantity: 1, purchaseToBaseFactor: 0.001, purchaseUnitCode: 'KG', baseUnitCode: 'G' });
    expect(wrong.baseUnitCost).toBeCloseTo(350_000, 5);
    // จึงต้องกันตั้งแต่ต้นทางด้วย conflictsWithStandard
    expect(conflictsWithStandard({ purchaseUnitId: U.KG, baseUnitId: U.G, edges: EDGES, factor: 0.001 }))
      .toEqual({ expected: 1000, received: 0.001 });
  });

  it('ต้นทุนวัตถุดิบ 0.35/G ใช้ในสูตร 100 G → 35 บาท', () => {
    const p = unitPricePreview({ purchasePrice: 350, purchaseQuantity: 1, purchaseToBaseFactor: 1000, purchaseUnitCode: 'KG', baseUnitCode: 'G' });
    expect((p.baseUnitCost ?? 0) * 100).toBeCloseTo(35, 10);
  });
});

describe('การตรวจอัตราที่ขัดกับมาตรฐาน', () => {
  it('อัตราถูกต้องต้องผ่าน', () => {
    expect(conflictsWithStandard({ purchaseUnitId: U.KG, baseUnitId: U.G, edges: EDGES, factor: 1000 })).toBeNull();
    expect(conflictsWithStandard({ purchaseUnitId: U.L, baseUnitId: U.ML, edges: EDGES, factor: 1000 })).toBeNull();
  });

  it('อัตราผิดทิศหรือผิดค่าต้องถูกจับได้', () => {
    expect(conflictsWithStandard({ purchaseUnitId: U.KG, baseUnitId: U.G, edges: EDGES, factor: 0.001 })).not.toBeNull();
    expect(conflictsWithStandard({ purchaseUnitId: U.KG, baseUnitId: U.G, edges: EDGES, factor: 500 })).not.toBeNull();
    expect(conflictsWithStandard({ purchaseUnitId: U.KG, baseUnitId: U.G, edges: EDGES, factor: 0 })).not.toBeNull();
  });

  it('อัตราเฉพาะวัตถุดิบไม่มีมาตรฐานให้เทียบ จึงต้องปล่อยผ่าน', () => {
    expect(conflictsWithStandard({ purchaseUnitId: U.SACK, baseUnitId: U.KG, edges: EDGES, factor: 25 })).toBeNull();
    // KG → ML ขึ้นกับความหนาแน่นของวัตถุดิบ จงใจไม่มีในตารางมาตรฐาน
    expect(conflictsWithStandard({ purchaseUnitId: U.KG, baseUnitId: U.ML, edges: EDGES, factor: 1000 })).toBeNull();
  });
});

/* ---------- K: หน้าสร้างและหน้าแก้ไขต้องทำงานเหมือนกัน ---------- */

describe('K — โครงของฟอร์มวัตถุดิบ', () => {
  const src = fs.readFileSync(path.resolve(__dirname, '../pages/catalog/ItemFormWorkspace.tsx'), 'utf8');
  const clean = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('หน้าสร้างและหน้าแก้ไขใช้คอมโพเนนต์เดียวกัน จึงมีพฤติกรรมเดียวกันโดยอัตโนมัติ', () => {
    const ingredient = fs.readFileSync(path.resolve(__dirname, '../pages/catalog/IngredientFormPage.tsx'), 'utf8');
    expect(ingredient).toContain('ItemFormWorkspace');
    const app = fs.readFileSync(path.resolve(__dirname, '../App.tsx'), 'utf8');
    expect(app).toContain('path="/ingredients/new" element={<IngredientFormPage />}');
    expect(app).toContain('path="/ingredients/:id" element={<IngredientFormPage />}');
  });

  it('ฟอร์มอ่านอัตราจากตารางแปลงหน่วยของระบบ ไม่เก็บค่าซ้ำเอง', () => {
    expect(clean).toContain('resolveConversion(');
    expect(clean).toContain("queryKey: ['unit-conversions']");
    expect(clean).toContain('catalogApi.conversions()');
    // ต้องไม่มีตารางค่าคงที่ของหน่วยฟิสิกส์ซ่อนอยู่ในฟอร์ม
    expect(clean).not.toMatch(/KG['"]?\s*:\s*1000/);
  });

  it('อัตรามาตรฐานถูกล็อกไม่ให้พิมพ์ทับ และเปลี่ยนหน่วยแล้วคำนวณใหม่ทันที', () => {
    expect(clean).toContain('const factorLocked = isStandard || isSameUnit;');
    expect(clean).toMatch(/factorLocked\s*\n?\s*\?\s*<span className="eq-const eq-standard">/);
    expect(clean).toMatch(/if \(form\.purchaseToBaseFactor !== resolved\) set\(\{ purchaseToBaseFactor: resolved \}\)/);
  });

  it('ไม่ใช้ศัพท์เทคนิคในข้อความที่ผู้ใช้เห็น', () => {
    const visible = clean.match(/>[^<>{}]*[ก-๙][^<>{}]*</g) ?? [];
    expect(visible.join(' ')).not.toContain('purchaseToBaseFactor');
    expect(clean).toContain('หน่วยมาตรฐาน — ระบบคำนวณให้อัตโนมัติ');
  });
});

/* ---------- PHASE 20B: ทุกหน้าที่สร้าง/แก้สินค้าต้องใช้ความหมายเดียวกัน ---------- */

describe('20B — ฟอร์มสินค้าทุกหน้าใช้ตรรกะแปลงหน่วยชุดเดียวกัน', () => {
  const readPage = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
  const clean = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  /** ทุกหน้าที่ผู้ใช้สร้างหรือแก้สินค้าได้ */
  const FORMS = [
    ['ฟอร์มรวม (วัตถุดิบ + บรรจุภัณฑ์)', '../pages/catalog/ItemFormWorkspace.tsx'],
    ['ฟอร์มเดิมของหน้า /items', '../pages/catalog/ItemFormPage.tsx'],
  ] as const;

  it.each(FORMS)('%s — เรียกใช้ตัวแก้อัตราส่วนกลาง ไม่เขียนตรรกะเอง', (_name, rel) => {
    const src = clean(readPage(rel));
    expect(src).toContain('resolveConversion(');
    expect(src).toContain("from '@/lib/standard-conversion'");
    expect(src).toContain("queryKey: ['unit-conversions']");
    expect(src).toContain('catalogApi.conversions()');
  });

  it.each(FORMS)('%s — ไม่มีตารางอัตราหน่วยฟิสิกส์ซ่อนอยู่ในไฟล์', (_name, rel) => {
    const src = clean(readPage(rel));
    // ห้ามมีค่าคงที่ของหน่วยมาตรฐานฝังในฟอร์ม ต้องมาจากตาราง UnitConversion เท่านั้น
    expect(src).not.toMatch(/['"]KG['"]\s*:\s*1000/);
    expect(src).not.toMatch(/['"]L['"]\s*:\s*1000/);
    expect(src).not.toMatch(/factor\s*=\s*1000\b/);
  });

  it.each(FORMS)('%s — อัตรามาตรฐานถูกล็อก และเติมใหม่ทันทีเมื่อเปลี่ยนหน่วย', (_name, rel) => {
    const src = clean(readPage(rel));
    expect(src).toContain('factorLocked');
    expect(src).toMatch(/if \(form\.purchaseToBaseFactor !== resolved\) set\(\{ purchaseToBaseFactor: resolved \}\)/);
  });

  it.each(FORMS)('%s — ต้นทุนต่อหน่วยฐานหารด้วยอัตรา ไม่ใช่คูณ', (_name, rel) => {
    const src = clean(readPage(rel));
    // ต้องไม่มีการคูณอัตราเข้ากับราคาซื้อเพื่อหาต้นทุนต่อหน่วยฐาน
    expect(src).not.toMatch(/pricePerPurchaseUnit\s*\*\s*factor/);
    expect(src).not.toMatch(/price\s*\*\s*factor/);
  });

  it('ฟอร์มเดิมยังแสดงด้านกลับที่คำนวณจาก 1/อัตรา', () => {
    const src = clean(readPage('../pages/catalog/ItemFormPage.tsx'));
    expect(src).toContain('conversion.reverseText');
    expect(src).toContain('หน่วยมาตรฐาน — ระบบคำนวณให้อัตโนมัติ');
  });

  it('ฟอร์มเดิมยังกรอกอัตราเฉพาะรายการได้ เมื่อไม่มีอัตรามาตรฐาน', () => {
    const src = clean(readPage('../pages/catalog/ItemFormPage.tsx'));
    expect(src).toMatch(/: <label className="full">อัตราแปลงของรายการนี้/);
    expect(src).toContain('onChange={(e) => set({ purchaseToBaseFactor: e.target.value })}');
  });

  it('ทุกหน้าคิดต้นทุนได้ผลเดียวกันในสามเคสอ้างอิง', () => {
    // ตรรกะการคิดต้นทุนอยู่ที่เดียว จึงยืนยันผ่านสูตรกลางได้ทุกหน้า
    const cases = [
      { price: 350, qty: 1, factor: 1000, expected: 0.35 },
      { price: 700, qty: 2, factor: 1000, expected: 0.35 },
      { price: 47, qty: 1, factor: 1000, expected: 0.047 },
    ];
    for (const c of cases) {
      const preview = unitPricePreview({
        purchasePrice: c.price, purchaseQuantity: c.qty, purchaseToBaseFactor: c.factor,
        purchaseUnitCode: 'KG', baseUnitCode: 'G',
      });
      expect(preview.baseUnitCost, JSON.stringify(c)).toBeCloseTo(c.expected, 10);
      // สูตรเดียวกับที่ฟอร์มเดิมใช้: ราคา ÷ จำนวน ÷ อัตรา
      expect((c.price / c.qty) / c.factor).toBeCloseTo(c.expected, 10);
    }
  });

  it('ไม่มีหน้าไหนเหลือช่องกรอกอัตราแบบไม่มีการตรวจ', () => {
    for (const [, rel] of FORMS) {
      const src = clean(readPage(rel));
      // ช่องกรอกอัตราต้องอยู่หลังการตัดสินว่าเป็นอัตราเฉพาะรายการเท่านั้น
      const inputs = src.match(/set\(\{ purchaseToBaseFactor: e\.target\.value \}\)/g) ?? [];
      expect(inputs.length, rel).toBe(1);
      expect(src.indexOf('factorLocked')).toBeLessThan(src.indexOf('set({ purchaseToBaseFactor: e.target.value })'));
    }
  });
});
