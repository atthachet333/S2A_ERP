import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { authenticate, requirePasswordChanged } from './auth.guard.js';
import { createRefreshToken, findUser, findUserById, revokeRefreshToken, rotateRefreshToken, toAuthUser, updatePassword, verifyPassword } from './auth.service.js';
import './auth.types.js';

const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1).optional() });
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/) });
const signAccessToken = (app: FastifyInstance, user: ReturnType<typeof toAuthUser>) => app.jwt.sign({ sub: user.id, username: user.username, roles: user.roles, permissions: user.permissions });

export default async function authRoutes(app: FastifyInstance) {
  app.post('/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await findUser(body.username);
    const valid = Boolean(user?.isActive && await verifyPassword(body.password, user.passwordHash));
    await prisma.loginLog.create({ data: { userId: user?.id, username: body.username, success: valid, ip: req.ip, userAgent: req.headers['user-agent'] } });
    if (!valid || !user) return reply.status(401).send(fail('INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const safeUser = toAuthUser(user);
    return ok({ accessToken: signAccessToken(app, safeUser), refreshToken: await createRefreshToken(user.id, req.ip, req.headers['user-agent']), user: safeUser });
  });

  app.post('/refresh', async (req, reply) => {
    const { refreshToken } = refreshSchema.parse((req.body ?? {}) as object);
    if (!refreshToken) return reply.status(401).send(fail('INVALID_REFRESH_TOKEN', 'เซสชันไม่ถูกต้องหรือหมดอายุ'));
    const rotated = await rotateRefreshToken(refreshToken, req.ip, req.headers['user-agent']);
    if (!rotated) return reply.status(401).send(fail('INVALID_REFRESH_TOKEN', 'เซสชันไม่ถูกต้องหรือหมดอายุ'));
    return ok({ accessToken: signAccessToken(app, rotated.user), refreshToken: rotated.refreshToken, user: rotated.user });
  });

  app.post('/logout', async (req) => {
    const { refreshToken } = refreshSchema.parse((req.body ?? {}) as object);
    await revokeRefreshToken(refreshToken);
    return ok(null, 'ออกจากระบบแล้ว');
  });

  app.get('/me', { preHandler: authenticate }, async (req, reply) => {
    const user = await findUserById(req.user.sub);
    return user ? ok(toAuthUser(user)) : reply.status(401).send(fail('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ'));
  });
  app.get('/dashboard', { preHandler: requirePasswordChanged }, async () => ok({ ready: true }));

  app.post('/change-password', { preHandler: authenticate }, async (req, reply) => {
    const body = passwordSchema.parse(req.body);
    const user = await findUserById(req.user.sub);
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) return reply.status(400).send(fail('INVALID_CURRENT_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง'));
    if (await verifyPassword(body.newPassword, user.passwordHash)) return reply.status(400).send(fail('PASSWORD_REUSED', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'));
    await updatePassword(user.id, body.newPassword, req.ip);
    return ok(null, 'เปลี่ยนรหัสผ่านสำเร็จ กรุณาเข้าสู่ระบบอีกครั้ง');
  });
}
