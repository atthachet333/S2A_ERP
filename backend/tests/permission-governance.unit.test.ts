import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { BOOTSTRAP_ROLE_GRANTS, PERMISSION_CODES, PERMISSION_DEFINITIONS, bootstrapGrantsFor } from '../prisma/permission-catalog.js';
import { resolveSeedMode } from '../prisma/seed.js';

/**
 * PHASE 19 — กติกาการกำกับดูแลสิทธิ์
 *
 * สิ่งที่ตรึงไว้:
 *   1) "รายการสิทธิ์" เป็นของโค้ด
 *   2) "การผูกสิทธิ์กับบทบาท" ของฐานผลิตเป็นของผู้ดูแล seed ต้องไม่เขียนทับ
 *   3) ค่าตั้งต้นใช้ได้เฉพาะตอน bootstrap ฐานเปล่าและฐานทดสอบ
 */

const BACKEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => fs.readFileSync(path.join(BACKEND, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('แคตตาล็อกสิทธิ์', () => {
  it('รหัสไม่ซ้ำและมีคำอธิบายครบ', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    expect(PERMISSION_DEFINITIONS).toHaveLength(PERMISSION_CODES.length);
    expect(PERMISSION_DEFINITIONS.every((p) => p.code && p.description)).toBe(true);
  });

  it('สิทธิ์ของงานโอนย้ายยังอยู่ครบทั้งสี่', () => {
    for (const code of ['STOCK_TRANSFER_VIEW', 'STOCK_TRANSFER_CREATE', 'STOCK_TRANSFER_CONFIRM', 'STOCK_TRANSFER_REVERSE']) {
      expect(PERMISSION_CODES, code).toContain(code);
    }
  });

  it('ค่าตั้งต้นอ้างถึงเฉพาะรหัสที่มีอยู่จริง', () => {
    for (const [role, codes] of Object.entries(BOOTSTRAP_ROLE_GRANTS)) {
      for (const code of codes) expect(PERMISSION_CODES, `${role} → ${code}`).toContain(code);
    }
  });

  it('กติกาของบทบาทระดับสูงคำนวณจากรายการทั้งหมด ไม่ใช่รายการที่พิมพ์ค้างไว้', () => {
    expect(bootstrapGrantsFor('SUPER_ADMIN')).toHaveLength(PERMISSION_CODES.length);
    expect(bootstrapGrantsFor('ADMIN')).toHaveLength(PERMISSION_CODES.length - 1);
    expect(bootstrapGrantsFor('ADMIN')).not.toContain('USER_MANAGE');
    expect(bootstrapGrantsFor('MANAGER')).toHaveLength(PERMISSION_CODES.length - 3);
    for (const code of ['ROLE_MANAGE', 'PERMISSION_MANAGE', 'SECURITY_SETTINGS']) {
      expect(bootstrapGrantsFor('MANAGER')).not.toContain(code);
    }
  });

  it('บทบาทที่ไม่มีค่าตั้งต้นต้องคืนรายการว่าง ไม่เดา', () => {
    // WAREHOUSE / EXECUTIVE / VIEWER ตั้งใจให้ผู้ดูแลกำหนดเองทั้งหมด
    expect(bootstrapGrantsFor('WAREHOUSE')).toEqual([]);
    expect(bootstrapGrantsFor('EXECUTIVE')).toEqual([]);
    expect(bootstrapGrantsFor('VIEWER')).toEqual([]);
    expect(bootstrapGrantsFor('ROLE_THAT_DOES_NOT_EXIST')).toEqual([]);
  });

  it('ค่าตั้งต้นไม่ให้สิทธิ์โอนย้ายแก่บทบาทที่ยังไม่มีนโยบายชัดเจน', () => {
    for (const role of ['WAREHOUSE', 'CHEF', 'ORDER_COORDINATOR', 'COSTING_STAFF', 'SALES', 'EXECUTIVE', 'VIEWER']) {
      const transfer = bootstrapGrantsFor(role).filter((c) => c.startsWith('STOCK_TRANSFER_'));
      expect(transfer, role).toEqual([]);
    }
    expect(bootstrapGrantsFor('OPERATIONS').filter((c) => c.startsWith('STOCK_TRANSFER_'))).toHaveLength(4);
    expect(bootstrapGrantsFor('PRODUCTION').filter((c) => c.startsWith('STOCK_TRANSFER_'))).toEqual(['STOCK_TRANSFER_VIEW']);
    expect(bootstrapGrantsFor('PURCHASING').filter((c) => c.startsWith('STOCK_TRANSFER_'))).toEqual(['STOCK_TRANSFER_VIEW']);
  });
});

describe('โหมดของ seed', () => {
  const withEnv = <T>(value: string | undefined, run: () => T): T => {
    const previous = process.env.SEED_MODE;
    if (value === undefined) delete process.env.SEED_MODE; else process.env.SEED_MODE = value;
    try { return run(); } finally {
      if (previous === undefined) delete process.env.SEED_MODE; else process.env.SEED_MODE = previous;
    }
  };

  it('ค่าเริ่มต้นคือโหมดปลอดภัยเสมอ — การเผลอรัน seed ต้องไม่แตะสิทธิ์ของบทบาท', () => {
    expect(withEnv(undefined, () => resolveSeedMode())).toBe('safe');
    expect(withEnv('safe', () => resolveSeedMode())).toBe('safe');
  });

  it('สั่งโหมดได้ทั้งทาง env และทางพารามิเตอร์', () => {
    expect(withEnv('bootstrap', () => resolveSeedMode())).toBe('bootstrap');
    expect(withEnv('test', () => resolveSeedMode())).toBe('test');
    // พารามิเตอร์ชนะ env เสมอ เพื่อให้ globalSetup ของเทสต์คุมได้แน่นอน
    expect(withEnv('safe', () => resolveSeedMode('test'))).toBe('test');
  });

  it('โหมดที่สะกดผิดต้องล้มทันที ไม่เงียบแล้วเดาเป็นโหมดใดโหมดหนึ่ง', () => {
    expect(() => withEnv('BOOTSTRAP', () => resolveSeedMode())).toThrow(/SEED_MODE/);
    expect(() => withEnv('production', () => resolveSeedMode())).toThrow(/SEED_MODE/);
  });
});

describe('โครงสร้างของ seed ต้องปลอดภัยกับฐานผลิต', () => {
  const seed = stripComments(read('prisma/seed.ts'));

  it('ไม่มีการลบการผูกสิทธิ์ใด ๆ ใน seed', () => {
    expect(seed).not.toMatch(/rolePermission\.deleteMany/);
    expect(seed).not.toMatch(/rolePermission\.delete\b/);
  });

  it('การเขียนสิทธิ์ของบทบาทต้องอยู่หลังการตรวจโหมดเสมอ', () => {
    const guardAt = seed.indexOf("effectiveMode === 'safe'");
    const writeAt = seed.indexOf('rolePermission.upsert');
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(guardAt);
  });

  it('โหมด bootstrap ต้องข้ามบทบาทที่ตั้งค่าไว้แล้ว', () => {
    expect(seed).toMatch(/effectiveMode === 'bootstrap' && configuredRoleNames\.has\(roleName\)\) continue;/);
  });

  it('ยังคง upsert รายการสิทธิ์ได้ตามเดิม เพราะเป็นชั้นที่โค้ดเป็นเจ้าของ', () => {
    expect(seed).toMatch(/permission\.upsert/);
  });

  it('ผู้ใช้เดิมต้องไม่ถูกแก้ไข — user.upsert ทุกจุดต้องเป็น update ว่าง', () => {
    const upserts = [...seed.matchAll(/db\.user\.upsert\(\{[\s\S]{0,200}?update:\s*\{\s*\}/g)];
    expect(upserts.length).toBeGreaterThanOrEqual(2);
    expect(seed).not.toMatch(/db\.user\.upsert\(\{[\s\S]{0,200}?update:\s*\{\s*passwordHash/);
  });

  it('ฐานทดสอบสั่งโหมด test อย่างชัดเจน เพื่อให้ผลเหมือนกันทุกครั้ง', () => {
    expect(stripComments(read('tests/helpers/global-setup.ts'))).toMatch(/seedDatabase\(db, \{ mode: 'test' \}\)/);
  });
});

describe('เครื่องมือดูแลสิทธิ์', () => {
  const tools = read('scripts/permission-tools.ts');
  const stockTransferSync = read('scripts/sync-stock-transfer-permissions.mjs');
  const pkg = JSON.parse(read('package.json')) as { scripts: Record<string, string> };

  it('มีคำสั่งครบตามที่ประกาศไว้', () => {
    expect(pkg.scripts['permissions:sync']).toContain('permission-tools.ts sync');
    expect(pkg.scripts['permissions:audit']).toContain('permission-tools.ts audit');
    expect(pkg.scripts['permissions:stock-transfer']).toContain('sync-stock-transfer-permissions.mjs');
  });

  it('คำสั่งซิงก์รายการสิทธิ์ต้องไม่ผูกสิทธิ์กับบทบาทและไม่ลบอะไร', () => {
    const sync = tools.slice(tools.indexOf('async function syncCatalog'), tools.indexOf('async function auditRoles'));
    expect(sync).toMatch(/permission\.upsert/);
    expect(sync).not.toMatch(/rolePermission\.(create|createMany|upsert|deleteMany|delete)\b/);
    expect(sync).not.toMatch(/permission\.delete/);
  });

  it('คำสั่งตรวจสอบต้องอ่านอย่างเดียวจริง ๆ', () => {
    const audit = tools.slice(tools.indexOf('async function auditRoles'));
    for (const forbidden of ['.create(', '.createMany(', '.update(', '.updateMany(', '.upsert(', '.delete(', '.deleteMany(', '$executeRaw']) {
      expect(audit, forbidden).not.toContain(forbidden);
    }
  });

  it('คำสั่งที่เขียนข้อมูลต้องมีด่านชื่อฐานข้อมูลและรองรับ --dry-run', () => {
    for (const [name, source] of [['permission-tools', tools], ['stock-transfer sync', stockTransferSync]] as const) {
      expect(source, name).toContain("EXPECTED_DATABASE = 's2a_erp_main'");
      expect(source, name).toContain('SELECT DATABASE()');
      expect(source, name).toContain('--dry-run');
      expect(source, name).toContain('TEST_DATABASE_URL');
    }
  });

  it('สคริปต์เฉพาะกิจของงานโอนย้ายผูกเฉพาะบทบาทที่ตั้งใจ และไม่ลบของเดิม', () => {
    expect(stockTransferSync).not.toMatch(/deleteMany|\.delete\(/);
    for (const role of ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATIONS', 'PRODUCTION', 'PURCHASING']) {
      expect(stockTransferSync, role).toContain(`role: '${role}'`);
    }
    // WAREHOUSE ยังไม่มีนโยบาย จึงต้องไม่ถูกใส่ไว้ในสคริปต์
    expect(stockTransferSync).not.toContain("role: 'WAREHOUSE'");
  });
});

describe('เส้นทางแก้สิทธิ์ผ่านหน้าเว็บ', () => {
  const admin = stripComments(read('src/modules/admin/admin.route.ts'));

  it('ต้องมีสิทธิ์ PERMISSION_MANAGE เท่านั้นจึงแก้ได้', () => {
    expect(admin).toMatch(/const PERM_MANAGE = requirePermission\('PERMISSION_MANAGE'\)/);
    expect(admin).toMatch(/app\.put\('\/roles\/:roleName\/permissions', \{ preHandler: PERM_MANAGE \}/);
  });

  it('SUPER_ADMIN ถูกล็อกไม่ให้แก้ กันล็อกเอาต์ทั้งระบบ', () => {
    expect(admin).toMatch(/roleName === RoleName\.SUPER_ADMIN\) return reply\.status\(409\)/);
    expect(admin).toContain('ROLE_LOCKED');
    expect(admin).toMatch(/locked: \[RoleName\.SUPER_ADMIN\]/);
  });

  it('บันทึกสิทธิ์ของบทบาทหนึ่งต้องลบเฉพาะของบทบาทนั้น ไม่ล้างทั้งตาราง', () => {
    expect(admin).toMatch(/rolePermission\.deleteMany\(\{ where: \{ roleId: role\.id \} \}\)/);
    expect(admin).not.toMatch(/rolePermission\.deleteMany\(\{\s*\}\)/);
  });

  it('รับเฉพาะรหัสสิทธิ์ที่มีจริง และบันทึกประวัติก่อน/หลัง', () => {
    expect(admin).toMatch(/permission\.findMany\(\{ where: \{ code: \{ in: permissions \}/);
    expect(admin).toContain('ROLE_PERMISSIONS_UPDATED');
    expect(admin).toMatch(/before: \{ role: roleName, permissions: before \}/);
  });

  it('สิทธิ์ที่ระบบยังไม่รู้จักต้องไม่ทำให้หน้าเว็บพัง — จัดเข้ากลุ่ม Other', () => {
    expect(admin).toMatch(/return 'Other';/);
    // STOCK_TRANSFER_* ขึ้นต้นด้วย STOCK_ จึงเข้ากลุ่ม Stock ได้เองโดยไม่ต้องแก้โค้ด
    expect(admin).toMatch(/code\.startsWith\('STOCK_'\)\) return 'Stock';/);
  });
});
