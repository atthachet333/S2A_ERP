import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RoleName } from '@prisma/client';
import { prisma } from '../src/lib/prisma.js';
import { seedDatabase } from '../prisma/seed.js';
import { bootstrapGrantsFor } from '../prisma/permission-catalog.js';

/**
 * PHASE 19 — พิสูจน์กับฐานข้อมูลจริงว่า seed ไม่เขียนทับการตัดสินใจของผู้ดูแล
 *
 * บทบาทที่ใช้ในไฟล์นี้เลือกมาเพราะไม่มีเทสต์อื่นพึ่งพา:
 *   COSTING_STAFF = บทบาทที่ "ตั้งค่าไว้แล้ว" (มีสิทธิ์อยู่)
 *   SALES         = บทบาทที่ "ยังว่าง" แต่มีค่าตั้งต้นให้
 * ปิดท้ายด้วยการคืนสถานะด้วยโหมด test เพื่อไม่ให้ไฟล์อื่นได้รับผลกระทบ
 */

const MANAGED_ROLE = RoleName.COSTING_STAFF;
const EMPTY_ROLE = RoleName.SALES;

const codesOf = async (roleName: RoleName): Promise<string[]> => {
  const role = await prisma.role.findUniqueOrThrow({
    where: { name: roleName },
    include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
  });
  return role.rolePermissions.map((rp) => rp.permission.code).sort();
};

const clearRole = async (roleName: RoleName) => {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
};

/** จำลองการที่ผู้ดูแลตัดสิทธิ์หนึ่งตัวออกผ่านหน้าเว็บ */
const revoke = async (roleName: RoleName, code: string) => {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const permission = await prisma.permission.findUniqueOrThrow({ where: { code } });
  await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
};

describe.sequential('seed governance', () => {
  let revokedCode = '';

  beforeAll(async () => {
    revokedCode = bootstrapGrantsFor(MANAGED_ROLE)[0];
    expect(revokedCode, 'บทบาทที่ใช้ทดสอบต้องมีค่าตั้งต้น').toBeTruthy();
  });

  afterAll(async () => {
    // คืนสถานะให้ฐานทดสอบกลับไปเป็นค่าตั้งต้นครบถ้วนเสมอ
    await seedDatabase(prisma, { mode: 'test' });
    await prisma.$disconnect();
  });

  it('G1 โหมดปลอดภัย (ค่าเริ่มต้น) ต้องไม่คืนสิทธิ์ที่ผู้ดูแลตัดออกไปแล้ว', async () => {
    await revoke(MANAGED_ROLE, revokedCode);
    const before = await codesOf(MANAGED_ROLE);
    expect(before).not.toContain(revokedCode);

    await seedDatabase(prisma, { mode: 'safe' });

    const after = await codesOf(MANAGED_ROLE);
    expect(after, 'seed โหมดปลอดภัยต้องไม่เติมสิทธิ์กลับ').toEqual(before);
    expect(after).not.toContain(revokedCode);
  });

  it('G2 โหมด bootstrap ก็ยังไม่แตะบทบาทที่ตั้งค่าไว้แล้ว', async () => {
    const before = await codesOf(MANAGED_ROLE);
    expect(before.length).toBeGreaterThan(0);
    expect(before).not.toContain(revokedCode);

    await seedDatabase(prisma, { mode: 'bootstrap' });

    expect(await codesOf(MANAGED_ROLE)).toEqual(before);
  });

  it('G3 โหมด bootstrap เขียนค่าตั้งต้นให้เฉพาะบทบาทที่ยังว่าง', async () => {
    await clearRole(EMPTY_ROLE);
    expect(await codesOf(EMPTY_ROLE)).toEqual([]);
    const managedBefore = await codesOf(MANAGED_ROLE);

    await seedDatabase(prisma, { mode: 'bootstrap' });

    expect(await codesOf(EMPTY_ROLE)).toEqual(bootstrapGrantsFor(EMPTY_ROLE).slice().sort());
    // บทบาทที่ตั้งค่าไว้แล้วต้องไม่ขยับตามไปด้วย
    expect(await codesOf(MANAGED_ROLE)).toEqual(managedBefore);
  });

  it('G4 โหมดปลอดภัยไม่เขียนแม้บทบาทที่ยังว่าง', async () => {
    await clearRole(EMPTY_ROLE);
    await seedDatabase(prisma, { mode: 'safe' });
    expect(await codesOf(EMPTY_ROLE)).toEqual([]);
  });

  it('G5 โหมด test คืนค่าตั้งต้นให้ครบทุกบทบาท — ฐานทดสอบต้องเหมือนเดิมทุกครั้ง', async () => {
    await clearRole(EMPTY_ROLE);
    await revoke(MANAGED_ROLE, revokedCode);

    await seedDatabase(prisma, { mode: 'test' });

    expect(await codesOf(EMPTY_ROLE)).toEqual(bootstrapGrantsFor(EMPTY_ROLE).slice().sort());
    expect(await codesOf(MANAGED_ROLE)).toEqual(bootstrapGrantsFor(MANAGED_ROLE).slice().sort());
    expect(await codesOf(MANAGED_ROLE)).toContain(revokedCode);
  });

  it('G6 seed ไม่เคยลบการผูกสิทธิ์ที่ไม่ได้อยู่ในค่าตั้งต้น', async () => {
    // ให้สิทธิ์ที่ค่าตั้งต้นไม่มี แล้วรัน seed ทุกโหมด สิทธิ์นั้นต้องยังอยู่
    const role = await prisma.role.findUniqueOrThrow({ where: { name: MANAGED_ROLE } });
    const outsider = await prisma.permission.findUniqueOrThrow({ where: { code: 'AUDIT_VIEW' } });
    expect(bootstrapGrantsFor(MANAGED_ROLE)).not.toContain('AUDIT_VIEW');
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: role.id, permissionId: outsider.id } },
      update: {}, create: { roleId: role.id, permissionId: outsider.id },
    });

    for (const mode of ['safe', 'bootstrap', 'test'] as const) {
      await seedDatabase(prisma, { mode });
      expect(await codesOf(MANAGED_ROLE), mode).toContain('AUDIT_VIEW');
    }

    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: outsider.id } });
  });

  it('G7 รายการสิทธิ์ยังถูกดูแลโดยโค้ดเสมอ ทุกโหมดต้องมีรหัสครบ', async () => {
    const missing = await prisma.permission.findMany({
      where: { code: { in: ['STOCK_TRANSFER_VIEW', 'STOCK_TRANSFER_CREATE', 'STOCK_TRANSFER_CONFIRM', 'STOCK_TRANSFER_REVERSE'] } },
      select: { code: true },
    });
    expect(missing).toHaveLength(4);

    // ลบรหัสหนึ่งออกแล้วให้ seed โหมดปลอดภัยสร้างคืน (ชั้นแคตตาล็อกเป็นของโค้ด)
    const target = 'STOCK_TRANSFER_REVERSE';
    await prisma.rolePermission.deleteMany({ where: { permission: { code: target } } });
    await prisma.permission.delete({ where: { code: target } });
    expect(await prisma.permission.count({ where: { code: target } })).toBe(0);

    await seedDatabase(prisma, { mode: 'safe' });
    expect(await prisma.permission.count({ where: { code: target } })).toBe(1);
  });
});
