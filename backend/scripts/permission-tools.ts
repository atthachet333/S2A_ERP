import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';
import { PERMISSION_DEFINITIONS, bootstrapGrantsFor } from '../prisma/permission-catalog.js';

/**
 * PHASE 19 — เครื่องมือดูแลสิทธิ์สำหรับฐานผลิต
 *
 *   npm run permissions:sync  -- --dry-run   เพิ่ม "รายการสิทธิ์" ที่ยังขาด (ไม่ผูกกับบทบาทใดเลย)
 *   npm run permissions:sync
 *   npm run permissions:audit                อ่านอย่างเดียว เทียบของจริงกับค่าตั้งต้น
 *
 * แยกสองงานออกจากกันโดยตั้งใจ:
 *   - เพิ่มรหัสสิทธิ์ใหม่เข้าระบบ = ปลอดภัย ทำได้ตลอด
 *   - มอบสิทธิ์ให้บทบาท = การตัดสินใจของผู้ดูแล ต้องทำผ่านหน้าเว็บ
 *     หรือผ่านสคริปต์เฉพาะกิจที่ระบุการผูกไว้ชัดเจน (เช่น sync-stock-transfer-permissions.mjs)
 */

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

const EXPECTED_DATABASE = 's2a_erp';

function databaseNameFromUrl(url: string | undefined): string {
  if (!url) throw new Error('ไม่พบ DATABASE_URL ใน .env');
  const parsed = new URL(url);
  if (!parsed.protocol.startsWith('mysql')) throw new Error(`โปรโตคอลไม่ถูกต้อง: ${parsed.protocol}`);
  const name = parsed.pathname.replace(/^\//, '');
  if (!name) throw new Error('DATABASE_URL ไม่มีชื่อฐานข้อมูล');
  return name;
}

/**
 * ด่านความปลอดภัยสองชั้น — ตรวจจากค่าที่ตั้งไว้ แล้วถามเซิร์ฟเวอร์จริงซ้ำ
 * คำสั่งอ่านอย่างเดียวไม่บังคับชื่อฐาน (ตรวจฐานทดสอบก็มีประโยชน์) แต่ต้องพิมพ์ชื่อออกมาเสมอ
 */
async function connect(options: { requireProduction: boolean }): Promise<PrismaClient> {
  const url = process.env.DATABASE_URL;
  const configured = databaseNameFromUrl(url);
  console.log(`เป้าหมาย: ${configured}`);
  if (options.requireProduction) {
    if (configured !== EXPECTED_DATABASE) {
      throw new Error(`คำสั่งที่เขียนข้อมูลทำงานกับฐาน ${EXPECTED_DATABASE} เท่านั้น พบ: ${configured}`);
    }
    if (process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL === url) {
      throw new Error('DATABASE_URL ตรงกับ TEST_DATABASE_URL — ปฏิเสธการทำงาน');
    }
  }
  const db = new PrismaClient({ datasourceUrl: url });
  const rows = await db.$queryRawUnsafe<{ db: string | null }[]>('SELECT DATABASE() AS db');
  const actual = rows?.[0]?.db ?? null;
  console.log(`เซิร์ฟเวอร์รายงานว่าเชื่อมต่ออยู่กับ: ${actual}`);
  if (options.requireProduction && actual !== EXPECTED_DATABASE) {
    await db.$disconnect();
    throw new Error(`เซิร์ฟเวอร์ไม่ได้อยู่ที่ฐาน ${EXPECTED_DATABASE} พบ: ${actual}`);
  }
  return db;
}

/* ============================ ซิงก์รายการสิทธิ์ ============================ */

async function syncCatalog(dryRun: boolean) {
  const db = await connect({ requireProduction: true });
  try {
    const before = await db.permission.count();
    console.log(`รายการสิทธิ์ก่อนดำเนินการ: ${before}`);
    console.log(dryRun ? '\n[ดูอย่างเดียว] จะไม่มีการเขียนใด ๆ\n' : '\n[เขียนจริง]\n');

    const existing = new Set(
      (await db.permission.findMany({ select: { code: true } })).map((p) => p.code),
    );
    const missing = PERMISSION_DEFINITIONS.filter((p) => !existing.has(p.code));
    const extra = [...existing].filter((code) => !PERMISSION_DEFINITIONS.some((p) => p.code === code));

    if (missing.length === 0) console.log('ไม่มีรหัสสิทธิ์ใหม่ที่ต้องเพิ่ม');
    for (const definition of missing) {
      console.log(`  จะสร้างใหม่  ${definition.code}`);
      // upsert เท่านั้น และไม่ผูกกับบทบาทใดทั้งสิ้น
      if (!dryRun) await db.permission.upsert({ where: { code: definition.code }, update: {}, create: definition });
    }

    /* รหัสที่มีในฐานแต่ไม่มีในโค้ด — รายงานอย่างเดียว ไม่ลบ
       อาจเป็นรหัสที่เพิ่งถอดออกจากโค้ดหรือเพิ่มไว้ด้วยมือ การลบต้องเป็นการตัดสินใจของคน */
    if (extra.length) {
      console.log(`\nมีในฐานข้อมูลแต่ไม่มีในโค้ด (${extra.length}) — รายงานอย่างเดียว ไม่ลบ:`);
      for (const code of extra) console.log(`  ${code}`);
    }

    const after = await db.permission.count();
    console.log(`\nสรุป: สร้างใหม่ ${missing.length}${dryRun ? ' (ยังไม่เขียน)' : ''} · รายการสิทธิ์หลังดำเนินการ ${after}`);
    console.log('หมายเหตุ: คำสั่งนี้ไม่มอบสิทธิ์ให้บทบาทใดเลย การมอบสิทธิ์ทำผ่านหน้าจัดการสิทธิ์');
    if (dryRun) console.log('\nยังไม่ได้เขียนอะไร — รันซ้ำโดยไม่ใส่ --dry-run เพื่อเขียนจริง');
  } finally {
    await db.$disconnect();
  }
}

/* ============================ ตรวจสอบสิทธิ์ของบทบาท ============================ */

async function auditRoles() {
  // อ่านอย่างเดียว จึงเปิดให้ตรวจฐานอื่นได้ด้วย แต่ยังพิมพ์ชื่อฐานให้เห็นชัดเสมอ
  const db = await connect({ requireProduction: false });
  try {
    const roles = await db.role.findMany({
      include: { rolePermissions: { include: { permission: { select: { code: true } } } } },
      orderBy: { name: 'asc' },
    });

    console.log(`\nรายการสิทธิ์ทั้งหมดในฐาน: ${await db.permission.count()} · ในโค้ด: ${PERMISSION_DEFINITIONS.length}`);
    console.log('\nบทบาท · จำนวนสิทธิ์ · ส่วนต่างจากค่าตั้งต้น');
    console.log('-'.repeat(78));

    let drifted = 0;
    for (const role of roles) {
      const actual = role.rolePermissions.map((rp) => rp.permission.code).sort();
      const expected = bootstrapGrantsFor(role.name).slice().sort();
      const missing = expected.filter((code) => !actual.includes(code));
      const extra = actual.filter((code) => !expected.includes(code));
      const managed = missing.length > 0 || extra.length > 0;
      if (managed) drifted += 1;

      console.log(`${role.name.padEnd(18)} ${String(actual.length).padStart(3)} สิทธิ์  ` +
        `${managed ? `ต่างจากค่าตั้งต้น (ขาด ${missing.length} · เกิน ${extra.length}) — ผู้ดูแลกำหนดเอง` : 'ตรงกับค่าตั้งต้น'}`);
      if (missing.length) console.log(`    ขาด : ${missing.join(', ')}`);
      if (extra.length) console.log(`    เกิน: ${extra.join(', ')}`);
      if (!missing.length && !extra.length && actual.length) console.log(`    รหัส: ${actual.join(', ')}`);
      if (!actual.length) console.log('    รหัส: (ไม่มี)');
    }

    console.log('-'.repeat(78));
    console.log(`บทบาทที่ต่างจากค่าตั้งต้น: ${drifted} จาก ${roles.length}`);
    console.log('ส่วนต่างไม่ใช่ข้อผิดพลาด — การผูกสิทธิ์ของฐานผลิตเป็นของผู้ดูแล ค่าตั้งต้นใช้เฉพาะตอน bootstrap');
    console.log('คำสั่งนี้อ่านอย่างเดียว ไม่เขียนอะไรลงฐานข้อมูล');
  } finally {
    await db.$disconnect();
  }
}

/* ============================ ทางเข้า ============================ */

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

const run = async () => {
  if (command === 'sync') return syncCatalog(dryRun);
  if (command === 'audit') return auditRoles();
  throw new Error(`ไม่รู้จักคำสั่ง: ${command ?? '(ว่าง)'} — ใช้ได้: sync | audit`);
};

run().catch((error: unknown) => {
  console.error(`ล้มเหลว: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
