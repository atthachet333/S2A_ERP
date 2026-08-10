import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { RoleName } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePermission } from '../auth/auth.guard.js';

const protectedRoles = new Set<RoleName>([RoleName.SUPER_ADMIN, RoleName.ADMIN]);
const generatedPassword = () => `Temp#${randomBytes(9).toString('base64url')}`;
const isSuperAdmin = (req: FastifyRequest) => req.user.roles.includes('SUPER_ADMIN');

async function guardProtectedTarget(req: FastifyRequest, userId: string, roleName: RoleName, reply: FastifyReply) {
  if (!isSuperAdmin(req) && protectedRoles.has(roleName)) {
    reply.status(403).send(fail('PROTECTED_ROLE', 'เฉพาะผู้ดูแลระบบสูงสุดเท่านั้นที่จัดการบัญชีบทบาทนี้ได้'));
    return false;
  }
  if (req.user.sub === userId) {
    reply.status(409).send(fail('SELF_ADMIN_ACTION_DENIED', 'ไม่สามารถปิดใช้งานหรือเปลี่ยนบทบาทบัญชีของตนเองจากหน้านี้'));
    return false;
  }
  return true;
}

export default async function userRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePermission('USER_VIEW', 'USER_MANAGE') }, async (req) => {
    const memberships = await prisma.companyMembership.findMany({
      where: { companyId: req.user.companyId!, user: { deletedAt: null } },
      select: { isActive: true, role: { select: { name: true } }, company: { select: { id: true, nameTh: true, code: true } }, user: { select: { id: true, username: true, email: true, fullName: true, isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true } } },
      orderBy: { user: { username: 'asc' } },
    });
    return ok(memberships.map(({ role, company, isActive: membershipActive, user: { lastLoginAt, createdAt, ...user } }) => ({ ...user, company: { ...company, nameTh: company.code === 'S2A-PRIMARY' ? 'ครัวสดดี' : company.nameTh }, isActive: user.isActive && membershipActive, roles: [role.name], lastLoginAt: lastLoginAt?.toISOString() ?? null, createdAt: createdAt.toISOString() })));
  });

  app.get('/roles', { preHandler: requirePermission('USER_MANAGE') }, async (req) => {
    const roles = await prisma.role.findMany({ where: isSuperAdmin(req) ? {} : { name: { notIn: [RoleName.SUPER_ADMIN, RoleName.ADMIN] } }, select: { id: true, name: true, description: true }, orderBy: { name: 'asc' } });
    return ok(roles);
  });

  app.post('/', { preHandler: requirePermission('USER_MANAGE') }, async (req, reply) => {
    const body = z.object({ fullName: z.string().trim().min(2).max(160), username: z.string().trim().min(3).max(60).regex(/^[a-zA-Z0-9._-]+$/), email: z.string().email().optional().or(z.literal('')), role: z.nativeEnum(RoleName), isActive: z.boolean().default(true), temporaryPassword: z.string().min(10).max(128).optional() }).parse(req.body);
    if (!isSuperAdmin(req) && protectedRoles.has(body.role)) return reply.status(403).send(fail('PROTECTED_ROLE', 'คุณไม่มีสิทธิ์สร้างผู้ดูแลระบบระดับสูง'));
    const duplicate = await prisma.user.findFirst({ where: { OR: [{ username: { equals: body.username, mode: 'insensitive' } }, ...(body.email ? [{ email: { equals: body.email, mode: 'insensitive' as const } }] : [])] } });
    if (duplicate) return reply.status(409).send(fail('DUPLICATE_USER', 'Username หรือ Email นี้มีบัญชีอยู่แล้ว'));
    const role = await prisma.role.findUniqueOrThrow({ where: { name: body.role } }); const temporaryPassword = body.temporaryPassword ?? generatedPassword(); const passwordHash = await bcrypt.hash(temporaryPassword, 12); const companyId = req.user.companyId!;
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({ data: { fullName: body.fullName, username: body.username, email: body.email || `${body.username}@account.s2a.local`, passwordHash, isActive: body.isActive, mustChangePassword: true } });
      await tx.userRole.create({ data: { userId: created.id, roleId: role.id } });
      await tx.companyMembership.create({ data: { userId: created.id, companyId, roleId: role.id, isActive: body.isActive, isDefault: true } });
      await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'USER_CREATED', entity: 'User', entityId: created.id, after: { username: created.username, fullName: created.fullName, role: body.role, isActive: body.isActive } } });
      return created;
    });
    return reply.status(201).send(ok({ id: user.id, username: user.username, fullName: user.fullName, temporaryPassword, mustChangePassword: true }));
  });

  app.post('/:id/reset-password', { preHandler: requirePermission('USER_MANAGE') }, async (req, reply) => {
    const { id } = req.params as { id: string }; const companyId = req.user.companyId!;
    const membership = await prisma.companyMembership.findFirst({ where: { userId: id, companyId }, include: { role: true, user: true } });
    if (!membership) return reply.status(404).send(fail('USER_NOT_FOUND', 'ไม่พบบัญชีในบริษัทปัจจุบัน'));
    if (!await guardProtectedTarget(req, id, membership.role.name, reply)) return;
    const temporaryPassword = generatedPassword(); const passwordHash = await bcrypt.hash(temporaryPassword, 12);
    await prisma.$transaction([prisma.user.update({ where: { id }, data: { passwordHash, mustChangePassword: true } }), prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }), prisma.auditLog.create({ data: { userId: req.user.sub, companyId, action: 'PASSWORD_RESET', entity: 'User', entityId: id, after: { mustChangePassword: true, sessionsRevoked: true } } })]);
    return ok({ username: membership.user.username, temporaryPassword, mustChangePassword: true });
  });

  app.patch('/:id', { preHandler: requirePermission('USER_MANAGE') }, async (req, reply) => {
    const { id } = req.params as { id: string }; const body = z.object({ fullName: z.string().trim().min(2).max(160).optional(), email: z.string().email().optional(), role: z.nativeEnum(RoleName).optional(), isActive: z.boolean().optional() }).parse(req.body); const companyId = req.user.companyId!;
    const membership = await prisma.companyMembership.findFirst({ where: { userId: id, companyId }, include: { role: true, user: true } });
    if (!membership) return reply.status(404).send(fail('USER_NOT_FOUND', 'ไม่พบบัญชีในบริษัทปัจจุบัน'));
    if ((body.isActive === false || body.role) && !await guardProtectedTarget(req, id, membership.role.name, reply)) return;
    if (!isSuperAdmin(req) && body.role && protectedRoles.has(body.role)) return reply.status(403).send(fail('PROTECTED_ROLE', 'คุณไม่มีสิทธิ์กำหนดบทบาทผู้ดูแลระบบระดับสูง'));
    if (membership.role.name === RoleName.SUPER_ADMIN && body.isActive === false) { const remaining = await prisma.companyMembership.count({ where: { companyId, isActive: true, role: { name: RoleName.SUPER_ADMIN }, userId: { not: id }, user: { isActive: true, deletedAt: null } } }); if (!remaining) return reply.status(409).send(fail('LAST_SUPER_ADMIN', 'ไม่สามารถปิดใช้งานผู้ดูแลระบบสูงสุดคนสุดท้ายได้')); }
    const nextRole = body.role ? await prisma.role.findUniqueOrThrow({ where: { name: body.role } }) : null;
    await prisma.$transaction(async (tx) => { await tx.user.update({ where: { id }, data: { fullName: body.fullName, email: body.email, ...(body.isActive === undefined ? {} : { isActive: body.isActive }) } }); await tx.companyMembership.update({ where: { id: membership.id }, data: { ...(nextRole ? { roleId: nextRole.id } : {}), ...(body.isActive === undefined ? {} : { isActive: body.isActive }) } }); if (nextRole) { await tx.userRole.deleteMany({ where: { userId: id } }); await tx.userRole.create({ data: { userId: id, roleId: nextRole.id } }); } if (body.isActive === false) await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } }); await tx.auditLog.create({ data: { userId: req.user.sub, companyId, action: body.isActive === false ? 'USER_DISABLED' : body.role ? 'ROLE_CHANGED' : 'USER_UPDATED', entity: 'User', entityId: id, before: { fullName: membership.user.fullName, email: membership.user.email, role: membership.role.name, isActive: membership.isActive }, after: { fullName: body.fullName ?? membership.user.fullName, email: body.email ?? membership.user.email, role: body.role ?? membership.role.name, isActive: body.isActive ?? membership.isActive } } }); });
    return ok({ id, updated: true });
  });
}
