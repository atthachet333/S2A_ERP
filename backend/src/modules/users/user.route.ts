import type { FastifyInstance } from 'fastify';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePasswordChanged } from '../auth/auth.guard.js';

export default async function userRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePasswordChanged }, async (req, reply) => {
    if (!req.user.roles.includes('SUPER_ADMIN')) return reply.status(403).send(fail('FORBIDDEN', 'คุณไม่มีสิทธิ์ใช้งานส่วนนี้'));
    const users = await prisma.user.findMany({ where: { deletedAt: null }, select: { id: true, username: true, email: true, fullName: true, isActive: true, mustChangePassword: true, lastLoginAt: true, createdAt: true, userRoles: { select: { role: { select: { name: true } } } } }, orderBy: { username: 'asc' } });
    return ok(users.map(({ userRoles, lastLoginAt, createdAt, ...user }) => ({ ...user, roles: userRoles.map(({ role }) => role.name), lastLoginAt: lastLoginAt?.toISOString() ?? null, createdAt: createdAt.toISOString() })));
  });
}
