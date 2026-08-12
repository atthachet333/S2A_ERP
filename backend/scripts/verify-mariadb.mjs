import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const rollback = Symbol('rollback');
let roundTrip = false;

try {
  try {
    await prisma.$transaction(async (tx) => {
      const multilingual = { th: 'ภาษาไทย', en: 'English', zh: '简体中文' };
      const row = await tx.auditLog.create({
        data: { action: 'MARIADB_VERIFY', entity: 'MigrationCheck', before: multilingual, after: { decimal: '0.3000' } },
      });
      const read = await tx.auditLog.findUniqueOrThrow({ where: { id: row.id } });
      roundTrip = JSON.stringify(read.before) === JSON.stringify(multilingual);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  const [foreignKeys, indexes, charsets, roles, permissions, companies, users] = await Promise.all([
    prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE()'),
    prisma.$queryRawUnsafe('SELECT COUNT(DISTINCT TABLE_NAME, INDEX_NAME) AS count FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE()'),
    prisma.$queryRawUnsafe('SELECT TABLE_COLLATION AS collationName, COUNT(*) AS count FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = ? GROUP BY TABLE_COLLATION', 'BASE TABLE'),
    prisma.role.count(),
    prisma.permission.count(),
    prisma.company.findMany({ select: { code: true, nameTh: true } }),
    prisma.user.count(),
  ]);

  console.log(JSON.stringify({
    foreignKeyCount: Number(foreignKeys[0].count),
    indexCount: Number(indexes[0].count),
    tableCollations: charsets.map((row) => ({ collationName: row.collationName, count: Number(row.count) })),
    seed: { roleCount: roles, permissionCount: permissions, userCount: users, companies },
    jsonAndI18nRoundTrip: roundTrip,
    verificationRowsPersisted: await prisma.auditLog.count({ where: { action: 'MARIADB_VERIFY' } }),
  }, null, 2));
} finally {
  await prisma.$disconnect();
}
