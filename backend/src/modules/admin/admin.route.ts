import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { RoleName } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';

const isSuperAdmin = (req: FastifyRequest) => req.user.roles.includes('SUPER_ADMIN');

// จัดกลุ่ม permission code → กลุ่มที่มนุษย์อ่านง่าย (ใช้จัด matrix ในหน้าเว็บ)
function groupOf(code: string): string {
  if (code.startsWith('INGREDIENT_')) return 'Ingredients';
  if (code.startsWith('PACKAGING_')) return 'Packaging';
  if (code.startsWith('RECIPE_')) return 'Recipes';
  if (code.startsWith('COSTING_')) return 'Costing';
  if (code.startsWith('PRICING_')) return 'Pricing';
  if (code.startsWith('CUSTOMER_')) return 'Customers';
  if (code.startsWith('ORDER_')) return 'Orders';
  if (code.startsWith('RECEIVING_')) return 'Receiving';
  if (code.startsWith('STOCK_')) return 'Stock';
  if (code.startsWith('COMPANY_')) return 'Companies';
  if (code.startsWith('DOCUMENT_')) return 'Documents';
  if (code === 'DASHBOARD_VIEW' || code === 'KPI_VIEW') return 'Dashboard';
  if (code === 'REPORT_VIEW') return 'Reports';
  if (code === 'NOTIFICATION_VIEW') return 'Notifications';
  if (code === 'USER_VIEW' || code === 'USER_MANAGE') return 'Users';
  if (code === 'ROLE_MANAGE' || code === 'PERMISSION_MANAGE') return 'Permissions';
  if (code === 'AUDIT_VIEW') return 'Audit';
  if (code === 'SYSTEM_SETTINGS' || code === 'SECURITY_SETTINGS') return 'Settings';
  return 'Other';
}

const READ = requirePermission('ROLE_MANAGE', 'PERMISSION_MANAGE', 'USER_MANAGE');
const PERM_MANAGE = requirePermission('PERMISSION_MANAGE');
const USER_MANAGE = requirePermission('USER_MANAGE');

export default async function adminRoutes(app: FastifyInstance) {
  // ---- Roles & Permissions matrix ----
  app.get('/permissions/matrix', { preHandler: READ }, async () => {
    const [roles, permissions, rolePermissions] = await Promise.all([
      prisma.role.findMany({ select: { id: true, name: true, description: true }, orderBy: { name: 'asc' } }),
      prisma.permission.findMany({ select: { code: true, description: true }, orderBy: { code: 'asc' } }),
      prisma.rolePermission.findMany({ select: { role: { select: { name: true } }, permission: { select: { code: true } } } }),
    ]);
    const grants: Record<string, string[]> = {};
    for (const role of roles) grants[role.name] = [];
    for (const rp of rolePermissions) (grants[rp.role.name] ??= []).push(rp.permission.code);
    return ok({
      roles,
      permissions: permissions.map((p) => ({ code: p.code, group: groupOf(p.code) })),
      grants,
      // SUPER_ADMIN มีสิทธิ์เต็มเสมอในระดับโค้ด (bypass) — ล็อกไม่ให้แก้เพื่อกันล็อกเอาต์ทั้งระบบ
      locked: [RoleName.SUPER_ADMIN],
    });
  });

  app.put('/roles/:roleName/permissions', { preHandler: PERM_MANAGE }, async (req, reply) => {
    const { roleName } = z.object({ roleName: z.nativeEnum(RoleName) }).parse(req.params);
    const { permissions } = z.object({ permissions: z.array(z.string()).max(200) }).parse(req.body);
    if (roleName === RoleName.SUPER_ADMIN) return reply.status(409).send(fail('ROLE_LOCKED', 'บทบาทผู้ดูแลระบบสูงสุดมีสิทธิ์เต็มเสมอ ไม่สามารถแก้ไขได้'));
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) return reply.status(404).send(fail('ROLE_NOT_FOUND', 'ไม่พบบทบาท'));
    // รับเฉพาะ permission code ที่มีจริงในระบบ
    const valid = await prisma.permission.findMany({ where: { code: { in: permissions } }, select: { id: true, code: true } });
    const before = (await prisma.rolePermission.findMany({ where: { roleId: role.id }, select: { permission: { select: { code: true } } } })).map((r) => r.permission.code);
    await prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      if (valid.length) await tx.rolePermission.createMany({ data: valid.map((p) => ({ roleId: role.id, permissionId: p.id })) });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId: req.user.companyId, action: 'ROLE_PERMISSIONS_UPDATED', entity: 'Role', entityId: role.id, before: { role: roleName, permissions: before }, after: { role: roleName, permissions: valid.map((p) => p.code) } } });
    });
    return ok({ role: roleName, permissions: valid.map((p) => p.code) }, 'บันทึกสิทธิ์เรียบร้อยแล้ว');
  });

  // รายชื่อบริษัท (ใช้เลือกตอนอนุมัติผู้สมัคร) — SUPER_ADMIN เห็นทั้งหมด, อื่น ๆ เห็นเฉพาะบริษัทที่สังกัด
  app.get('/companies', { preHandler: USER_MANAGE }, async (req) => {
    const where = isSuperAdmin(req) ? { isActive: true } : { isActive: true, memberships: { some: { userId: req.user.sub, isActive: true } } };
    const companies = await prisma.company.findMany({ where, select: { id: true, code: true, nameTh: true }, orderBy: { nameTh: 'asc' } });
    return ok(companies.map((c) => ({ ...c, nameTh: c.code === 'S2A-PRIMARY' ? 'ครัวสดดี' : c.nameTh })));
  });

  // รายชื่อบทบาทที่มอบหมายได้ (ไม่รวม SUPER_ADMIN/ADMIN ผ่านโฟลว์อนุมัติ)
  app.get('/assignable-roles', { preHandler: USER_MANAGE }, async () => {
    const roles = await prisma.role.findMany({ where: { name: { notIn: [RoleName.SUPER_ADMIN, RoleName.ADMIN] } }, select: { id: true, name: true }, orderBy: { name: 'asc' } });
    return ok(roles);
  });

  // ---- Pending registrations ----
  app.get('/registrations', { preHandler: USER_MANAGE }, async (req) => {
    const { status } = z.object({ status: z.enum(['PENDING', 'APPROVED', 'REJECTED']).default('PENDING') }).parse(req.query ?? {});
    const users = await prisma.user.findMany({
      where: { registrationStatus: status, deletedAt: null },
      // ไม่ดึง passwordHash เด็ดขาด
      select: { id: true, fullName: true, username: true, email: true, isActive: true, createdAt: true, registrationStatus: true, rejectionReason: true, rejectedAt: true, approvedAt: true },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return ok(users.map((u) => ({ ...u, createdAt: u.createdAt.toISOString(), approvedAt: u.approvedAt?.toISOString() ?? null, rejectedAt: u.rejectedAt?.toISOString() ?? null })));
  });

  app.post('/registrations/:id/approve', { preHandler: USER_MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { companyId, role } = z.object({ companyId: z.string().min(1), role: z.nativeEnum(RoleName) }).parse(req.body);
    // ไม่มอบ SUPER_ADMIN/ADMIN ผ่านการอนุมัติสมัคร (ต้องการการกระทำที่เข้มกว่านี้)
    if (role === RoleName.SUPER_ADMIN || role === RoleName.ADMIN) return reply.status(403).send(fail('ROLE_NOT_ALLOWED', 'ไม่สามารถมอบบทบาทผู้ดูแลระบบผ่านการอนุมัติสมัครได้'));
    // ผู้ที่ไม่ใช่ SUPER_ADMIN อนุมัติเข้าได้เฉพาะบริษัทที่ตนสังกัดอยู่
    if (!isSuperAdmin(req) && companyId !== req.user.companyId) return reply.status(403).send(fail('COMPANY_SCOPE_DENIED', 'อนุมัติได้เฉพาะบริษัทที่คุณสังกัด'));
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) return reply.status(404).send(fail('USER_NOT_FOUND', 'ไม่พบผู้ใช้'));
    if (user.registrationStatus !== 'PENDING') return reply.status(409).send(fail('NOT_PENDING', 'คำขอนี้ถูกดำเนินการไปแล้ว'));
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    if (!company) return reply.status(404).send(fail('COMPANY_NOT_FOUND', 'ไม่พบบริษัท'));
    const roleRecord = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: true, registrationStatus: 'APPROVED', approvedAt: new Date(), approvedById: req.user.sub, rejectedAt: null, rejectedById: null, rejectionReason: null } });
      await tx.companyMembership.upsert({ where: { userId_companyId: { userId: id, companyId } }, update: { roleId: roleRecord.id, isActive: true }, create: { userId: id, companyId, roleId: roleRecord.id, isActive: true, isDefault: true } });
      await tx.userRole.upsert({ where: { userId_roleId: { userId: id, roleId: roleRecord.id } }, update: {}, create: { userId: id, roleId: roleRecord.id } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'REGISTRATION_APPROVED', entity: 'User', entityId: id, after: { username: user.username, companyId, role } } });
    });
    return ok({ id, status: 'APPROVED', role, companyId }, 'อนุมัติผู้ใช้เรียบร้อยแล้ว');
  });

  app.post('/registrations/:id/reject', { preHandler: USER_MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { reason } = z.object({ reason: z.string().max(500).optional() }).parse(req.body ?? {});
    const user = await prisma.user.findFirst({ where: { id, deletedAt: null } });
    if (!user) return reply.status(404).send(fail('USER_NOT_FOUND', 'ไม่พบผู้ใช้'));
    if (user.registrationStatus !== 'PENDING') return reply.status(409).send(fail('NOT_PENDING', 'คำขอนี้ถูกดำเนินการไปแล้ว'));
    // ไม่ลบผู้ใช้ที่ถูกปฏิเสธ — ปิดใช้งานและบันทึกเหตุผลไว้เท่านั้น
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive: false, registrationStatus: 'REJECTED', rejectedAt: new Date(), rejectedById: req.user.sub, rejectionReason: reason ?? null } });
      await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId: req.user.companyId, action: 'REGISTRATION_REJECTED', entity: 'User', entityId: id, after: { username: user.username, reason: reason ?? null } } });
    });
    return ok({ id, status: 'REJECTED' }, 'ปฏิเสธคำขอสมัครแล้ว');
  });
}
