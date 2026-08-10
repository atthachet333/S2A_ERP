import { PrismaClient, RoleName, ItemType } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

/**
 * Seed ข้อมูลตัวอย่างสำหรับทดลองระบบ
 * - บัญชี admin (บังคับเปลี่ยนรหัสผ่านครั้งแรก)
 * - Roles, หน่วยนับ, หมวดหมู่, วัตถุดิบ/บรรจุภัณฑ์, เมนู, supplier, คลัง
 * เขียนแบบ idempotent (upsert) — รันซ้ำได้
 */
async function main() {
  console.log('🌱 เริ่ม seed ข้อมูล...');

  // ---- Roles ----
  const roleNames = Object.values(RoleName);
  for (const name of roleNames) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name, description: `บทบาท ${name}` },
    });
  }
  const superAdmin = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.SUPER_ADMIN } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { name: RoleName.ADMIN } });

  const primaryCompany = await prisma.company.upsert({
    where: { code: 'S2A-PRIMARY' },
    update: {},
    create: { code: 'S2A-PRIMARY', nameTh: 'บริษัทหลัก', nameEn: 'Primary Company' },
  });
  // เปลี่ยนเฉพาะค่า placeholder เดิม และเติม logo เฉพาะเมื่อยังไม่มีค่า เพื่อไม่ทับข้อมูล production
  await prisma.company.updateMany({ where: { id: primaryCompany.id, nameTh: { in: ['บริษัทหลัก', 'ครัวซื่อสดดี'] } }, data: { nameTh: 'ครัวสดดี', nameEn: null } });
  await prisma.company.updateMany({ where: { id: primaryCompany.id, logoUrl: null }, data: { logoUrl: '/company-logos/krua-suesoddee.png' } });

  const permissionCodes = [
    'COMPANY_VIEW', 'COMPANY_SWITCH', 'DASHBOARD_VIEW', 'PROFILE_VIEW',
    'INGREDIENT_VIEW', 'INGREDIENT_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_VIEW', 'PACKAGING_CREATE', 'PACKAGING_EDIT',
    'RECIPE_VIEW', 'RECIPE_CREATE', 'RECIPE_EDIT', 'RECIPE_APPROVE_IF_NEEDED', 'COSTING_VIEW', 'COSTING_CALCULATE',
    'PRICING_VIEW', 'PRICING_EDIT', 'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_EDIT',
    'ORDER_VIEW', 'ORDER_CREATE', 'ORDER_EDIT', 'ORDER_SEND', 'ORDER_CONFIRM', 'ORDER_CANCEL', 'ORDER_COMPLETE',
    'RECEIVING_VIEW', 'RECEIVING_CREATE', 'RECEIVING_EDIT', 'STOCK_VIEW', 'STOCK_ISSUE_VIEW', 'STOCK_ISSUE_CREATE',
    'KPI_VIEW', 'REPORT_VIEW', 'NOTIFICATION_VIEW', 'DOCUMENT_DOWNLOAD', 'DOCUMENT_EMAIL',
    'USER_VIEW', 'USER_MANAGE', 'AUDIT_VIEW', 'ROLE_MANAGE', 'PERMISSION_MANAGE', 'SYSTEM_SETTINGS', 'SECURITY_SETTINGS',
  ];
  const permissionDefs = permissionCodes.map((code) => ({ code, description: code }));
  for (const definition of permissionDefs) {
    await prisma.permission.upsert({ where: { code: definition.code }, update: definition, create: definition });
  }
  const permissions = await prisma.permission.findMany({ where: { code: { in: permissionDefs.map(({ code }) => code) } } });
  for (const permission of permissions) {
    await prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId: superAdmin.id, permissionId: permission.id } },
      update: {},
      create: { roleId: superAdmin.id, permissionId: permission.id },
    });
    if (permission.code !== 'USER_MANAGE') {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: adminRole.id, permissionId: permission.id } },
        update: {},
        create: { roleId: adminRole.id, permissionId: permission.id },
      });
    }
  }
  const scopedRoles: RoleName[] = [RoleName.MANAGER, RoleName.OPERATIONS, RoleName.ORDER_COORDINATOR, RoleName.CHEF, RoleName.COSTING_STAFF];
  const grants: Record<string, string[]> = {
    MANAGER: permissionCodes.filter((code) => !['ROLE_MANAGE', 'PERMISSION_MANAGE', 'SECURITY_SETTINGS'].includes(code)),
    OPERATIONS: ['COMPANY_VIEW', 'COMPANY_SWITCH', 'DASHBOARD_VIEW', 'PROFILE_VIEW', 'INGREDIENT_VIEW', 'PACKAGING_VIEW', 'RECIPE_VIEW', 'RECIPE_CREATE', 'RECIPE_EDIT', 'COSTING_VIEW', 'ORDER_VIEW', 'ORDER_CONFIRM', 'RECEIVING_VIEW', 'RECEIVING_CREATE', 'RECEIVING_EDIT', 'STOCK_VIEW', 'STOCK_ISSUE_VIEW', 'STOCK_ISSUE_CREATE', 'NOTIFICATION_VIEW', 'DOCUMENT_DOWNLOAD'],
    ORDER_COORDINATOR: ['COMPANY_VIEW', 'COMPANY_SWITCH', 'DASHBOARD_VIEW', 'PROFILE_VIEW', 'CUSTOMER_VIEW', 'CUSTOMER_CREATE', 'CUSTOMER_EDIT', 'ORDER_VIEW', 'ORDER_CREATE', 'ORDER_EDIT', 'ORDER_SEND', 'ORDER_CONFIRM', 'ORDER_CANCEL', 'NOTIFICATION_VIEW', 'DOCUMENT_DOWNLOAD', 'DOCUMENT_EMAIL'],
    CHEF: ['COMPANY_VIEW', 'COMPANY_SWITCH', 'DASHBOARD_VIEW', 'PROFILE_VIEW', 'INGREDIENT_VIEW', 'PACKAGING_VIEW', 'RECIPE_VIEW', 'RECIPE_CREATE', 'ORDER_VIEW', 'NOTIFICATION_VIEW', 'DOCUMENT_DOWNLOAD'],
    COSTING_STAFF: ['COMPANY_VIEW', 'COMPANY_SWITCH', 'DASHBOARD_VIEW', 'PROFILE_VIEW', 'INGREDIENT_VIEW', 'INGREDIENT_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_VIEW', 'PACKAGING_CREATE', 'PACKAGING_EDIT', 'RECIPE_VIEW', 'RECIPE_CREATE', 'RECIPE_EDIT', 'COSTING_VIEW', 'COSTING_CALCULATE', 'PRICING_VIEW', 'PRICING_EDIT', 'KPI_VIEW', 'REPORT_VIEW', 'NOTIFICATION_VIEW', 'DOCUMENT_DOWNLOAD'],
  };
  for (const roleName of scopedRoles) {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    for (const permission of permissions.filter(({ code }) => grants[roleName].includes(code))) {
      await prisma.rolePermission.upsert({ where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } }, update: {}, create: { roleId: role.id, permissionId: permission.id } });
    }
  }

  // ---- Admin user ----
  const passwordHash = await bcrypt.hash('ChangeMe123!', 10);
  const admin = await prisma.user.upsert({
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
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdmin.id } },
    update: {},
    create: { userId: admin.id, roleId: superAdmin.id },
  });
  await prisma.companyMembership.upsert({ where: { userId_companyId: { userId: admin.id, companyId: primaryCompany.id } }, update: {}, create: { userId: admin.id, companyId: primaryCompany.id, roleId: superAdmin.id, isDefault: true } });

  const developmentUsers = [
    { username: 'win', email: 'win@s2a.local', password: '3333', fullName: 'วิน', roleId: superAdmin.id },
    { username: 'pueng', email: 'pueng@s2a.local', password: '1234', fullName: 'ผึ้ง', roleId: (await prisma.role.findUniqueOrThrow({ where: { name: RoleName.MANAGER } })).id },
  ];
  for (const definition of developmentUsers) {
    const developmentPasswordHash = await bcrypt.hash(definition.password, 12);
    const user = await prisma.user.upsert({
      where: { username: definition.username },
      update: {},
      create: { username: definition.username, email: definition.email, passwordHash: developmentPasswordHash, fullName: definition.fullName, isActive: true, mustChangePassword: true },
    });
    await prisma.userRole.upsert({
      where: { userId_roleId: { userId: user.id, roleId: definition.roleId } },
      update: {},
      create: { userId: user.id, roleId: definition.roleId },
    });
    await prisma.companyMembership.upsert({ where: { userId_companyId: { userId: user.id, companyId: primaryCompany.id } }, update: { roleId: definition.roleId }, create: { userId: user.id, companyId: primaryCompany.id, roleId: definition.roleId, isDefault: true } });
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
    const created = await prisma.unit.upsert({
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
    await prisma.unitConversion.upsert({
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
    const created = await prisma.category.upsert({
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
    const created = await prisma.item.upsert({
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
  await prisma.supplier.upsert({
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
    const wh = await prisma.warehouse.upsert({
      where: { code: w.code },
      update: {},
      create: { ...w, companyId: primaryCompany.id },
    });
    await prisma.warehouseLocation.upsert({
      where: { warehouseId_code: { warehouseId: wh.id, code: 'DEFAULT' } },
      update: {},
      create: { warehouseId: wh.id, code: 'DEFAULT', zone: 'A', rack: '1', bin: '1' },
    });
  }

  // ---- System settings ----
  await prisma.systemSetting.upsert({
    where: { key: 'COST_METHOD' },
    update: {},
    create: { key: 'COST_METHOD', value: 'MOVING_AVERAGE' },
  });

  console.log('✅ seed เสร็จสิ้น');
}

main()
  .catch((e) => {
    console.error('❌ seed ล้มเหลว:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
