import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  const [server] = await prisma.$queryRawUnsafe(
    'SELECT VERSION() AS version, DATABASE() AS databaseName, @@character_set_database AS charsetName, @@collation_database AS collationName',
  );
  const tables = await prisma.$queryRawUnsafe(
    'SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ? ORDER BY TABLE_NAME',
    'BASE TABLE',
  );
  console.log(JSON.stringify({
    connected: true,
    databaseName: server.databaseName,
    version: server.version,
    charsetName: server.charsetName,
    collationName: server.collationName,
    tableCount: tables.length,
    tableNames: tables.map((row) => row.tableName),
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    connected: false,
    errorType: error?.constructor?.name ?? 'UnknownError',
    errorCode: error?.code ?? 'UNKNOWN',
  }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
