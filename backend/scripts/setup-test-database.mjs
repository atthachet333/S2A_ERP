import { spawnSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

/* PHASE 15 — โหลด .env.test อย่างเจาะจง
   ห้ามใช้ dotenv/config เฉย ๆ เพราะจะได้ .env ของ production มาแทน
   และห้าม fallback ไป DATABASE_URL ไม่ว่ากรณีใด */
dotenv.config({ path: fileURLToPath(new URL('../.env.test', import.meta.url)) });

const testUrl = process.env.TEST_DATABASE_URL;
if (!testUrl) throw new Error('TEST_DATABASE_URL is required (ตั้งค่าใน backend/.env.test)');

const parsed = new URL(testUrl);
if (parsed.protocol !== 'mysql:' || parsed.pathname.replace(/^\//, '') !== 's2a_erp_test') {
  throw new Error('Refusing to initialize any database other than s2a_erp_test');
}

const prisma = new PrismaClient({ datasourceUrl: testUrl });
try {
  try {
    const [metadata] = await prisma.$queryRawUnsafe(
      'SELECT DATABASE() AS databaseName, @@character_set_database AS charsetName, @@collation_database AS collationName',
    );
    if (metadata.databaseName !== 's2a_erp_test') throw new Error('Unexpected test database identity');
    console.log(JSON.stringify({
      connected: true,
      databaseName: metadata.databaseName,
      charsetName: metadata.charsetName,
      collationName: metadata.collationName,
    }));
  } catch (error) {
    const message = String(error?.message ?? '');
    console.error(JSON.stringify({
      ready: false,
      databaseName: 's2a_erp_test',
      errorType: error?.constructor?.name ?? 'UnknownError',
      errorCode: error?.meta?.code ?? error?.code ?? 'UNKNOWN',
      errorCategory: /denied access|access denied/i.test(message)
        ? 'ACCESS_DENIED'
        : /does not exist|unknown database/i.test(message)
          ? 'DATABASE_NOT_FOUND'
          : /invalid.*url|connection string/i.test(message)
            ? 'INVALID_CONNECTION_CONFIGURATION'
            : 'CONNECTION_FAILED',
      requiredAction: 'Verify s2a_erp_test exists and grant the test account privileges on that database.',
    }));
    process.exit(1);
  }
} finally {
  await prisma.$disconnect();
}

/* PHASE 15 — เรียก Prisma CLI ด้วย node ตรง ๆ
   Node 24 บน Windows ปฏิเสธการ spawn ไฟล์ .cmd แบบ shell:false (EINVAL)
   และการใช้ shell:true จะทำให้ argument ไม่ถูก escape จึงเลี่ยงทั้งสองทาง */
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const result = spawnSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
  stdio: 'inherit',
});

if (result.status !== 0) process.exit(result.status ?? 1);
console.log('Test database s2a_erp_test is ready.');
