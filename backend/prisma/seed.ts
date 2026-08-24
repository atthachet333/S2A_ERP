import { PrismaClient, RoleName, ItemType } from '@prisma/client';
import { PERMISSION_DEFINITIONS, bootstrapGrantsFor } from './permission-catalog.js';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed ข้อมูลตัวอย่างสำหรับทดลองระบบ
 * - บัญชี admin (บังคับเปลี่ยนรหัสผ่านครั้งแรก)
 * - Roles, หน่วยนับ, หมวดหมู่, วัตถุดิบ/บรรจุภัณฑ์, เมนู, supplier, คลัง
 * เขียนแบบ idempotent (upsert) — รันซ้ำได้
 */
/**
 * PHASE 15B — รับ PrismaClient เข้ามาได้ เพื่อให้ globalSetup ของเทสต์
 * ส่ง client ที่ชี้ไป s2a_erp_test (ผ่านด่านตรวจแล้ว) เข้ามาเอง
 * ไม่งั้น client ระดับโมดูลจะอ่าน DATABASE_URL จาก env ซึ่งอาจเป็น production
 */
export type SeedMode = 'safe' | 'bootstrap' | 'test';

/** โหมดมาจากพารามิเตอร์ก่อน ถ้าไม่ระบุจึงดูจาก SEED_MODE และค่าเริ่มต้นคือโหมดปลอดภัยเสมอ */
export function resolveSeedMode(explicit?: SeedMode): SeedMode {
  if (explicit) return explicit;
  const fromEnv = process.env.SEED_MODE;
  if (fromEnv === 'bootstrap' || fromEnv === 'test') return fromEnv;
  if (fromEnv && fromEnv !== 'safe') throw new Error(`SEED_MODE ไม่ถูกต้อง: ${fromEnv} (ใช้ได้: safe | bootstrap | test)`);
  return 'safe';
}

export async function seedDatabase(db: PrismaClient = prisma, options: { mode?: SeedMode } = {}) {
  const mode = resolveSeedMode(options.mode);
  console.log(`🌱 เริ่ม seed ข้อมูล... (โหมด ${mode})`);

  // ---- Roles ----
  const roleNames = Object.values(RoleName);
  for (const name of roleNames) {
    await db.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `บทบาท ${name}` },
    });
  }
  const superAdmin = await db.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });

  const primaryCompany = await db.company.upsert({
    where: { code: 'S2A-PRIMARY' },
    update: {},
    create: { code: 'S2A-PRIMARY', nameTh: 'บริษัทหลัก', nameEn: 'Primary Company' },
  });
  // เปลี่ยนเฉพาะค่า placeholder เดิม และเติม logo เฉพาะเมื่อยังไม่มีค่า เพื่อไม่ทับข้อมูล production
  await db.company.updateMany({ where: { id: primaryCompany.id, nameTh: { in: ['บริษัทหลัก', 'ครัวซื่อสดดี'] } }, data: { nameTh: 'ครัวสดดี', nameEn: null } });
  await db.company.updateMany({ where: { id: primaryCompany.id, logoUrl: null }, data: { logoUrl: '/company-logos/krua-suesoddee.png' } });

  /* ---- สิทธิ์ ----
     PHASE 19 — แยกเป็นสองชั้นชัดเจน
       ชั้นที่ 1 "รายการสิทธิ์" เป็นของโค้ด upsert ได้เสมอ ปลอดภัยกับทุกฐานข้อมูล
       ชั้นที่ 2 "การผูกสิทธิ์กับบทบาท" ของฐานผลิตเป็นของผู้ดูแล ห้ามเขียนทับจาก seed
     เดิม seed ใช้ rolePermission.upsert ซึ่งเพิ่มสิทธิ์ให้บทบาทเสมอ (ไม่เคยลบ)
     ถ้ารันกับฐานผลิตจะเติมสิทธิ์กลับเข้าไปให้บทบาทที่ผู้ดูแลตั้งใจตัดออก โดยไม่มีใครรู้ */
  for (const definition of PERMISSION_DEFINITIONS) {
    await db.permission.upsert({ where: { code: definition.code }, update: definition, create: definition });
  }
  const permissions = await db.permission.findMany({ where: { code: { in: PERMISSION_DEFINITIONS.map(({ code }) => code) } } });
  const permissionIdOf = new Map(permissions.map((p) => [p.code, p.id]));

  const configuredRoleNames = new Set(
    (await db.rolePermission.findMany({ select: { role: { select: { name: true } } }, distinct: ['roleId'] }))
      .map((rp) => rp.role.name as string),
  );
  const totalRolePermissions = await db.rolePermission.count();

  /* ฐานที่ยังไม่มีการผูกสิทธิ์เลย = ฐานเปล่าจริง ๆ เขียนค่าตั้งต้นได้โดยไม่ทับอะไร
     นอกนั้นต้องสั่งโหมดมาเองเท่านั้น */
  const effectiveMode: SeedMode = mode === 'safe' && totalRolePermissions === 0 ? 'bootstrap' : mode;

  if (effectiveMode === 'safe') {
    const wouldChange = Object.values(RoleName).filter((roleName) => {
      const wanted = bootstrapGrantsFor(roleName);
      return wanted.length > 0 && !configuredRoleNames.has(roleName);
    });
    console.log('🔒 โหมดปลอดภัย: ไม่แตะการผูกสิทธิ์ของบทบาทใดเลย (ฐานนี้ตั้งค่าไว้แล้ว)');
    console.log(`   บทบาทที่ยังไม่มีสิทธิ์และค่าตั้งต้นมีให้: ${wouldChange.length ? wouldChange.join(', ') : 'ไม่มี'}`);
    console.log('   ต้องการเขียนค่าตั้งต้นจริง ให้สั่ง SEED_MODE=bootstrap (เขียนเฉพาะบทบาทที่ยังว่าง)');
  } else {
    for (const roleName of Object.values(RoleName)) {
      const wanted = bootstrapGrantsFor(roleName);
      if (wanted.length === 0) continue;
      /* bootstrap = ข้ามบทบาทที่ตั้งค่าไว้แล้ว (ไม่ทับการตัดสินใจของผู้ดูแล)
         test     = เขียนให้ครบเสมอ เพื่อให้ฐานทดสอบได้ผลเหมือนกันทุกครั้ง */
      if (effectiveMode === 'bootstrap' && configuredRoleNames.has(roleName)) continue;
      const role = await db.role.findUniqueOrThrow({ where: { name: roleName } });
      for (const code of wanted) {
        const permissionId = permissionIdOf.get(code);
        if (!permissionId) continue;
        await db.rolePermission.upsert({
          where: { roleId_permissionId: { roleId: role.id, permissionId } },
          update: {},
          create: { roleId: role.id, permissionId },
        });
      }
    }
    console.log(`🧩 เขียนสิทธิ์ตั้งต้นในโหมด ${effectiveMode} แล้ว`);
  }

  // ---- Admin user ----
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  const admin = await db.user.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      email: 'admin@food-erp.local',
      passwordHash,
      fullName: 'ผู้ดูแลระบบ',
      isActive: true,
      mustChangePassword: true,
    },
  });
  await db.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdmin.id } },
    update: {},
    create: { userId: admin.id, roleId: superAdmin.id },
  });
  await db.companyMembership.upsert({ where: { userId_companyId: { userId: admin.id, companyId: primaryCompany.id } }, update: {}, create: { userId: admin.id, companyId: primaryCompany.id, roleId: superAdmin.id, isDefault: true } });

  const developmentUsers = [
    { username: 'win', email: 'atthachetthongchat333@gmail.com', password: '3333', fullName: 'วิน', roleId: superAdmin.id },
    { username: 'pueng', email: 'pueng@s2a.local', password: '1234', fullName: 'ผึ้ง', roleId: (await db.role.findUniqueOrThrow({ where: { name: RoleName.MANAGER } })).id },
  ];
  for (const definition of developmentUsers) {
    const developmentPasswordHash = await bcrypt.hash(definition.password, 12);
    const user = await db.user.upsert({
      where: { username: definition.username },
      update: {},
      create: { username: definition.username, email: definition.email, passwordHash: developmentPasswordHash, fullName: definition.fullName, isActive: true, mustChangePassword: true },
    });
    await db.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: definition.roleId } },
      update: {},
      create: { userId: user.id, roleId: definition.roleId },
    });
    await db.companyMembership.upsert({ where: { userId_companyId: { userId: user.id, companyId: primaryCompany.id } }, update: { roleId: definition.roleId }, create: { userId: user.id, companyId: primaryCompany.id, roleId: definition.roleId, isDefault: true } });
  }

  // ---- Units ----
  const unitDefs = [
    { code: 'KG', name: 'กิโลกรัม' },
    { code: 'G', name: 'กรัม' },
    { code: 'L', name: 'ลิตร' },
    { code: 'ML', name: 'มิลลิลิตร' },
    { code: 'PCS', name: 'ชิ้น' },
    { code: 'SHEET', name: 'ใบ' },
    { code: 'BOX', name: 'กล่อง' },
    { code: 'BAG', name: 'ถุง' },
    { code: 'PACK', name: 'แพ็ก' },
  ];
  const units: Record<string, string> = {};
  for (const u of unitDefs) {
    const created = await db.unit.upsert({
      where: { code: u.code },
      update: {},
      create: u,
    });
    units[u.code] = created.id;
  }

  // ---- Unit conversions ----
  const convDefs = [
    { from: 'KG', to: 'G', factor: 1000 },
    { from: 'L', to: 'ML', factor: 1000 },
    { from: 'BOX', to: 'PCS', factor: 12 },
  ];
  for (const c of convDefs) {
    await db.unitConversion.upsert({
      where: { fromUnitId_toUnitId: { fromUnitId: units[c.from], toUnitId: units[c.to] } },
      update: { factor: c.factor },
      create: { fromUnitId: units[c.from], toUnitId: units[c.to], factor: c.factor },
    });
  }

  // ---- Categories ----
  const catDefs = [
    { code: 'CAT-RAW', name: 'วัตถุดิบ', type: ItemType.RAW_MATERIAL },
    { code: 'CAT-PKG', name: 'บรรจุภัณฑ์', type: ItemType.PACKAGING },
    { code: 'CAT-FG', name: 'สินค้าสำเร็จรูป', type: ItemType.FINISHED_GOOD },
  ];
  const cats: Record<string, string> = {};
  for (const c of catDefs) {
    const created = await db.category.upsert({
      where: { code: c.code },
      update: {},
      create: { ...c, companyId: primaryCompany.id },
    });
    cats[c.code] = created.id;
  }

  // ---- Items ----
  const itemDefs = [
    { code: 'RM-001', name: 'ข้าวหอมมะลิ', type: ItemType.RAW_MATERIAL, cat: 'CAT-RAW', unit: 'KG', cost: 35 },
    { code: 'RM-002', name: 'น้ำมันพืช', type: ItemType.RAW_MATERIAL, cat: 'CAT-RAW', unit: 'L', cost: 55 },
    { code: 'RM-003', name: 'เกลือ', type: ItemType.RAW_MATERIAL, cat: 'CAT-RAW', unit: 'KG', cost: 12 },
    { code: 'PKG-001', name: 'กล่องอาหาร', type: ItemType.PACKAGING, cat: 'CAT-PKG', unit: 'PCS', cost: 3.5 },
    { code: 'PKG-002', name: 'ถุงพลาสติก', type: ItemType.PACKAGING, cat: 'CAT-PKG', unit: 'PCS', cost: 0.8 },
    { code: 'FG-001', name: 'ข้าวกล่องพร้อมทาน', type: ItemType.FINISHED_GOOD, cat: 'CAT-FG', unit: 'BOX', cost: 0 },
  ];
  const items: Record<string, string> = {};
  for (const it of itemDefs) {
    const created = await db.item.upsert({
      where: { code: it.code },
      update: {},
      create: {
        companyId: primaryCompany.id,
        code: it.code,
        name: it.name,
        type: it.type,
        categoryId: cats[it.cat],
        baseUnitId: units[it.unit],
        avgCost: it.cost,
        lastCost: it.cost,
        isExpiryTracked: it.type === ItemType.FINISHED_GOOD || it.type === ItemType.RAW_MATERIAL,
        isLotTracked: it.type === ItemType.FINISHED_GOOD,
        createdById: admin.id,
      },
    });
    items[it.code] = created.id;
  }

  // ---- Supplier ----
  await db.supplier.upsert({
    where: { code: 'SUP-001' },
    update: {},
    create: { companyId: primaryCompany.id, code: 'SUP-001', name: 'บริษัท วัตถุดิบดี จำกัด', phone: '02-000-0000' },
  });

  // ---- Warehouses ----
  const whDefs = [
    { code: 'WH-RAW', name: 'คลังวัตถุดิบ', type: ItemType.RAW_MATERIAL },
    { code: 'WH-FG', name: 'คลังสินค้าสำเร็จรูป', type: ItemType.FINISHED_GOOD },
  ];
  for (const w of whDefs) {
    const wh = await db.warehouse.upsert({
      where: { code: w.code },
      update: {},
      create: { ...w, companyId: primaryCompany.id },
    });
    await db.warehouseLocation.upsert({
      where: { warehouseId_code: { warehouseId: wh.id, code: 'DEFAULT' } },
      update: {},
      create: { warehouseId: wh.id, code: 'DEFAULT', zone: 'A', rack: '1', bin: '1' },
    });
  }

  // ---- System settings ----
  await db.systemSetting.upsert({
    where: { key: 'COST_METHOD' },
    update: {},
    create: { key: 'COST_METHOD', value: 'MOVING_AVERAGE' },
  });

  console.log('✅ seed เสร็จสิ้น');
}

/* รันเป็นสคริปต์ตรง ๆ เท่านั้น (npm run prisma:seed) — ตอน import จะไม่ทำงานเอง */
const runDirectly = process.argv[1]?.replace(/\\/g, '/').endsWith('prisma/seed.ts');
if (runDirectly) {
  seedDatabase()
    .catch((e) => {
      console.error('❌ seed ล้มเหลว:', e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
