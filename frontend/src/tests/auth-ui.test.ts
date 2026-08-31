import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PHASE 38 — ยามของหน้ากลุ่มเข้าสู่ระบบ/บัญชี
 * กันไม่ให้กลับไปมีหน้าเข้าสู่ระบบหรือหน้าเปลี่ยนรหัสผ่านซ้อนกันสองชุดอีก
 * และกันสไตล์เก่าที่ถูกลบไปแล้วกลับเข้ามา
 */

const SRC = path.resolve(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (!/tests/.test(full)) walk(full, out); }
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

describe('PHASE 38 — ไม่มีหน้า auth ซ้อนกันสองชุด', () => {
  it('ไม่มี export ชื่อ Legacy* หลงเหลือในโค้ด', () => {
    const offenders = walk(SRC)
      .filter((file) => /export function Legacy/.test(fs.readFileSync(file, 'utf8')))
      .map((file) => path.relative(SRC, file).split(path.sep).join('/'));
    expect(offenders).toEqual([]);
  });

  it('route ของ /login และ /change-password ชี้ไปที่ implementation ชุดเดียว', () => {
    expect(read('pages/LoginPage.tsx')).toContain('LoginExperience');
    expect(read('pages/ChangePasswordPage.tsx')).toContain('PasswordExperience');
  });

  it('คลาสของหน้า auth เก่าถูกลบออกจาก CSS แล้ว', () => {
    const css = read('index.css');
    for (const dead of ['.auth-page', '.auth-story', '.auth-panel', '.input-wrap', '.center-page']) {
      expect(css.includes(`${dead}{`) || css.includes(`${dead} {`), dead).toBe(false);
    }
  });
});

describe('PHASE 38 — คอมโพเนนต์กลางของ auth', () => {
  const shell = read('components/auth/AuthShell.tsx');

  it('ผูก label กับช่องกรอกด้วย id จริง ไม่ใช่ห่อเฉย ๆ', () => {
    expect(shell).toContain('useId()');
    expect(shell).toContain('htmlFor={id}');
  });

  it('ส่ง aria-describedby ของคำอธิบาย/ข้อความผิดพลาดให้ช่องกรอก', () => {
    expect(shell).toContain('aria-describedby={describedBy}');
    expect(shell).toContain('aria-invalid');
  });

  it('ข้อความผิดพลาดประกาศด้วย role=alert', () => {
    expect(shell).toContain('role="alert"');
  });

  it('ปุ่มแสดง/ซ่อนรหัสผ่านมีชื่อสำหรับโปรแกรมอ่านหน้าจอ', () => {
    expect(shell).toContain('aria-label={visible ? hideLabel : showLabel}');
  });

  it('ทุกหน้าในกลุ่มใช้ AuthShell ชุดเดียวกัน', () => {
    for (const page of ['components/auth/LoginExperience.tsx', 'components/auth/PasswordExperience.tsx', 'pages/PasswordRecoveryPages.tsx']) {
      expect(read(page), page).toContain('AuthShell');
    }
  });
});

describe('PHASE 38 — สไตล์ auth', () => {
  const css = read('styles/auth.css');

  it('ช่องกรอกสูง 48px ตามสเปก 44–48px', () => {
    expect(/\.auth2-control \{[^}]*height: 48px/.test(css)).toBe(true);
  });

  it('เคารพการตั้งค่าลดการเคลื่อนไหว', () => {
    expect(css).toContain('prefers-reduced-motion: no-preference');
  });

  it('ไม่ประกาศ theme token ใหม่ในไฟล์นี้ (source เดียวคือ tokens.css)', () => {
    expect(/:root\s*\{/.test(css)).toBe(false);
  });
});
