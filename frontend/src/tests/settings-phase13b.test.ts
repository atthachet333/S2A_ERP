import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * PHASE 13B — ปุ่ม PDF ของใบปรับปรุงสต็อก และหน้าตั้งค่าเอกสารบริษัท
 */

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');
/** ตัดคอมเมนต์ทิ้งก่อนตรวจ เพราะคอมเมนต์อธิบายบั๊กมักมีข้อความที่ถูก assert */
const code = (rel: string) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

const inventory = read('pages/InventoryPages.tsx');
const inventoryCode = code('pages/InventoryPages.tsx');
const settings = read('pages/CompanySettingsPage.tsx');
const settingsCode = code('pages/CompanySettingsPage.tsx');
const css = read('styles/consistency.css');

/* ============================================================
   §2 ปุ่ม PDF ของใบปรับปรุงสต็อก
   ============================================================ */
describe('PHASE 13B — ปุ่ม PDF ใบปรับปรุงสต็อก', () => {
  it('มีปุ่ม PDF ในตารางประวัติ', () => {
    expect(inventory).toContain('downloadAdjustmentPdf');
    expect(inventory).toContain('ดาวน์โหลด PDF');
  });

  it('ใช้ id ของแถวที่กด ไม่ใช่ใบล่าสุดจาก state อื่น', () => {
    const fn = inventoryCode.slice(inventoryCode.indexOf('const downloadAdjustmentPdf'), inventoryCode.indexOf('const printHistoryRow'));
    expect(fn).toContain('${row.id}.pdf');
    expect(fn).not.toContain('printDoc');
    expect(fn).not.toContain('historyDoc');
    // ปุ่มต้องส่ง h (แถวนั้น) เข้าไปตรง ๆ
    expect(inventory).toContain('onClick={() => void downloadAdjustmentPdf(h)}');
  });

  it('ตรวจว่าเป็น PDF จริงและตั้งชื่อไฟล์ AJ-<เลขที่>', () => {
    const fn = inventoryCode.slice(inventoryCode.indexOf('const downloadAdjustmentPdf'), inventoryCode.indexOf('const printHistoryRow'));
    expect(fn).toContain("expect: 'pdf'");
    expect(fn).toContain('fallbackName: `AJ-${row.adjustmentNo}.pdf`');
  });

  it('ยิงผ่าน apiClient ไม่ใช่ path สัมพัทธ์', () => {
    expect(inventoryCode).toContain('apiClient.download(');
    expect(inventoryCode).not.toMatch(/fetch\(\s*[`'"]\/api\//);
  });

  it('ปุ่มพิมพ์รายแถวแบบเดิมยังอยู่ ไม่ถูกแทนที่', () => {
    expect(inventory).toContain('printHistoryRow(h)');
  });
});

/* ============================================================
   §4 §6 §7 หน้าตั้งค่าเอกสาร
   ============================================================ */
describe('PHASE 13B — ตั้งค่าข้อมูลบนเอกสาร', () => {
  it('มีครบทุกกลุ่มตามที่กำหนด', () => {
    for (const heading of ['ข้อมูลบริษัท', 'ข้อมูลติดต่อ', 'ข้อมูลเอกสาร', 'โลโก้บริษัท', 'ตัวอย่างหัวเอกสาร']) {
      expect(settings, `ขาดหัวข้อ ${heading}`).toContain(heading);
    }
  });

  it('แก้ไขได้ครบทุก field ที่ API รับ', () => {
    for (const f of ['nameTh', 'nameEn', 'taxId', 'address', 'phone', 'email', 'website', 'authorizedName', 'documentFooter', 'logoUrl']) {
      expect(settingsCode, `ขาด field ${f}`).toContain(f);
    }
  });

  it('ช่องว่างถูกส่งเป็น null เพื่อให้เอกสารไม่แสดงบรรทัดนั้น', () => {
    expect(settingsCode).toContain("const orNull = (v: string) => (v.trim() === '' ? null : v.trim());");
    expect(settingsCode).toContain('nameEn: orNull(form.nameEn)');
    expect(settingsCode).toContain('logoUrl: orNull(form.logoUrl)');
  });

  it('ไม่ hardcode ข้อมูลบริษัทใด ๆ ไว้ในหน้า', () => {
    expect(settingsCode).not.toContain('krua-suesoddee');
    expect(settingsCode).not.toContain('ซื่อสดดี');
    expect(settingsCode).not.toContain('ครัวสดดี');
    // อักษรย่อสำรองต้องมาจากชื่อบริษัทจริง ไม่ใช่ค่าคงที่
    expect(settingsCode).not.toMatch(/<strong>KS<\/strong>/);
    expect(settingsCode).toContain('const initials =');
  });

  it('อัปโหลดโลโก้ผ่าน helper กลาง (ได้ BASE_URL ของ API)', () => {
    expect(settingsCode).toContain("uploadImage('company', file)");
    expect(settingsCode).toContain("from '@/lib/catalog'");
    expect(settingsCode).not.toMatch(/fetch\(\s*[`'"]\/api\//);
  });

  it('รับเฉพาะ PNG/JPG ให้ตรงกับที่ backend และ PDF รองรับ', () => {
    expect(settings).toContain('accept="image/png,image/jpeg"');
  });

  it('มีพรีวิวรูปก่อนอัปโหลด และคืนหน่วยความจำ object URL', () => {
    expect(settingsCode).toContain('URL.createObjectURL(file)');
    expect(settingsCode).toContain('URL.revokeObjectURL');
  });

  it('ลบโลโก้ได้ และรูปที่เปิดไม่ได้จะถอยไปใช้อักษรย่อ', () => {
    expect(settings).toContain('ลบโลโก้');
    expect(settingsCode).toContain('onError={() => setLogoFailed(true)}');
  });

  it('ตัวอย่างเอกสารซ่อนบรรทัดที่ยังไม่ได้กรอก', () => {
    const preview = settingsCode.slice(settingsCode.indexOf('doc-preview-identity'), settingsCode.indexOf('doc-preview-foot'));
    for (const f of ['form.nameEn &&', 'form.address &&', 'form.phone &&', 'form.email &&', 'form.website &&', 'form.taxId &&']) {
      expect(preview, `ตัวอย่างต้องซ่อนเมื่อ ${f} ว่าง`).toContain(f);
    }
  });

  it('ตัวอย่างสร้างจาก form state ไม่ต้องเรียก API สร้าง PDF', () => {
    const preview = settingsCode.slice(settingsCode.indexOf('ตัวอย่างหัวเอกสาร'));
    expect(preview).not.toContain('apiClient');
    expect(preview).not.toContain('.pdf');
  });

  it('มีสไตล์รองรับและ responsive บนจอแคบ', () => {
    expect(css).toContain('.logo-manager');
    expect(css).toContain('.doc-preview');
    const mq = css.slice(css.lastIndexOf('@media (max-width: 760px)'));
    expect(mq).toContain('.logo-manager');
    expect(mq).toContain('.doc-preview-head');
  });

  it('ปุ่มบันทึกเปิดเฉพาะเมื่อมีการแก้จริง', () => {
    expect(settingsCode).toContain('disabled={busy || !dirty}');
    expect(settingsCode).toContain('JSON.stringify(form) !== JSON.stringify(toForm(company))');
  });
});
