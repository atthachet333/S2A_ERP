import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

/**
 * PHASE 18B — เพิ่มสิทธิ์ของงานโอนย้ายระหว่างคลังเข้าฐานผลิต
 *
 * สคริปต์บำรุงรักษาสำหรับฐานผลิตโดยเฉพาะ จงใจไม่ใช้ seed ทั้งชุด
 * เพราะ seed จะสร้างข้อมูลหลักตั้งต้น (หน่วยนับ คลัง ผู้จำหน่าย ผู้ใช้) เพิ่มเข้าไปด้วย
 *
 * ขอบเขตที่ยอมให้แตะมีแค่สองตาราง: permissions และ role_permissions
 * ห้ามแตะ users · companies · ข้อมูลหลัก · รหัสผ่าน · และห้ามลบสิทธิ์เดิมใด ๆ
 *
 * วิธีใช้:
 *   npm run permissions:stock-transfer -- --dry-run   (ดูอย่างเดียว ไม่เขียน)
 *   npm run permissions:stock-transfer                (เขียนจริง)
 */

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

/** ฐานข้อมูลเดียวที่สคริปต์นี้ยอมทำงานด้วย — ตั้งใจให้เป็นฐานผลิตอย่างชัดเจน */
const EXPECTED_DATABASE = 's2a_erp';

const PERMISSIONS = [
  { code: 'STOCK_TRANSFER_VIEW', description: 'STOCK_TRANSFER_VIEW' },
  { code: 'STOCK_TRANSFER_CREATE', description: 'STOCK_TRANSFER_CREATE' },
  { code: 'STOCK_TRANSFER_CONFIRM', description: 'STOCK_TRANSFER_CONFIRM' },
  { code: 'STOCK_TRANSFER_REVERSE', description: 'STOCK_TRANSFER_REVERSE' },
];

const ALL = PERMISSIONS.map((p) => p.code);
const VIEW_ONLY = ['STOCK_TRANSFER_VIEW'];

/**
 * บทบาทที่ต้องได้สิทธิ์ พร้อมเหตุผลว่ามาจากกติกาข้อไหนของ seed
 * บทบาทที่ไม่อยู่ในตารางนี้จะไม่ได้อะไรเลย (EXECUTIVE · SALES · VIEWER · CHEF ·
 * ORDER_COORDINATOR · COSTING_STAFF · WAREHOUSE) เพราะ seed ก็ไม่ได้ให้เช่นกัน
 */
const ROLE_GRANTS = [
  { role: 'SUPER_ADMIN', codes: ALL, reason: 'seed ให้ทุกสิทธิ์' },
  { role: 'ADMIN', codes: ALL, reason: 'seed ให้ทุกสิทธิ์ยกเว้น USER_MANAGE' },
  { role: 'MANAGER', codes: ALL, reason: 'seed ให้ทุกสิทธิ์ยกเว้น ROLE_MANAGE/PERMISSION_MANAGE/SECURITY_SETTINGS' },
  { role: 'OPERATIONS', codes: ALL, reason: 'seed ระบุครบทั้งสี่' },
  { role: 'PRODUCTION', codes: VIEW_ONLY, reason: 'seed ระบุเฉพาะสิทธิ์ดู' },
  { role: 'PURCHASING', codes: VIEW_ONLY, reason: 'seed ระบุเฉพาะสิทธิ์ดู' },
];

const dryRun = process.argv.includes('--dry-run');

function databaseNameFromUrl(url) {
  if (!url) throw new Error('ไม่พบ DATABASE_URL ใน .env');
  const parsed = new URL(url);
  if (!parsed.protocol.startsWith('mysql')) throw new Error(`โปรโตคอลไม่ถูกต้อง: ${parsed.protocol}`);
  const name = parsed.pathname.replace(/^\//, '');
  if (!name) throw new Error('DATABASE_URL ไม่มีชื่อฐานข้อมูล');
  return name;
}

async function main() {
  // ---- ด่าน 1: ตรวจจากค่าที่ตั้งไว้ (ยังไม่ต่อฐานข้อมูล) ----
  const url = process.env.DATABASE_URL;
  const configured = databaseNameFromUrl(url);
  console.log(`เป้าหมาย: ${configured}`);
  if (configured !== EXPECTED_DATABASE) {
    throw new Error(`สคริปต์นี้ทำงานกับฐาน ${EXPECTED_DATABASE} เท่านั้น พบ: ${configured}`);
  }
  // ไม่แตะฐานทดสอบเด็ดขาด แม้จะตั้งค่ามาชี้ที่เดียวกัน
  if (process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL === url) {
    throw new Error('DATABASE_URL ตรงกับ TEST_DATABASE_URL — ปฏิเสธการทำงาน');
  }

  const db = new PrismaClient({ datasourceUrl: url });
  try {
    // ---- ด่าน 2: ถามเซิร์ฟเวอร์จริงว่ากำลังต่ออยู่กับฐานไหน ----
    const rows = await db.$queryRawUnsafe('SELECT DATABASE() AS db');
    const actual = rows?.[0]?.db ?? null;
    console.log(`เซิร์ฟเวอร์รายงานว่าเชื่อมต่ออยู่กับ: ${actual}`);
    if (actual !== EXPECTED_DATABASE) {
      throw new Error(`เซิร์ฟเวอร์ไม่ได้อยู่ที่ฐาน ${EXPECTED_DATABASE} พบ: ${actual}`);
    }

    const before = {
      permissions: await db.permission.count(),
      rolePermissions: await db.rolePermission.count(),
    };
    console.log(`ก่อนดำเนินการ: permissions=${before.permissions} role_permissions=${before.rolePermissions}`);
    console.log(dryRun ? '\n[ดูอย่างเดียว] จะไม่มีการเขียนใด ๆ\n' : '\n[เขียนจริง]\n');

    // ---- สิทธิ์ที่ต้องสร้าง ----
    const existingCodes = new Set(
      (await db.permission.findMany({ where: { code: { in: ALL } }, select: { code: true } })).map((p) => p.code),
    );
    const toCreate = PERMISSIONS.filter((p) => !existingCodes.has(p.code));
    console.log('สิทธิ์:');
    for (const p of PERMISSIONS) {
      console.log(`  ${existingCodes.has(p.code) ? 'มีอยู่แล้ว' : 'จะสร้างใหม่'}  ${p.code}`);
    }

    if (!dryRun) {
      for (const definition of toCreate) {
        // upsert เท่านั้น ไม่ลบและไม่สร้างตารางใหม่
        await db.permission.upsert({ where: { code: definition.code }, update: {}, create: definition });
      }
    }

    // ---- การผูกสิทธิ์กับบทบาท ----
    const permissionIdOf = new Map(
      (await db.permission.findMany({ where: { code: { in: ALL } }, select: { id: true, code: true } }))
        .map((p) => [p.code, p.id]),
    );

    console.log('\nการผูกสิทธิ์กับบทบาท:');
    let added = 0;
    let already = 0;
    for (const grant of ROLE_GRANTS) {
      const role = await db.role.findUnique({ where: { name: grant.role }, select: { id: true } });
      if (!role) {
        console.log(`  ข้าม ${grant.role} — ไม่พบบทบาทนี้ในฐานข้อมูล`);
        continue;
      }
      for (const code of grant.codes) {
        const permissionId = permissionIdOf.get(code);
        if (!permissionId) {
          // เกิดได้เฉพาะตอน dry-run ที่ยังไม่ได้สร้างสิทธิ์
          console.log(`  จะเพิ่ม     ${grant.role.padEnd(12)} ${code}  (${grant.reason})`);
          added += 1;
          continue;
        }
        const exists = await db.rolePermission.findUnique({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
        });
        if (exists) {
          console.log(`  มีอยู่แล้ว  ${grant.role.padEnd(12)} ${code}`);
          already += 1;
          continue;
        }
        console.log(`  จะเพิ่ม     ${grant.role.padEnd(12)} ${code}  (${grant.reason})`);
        added += 1;
        if (!dryRun) {
          await db.rolePermission.create({ data: { roleId: role.id, permissionId } });
        }
      }
    }

    const after = {
      permissions: await db.permission.count(),
      rolePermissions: await db.rolePermission.count(),
    };
    console.log(`\nสรุป: สิทธิ์ที่สร้าง ${dryRun ? toCreate.length + ' (ยังไม่เขียน)' : toCreate.length}` +
      ` · การผูกที่เพิ่ม ${added}${dryRun ? ' (ยังไม่เขียน)' : ''} · ที่มีอยู่แล้ว ${already}`);
    console.log(`หลังดำเนินการ: permissions=${after.permissions} role_permissions=${after.rolePermissions}`);
    if (dryRun) console.log('\nยังไม่ได้เขียนอะไรลงฐานข้อมูล — รันซ้ำโดยไม่ใส่ --dry-run เพื่อเขียนจริง');
  } finally {
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error(`ล้มเหลว: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
