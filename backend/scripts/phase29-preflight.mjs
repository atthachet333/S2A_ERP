import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';

const target = process.argv.find((arg) => arg.startsWith('--target='))?.split('=')[1];
if (target !== 'test' && target !== 'production') throw new Error('Use --target=test or --target=production');

const envPath = fileURLToPath(new URL(target === 'test' ? '../.env.test' : '../.env', import.meta.url));
dotenv.config({ path: envPath, override: true });
const url = target === 'test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;
const expected = target === 'test' ? 's2a_erp_test' : 's2a_erp_main';
if (!url) throw new Error(`${target === 'test' ? 'TEST_DATABASE_URL' : 'DATABASE_URL'} is required`);
const configuredName = new URL(url).pathname.replace(/^\//, '');
console.log(JSON.stringify({ target, configuredDatabase: configuredName }));
if (configuredName !== expected) throw new Error(`Refusing ${target}: expected ${expected}`);

const prisma = new PrismaClient({ datasources: { db: { url } } });
try {
  const selected = await prisma.$queryRawUnsafe('SELECT DATABASE() AS db');
  const database = selected?.[0]?.db ?? null;
  console.log(JSON.stringify({ selectedDatabase: database }));
  if (database !== expected) throw new Error(`Connected to ${database}; expected ${expected}`);

  const [counts] = await prisma.$queryRawUnsafe(`
    SELECT
      (SELECT COUNT(*) FROM stock_balances) AS stockBalances,
      (SELECT COUNT(*) FROM stock_ledgers) AS stockLedgers,
      (SELECT COUNT(*) FROM goods_receipts) AS goodsReceipts,
      (SELECT COUNT(*) FROM production_orders) AS productionOrders,
      (SELECT COUNT(*) FROM stock_issues) AS stockIssues,
      (SELECT COUNT(*) FROM stock_transfers) AS stockTransfers,
      (SELECT COUNT(*) FROM items) AS items,
      (SELECT COUNT(*) FROM inventory_lots) AS inventoryLots,
      (SELECT COUNT(*) FROM stock_balances WHERE lotId IS NULL) AS lotlessBalances,
      (SELECT COUNT(*) FROM stock_balances WHERE lotId IS NOT NULL) AS lotBalances
  `);
  const duplicates = await prisma.$queryRawUnsafe(`
    SELECT itemId, warehouseId, COALESCE(locationId, '') AS locationKey,
           COALESCE(lotId, '') AS lotKey, COUNT(*) AS rowCount,
           SUM(onHand) AS totalOnHand, SUM(reserved) AS totalReserved
      FROM stock_balances
     GROUP BY itemId, warehouseId, COALESCE(locationId, ''), COALESCE(lotId, '')
    HAVING COUNT(*) > 1
     ORDER BY rowCount DESC, itemId, warehouseId
  `);
  console.log(JSON.stringify({ counts }, (_, value) => typeof value === 'bigint' ? Number(value) : value));
  console.log(JSON.stringify({ duplicateLogicalBalances: duplicates }, (_, value) => typeof value === 'bigint' ? Number(value) : value));
  if (duplicates.length) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
