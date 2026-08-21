/**
 * Seed เฉพาะ permission ของ inventory/confirm (idempotent)
 *
 * แยกจาก prisma/seed.ts เพราะ seed หลักสร้าง company/user/master data ด้วย
 * สคริปต์นี้แตะแค่ permissions + role_permissions และรันซ้ำได้ไม่เกิดของซ้ำ (upsert ทั้งหมด)
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** permission ใหม่ + role ที่ควรได้รับ (ตาม role matrix เดิม) */
const NEW_PERMISSIONS = {
  RECEIVING_CONFIRM: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATIONS', 'PURCHASING'],
  STOCK_ISSUE_CONFIRM: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATIONS'],
  INVENTORY_VIEW: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATIONS', 'PURCHASING', 'PRODUCTION'],
  INVENTORY_ADJUST: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'OPERATIONS'],
};

async function main() {
  let created = 0, granted = 0, skipped = 0;

  for (const [code, roleNames] of Object.entries(NEW_PERMISSIONS)) {
    const before = await prisma.permission.findUnique({ where: { code } });
    const permission = await prisma.permission.upsert({
      where: { code },
      update: {},                     // ไม่ทับ description เดิมถ้ามีอยู่แล้ว
      create: { code, description: code },
    });
    if (before) skipped += 1; else created += 1;

    for (const roleName of roleNames) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) { console.log(`  ! ข้าม role ${roleName} (ไม่มีในระบบ)`); continue; }
      const existing = await prisma.rolePermission.findUnique({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      });
      if (!existing) {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
        granted += 1;
      }
    }
    console.log(`  ✔ ${code} → ${roleNames.join(', ')}`);
  }

  console.log(`\nสรุป: permission ใหม่ ${created} รายการ, มีอยู่แล้ว ${skipped} รายการ, ให้สิทธิ์เพิ่ม ${granted} ครั้ง`);

  // ตรวจว่า SUPER_ADMIN ได้ครบ (bypass อยู่ในโค้ดแล้ว แต่ให้มีในตารางด้วยเพื่อความชัดเจน)
  const check = await prisma.permission.findMany({
    where: { code: { in: Object.keys(NEW_PERMISSIONS) } },
    include: { rolePermissions: { include: { role: true } } },
  });
  for (const p of check) {
    console.log(`  ${p.code}: ${p.rolePermissions.map((rp) => rp.role.name).sort().join(', ') || '(ยังไม่มี role)'}`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
