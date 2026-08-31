import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { homeContent } from '@/i18n/home-content';
import { messages } from '@/i18n/i18n';

const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), 'src', rel), 'utf8');

/**
 * PHASE 41 — ส่วนท้ายหน้าสาธารณะ
 * เดิมมีแต่คอลัมน์ลิงก์ ไม่มีช่องทางติดต่อเลย
 */
describe('PHASE 41 — ข้อมูลติดต่อในส่วนท้าย', () => {
  it('มีเบอร์โทรครบสามเบอร์ เรียงตามลำดับที่กำหนด', () => {
    const people = homeContent.th.contact.people;
    expect(people.map(([who]) => who)).toEqual(['ออฟฟิศ', 'คุณผึ้ง', 'คุณวิน']);
    expect(people.map(([, tel]) => tel)).toEqual(['064-924-5544', '090-662-5464', '063-869-3614']);
  });

  it('ข้อมูลติดต่อเป็นข้อเท็จจริงเดียวกันทุกภาษา', () => {
    for (const locale of ['th', 'en', 'zh-CN'] as const) {
      expect(homeContent[locale].contact.people, locale).toEqual(homeContent.th.contact.people);
      expect(homeContent[locale].contact.line, locale).toBe('@s2a.customer');
      expect(homeContent[locale].contact.website, locale).toBe('www.s2aconsultant.com');
    }
  });

  it('ที่อยู่สำนักงานตรงตามที่ระบุ', () => {
    expect(homeContent.th.contact.address).toEqual([
      '14/14 ตรอกวัดเชิงหวาย',
      'ซอยกรุงเทพ-นนท์บางซื่อ 21',
      'เขตบางซื่อ แขวงบางซื่อ',
      'กรุงเทพมหานคร 10800',
    ]);
  });

  it('เบอร์โทรเป็นการ์ดที่กดได้ทั้งแถว ไม่ใช่ข้อความเรียงต่อกันในบรรทัดเดียว', () => {
    const page = read('pages/HomePage.tsx');
    // PHASE 44 — เปลี่ยนจากข้อความสองบรรทัดลอย ๆ เป็นแถวที่กดโทรออกได้ทั้งแถว
    expect(page).toContain('hp-contact-item');
    expect(page).toContain('hp-contact-label');
    expect(page).toContain('hp-contact-value');
    const css = read('pages/home.css');
    // ป้ายกำกับกับตัวเลขซ้อนกันแนวตั้งภายในการ์ด
    expect(css).toMatch(/\.hp-contact-body \{[^}]*flex-direction: column/);
    // ตัวเลขต้องเด่นกว่าป้ายกำกับ
    const label = /\.hp-contact-label \{[^}]*font-size: ([\d.]+)px/.exec(css)?.[1];
    const value = /\.hp-contact-value \{[\s\S]*?font-size: ([\d.]+)px/.exec(css)?.[1];
    expect(Number(value)).toBeGreaterThan(Number(label));
  });

  it('เบอร์โทรกดโทรออกได้', () => {
    expect(read('pages/HomePage.tsx')).toContain("href={`tel:${tel.replace(/-/g, '')}`}");
  });

  it('ส่วนท้ายเป็น 4 คอลัมน์บนเดสก์ท็อป และยุบลงบนจอแคบ', () => {
    const css = read('pages/home.css');
    expect(css).toMatch(/\.hp-footer-grid \{[^}]*grid-template-columns: 1\.4fr 1fr 1\.1fr 1\.2fr/);
    expect(css).toMatch(/@media \(max-width: 1080px\)[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
    expect(css).toMatch(/@media \(max-width: 640px\)[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  });

  it('ไม่สร้างลิงก์นโยบายความเป็นส่วนตัวเพราะยังไม่มี route จริง', () => {
    const app = read('App.tsx');
    const page = read('pages/HomePage.tsx');
    expect(app).not.toContain('path="/privacy"');
    expect(page).not.toContain('/privacy');
  });

  it('เมนู "ติดต่อเรา" มีครบทุกภาษาและชี้ไปยัง anchor ที่มีจริง', () => {
    for (const locale of ['th', 'en', 'zh-CN'] as const) {
      expect(messages[locale].home.nav, locale).toHaveLength(5);
    }
    const page = read('pages/HomePage.tsx');
    expect(page).toContain("{ id: 'contact' }");
    expect(page).toContain('id="contact"');
  });
});

/* ============================================================
   PHASE 42 — ป๊อปอัป LINE + เนื้อหาหน้าเข้าสู่ระบบ
   ============================================================ */
describe('PHASE 42 — ป๊อปอัป QR ของ LINE', () => {
  const modal = read('components/public/LineContactModal.tsx');
  const page = read('pages/HomePage.tsx');

  it('LINE ในส่วนท้ายเป็นปุ่มที่เปิดป๊อปอัปได้จริง ไม่ใช่ข้อความเฉย ๆ', () => {
    expect(page).toContain('onClick={() => setLineOpen(true)}');
    expect(page).toContain('aria-haspopup="dialog"');
    expect(page).toContain('LineContactModal');
  });

  it('ป๊อปอัปมี semantics ของ dialog ครบ', () => {
    expect(modal).toContain('role="dialog"');
    expect(modal).toContain('aria-modal="true"');
    expect(modal).toContain('aria-labelledby="line-modal-title"');
  });

  it('ปิดด้วย Escape ได้ และคืนโฟกัสให้ปุ่มเดิม', () => {
    expect(modal).toContain("event.key === 'Escape'");
    expect(modal).toContain('openerRef.current as HTMLElement | null)?.focus?.()');
  });

  it('ใช้ลิงก์เพิ่มเพื่อนอย่างเป็นทางการของ LINE ไม่ได้ปลอม QR ขึ้นมาเอง', () => {
    expect(modal).toContain('https://line.me/R/ti/p/');
    expect(modal).toContain('@s2a.customer');
    // ถ้าไม่มีไฟล์ QR ต้องมีทางสำรองที่ใช้งานได้ ไม่ใช่รูปเสีย
    expect(modal).toContain('onError');
    expect(modal).toContain('line-qr-fallback');
  });
});

describe('PHASE 42 — เนื้อหาหน้าเข้าสู่ระบบ', () => {
  const login = read('components/auth/LoginExperience.tsx');

  it('แผงซ้ายมีพาดหัว คำอธิบาย และการ์ดความสามารถ 2x2', () => {
    expect(login).toContain('auth.loginHeadline');
    expect(login).toContain('auth.loginLead');
    // PHASE 44 — เปลี่ยนจากรายการหัวข้อย่อยแนวตั้ง เป็นการ์ด 2x2
    expect(login).toContain('auth.loginTiles');
    expect(messages.th.auth.loginTiles).toHaveLength(4);
    for (const [title, description] of messages.th.auth.loginTiles) {
      expect(title.length, title).toBeGreaterThan(0);
      expect(description.length, description).toBeGreaterThan(0);
    }
  });

  it('มีป้ายโมดูลและประโยคปิดเป็นตัวรอง', () => {
    expect(login).toContain('auth.loginTags');
    expect(login).toContain('auth.loginCaption');
    expect(messages.th.auth.loginTags).toEqual(['Food Cost', 'Inventory', 'Purchasing', 'Production', 'Analytics']);
  });

  it('ฟอร์มมีหัวข้อรอง คำอธิบาย และหมายเหตุความปลอดภัย', () => {
    expect(login).toContain('auth.formEyebrow');
    expect(login).toContain('auth.formLead');
    expect(login).toContain('auth.formNote');
  });

  it('ยังคงฟังก์ชันเดิมของการเข้าสู่ระบบครบ', () => {
    for (const kept of ['s2a_remembered_username', 'auth.remember', '/forgot-password', '/register', 'LanguageSwitcher', 'PasswordField']) {
      expect(login, kept).toContain(kept);
    }
  });

  it('จอเตี้ยบีบเนื้อหาแทนที่จะปล่อยให้หน้าเลื่อน', () => {
    const css = read('styles/auth.css');
    expect(css).toContain('@media (max-height: 820px)');
    expect(css).toContain('@media (min-height: 821px) and (max-height: 960px)');
  });
});

/* ============================================================
   PHASE 43 — QR จริง + แถบคุณค่า
   ============================================================ */
describe('PHASE 43 — ไฟล์ QR จริง', () => {
  const qrPath = path.join(process.cwd(), 'public', 'line-qr.png');

  it('มีไฟล์ QR อยู่ใน public asset จริง', () => {
    expect(fs.existsSync(qrPath)).toBe(true);
  });

  it('เป็นไฟล์ PNG ที่ใช้ได้จริง ไม่ใช่ไฟล์ว่างหรือ placeholder', () => {
    const buffer = fs.readFileSync(qrPath);
    expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a'); // PNG magic
    expect(buffer.length).toBeGreaterThan(10_000);
  });

  it('เป็นภาพสี่เหลี่ยมจัตุรัส ความละเอียดพอสำหรับสแกน', () => {
    const buffer = fs.readFileSync(qrPath);
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    expect(width).toBe(height);
    expect(width).toBeGreaterThanOrEqual(300);
  });

  it('โมดัลชี้ไปที่ไฟล์นั้น และไม่มีฟิลเตอร์/ครอบทับ QR', () => {
    const modal = read('components/public/LineContactModal.tsx');
    expect(modal).toContain("const QR_SRC = '/line-qr.png'");
    const css = read('pages/home.css');
    const rule = /\.line-modal-qr img \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).not.toMatch(/filter:\s*(?!none)/);
    expect(css).toMatch(/\.line-modal-qr \{[\s\S]*?width: 244px/);
  });
});

describe('PHASE 43 — แถบคุณค่าใต้ hero', () => {
  it('มีสี่บล็อกครบทุกภาษา', () => {
    for (const locale of ['th', 'en', 'zh-CN'] as const) {
      expect(homeContent[locale].valueStrip, locale).toHaveLength(4);
    }
  });

  it('ถูกวางไว้ก่อนส่วนฟีเจอร์ และเป็นแถบเตี้ย ไม่ใช่การ์ดใหญ่', () => {
    const page = read('pages/HomePage.tsx');
    expect(page.indexOf('hp-value-strip')).toBeLessThan(page.indexOf('id="features"'));
    const css = read('pages/home.css');
    expect(css).toMatch(/\.hp-value-strip ul \{[\s\S]*?grid-template-columns: repeat\(4/);
  });
});
