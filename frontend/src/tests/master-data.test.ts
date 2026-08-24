import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { itemPriceDisplay, needsConversion, purchasePriceFromBase, unitPricePreview } from '@/lib/item-unit-price';
import { findExisting, inUseMessage, isConflict, masterConflictMessage } from '@/lib/master-validation';

/** PHASE 7 — MASTER DATA REDESIGN */

/* ============================================================
   หน่วย / ราคา — หัวใจของเฟสนี้
   ============================================================ */
describe('ราคาซื้อ → ต้นทุนต่อหน่วยฐาน (ตอนคีย์ฟอร์ม)', () => {
  it('1 กรณีตัวอย่างในสเปก: ฿47 ต่อ 1 L, 1 L = 1000 ML → ฿0.047 / ML', () => {
    const p = unitPricePreview({ purchasePrice: 47, purchaseQuantity: 1, purchaseToBaseFactor: 1000, purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(p.pricePerPurchaseUnit).toBe(47);
    expect(p.baseUnitCost).toBeCloseTo(0.047, 10);
    expect(p.conversionText).toBe('1 L = 1,000 ML');
    expect(p.formula).toBe('47 ÷ 1,000 = 0.047');
    expect(p.warning).toBeNull();
  });

  it('2 บรรจุภัณฑ์: ฿120 ต่อ 1 BOX, 1 BOX = 12 PCS → ฿10 / PCS', () => {
    const p = unitPricePreview({ purchasePrice: 120, purchaseQuantity: 1, purchaseToBaseFactor: 12, purchaseUnitCode: 'BOX', baseUnitCode: 'PCS' });
    expect(p.baseUnitCost).toBe(10);
    expect(p.conversionText).toBe('1 BOX = 12 PCS');
  });

  it('3 ซื้อหลายหน่วยในราคาเดียว: ฿350 ได้ 5 KG, 1 KG = 1000 G', () => {
    const p = unitPricePreview({ purchasePrice: 350, purchaseQuantity: 5, purchaseToBaseFactor: 1000, purchaseUnitCode: 'KG', baseUnitCode: 'G' });
    expect(p.pricePerPurchaseUnit).toBe(70);
    expect(p.baseUnitCost).toBeCloseTo(0.07, 10);
  });

  it('4 factor = 1 → บอกว่าหน่วยเดียวกัน ไม่ต้องมีสมการ', () => {
    const p = unitPricePreview({ purchasePrice: 47, purchaseToBaseFactor: 1, purchaseUnitCode: 'KG', baseUnitCode: 'KG' });
    expect(p.factorState).toBe('same');
    expect(p.baseUnitCost).toBe(47);
    expect(p.conversionText).toBeNull();
    expect(p.formula).toBeNull();
  });

  it('5 ไม่มี factor → เตือนตามข้อความในสเปก และไม่คำนวณต้นทุน', () => {
    const p = unitPricePreview({ purchasePrice: 47, purchaseToBaseFactor: 0, purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(p.factorState).toBe('missing');
    expect(p.baseUnitCost).toBeNull();
    expect(p.warning).toBe('กรุณากำหนดอัตราแปลงก่อนใช้ราคานี้คำนวณต้นทุน');
  });

  it('6 ยังไม่กรอกราคา → ไม่โชว์ 0 หลอกตา', () => {
    const p = unitPricePreview({ purchasePrice: '', purchaseToBaseFactor: 1000 });
    expect(p.pricePerPurchaseUnit).toBeNull();
    expect(p.baseUnitCost).toBeNull();
  });

  it('7 ค่าที่ไม่ใช่ตัวเลขไม่ทำให้พัง', () => {
    const p = unitPricePreview({ purchasePrice: 'abc', purchaseToBaseFactor: 'x' });
    expect(p.baseUnitCost).toBeNull();
    expect(p.factorState).toBe('missing');
  });

  it('8 ตรงกับสูตรที่ backend ใช้: perPurchase / factor', () => {
    // baseUnitCost(purchasePrice, purchaseQuantity, factor) = (price/qty) / factor
    for (const [price, qty, factor] of [[100, 2, 5], [47, 1, 1000], [999, 3, 7]]) {
      const p = unitPricePreview({ purchasePrice: price, purchaseQuantity: qty, purchaseToBaseFactor: factor });
      expect(p.baseUnitCost).toBeCloseTo((price / qty) / factor, 10);
    }
  });
});

describe('ต้นทุนที่เก็บไว้ → ราคาซื้อ (ตอนแสดงในตาราง)', () => {
  it('9 กลับสมการเดิมได้ตรง: 0.047 × 1000 = 47', () => {
    expect(purchasePriceFromBase(0.047, 1000)).toBeCloseTo(47, 10);
  });

  it('10 ตารางแสดงทั้งราคาซื้อ ต้นทุนฐาน และอัตราแปลงพร้อมกัน', () => {
    const d = itemPriceDisplay({ lastCost: 0.047, purchaseToBaseFactor: 1000, purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(d.purchase).toBe('฿47.00 / L');
    expect(d.base).toBe('฿0.0470 / ML');
    expect(d.conversion).toBe('1 L = 1,000 ML');
    expect(d.factorState).toBe('ok');
  });

  it('11 ไม่มีราคา → ไม่เดาเป็นศูนย์', () => {
    const d = itemPriceDisplay({ lastCost: 0, purchaseToBaseFactor: 1000, purchaseUnitCode: 'L', baseUnitCode: 'ML' });
    expect(d.purchase).toBeNull();
    expect(d.base).toBeNull();
  });

  it('12 ไม่มีหน่วยซื้อแยก → ถือว่าซื้อด้วยหน่วยฐาน', () => {
    const d = itemPriceDisplay({ lastCost: 45, purchaseToBaseFactor: 1, purchaseUnitCode: null, baseUnitCode: 'KG' });
    expect(d.purchase).toBe('฿45.00 / KG');
    expect(d.factorState).toBe('same');
    expect(d.conversion).toBeNull();
  });

  it('13 factor เสีย → ไม่แสดงราคาซื้อที่คำนวณจากค่าผิด', () => {
    const d = itemPriceDisplay({ lastCost: 5, purchaseToBaseFactor: 0, purchaseUnitCode: 'BOX', baseUnitCode: 'PCS' });
    expect(d.purchase).toBeNull();
    expect(d.factorState).toBe('missing');
  });
});

describe('รายการที่ยังตั้งอัตราแปลงไม่ครบ', () => {
  it('14 มีหน่วยซื้อแยกแต่ factor ไม่ถูกต้อง → ต้องเตือน', () => {
    expect(needsConversion({ purchaseUnitId: 'u1', baseUnitId: 'u2', purchaseToBaseFactor: 0 })).toBe(true);
  });
  it('15 ซื้อด้วยหน่วยฐานตรง ๆ → ไม่ถือว่าขาด', () => {
    expect(needsConversion({ purchaseUnitId: null, baseUnitId: 'u2', purchaseToBaseFactor: 0 })).toBe(false);
    expect(needsConversion({ purchaseUnitId: 'u2', baseUnitId: 'u2', purchaseToBaseFactor: 0 })).toBe(false);
  });
  it('16 ตั้ง factor แล้ว → ไม่เตือน', () => {
    expect(needsConversion({ purchaseUnitId: 'u1', baseUnitId: 'u2', purchaseToBaseFactor: 1000 })).toBe(false);
  });
});

/* ============================================================
   ข้อความ validation / ซ้ำ / ลบไม่ได้
   ============================================================ */
describe('duplicate & validation UX', () => {
  it('17 จับ conflict ได้ทั้งจาก code และจากข้อความ', () => {
    expect(isConflict(Object.assign(new Error('x'), { code: 'DUPLICATE_UNIT' }))).toBe(true);
    expect(isConflict(Object.assign(new Error('x'), { code: 'P2002' }))).toBe(true);
    expect(isConflict(new Error('มีรหัส KG อยู่แล้ว'))).toBe(true);
    expect(isConflict(new Error('เครือข่ายขัดข้อง'))).toBe(false);
  });

  it('18 ข้อความซ้ำต้องบอกว่าตัวไหนชน ไม่ใช่ error technical', () => {
    const msg = masterConflictMessage(Object.assign(new Error('CONFLICT'), { code: 'DUPLICATE_UNIT' }), 'unit', 'KG');
    expect(msg).toContain('มีหน่วย KG อยู่ในระบบแล้ว');
    expect(msg).not.toContain('CONFLICT');
    expect(masterConflictMessage(new Error('อยู่แล้ว'), 'ingredient', 'น้ำมันพืช')).toContain('มีวัตถุดิบ น้ำมันพืช อยู่ในระบบแล้ว');
  });

  it('19 error อื่นยังคงข้อความเดิมไว้ ไม่กลบสาเหตุจริง', () => {
    expect(masterConflictMessage(new Error('เครือข่ายขัดข้อง'), 'unit')).toBe('เครือข่ายขัดข้อง');
    expect(masterConflictMessage(Object.assign(new Error(''), { code: 'FORBIDDEN' }), 'unit')).toBe('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
  });

  it('20 ลบไม่ได้เพราะถูกใช้งาน → ข้อความตามสเปก', () => {
    expect(inUseMessage(Object.assign(new Error('x'), { code: 'CONVERSION_IN_USE' }), 'unit'))
      .toBe('หน่วยนี้กำลังถูกใช้งานอยู่ จึงไม่สามารถลบได้');
    expect(inUseMessage(new Error('อย่างอื่น'), 'unit')).toBeNull();
  });

  it('21 กันสร้างซ้ำตั้งแต่ฝั่ง UI ทั้งจากชื่อและรหัส', () => {
    const rows = [{ name: 'กิโลกรัม', code: 'KG' }, { name: 'กรัม', code: 'G' }];
    expect(findExisting(rows, 'kg')?.code).toBe('KG');
    expect(findExisting(rows, ' กรัม ')?.code).toBe('G');
    expect(findExisting(rows, 'ลิตร')).toBeNull();
    expect(findExisting(rows, '')).toBeNull();
  });
});

/* ============================================================
   โครงหน้า
   ============================================================ */
const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const itemList = read('pages/catalog/ItemListWorkspace.tsx');
const itemForm = read('pages/catalog/ItemFormWorkspace.tsx');
const masters = read('pages/catalog/CatalogMastersPage.tsx');
const partners = read('pages/catalog/PartnerMastersPage.tsx');
const modal = read('components/ui/MasterModal.tsx');
const ops = read('pages/OperationsPages.tsx');
const css = read('styles/master-data.css');
const nav = read('components/layout/nav-config.ts');
const app = read('App.tsx');

describe('PART 2 — pattern เดียวกันทุกหน้า master', () => {
  it('22 ทุกหน้าใช้ primitive กลาง ไม่ใช่ hero/toolbar เฉพาะกิจ', () => {
    for (const [name, src] of [['list', itemList], ['units', masters], ['partners', partners]] as const) {
      expect(src, name).toContain('<PageContainer');
      expect(src, name).toContain('<PageHeader');
      expect(src, name).toContain('<FilterBar');
      expect(src, name).toContain('<ContentCard');
      expect(src, name).toContain('<KPIGrid');
    }
    expect(itemForm).toContain('<PageContainer');
    expect(itemForm).toContain('<PageHeader');
  });

  it('23 เลิกใช้ hero เดิมของ catalog แล้ว', () => {
    for (const src of [itemList, itemForm, masters, partners]) {
      expect(src).not.toContain('units-hero');
      expect(src).not.toContain('fcx-hero');
    }
  });

  it('24 ไม่มี inline style เหลือในหน้า master', () => {
    for (const [name, src] of [['list', itemList], ['form', itemForm], ['units', masters], ['partners', partners], ['ops', ops]] as const) {
      expect(src.match(/style=\{\{/g)?.length ?? 0, name).toBe(0);
    }
  });

  it('25 ทุกหน้ามี empty / loading / error state', () => {
    for (const src of [itemList, masters, partners]) {
      expect(src).toContain('EmptyState');
    }
    expect(itemList).toContain('SkeletonRows');
    expect(masters).toContain('SkeletonRows');
    expect(partners).toContain('SkeletonRows');
  });
});

describe('PART 3 — ตารางวัตถุดิบ/บรรจุภัณฑ์', () => {
  it('26 มีคอลัมน์ครบตามสเปก และมีอัตราแปลงเป็นตัวเชื่อม', () => {
    for (const col of ['หน่วยซื้อ', 'หน่วยฐาน', 'อัตราแปลง', 'หมวด']) {
      expect(itemList, col).toContain(`<th>${col}</th>`);
    }
    // สองคอลัมน์นี้จัดขวา จึงมี class num
    expect(itemList).toContain('<th className="num">ราคาซื้อล่าสุด</th>');
    expect(itemList).toContain('<th>สถานะ</th>');
    // ทุกคอลัมน์ต้องมี data-label เพื่อกลายเป็นการ์ดบนมือถือ
    for (const col of ['หน่วยซื้อ', 'หน่วยฐาน', 'อัตราแปลง', 'ราคาซื้อล่าสุด', 'สถานะ']) {
      expect(itemList, col).toContain(`data-label="${col}"`);
    }
  });

  it('27 คอลัมน์ราคาซื้อล่าสุดมีค่าจริงแล้ว (เดิมเป็น — ตายตัว)', () => {
    expect(itemList).toContain('itemPriceDisplay(');
    expect(itemList).toContain('{p.purchase ??');
    expect(itemList).not.toContain('<td className="num">—</td>');
  });

  it('28 KPI นับจากทั้งชุด ไม่ใช่เฉพาะหน้าที่เปิดอยู่', () => {
    expect(itemList).toContain('selectableItems(variant.type)');
    expect(itemList).not.toContain("sub=\"ในหน้านี้\"");
  });

  it('29 ปิด/เปิดใช้งานต้องผ่าน ConfirmDialog ที่บอกผลกระทบ', () => {
    expect(itemList).toContain('<ConfirmDialog');
    expect(itemList).toContain('ข้อมูลเดิมและสูตรที่ใช้อยู่ยังคงเดิม');
  });
});

describe('PART 4–5 — ฟอร์มแบ่งหัวข้อ + preview ก่อนบันทึก', () => {
  it('30 แบ่ง section A–E ตามสเปก', () => {
    for (const badge of ['A', 'B', 'C', 'D', 'E']) {
      expect(itemForm).toContain(`<span className="md-section-badge">${badge}</span>`);
    }
  });

  it('31 preview เรียกใช้ semantics เดิม ไม่คิดสูตรใหม่', () => {
    expect(itemForm).toContain('unitPricePreview({');
    expect(itemForm).toContain('preview.baseUnitCost');
    expect(itemForm).toContain('preview.formula');
    expect(itemForm).toContain('preview.warning');
  });

  it('32 ต้นทุนต่อหน่วยฐานเป็นตัวเลขเด่นที่สุดในแผงสรุป', () => {
    expect(itemForm).toContain('className="md-preview-row lead"');
    const lead = /\.md-preview-row\.lead > strong \{[^}]*font-size: (\d+)px/.exec(css);
    const normal = /\.md-preview-row > strong \{[^}]*font-size: (\d+)px/.exec(css);
    expect(Number(lead?.[1])).toBeGreaterThan(Number(normal?.[1]) + 8);
  });

  it('33 สมการหน่วยเป็นรูปแบบเดียวทั้งระบบ: [1] [หน่วยซื้อ] = [x] [หน่วยฐาน]', () => {
    /* PHASE 20 — โครงสมการยังเป็นรูปแบบเดียวกัน แต่ className เพิ่มสถานะล็อก
       เมื่อเป็นอัตราหน่วยมาตรฐานที่ระบบเติมให้ จึงตรวจที่ชื่อคลาสแทนสตริงตายตัว */
    expect(itemForm).toMatch(/className=\{?`?md-equation/);
    expect(itemForm).toContain('<span className="eq-const">1</span>');
    expect(itemForm).toContain('<span className="eq-op">=</span>');
  });

  it('34 error ผูกกับ field ด้วย aria ไม่ใช่ข้อความลอย', () => {
    expect(itemForm).toContain('aria-invalid={missingName}');
    expect(itemForm).toContain("aria-describedby={missingName ? 'err-name' : undefined}");
    expect(itemForm).toContain('id="err-name"');
    expect(itemForm).toContain('aria-describedby={badFactor');
  });

  it('35 ตัวเลือก "ประเภทหน่วย" ที่เก็บค่าแล้วไม่เคยส่ง ถูกเอาออกแล้ว', () => {
    // ของเดิม: newUnit.category = WEIGHT/VOLUME/... แต่ createUnit ส่งแค่ code/name
    expect(itemForm).not.toContain("category: 'COUNT'");
    expect(itemForm).not.toContain('<option value="WEIGHT">');
  });
});

describe('PART 7 — หน้าหน่วย', () => {
  it('36 ไม่สร้างคอลัมน์ประเภทหน่วยขึ้นเอง (schema ไม่มี field นี้)', () => {
    expect(masters).not.toContain('<th>ประเภท</th>');
    expect(masters).toContain('ถูกใช้งานที่');
  });

  it('37 "ถูกใช้งานที่" คำนวณจากข้อมูลจริง ไม่ใช่ค่าคงที่', () => {
    expect(masters).toContain('selectableItems()');
    expect(masters).toContain('bump(it.baseUnit?.code');
    expect(masters).toContain("bump(c.fromCode, 'conversions')");
  });

  it('38 มีปุ่มไปหน้าสูตรแปลงหน่วย และไม่ทำฟอร์ม conversion ซ้ำ', () => {
    expect(masters).toContain('to="/units/conversions"');
    expect(masters).not.toContain('saveConversion');
    expect(masters).not.toContain('conversion-form');
  });
});

describe('PART 10–12 — ผู้จำหน่าย / คลัง', () => {
  it('39 มี route และเมนูจริง', () => {
    expect(app).toContain('<Route path="/suppliers"');
    expect(app).toContain('<Route path="/warehouses"');
    expect(nav).toContain("path: '/suppliers'");
    expect(nav).toContain("path: '/warehouses'");
    expect(nav).toContain("path: '/units'");
  });

  it('40 เมนูใช้สิทธิ์ตรงกับที่ endpoint ยอมให้เข้า จึงไม่กดแล้วเจอ 403', () => {
    expect(nav).toContain("requiredAnyPermission: ['RECEIVING_CREATE', 'STOCK_ISSUE_CREATE', 'ORDER_VIEW']");
  });

  it('41 ไม่ใส่คอลัมน์ที่ API ไม่ได้ส่งมา', () => {
    // lookups คืนแค่ id/code/name — จึงต้องไม่มีคอลัมน์ผู้ติดต่อ/โทร/อีเมล ในตาราง
    expect(partners).not.toContain('<th>ผู้ติดต่อ</th>');
    expect(partners).not.toContain('<th>โทรศัพท์</th>');
    expect(partners).not.toContain('<th>อีเมล</th>');
  });

  it('42 ตัวเลขประกอบมาจาก endpoint จริง', () => {
    // Phase 7B — เปลี่ยนจากรวมเลขเองฝั่ง frontend มาใช้ค่าที่ backend ส่งมาให้แล้ว
    expect(partners).toContain('partnerApi.suppliers(');
    expect(partners).toContain('partnerApi.warehouses(');
    expect(partners).toContain('r.receivingCount');
    expect(partners).toContain('r.stockValue');
  });

  it('43 คลังมี CTA ไปดูสต็อกของคลังนั้น และหน้าสต็อกรับ query จริง', () => {
    expect(partners).toContain('/inventory?warehouse=');
    const inv = read('pages/InventoryPages.tsx');
    expect(inv).toContain("new URLSearchParams(locationSearch).get('warehouse')");
    expect(inv).toContain('useState(warehouseParam)');
  });

  it('44 quick-create ผู้จำหน่ายขยายเป็นฟอร์มเต็มได้', () => {
    expect(partners).toContain('เพิ่มรายละเอียดผู้จำหน่าย');
    expect(partners).toContain('setExpanded(true)');
  });

  it('45 Phase 7B เปิด contract แล้ว จึงแก้ไข/ปิดใช้งานได้จริง', () => {
    // ข้อจำกัดเดิม ("ยังทำผ่านหน้านี้ไม่ได้") ถูกยกเลิกแล้วเพราะมี PATCH จริง
    expect(partners).not.toContain('ยังทำผ่านหน้านี้ไม่ได้');
    expect(partners).toContain('partnerApi.updateSupplier(');
    expect(partners).toContain('partnerApi.updateWarehouse(');
    // ยังต้องไม่มีการลบถาวร — ปิดใช้งานเท่านั้น
    expect(partners).not.toContain('deleteSupplier');
    expect(partners).not.toContain('deleteWarehouse');
  });
});

describe('PART 13 — modal กลาง', () => {
  it('46 MasterModal มีโครงครบ: header / description / body / validation / footer', () => {
    expect(modal).toContain('md-modal-head');
    expect(modal).toContain('md-modal-body');
    expect(modal).toContain('md-modal-foot');
    expect(modal).toContain('role="alert"');
  });

  it('47 ESC ปิด · ล็อกพื้นหลัง · คืนโฟกัส · aria-labelledby', () => {
    expect(modal).toContain("if (e.key === 'Escape') onClose()");
    expect(modal).toContain("document.body.style.overflow = 'hidden'");
    expect(modal).toContain('opener?.focus?.()');
    expect(modal).toContain('aria-labelledby={titleId}');
    expect(modal).toContain('aria-modal="true"');
  });

  it('48 MasterCreateModal ในหน้ารับของย้ายมาใช้ modal กลางแล้ว', () => {
    expect(ops).toContain('<MasterModal');
    expect(ops).toContain("masterConflictMessage(e, state.kind === 'item' ? 'item' : state.kind)");
  });

  it('49 ทุกหน้า master ใช้ modal ตัวเดียวกัน', () => {
    for (const src of [itemForm, masters, partners, ops]) expect(src).toContain('MasterModal');
  });

  it('50 input สูงตามมาตรฐานสัมผัส และ modal พอดีจอมือถือ', () => {
    expect(css).toMatch(/\.md-fields input[\s\S]{0,200}min-height: var\(--control-h\)/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.md-modal \{[^}]*max-height: 92dvh/);
  });
});

describe('PART 14 — creatable dropdown', () => {
  it('51 มี + เพิ่ม เฉพาะ master ที่สร้างได้จริง และต้องมีสิทธิ์', () => {
    expect(itemForm).toContain('createLabel={canCreateMaster ? t.addCategory : undefined}');
    expect(itemForm).toContain('createLabel={canCreateMaster ? t.addUnit : undefined}');
    expect(itemForm).toContain('onCreate={canCreateMaster ?');
  });

  it('52 dropdown ของ enum คงที่ต้องไม่มีปุ่มสร้าง', () => {
    // สถานะ / ประเภทสินค้า ใช้ <select> ธรรมดา ไม่ใช่ CreatableCombobox
    expect(itemList).toMatch(/<select[\s\S]*?aria-label="สถานะ"/);
    expect(masters).toMatch(/<select[\s\S]*?aria-label="สถานะ"/);
    expect(ops).not.toContain('createLabel="เพิ่มสถานะ"');
  });
});

describe('PART 18–19 — dark mode / a11y / responsive', () => {
  it('53 CSS ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('54 breakpoint ตรงมาตรฐานระบบ', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.length).toBeGreaterThan(0);
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('55 มือถือฟอร์มเหลือคอลัมน์เดียว', () => {
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.md-fields \{ grid-template-columns: minmax\(0, 1fr\)/);
  });

  it('56 ปุ่มไอคอนในแถวมี aria-label ระบุว่าทำกับรายการไหน', () => {
    expect(itemList).toContain('aria-label={`แก้ไข ${item.name}`}');
    expect(itemList).toContain("aria-label={`${item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${item.name}`}");
  });

  it('57 สถานะไม่สื่อด้วยสีอย่างเดียว — มีข้อความกำกับเสมอ', () => {
    expect(itemList).toContain('>ใช้งาน<');
    expect(itemList).toContain('>ปิดใช้งาน<');
    expect(masters).toContain("{r.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}");
  });

  it('58 มุมมองตาราง/การ์ดบอกสถานะกับ screen reader', () => {
    expect(itemList).toContain("aria-pressed={view === 'table'}");
    expect(itemList).toContain("aria-pressed={view === 'cards'}");
  });
});

describe('PART 21 — integration contract ที่ห้ามพัง', () => {
  it('59 Recipe Builder ยังใช้ selectableItems และ quick-create เหมือนเดิม', () => {
    const rb = read('pages/catalog/RecipeBuilderPage.tsx');
    expect(rb).toContain('selectableItems');
  });

  it('60 Receiving ยังมี picker ครบสามตัวและ preview การแปลงราคา', () => {
    expect(ops).toContain('conversionPreview');
    expect(ops).toContain("kind: 'warehouse'");
    expect(ops).toContain("kind: 'supplier'");
    expect(ops).toContain("kind: 'item'");
  });

  it('61 Stock Issue ยังใช้ตัวเลือกสินค้าเดิม', () => {
    expect(ops).toContain('issuableItems(');
    expect(ops).toContain('searchIssuable(');
  });
});
