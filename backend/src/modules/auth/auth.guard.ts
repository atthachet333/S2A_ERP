import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../../lib/response.js';
import { findUserById } from './auth.service.js';
import { prisma } from '../../lib/prisma.js';

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try { await req.jwtVerify(); } catch { return reply.status(401).send(fail('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ')); }
  const user = await findUserById(req.user.sub);
  if (!user?.isActive) return reply.status(401).send(fail('UNAUTHORIZED', 'บัญชีผู้ใช้ไม่พร้อมใช้งาน'));
}

export async function requirePasswordChanged(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply);
  if (reply.sent) return;
  const user = await findUserById(req.user.sub);
  if (user?.mustChangePassword) return reply.status(403).send(fail('PASSWORD_CHANGE_REQUIRED', 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ'));
}

export async function requireCompany(req: FastifyRequest, reply: FastifyReply) {
  await requirePasswordChanged(req, reply);
  if (reply.sent) return;
  if (!req.user.companyId) return reply.status(403).send(fail('COMPANY_REQUIRED', 'กรุณาเลือกบริษัทก่อนใช้งาน'));
  const membership = await prisma.companyMembership.findFirst({
    where: { userId: req.user.sub, companyId: req.user.companyId, isActive: true, company: { isActive: true } },
  });
  if (!membership) return reply.status(403).send(fail('COMPANY_ACCESS_DENIED', 'คุณไม่มีสิทธิ์ใช้งานบริษัทนี้'));
}

export function requirePermission(...permissions: string[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    await requireCompany(req, reply);
    if (reply.sent) return;
    const allowed = req.user.roles.includes('SUPER_ADMIN') || permissions.some((permission) => req.user.permissions.includes(permission));
    if (!allowed) return reply.status(403).send(fail('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้'));
  };
}
