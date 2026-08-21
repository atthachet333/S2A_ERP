import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  auditActionLabel, auditEntityLabel, hasPermissionChanges, labelFor, permissionDiff,
  registrationBadge, registrationStatusLabel, roleLabel, sortGroups, userStatus,
} from '@/lib/admin-vocab';

/** PHASE 9 — ADMIN / USERS / PERMISSIONS / LOGS */

describe('PART 4 — สถานะผู้ใช้', () => {
  it('1 ประกอบจาก field จริง (schema ไม่มี enum status เดียว)', () => {
    expect(userStatus({ isActive: true })).toEqual({ label: 'ใช้งานอยู่', tone: 'success' });
    expect(userStatus({ isActive: false })).toEqual({ label: 'ปิดใช้งาน', tone: 'muted' });
  });

  it('2 คำขอที่ยังรออนุมัติมาก่อนสถานะ active', () => {
    expect(userStatus({ isActive: true, registrationStatus: 'PENDING' }).label).toBe('รออนุมัติ');
    expect(userStatus({ isActive: false, registrationStatus: 'REJECTED' }).label).toBe('ถูกปฏิเสธ');
  });

  it('3 ทุกสถานะมีทั้งข้อความและโทนสี ไม่สื่อด้วยสีอย่างเดียว', () => {
    for (const u of [{ isActive: true }, { isActive: false }, { isActive: true, registrationStatus: 'PENDING' }]) {
      const s = userStatus(u);
      expect(s.label.length).toBeGreaterThan(0);
      expect(['success', 'muted', 'warning', 'danger']).toContain(s.tone);
    }
  });
});

describe('PART 7 — สถานะคำขอลงทะเบียน', () => {
  it('4 แปลค่าที่ backend ใช้จริง', () => {
    expect(registrationStatusLabel('PENDING')).toBe('รออนุมัติ');
    expect(registrationStatusLabel('APPROVED')).toBe('อนุมัติแล้ว');
    expect(registrationStatusLabel('REJECTED')).toBe('ปฏิเสธแล้ว');
  });

  it('5 ค่าที่ไม่รู้จักคืนค่าดิบ ไม่เดา', () => {
    expect(registrationStatusLabel('SOMETHING')).toBe('SOMETHING');
    expect(registrationStatusLabel(null)).toBe('—');
    expect(registrationBadge('SOMETHING')).toBe('muted');
  });
});

describe('PART 15 — แปลเหตุการณ์ให้อ่านรู้เรื่อง', () => {
  it('6 แปล action ที่ระบบเขียนลง AuditLog จริง', () => {
    expect(auditActionLabel('ROLE_PERMISSIONS_UPDATED')).toBe('แก้ไขสิทธิ์ของบทบาท');
    expect(auditActionLabel('LOGIN_SUCCESS')).toBe('เข้าสู่ระบบสำเร็จ');
    expect(auditActionLabel('LOGIN_FAILED')).toBe('เข้าสู่ระบบไม่สำเร็จ');
    expect(auditActionLabel('STATUS_CHANGE')).toBe('เปลี่ยนสถานะ');
    expect(auditActionLabel('REGISTRATION_APPROVED')).toBe('อนุมัติคำขอสมัคร');
  });

  it('7 เหตุการณ์ที่ไม่รู้จักแสดงค่าดิบ — ห้ามเดาเรื่องความปลอดภัย', () => {
    expect(auditActionLabel('SOME_NEW_EVENT')).toBe('SOME_NEW_EVENT');
    expect(auditActionLabel(null)).toBe('—');
    expect(auditEntityLabel('WeirdEntity')).toBe('WeirdEntity');
  });

  it('8 แปลชนิด entity ที่พบจริง', () => {
    expect(auditEntityLabel('SalesOrder')).toBe('ออเดอร์');
    expect(auditEntityLabel('Role')).toBe('บทบาท');
    expect(auditEntityLabel('Auth')).toBe('การเข้าสู่ระบบ');
  });
});

describe('PART 9–12 — สิทธิ์', () => {
  it('9 แปลชื่อบทบาทจาก enum RoleName จริง', () => {
    expect(roleLabel('SUPER_ADMIN')).toBe('ผู้ดูแลระบบสูงสุด');
    expect(roleLabel('OPERATIONS')).toBe('ปฏิบัติการ');
    expect(roleLabel('WEIRD_ROLE')).toBe('WEIRD_ROLE');
    expect(roleLabel(null)).toBe('—');
  });

  it('10 เรียงกลุ่มตามลำดับงาน กลุ่มแปลกไปท้ายสุด', () => {
    const sorted = sortGroups(['Other', 'Users', 'Dashboard', 'ZZZ']);
    expect(sorted[0]).toBe('Dashboard');
    expect(sorted.indexOf('Users')).toBeLessThan(sorted.indexOf('Other'));
    expect(sorted[sorted.length - 1]).toBe('ZZZ');
  });

  it('11 ป้ายสิทธิ์เป็นภาษาที่เลือก และมีที่มาเดียว', () => {
    expect(labelFor('INVENTORY_VIEW', 'Stock', 'th')).toContain('ดู');
    expect(labelFor('PERMISSION_MANAGE', 'Permissions', 'th')).toBe('จัดการสิทธิ์');
    expect(labelFor('PERMISSION_MANAGE', 'Permissions', 'en')).toBe('Manage permissions');
  });

  it('12 ส่วนต่างของสิทธิ์คำนวณถูกต้อง', () => {
    const d = permissionDiff(['A', 'B', 'C'], ['B', 'C', 'D']);
    expect(d.added).toEqual(['D']);
    expect(d.removed).toEqual(['A']);
    expect(d.unchanged).toBe(2);
    expect(hasPermissionChanges(d)).toBe(true);
  });

  it('13 ไม่มีอะไรเปลี่ยน → ไม่ต้องเตือน', () => {
    const d = permissionDiff(['A', 'B'], ['B', 'A']);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
    expect(hasPermissionChanges(d)).toBe(false);
  });

  it('14 จากไม่มีสิทธิ์เลย → เพิ่มทั้งหมด', () => {
    const d = permissionDiff([], ['A', 'B']);
    expect(d.added).toEqual(['A', 'B']);
    expect(d.unchanged).toBe(0);
  });
});

/* ---------- โครงหน้า ---------- */
const FE = path.resolve(__dirname, '..');
const BE = path.resolve(__dirname, '../../../backend');
const read = (base: string, p: string) => fs.readFileSync(path.join(base, p), 'utf8');

const users = read(FE, 'pages/UsersPage.tsx');
const perms = read(FE, 'pages/AdminPermissionsPage.tsx');
const activity = read(FE, 'pages/ActivityPage.tsx');
const regs = read(FE, 'pages/RegistrationsPage.tsx');
const profile = read(FE, 'pages/ProfilePage.tsx');
const vocab = read(FE, 'lib/admin-vocab.ts');
const nav = read(FE, 'components/layout/nav-config.ts');
const css = read(FE, 'styles/admin.css');
const adminRoute = read(BE, 'src/modules/admin/admin.route.ts');
const activityRoute = read(BE, 'src/modules/activity/activity.route.ts');
const schema = read(BE, 'prisma/schema.prisma');

describe('PART 2–3 — โครงหน้าและเมนู', () => {
  it('15 ทุกหน้า admin ใช้ primitive กลาง', () => {
    for (const [name, src] of [['users', users], ['perms', perms], ['activity', activity], ['regs', regs], ['profile', profile]] as const) {
      expect(src, name).toContain('<PageContainer');
      expect(src, name).toContain('<PageHeader');
    }
    for (const src of [users, activity, regs]) {
      expect(src).toContain('<FilterBar');
      expect(src).toContain('<KPIGrid');
    }
  });

  it('16 ไม่เหลือ inline style ในหน้า admin', () => {
    for (const [name, src] of [['users', users], ['perms', perms], ['activity', activity], ['regs', regs], ['profile', profile]] as const) {
      expect(src.match(/style=\{\{/g)?.length ?? 0, name).toBe(0);
    }
  });

  it('17 เมนูแบ่งสามกลุ่มตามงานจริง', () => {
    for (const g of ['การจัดการผู้ใช้', 'สิทธิ์และความปลอดภัย', 'การตรวจสอบระบบ']) {
      expect(nav, g).toContain(g);
    }
  });

  it('18 สิทธิ์ของเมนูตรงกับที่ endpoint ยอมให้เข้า จึงไม่กดแล้วเจอ 403', () => {
    expect(nav).toContain("requiredAnyPermission: ['USER_VIEW', 'USER_MANAGE']");
    expect(nav).toContain("requiredAnyPermission: ['ROLE_MANAGE', 'PERMISSION_MANAGE', 'USER_MANAGE']");
    // /activity เป็น SUPER_ADMIN เท่านั้นตาม backend
    expect(activityRoute).toContain("!req.user.roles.includes('SUPER_ADMIN')");
    expect(nav).toContain("{ path: '/activity', label: 'ประวัติการใช้งาน', icon: History, requiredRole: 'SUPER_ADMIN' }");
  });
});

describe('PART 13 — ความปลอดภัยของสิทธิ์', () => {
  it('19 backend ยังเป็นผู้บังคับสิทธิ์ — หน้าเว็บไม่ใช่ source of truth', () => {
    expect(adminRoute).toContain("const PERM_MANAGE = requirePermission('PERMISSION_MANAGE')");
    expect(adminRoute).toContain("app.put('/roles/:roleName/permissions', { preHandler: PERM_MANAGE }");
  });

  it('20 SUPER_ADMIN แก้สิทธิ์ไม่ได้ (กันล็อกตัวเองออกทั้งระบบ)', () => {
    expect(adminRoute).toContain('ROLE_LOCKED');
    expect(adminRoute).toContain('roleName === RoleName.SUPER_ADMIN');
    expect(perms).toContain('locked.has(selectedRole)');
    expect(perms).toContain('มีสิทธิ์ทั้งหมดโดยระบบ');
  });

  it('21 backend รับเฉพาะ permission code ที่มีจริง', () => {
    expect(adminRoute).toContain('prisma.permission.findMany({ where: { code: { in: permissions } }');
  });

  it('22 อนุมัติสมัครมอบบทบาทผู้ดูแลระบบไม่ได้', () => {
    expect(adminRoute).toContain('ROLE_NOT_ALLOWED');
    expect(adminRoute).toContain('role === RoleName.SUPER_ADMIN || role === RoleName.ADMIN');
    expect(regs).toContain('ระบบไม่อนุญาตให้มอบบทบาทผู้ดูแลระบบผ่านการอนุมัติสมัคร');
  });

  it('23 หน้าเว็บไม่ตัดสินสิทธิ์เอง — แค่ซ่อนปุ่มตามสิทธิ์', () => {
    expect(perms).toContain("user?.permissions.includes('PERMISSION_MANAGE')");
    expect(perms).toContain('disabled={!canManage}');
  });
});

describe('PART 10–12 — การ์ดสิทธิ์รายโมดูล', () => {
  it('24 เลิกใช้ตาราง matrix กว้าง เปลี่ยนเป็นเลือกบทบาท + การ์ดโมดูล', () => {
    expect(perms).toContain('perm-layout');
    expect(perms).toContain('perm-roles');
    expect(perms).toContain('setSelectedRole');
    expect(perms).not.toContain('<Fragment>');
  });

  it('25 แสดงทั้งชื่อไทยและโค้ดจริง เพื่อให้ตรวจสอบย้อนหลังได้', () => {
    expect(perms).toContain('labelFor(p.code, p.group, locale)');
    expect(perms).toContain('<code>{p.code}</code>');
  });

  it('26 มีค้นหา เลือกทั้งกลุ่ม และแสดงเฉพาะที่เลือก', () => {
    expect(perms).toContain('ค้นหาสิทธิ์จากชื่อหรือโค้ด');
    expect(perms).toContain('toggleGroup(codes, !allOn)');
    expect(perms).toContain('แสดงเฉพาะที่เลือก');
  });

  it('27 บอกว่ามีอะไรเปลี่ยนก่อนบันทึก และยืนยันด้วย ConfirmDialog', () => {
    expect(perms).toContain('perm-changed');
    expect(perms).toContain('<ConfirmDialog');
    expect(perms).toContain('diff.added.length');
    expect(perms).toContain('diff.removed.length');
  });

  it('28 ปุ่มบันทึกกดไม่ได้ถ้าไม่มีอะไรเปลี่ยน', () => {
    expect(perms).toContain('disabled={!changed || isLocked || saving}');
  });

  it('29 checkbox แตะได้บนจอเล็ก', () => {
    expect(css).toMatch(/@media \(max-width: 1024px\)[\s\S]*?\.perm-item input \{ width: 22px; height: 22px; \}/);
  });
});

describe('PART 22 — การกระทำที่กระทบการเข้าถึง', () => {
  it('30 เลิกใช้ window.confirm ในหน้าผู้ใช้แล้ว', () => {
    // นับเฉพาะการเรียกจริง คอมเมนต์ที่อ้างถึงของเดิมไม่นับ
    expect(users).not.toContain('window.confirm(');
    expect(users.match(/<ConfirmDialog/g)?.length).toBe(2);
  });

  it('31 บอกผลกระทบก่อนปิดบัญชีและรีเซ็ตรหัสผ่าน', () => {
    expect(users).toContain('ผู้ใช้นี้จะเข้าสู่ระบบไม่ได้ทันที');
    expect(users).toContain('เซสชันที่ใช้งานอยู่จะถูกยกเลิกทั้งหมด');
    expect(users).toContain('ประวัติการทำงานทั้งหมดยังถูกเก็บไว้ครบ');
  });

  it('32 ไม่มีปุ่มลบผู้ใช้ถาวร', () => {
    expect(users).not.toContain('apiClient.delete');
    expect(users).not.toContain('ลบผู้ใช้');
  });

  it('33 ปฏิเสธคำขอไม่ลบบัญชี', () => {
    expect(adminRoute).toContain("registrationStatus: 'REJECTED'");
    expect(adminRoute).not.toContain('prisma.user.delete');
    expect(regs).toContain('ระบบไม่ลบบัญชีทิ้ง');
  });
});

describe('PART 14–18 — บันทึกเหตุการณ์', () => {
  it('34 แยกดูเฉพาะ audit หรือ login ได้ (endpoint คืนรวมกันมา)', () => {
    expect(activity).toContain("tab !== 'ALL' && e.type !== tab");
    expect(activity).toContain('การเปลี่ยนแปลงข้อมูล');
    expect(activity).toContain('การเข้าสู่ระบบ');
  });

  it('35 บอกตรง ๆ ว่าตัวกรองครอบคลุมแค่หน้าที่โหลดมา', () => {
    expect(activity).toContain('ที่โหลดมาในหน้านี้เท่านั้น');
  });

  it('36 ไม่สร้างคอลัมน์ที่ backend ไม่ได้ส่งมา', () => {
    // LoginLog ไม่มีคอลัมน์เหตุผลที่ล้มเหลว และ /activity ไม่ส่ง userAgent
    const loginBlock = schema.slice(schema.indexOf('model LoginLog'), schema.indexOf('model LoginLog') + 400);
    expect(loginBlock).not.toContain('failureReason');
    expect(activityRoute).not.toContain('userAgent');
    // ตรวจที่หัวตารางจริง ไม่ใช่ข้อความในคอมเมนต์ที่อธิบายว่าทำไมถึงไม่มี
    const head = activity.slice(activity.indexOf('<thead>'), activity.indexOf('</thead>'));
    expect(head).not.toContain('อุปกรณ์');
    expect(head).not.toContain('เหตุผล');
    expect(head).not.toContain('User Agent');
  });

  it('37 ใช้ค้นหาแบบหน่วงเวลา ไม่กรองใหม่ทุกตัวอักษร', () => {
    expect(activity).toContain('setTimeout(() => setDebounced(keyword), 300)');
  });

  it('38 ใช้ server pagination ที่ backend มีอยู่แล้ว', () => {
    expect(activity).toContain('useActivity(page, PAGE_SIZE, isAdmin)');
    expect(activityRoute).toContain('paginate(merged.slice(start, start + pageSize)');
  });

  it('39 ผลลัพธ์แสดงทั้งไอคอนและข้อความ', () => {
    expect(activity).toContain('>สำเร็จ<');
    expect(activity).toContain('>ไม่สำเร็จ<');
  });
});

describe('PART 19 — เชื่อมโยงระหว่างหน้า', () => {
  it('40 จากผู้ใช้ → ประวัติการใช้งาน', () => {
    expect(users).toContain('/activity?user=');
  });

  it('41 จากบันทึกเหตุการณ์ → ผู้ใช้', () => {
    expect(activity).toContain('/users?search=');
  });

  it('42 จากบทบาท → ผู้ใช้ในบทบาทนั้น และหน้าผู้ใช้รับ query จริง', () => {
    expect(perms).toContain('/users?role=');
    expect(users).toContain("params.get('role')");
  });
});

describe('PART 25–26 — dark mode / a11y', () => {
  it('43 CSS ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('44 breakpoint ตรงมาตรฐานระบบ', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.length).toBeGreaterThan(0);
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('45 ตัวเลือกบทบาทและแท็บใช้คีย์บอร์ดได้', () => {
    expect(perms).toContain('aria-current={selectedRole === r.name}');
    expect(activity).toContain('role="radiogroup" aria-label="ประเภทเหตุการณ์"');
    expect(regs).toContain('role="radiogroup" aria-label="สถานะคำขอ"');
  });

  it('46 ปุ่มไอคอนและช่องกรอกมี label', () => {
    expect(users).toContain('aria-label={`ดูข้อมูล ${row.fullName}`}');
    expect(users).toContain('aria-label="ค้นหาผู้ใช้งาน"');
    expect(activity).toContain('aria-label="ค้นหาเหตุการณ์"');
  });

  it('47 ตารางมี data-label ครบเพื่อกลายเป็นการ์ดบนมือถือ', () => {
    for (const c of ['ชื่อ', 'บทบาท', 'สถานะ']) expect(users, c).toContain(`data-label="${c}"`);
    for (const c of ['เวลา', 'ผู้ใช้', 'เหตุการณ์', 'ผลลัพธ์', 'IP']) expect(activity, c).toContain(`data-label="${c}"`);
  });
});

describe('PART 1 — ไม่สร้างสิ่งที่ backend ไม่มี', () => {
  it('48 ไม่มี KPI เซสชันที่ใช้งานอยู่ (schema ไม่มีตาราง Session)', () => {
    expect(schema).not.toContain('model Session');
    // ต้องไม่มี KPICard เรื่องเซสชัน (ข้อความ toast ที่อธิบายผลจริงของ backend ไม่นับ)
    const kpiBlock = users.slice(users.indexOf('<KPIGrid'), users.indexOf('</KPIGrid>'));
    expect(kpiBlock).not.toContain('เซสชัน');
    expect(users).not.toContain('revoke-sessions');
    expect(users).not.toContain('apiClient.post(`/users/${row.id}/sessions')
  });

  it('49 ไม่มีระบบล็อกบัญชี/คะแนนความเสี่ยงที่ backend ไม่มี', () => {
    for (const bad of ['lockout', 'ล็อกบัญชี', 'threat', 'คะแนนความเสี่ยง']) {
      expect(users, bad).not.toContain(bad);
      expect(activity, bad).not.toContain(bad);
    }
  });

  it('50 ใช้ค่าบทบาทจาก enum RoleName จริงเท่านั้น', () => {
    const block = schema.slice(schema.indexOf('enum RoleName'), schema.indexOf('enum RoleName') + 320);
    const labels = [...vocab.matchAll(/^ {2}([A-Z_]+): '/gm)].map((m) => m[1]);
    const roleKeys = labels.filter((k) => block.includes(k));
    expect(roleKeys.length).toBeGreaterThanOrEqual(10);
    // ทุกคีย์ในตารางบทบาทต้องมีอยู่จริงใน enum
    const roleTable = vocab.slice(vocab.indexOf('export const ROLE_LABEL'), vocab.indexOf('export const roleLabel'));
    // เอาเฉพาะคีย์ที่อยู่ต้นบรรทัดในตาราง (ข้ามบรรทัดประกาศตัวแปร)
    const keys = [...roleTable.matchAll(/^ {2}([A-Z_]+):/gm)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const key of keys) expect(block, key).toContain(key);
  });
});
