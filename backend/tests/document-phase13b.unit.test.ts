import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  columnsFor, renderBusinessPdf, resolveLogoPath, type BusinessDocument,
} from '../src/modules/business/document.service.js';
import { COMPANY_DOCUMENT_FIELDS, toDocumentCompany } from '../src/modules/business/company-identity.js';

/**
 * PHASE 13B — ใบปรับปรุงสต็อก (AJ) + แหล่งข้อมูลบริษัทชุดเดียว + โลโก้ที่อัปโหลดเอง
 */

const readSrc = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
const route = readSrc('modules/business/business.route.ts');
const uploads = readSrc('modules/uploads/upload.route.ts');

const company = {
  nameTh: 'บริษัท ซื่อสดดี จำกัด', nameEn: 'ZUE SOD DEE CO., LTD.',
  logoUrl: '/company-logos/krua-suesoddee.png', taxId: '0735569004886',
  address: '96 หมู่ 1 ตำบลห้วยพลู', email: 'zuesoddee@gmail.com',
  phone: null, website: null, documentFooter: null,
};

const ajDoc = (over: Partial<BusinessDocument> = {}): BusinessDocument => ({
  type: 'STOCK_ADJUSTMENT_SLIP', title: 'STOCK_ADJUSTMENT_SLIP',
  documentNo: 'AJ-2026-0001', date: new Date('2026-08-21T00:00:00Z'), company,
  status: 'ยืนยันแล้ว', createdBy: 'วิน',
  subject: [{ label: 'คลัง', value: 'คลังครัวสดดี' }, { label: 'เหตุผล', value: 'นับสต็อกประจำเดือน' }],
  lines: [
    { name: 'ไส้หมู', detail: '100 KG − 6 KG = 94 KG', before: 100, change: -6, after: 94, unit: 'KG' },
    { name: 'กระเพาะหมู', detail: '65.7 KG + 4.3 KG = 70 KG', before: 65.7, change: 4.3, after: 70, unit: 'KG' },
  ],
  note: 'ตรวจนับโดยทีมคลัง',
  ...over,
});

/* ============================================================
   §1 AJ PDF
   ============================================================ */
describe('PHASE 13B — ใบปรับปรุงสต็อก', () => {
  it('route รองรับชนิดเอกสาร STOCK_ADJUSTMENT_SLIP', () => {
    expect(route).toContain("'STOCK_ADJUSTMENT_SLIP'");
    expect(route).toContain("} else if (type === 'STOCK_ADJUSTMENT_SLIP') {");
  });

  it('อ่านเฉพาะเอกสารที่ร้องขอ และผูกกับบริษัทของผู้ใช้', () => {
    const branch = route.slice(route.indexOf("type === 'STOCK_ADJUSTMENT_SLIP'"), route.indexOf("type === 'RECIPE_COST_SHEET'"));
    expect(branch).toContain('prisma.stockAdjustment.findFirst');
    expect(branch).toContain('where: { id, companyId }');
    // ห้ามหยิบใบล่าสุดมาแทนใบที่ผู้ใช้กด
    expect(branch).not.toMatch(/orderBy[\s\S]{0,60}adjustmentDate/);
    expect(branch).not.toContain('findFirst({ where: { companyId }');
  });

  it('ใช้ยอดที่บันทึกไว้ตอนทำรายการ ไม่ย้อนคำนวณจากสต็อกปัจจุบัน', () => {
    const branch = route.slice(route.indexOf("type === 'STOCK_ADJUSTMENT_SLIP'"), route.indexOf("type === 'RECIPE_COST_SHEET'"));
    expect(branch).toContain('num(line.systemQty)');   // ก่อนปรับ
    expect(branch).toContain('num(line.diffQty)');     // ส่วนต่าง
    expect(branch).toContain('num(line.countedQty)');  // หลังปรับ
    expect(branch).not.toContain('stockBalance');
    expect(branch).not.toContain('onHand');
  });

  it('คอลัมน์ตรงกับข้อมูลที่มีจริง — ไม่มีคอลัมน์เหตุผลรายบรรทัด', () => {
    const keys = columnsFor('STOCK_ADJUSTMENT_SLIP', []).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'before', 'change', 'after', 'unit']);
    // เหตุผลอยู่ที่หัวเอกสาร จึงต้องไปอยู่ในบล็อกข้อมูล ไม่ซ้ำทุกแถว
    const branch = route.slice(route.indexOf("type === 'STOCK_ADJUSTMENT_SLIP'"), route.indexOf("type === 'RECIPE_COST_SHEET'"));
    expect(branch).toContain("label: 'เหตุผล'");
  });

  it('สร้างไฟล์ PDF จริง มีโลโก้และฟอนต์ครบ', async () => {
    const buf = await renderBusinessPdf(ajDoc());
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(buf.toString('latin1')).toContain('/MediaBox [0 0 419.53 595.28]');  // PHASE 14: ครึ่ง A4
    expect(buf.toString('latin1')).toMatch(/\/Subtype\s*\/Image/);
    expect((buf.toString('latin1').match(/\/FontFile2/g) || []).length).toBeGreaterThanOrEqual(2);
  });

  it('เอกสารไม่มียอดเงิน จึงไม่ต้องมีบล็อกยอดรวม', async () => {
    const buf = await renderBusinessPdf(ajDoc({ total: undefined }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('ชื่อไฟล์ขึ้นต้นด้วย AJ', () => {
    expect(route).toContain("STOCK_ADJUSTMENT_SLIP: 'AJ',");
  });

  it('หน่วย/ผู้ทำรายการที่ไม่มีในข้อมูลเดิม แสดงขีด ไม่เดา', () => {
    const branch = route.slice(route.indexOf("type === 'STOCK_ADJUSTMENT_SLIP'"), route.indexOf("type === 'RECIPE_COST_SHEET'"));
    expect(branch).toContain("baseUnit?.code ?? '—'");
    expect(branch).toContain('ajAuthor ?? undefined');
  });
});

/* ============================================================
   §8 แหล่งข้อมูลบริษัทชุดเดียว
   ============================================================ */
describe('PHASE 13B — ข้อมูลบริษัทชุดเดียว', () => {
  it('helper ส่งค่าจาก Company ตรง ๆ ไม่เขียนทับชื่อ', () => {
    const mapped = toDocumentCompany({ ...company, id: 'c1', code: 'S2A-PRIMARY' } as never);
    expect(mapped.nameTh).toBe('บริษัท ซื่อสดดี จำกัด');
    expect(mapped.taxId).toBe('0735569004886');
  });

  it('ไม่มีการเขียนทับชื่อบริษัทเหลืออยู่ในโค้ดแล้ว', () => {
    // ตัดคอมเมนต์ทิ้งก่อน เพราะคอมเมนต์อธิบายบั๊กมีคำนี้อยู่
    const code = route.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toContain('ครัวสดดี');
  });

  it('ทั้งเอกสารและหน้าตั้งค่าอ่านผ่าน helper เดียวกัน', () => {
    expect(route).toContain('toDocumentCompany(company)');
    expect(route).toContain("from './company-identity.js'");
  });

  it('รายชื่อ field ที่แก้ไขได้ตรงกับที่ PATCH รับจริง', () => {
    const patchBlock = route.slice(route.indexOf("app.patch('/company'"), route.indexOf("app.get('/customers'"));
    for (const f of COMPANY_DOCUMENT_FIELDS) {
      expect(patchBlock, `PATCH /company ต้องรับ ${f}`).toContain(`${f}:`);
    }
  });
});

/* ============================================================
   §5 §26 โลโก้ที่ผู้ใช้อัปโหลดเอง
   ============================================================ */
describe('PHASE 13B — อัปโหลดโลโก้บริษัท', () => {
  it('มี endpoint และคุมด้วยสิทธิ์ตั้งค่าระบบ', () => {
    expect(uploads).toContain("app.post('/company'");
    expect(uploads).toContain("requirePermission('SYSTEM_SETTINGS')");
  });

  it('โลโก้รับเฉพาะ PNG/JPEG เพราะ PDFKit ฝัง WEBP ไม่ได้', () => {
    const allow = uploads.slice(uploads.indexOf('ALLOWED_BY_KIND'), uploads.indexOf('async function handleUpload'));
    expect(allow).toMatch(/company:\s*\['image\/jpeg',\s*'image\/png'\]/);
    expect(allow).not.toMatch(/company:[^\]]*webp/);
  });

  it('ยังตรวจ magic bytes และเขียนไฟล์ด้วยชื่อ UUID เหมือนเดิม', () => {
    expect(uploads).toContain('detectImage(buffer)');
    expect(uploads).toContain('randomUUID()');
    expect(uploads).toContain('!allowed.includes(detected)');
  });

  it('เสิร์ฟไฟล์ของ kind company ได้', () => {
    expect(uploads).toContain("new Set(['items', 'menus', 'company'])");
  });

  it('หาไฟล์โลโก้ที่อัปโหลดเจอจาก url /api/uploads/company/...', () => {
    const dir = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? './data/uploads', 'company');
    fs.mkdirSync(dir, { recursive: true });
    const name = '11111111-1111-4111-8111-111111111111.png';
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    fs.writeFileSync(path.join(dir, name), png);
    try {
      expect(resolveLogoPath(`/api/uploads/company/${name}`)).toBeTruthy();
    } finally { fs.unlinkSync(path.join(dir, name)); }
  });

  it('กัน path traversal จาก logoUrl', () => {
    expect(resolveLogoPath('/api/uploads/company/../../../../Windows/win.ini.png')).toBeNull();
  });

  it('โลโก้เปิดไม่ได้ → เอกสารยังสร้างได้ ไม่ 500', async () => {
    const buf = await renderBusinessPdf(ajDoc({ company: { ...company, logoUrl: '/api/uploads/company/ไม่มีจริง.png' } }));
    expect(buf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

/* ============================================================
   §10 regression ของเอกสารเดิม
   ============================================================ */
describe('PHASE 13B — เอกสารเดิมต้องไม่ถอยหลัง', () => {
  it('GR ยังมีลำดับ ราคา/หน่วย และมูลค่า', () => {
    const keys = columnsFor('GOODS_RECEIPT_SLIP', [{ name: 'x', price: 1, total: 1 }]).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'quantity', 'unit', 'price', 'total']);
  });

  it('RI ยังไม่มีคอลัมน์เงิน', () => {
    const keys = columnsFor('STOCK_ISSUE_SLIP', [{ name: 'x', quantity: 2, unit: 'KG' }]).map((c) => c.key);
    expect(keys).toEqual(['no', 'name', 'quantity', 'unit']);
  });

  it('GR ยังใช้รหัสหน่วยจริง ไม่ใช่ id ของหน่วย', () => {
    expect(route).toContain("line.item.baseUnit?.code ?? '—'");
    expect(route).not.toContain('unit: line.item.baseUnitId');
  });

  it('Order ยังใช้ราคาที่บันทึกไว้ ไม่คำนวณใหม่', () => {
    const orderBranch = route.slice(route.indexOf("type === 'ORDER_SLIP'"), route.indexOf("type === 'GOODS_RECEIPT_SLIP'"));
    expect(orderBranch).toContain('line.unitPrice.toString()');
    expect(orderBranch).toContain('line.lineTotal.toString()');
    expect(orderBranch).toContain('menuNameSnapshot');
  });

  it('Excel export ยังส่ง content-type และชื่อไฟล์ที่ถูกต้อง', () => {
    expect(route).toContain('spreadsheetml.sheet');
    expect(route).toContain("contentDisposition('attachment'");
  });
});
