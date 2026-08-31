import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { authenticate, requirePasswordChanged } from './auth.guard.js';
import { createRefreshToken, findUser, findUserById, revokeRefreshToken, rotateRefreshToken, toAuthUser, updatePassword, verifyPassword } from './auth.service.js';
import './auth.types.js';

const loginSchema = z.object({ username: z.string().trim().min(1), password: z.string().min(1) });
const refreshSchema = z.object({ refreshToken: z.string().min(1).optional(), companyId: z.string().min(1).optional() });
const selectCompanySchema = z.object({ companyId: z.string().min(1) });
const passwordSchema = z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(10).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/) });
const forgotPasswordSchema = z.object({ identifier: z.string().trim().min(1).max(200) });
const resetPasswordSchema = z.object({ token: z.string().min(20), newPassword: z.string().min(10).regex(/[a-z]/).regex(/[A-Z]/).regex(/\d/).regex(/[^A-Za-z0-9]/) });
const registerSchema = z.object({
  fullName: z.string({ required_error: 'กรุณาระบุชื่อ-นามสกุล' }).trim().min(2, 'ชื่อ-นามสกุลต้องมีอย่างน้อย 2 ตัวอักษร').max(160, 'ชื่อ-นามสกุลยาวเกินไป'),
  username: z.string({ required_error: 'กรุณาระบุชื่อผู้ใช้' }).trim().min(3, 'ชื่อผู้ใช้ต้องมีอย่างน้อย 3 ตัวอักษร').max(60, 'ชื่อผู้ใช้ยาวเกินไป').regex(/^[A-Za-z0-9._-]+$/, 'ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง'),
  email: z.string({ required_error: 'กรุณาระบุอีเมล' }).trim().email('รูปแบบอีเมลไม่ถูกต้อง').max(200, 'อีเมลยาวเกินไป'),
  phone: z.string().trim().max(40, 'หมายเลขโทรศัพท์ยาวเกินไป').optional(),
  password: z.string({ required_error: 'กรุณาระบุรหัสผ่าน' }).min(10, 'รหัสผ่านต้องมีอย่างน้อย 10 ตัวอักษร').regex(/[a-z]/, 'รหัสผ่านต้องมีตัวพิมพ์เล็ก').regex(/[A-Z]/, 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่').regex(/\d/, 'รหัสผ่านต้องมีตัวเลข').regex(/[^A-Za-z0-9]/, 'รหัสผ่านต้องมีอักขระพิเศษ'),
  termsAccepted: z.literal(true, { errorMap: () => ({ message: 'กรุณายอมรับเงื่อนไขการใช้งาน' }) }),
}).strict();
const resetTokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();
const registrationAllowed = (ip: string) => { const now = Date.now(); const current = registrationAttempts.get(ip); if (!current || current.resetAt <= now) { registrationAttempts.set(ip, { count: 1, resetAt: now + 15 * 60_000 }); return true; } if (current.count >= 8) return false; current.count += 1; return true; };
const duplicateRegistrationCode = (error: Prisma.PrismaClientKnownRequestError) => {
  const target = String(error.meta?.target ?? '').toLowerCase();
  if (target.includes('username')) return ['USERNAME_ALREADY_EXISTS', 'ชื่อผู้ใช้นี้ถูกใช้แล้ว'] as const;
  if (target.includes('email')) return ['EMAIL_ALREADY_EXISTS', 'อีเมลนี้ถูกใช้แล้ว'] as const;
  return ['ACCOUNT_ALREADY_EXISTS', 'ชื่อผู้ใช้หรืออีเมลนี้ถูกใช้งานแล้ว'] as const;
};
const signAccessToken = (app: FastifyInstance, user: ReturnType<typeof toAuthUser>) => app.jwt.sign({ sub: user.id, username: user.username, roles: user.roles, permissions: user.permissions, companyId: user.activeCompany?.id });

export default async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (req, reply) => {
    const body = registerSchema.parse(req.body);
    // Invalid forms are rejected before the expensive-work limiter, so correcting a
    // field does not consume all registration attempts. Valid attempts remain limited.
    if (!registrationAllowed(req.ip)) return reply.status(429).send(fail('REGISTRATION_RATE_LIMITED', 'มีการลงทะเบียนมากเกินไป กรุณาลองใหม่ภายหลัง'));
    const passwordHash = await bcrypt.hash(body.password, 12);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { fullName: body.fullName, username: body.username.toLowerCase(), email: body.email.toLowerCase(), passwordHash, mustChangePassword: false, isActive: true, registrationStatus: 'PENDING' } });
        await tx.auditLog.create({ data: { userId: created.id, action: 'USER_SELF_REGISTERED', entity: 'User', entityId: created.id, ip: req.ip, after: { username: created.username, email: created.email, membershipCount: 0, verificationConfigured: false } } });
        return created;
      });
      return reply.status(201).send(ok({ id: user.id, username: user.username, email: user.email, status: 'PENDING_WORKSPACE', emailVerificationRequired: false }, 'สร้างบัญชีสำเร็จ'));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const [code, message] = duplicateRegistrationCode(error);
        return reply.status(409).send(fail(code, message));
      }
      throw error;
    }
  });
  app.post('/forgot-password', async (req) => {
    const { identifier } = forgotPasswordSchema.parse(req.body);
    const user = await prisma.user.findFirst({ where: { deletedAt: null, isActive: true, OR: [{ username: { equals: identifier } }, { email: { equals: identifier } }] }, select: { id: true } });
    if (user) await prisma.auditLog.create({ data: { userId: user.id, action: 'PASSWORD_RESET_REQUESTED', entity: 'User', entityId: user.id, ip: req.ip, after: { deliveryConfigured: false } } });
    return ok({ deliveryAvailable: false }, 'หากข้อมูลตรงกับบัญชีในระบบ เราได้เริ่มขั้นตอนรีเซ็ตรหัสผ่านให้แล้ว กรุณาติดต่อผู้ดูแลระบบเพื่อดำเนินการต่อ');
  });

  app.post('/reset-password', async (req, reply) => {
    const body = resetPasswordSchema.parse(req.body);
    const token = await prisma.passwordResetToken.findUnique({ where: { tokenHash: resetTokenHash(body.token) }, include: { user: { select: { id: true, isActive: true, deletedAt: true } } } });
    if (!token || token.usedAt || token.expiresAt <= new Date() || !token.user.isActive || token.user.deletedAt) return reply.status(400).send(fail('INVALID_RESET_TOKEN', 'ลิงก์รีเซ็ตรหัสผ่านไม่ถูกต้อง หมดอายุ หรือถูกใช้งานแล้ว'));
    const passwordHash = await bcrypt.hash(body.newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: token.userId }, data: { passwordHash, mustChangePassword: false } }),
      prisma.passwordResetToken.update({ where: { id: token.id }, data: { usedAt: new Date() } }),
      prisma.passwordResetToken.updateMany({ where: { userId: token.userId, id: { not: token.id }, usedAt: null }, data: { usedAt: new Date() } }),
      prisma.refreshToken.updateMany({ where: { userId: token.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
      prisma.auditLog.create({ data: { userId: token.userId, action: 'PASSWORD_RESET_COMPLETED', entity: 'User', entityId: token.userId, ip: req.ip } }),
    ]);
    return ok(null, 'ตั้งรหัสผ่านใหม่สำเร็จ กรุณาเข้าสู่ระบบ');
  });

  app.post('/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const user = await findUser(body.username);
    const valid = Boolean(user?.isActive && await verifyPassword(body.password, user.passwordHash));
    await prisma.loginLog.create({ data: { userId: user?.id, username: body.username, success: valid, ip: req.ip, userAgent: req.headers['user-agent'] } });
    if (!valid || !user) return reply.status(401).send(fail('INVALID_CREDENTIALS', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'));
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    const safeUser = toAuthUser(user, user.companyMemberships.length === 1 ? user.companyMemberships[0].companyId : undefined);
    return ok({ accessToken: signAccessToken(app, safeUser), refreshToken: await createRefreshToken(user.id, req.ip, req.headers['user-agent']), user: safeUser });
  });

  app.post('/refresh', async (req, reply) => {
    const { refreshToken, companyId } = refreshSchema.parse((req.body ?? {}) as object);
    if (!refreshToken) return reply.status(401).send(fail('INVALID_REFRESH_TOKEN', 'เซสชันไม่ถูกต้องหรือหมดอายุ'));
    const rotated = await rotateRefreshToken(refreshToken, req.ip, req.headers['user-agent'], companyId);
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
    return user ? ok(toAuthUser(user, req.user.companyId)) : reply.status(401).send(fail('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ'));
  });
  app.get('/companies', { preHandler: requirePasswordChanged }, async (req, reply) => {
    const user = await findUserById(req.user.sub);
    return user ? ok(toAuthUser(user).companies) : reply.status(401).send(fail('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ'));
  });
  app.post('/select-company', { preHandler: requirePasswordChanged }, async (req, reply) => {
    const { companyId } = selectCompanySchema.parse(req.body);
    const user = await findUserById(req.user.sub);
    const membership = user?.companyMemberships.find((entry) => entry.companyId === companyId);
    if (!user || !membership) return reply.status(403).send(fail('COMPANY_ACCESS_DENIED', 'คุณไม่มีสิทธิ์ใช้งานบริษัทนี้'));
    const safeUser = toAuthUser(user, companyId);
    await prisma.auditLog.create({ data: { userId: user.id, companyId, action: 'SWITCH_COMPANY', entity: 'Company', entityId: companyId, ip: req.ip } });
    return ok({ accessToken: signAccessToken(app, safeUser), user: safeUser });
  });
  app.get('/dashboard', { preHandler: requirePasswordChanged }, async () => ok({ ready: true }));

  app.post('/change-password', { preHandler: authenticate }, async (req, reply) => {
    const body = passwordSchema.parse(req.body);
    const user = await findUserById(req.user.sub);
    if (!user || !(await verifyPassword(body.currentPassword, user.passwordHash))) return reply.status(400).send(fail('INVALID_CURRENT_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง'));
    if (await verifyPassword(body.newPassword, user.passwordHash)) return reply.status(400).send(fail('PASSWORD_REUSED', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'));
    await updatePassword(user.id, body.newPassword, req.ip);
    const updated = await findUserById(user.id);
    if (!updated) return reply.status(401).send(fail('UNAUTHORIZED', 'ไม่พบบัญชีผู้ใช้'));
    const safeUser = toAuthUser(updated, updated.companyMemberships.length === 1 ? updated.companyMemberships[0].companyId : undefined);
    return ok({
      accessToken: signAccessToken(app, safeUser),
      refreshToken: await createRefreshToken(user.id, req.ip, req.headers['user-agent']),
      user: safeUser,
    }, 'เปลี่ยนรหัสผ่านสำเร็จ');
  });
}
