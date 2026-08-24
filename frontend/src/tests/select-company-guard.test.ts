import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PHASE 17 §14 — ปุ่ม "เพิ่มบริษัท" ต้องแสดงเฉพาะบทบาทที่ backend อนุญาตจริง
 *
 * backend (`POST /api/companies`) ตรวจ `req.user.roles.includes('SUPER_ADMIN')`
 * และเป็นผู้ตัดสินเสมอ — การซ่อนปุ่มไม่ใช่มาตรการความปลอดภัย แต่กันไม่ให้ผู้ใช้กดแล้วเจอ 403
 *
 * เทสต์นี้ตรึงเงื่อนไขไว้ให้ตรงกับ backend เพื่อไม่ให้หลุดกลับไปแสดงกับทุกคน
 */

const source = fs.readFileSync(path.resolve(__dirname, '../pages/SelectCompanyPage.tsx'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')   // ตัดคอมเมนต์ออกก่อน ไม่ให้ตัวอย่างในคอมเมนต์มาทำให้ผลเพี้ยน
  .replace(/^\s*\/\/.*$/gm, '');

describe('หน้าเลือกบริษัท: สิทธิ์สร้างบริษัท', () => {
  it('ปุ่มเพิ่มบริษัทถูกกั้นด้วยบทบาทเดียวกับที่ backend ตรวจ', () => {
    expect(source).toContain('add-company-button');
    const guarded = /user\.roles\.includes\('SUPER_ADMIN'\)\s*&&\s*<button className="add-company-button"/;
    expect(guarded.test(source), 'ปุ่มเพิ่มบริษัทต้องอยู่หลังการตรวจบทบาท SUPER_ADMIN').toBe(true);
  });

  it('ไม่มีปุ่มเพิ่มบริษัทตัวอื่นที่ไม่ได้ถูกกั้น', () => {
    const buttons = source.match(/<button className="add-company-button"/g) ?? [];
    expect(buttons).toHaveLength(1);
  });

  it('ยังมีข้อความสำหรับผู้ใช้ที่ไม่มีบริษัท (สถานะรออนุมัติ) อยู่', () => {
    // ผู้สมัครที่ยังรออนุมัติจะถูกส่งมาหน้านี้ ต้องเห็นข้อความ ไม่ใช่หน้าจอว่าง
    expect(source).toMatch(/companies\.length === 0 && <div className="company-empty">/);
  });
});
