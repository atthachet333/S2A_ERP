import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

async function resetDevelopmentUsers() {
  for (const [username, password] of [['win', '3333'], ['pueng', '1234']] as const) {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({ where: { username }, data: { passwordHash, mustChangePassword: true, isActive: true } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
    await prisma.passwordResetToken.deleteMany({ where: { userId: user.id } });
  }
}

describe.sequential('authentication integration', () => {
  let app: FastifyInstance; let accessToken = ''; let refreshToken = ''; let createdCompanyId = '';
  beforeAll(async () => { await resetDevelopmentUsers(); app = await buildApp(); await app.ready(); });
  afterAll(async () => { if (createdCompanyId) { await prisma.auditLog.deleteMany({ where: { companyId: createdCompanyId } }); await prisma.companyMembership.deleteMany({ where: { companyId: createdCompanyId } }); await prisma.company.deleteMany({ where: { id: createdCompanyId } }); } if (app) await app.close(); await resetDevelopmentUsers(); await prisma.$disconnect(); });

  it('rejects invalid credentials with the original Thai message', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'win', password: 'wrong' } });
    expect(response.statusCode).toBe(401); expect(response.json().error).toMatchObject({ code: 'INVALID_CREDENTIALS', message: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
  });
  it('returns INVALID_JSON for malformed JSON', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, payload: '{bad' });
    expect(response.statusCode).toBe(400); expect(response.json().error.code).toBe('INVALID_JSON');
  });
  it('accepts refresh without a body without returning INTERNAL_ERROR', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/refresh' });
    expect(response.statusCode).toBe(401); expect(response.json().error.code).toBe('INVALID_REFRESH_TOKEN');
  });
  it('accepts logout without a body', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/logout' });
    expect(response.statusCode).toBe(200); expect(response.json().success).toBe(true);
  });
  it('logs win in and requires a password change', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'win', password: '3333' } });
    expect(response.statusCode).toBe(200); const data = response.json().data; accessToken = data.accessToken; refreshToken = data.refreshToken;
    expect(data.user).toMatchObject({ username: 'win', mustChangePassword: true, roles: ['SUPER_ADMIN'] });
  });
  it('blocks dashboard before the first password change', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/auth/dashboard', headers: { authorization: `Bearer ${accessToken}` } });
    expect(response.statusCode).toBe(403); expect(response.json().error.code).toBe('PASSWORD_CHANGE_REQUIRED');
  });
  it('changes the temporary password and records an audit entry', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/change-password', headers: { authorization: `Bearer ${accessToken}` }, payload: { currentPassword: '3333', newPassword: 'S2aTest3333!' } });
    expect(response.statusCode).toBe(200); const user = await prisma.user.findUniqueOrThrow({ where: { username: 'win' } }); expect(user.mustChangePassword).toBe(false);
    expect(await prisma.auditLog.count({ where: { userId: user.id, action: 'CHANGE_PASSWORD' } })).toBeGreaterThan(0);
  });
  it('revokes the previous refresh token after password change', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } });
    expect(response.statusCode).toBe(401); expect(response.json().error.code).toBe('INVALID_REFRESH_TOKEN');
  });
  it('rejects the old password and accepts the new password', async () => {
    const oldResponse = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'win', password: '3333' } }); expect(oldResponse.statusCode).toBe(401);
    const response = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'win', password: 'S2aTest3333!' } }); expect(response.statusCode).toBe(200); accessToken = response.json().data.accessToken; refreshToken = response.json().data.refreshToken;
  });
  it('allows dashboard and user administration after password change', async () => {
    const dashboard = await app.inject({ method: 'GET', url: '/api/auth/dashboard', headers: { authorization: `Bearer ${accessToken}` } }); expect(dashboard.statusCode).toBe(200);
    const users = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: `Bearer ${accessToken}` } }); expect(users.statusCode).toBe(200); expect(users.json().data.some((user: { username: string }) => user.username === 'pueng')).toBe(true);
  });
  it('allows only SUPER_ADMIN to create a company with creator membership and audit', async () => {
    const deniedUser = await prisma.user.findUniqueOrThrow({ where: { username: 'pueng' } });
    for (const role of ['MANAGER', 'OPERATIONS', 'ORDER_COORDINATOR', 'CHEF', 'COSTING_STAFF']) {
      const deniedToken = app.jwt.sign({ sub: deniedUser.id, username: deniedUser.username, roles: [role], permissions: [] });
      const denied = await app.inject({ method: 'POST', url: '/api/companies', headers: { authorization: `Bearer ${deniedToken}` }, payload: { nameTh: 'Denied', code: `DENIED-${role}` } });
      expect(denied.statusCode).toBe(403);
    }
    const code = `CMP-${Date.now().toString().slice(-8)}`;
    const response = await app.inject({ method: 'POST', url: '/api/companies', headers: { authorization: `Bearer ${accessToken}` }, payload: { nameTh: 'บริษัททดสอบ', code, email: 'company@example.com', taxId: '1234567890123' } });
    expect(response.statusCode).toBe(201); createdCompanyId = response.json().data.id;
    const creator = await prisma.user.findUniqueOrThrow({ where: { username: 'win' } });
    expect(await prisma.companyMembership.count({ where: { companyId: createdCompanyId, userId: creator.id, role: { name: 'SUPER_ADMIN' } } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { companyId: createdCompanyId, action: 'COMPANY_CREATED' } })).toBe(1);
    const duplicate = await app.inject({ method: 'POST', url: '/api/companies', headers: { authorization: `Bearer ${accessToken}` }, payload: { nameTh: 'ซ้ำ', code } });
    expect(duplicate.statusCode).toBe(409);
  });
  it('returns real dashboard summary counts for an authenticated user', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/dashboard/summary', headers: { authorization: `Bearer ${accessToken}` } });
    expect(response.statusCode).toBe(200); const data = response.json().data;
    for (const key of ['users', 'activeUsers', 'units', 'warehouses', 'items', 'recipes']) expect(typeof data[key]).toBe('number');
    expect(data.users).toBeGreaterThanOrEqual(2);
  });
  it('returns paginated recent activity for SUPER_ADMIN', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/activity?page=1&pageSize=5', headers: { authorization: `Bearer ${accessToken}` } });
    expect(response.statusCode).toBe(200); const data = response.json().data;
    expect(Array.isArray(data.items)).toBe(true); expect(data.items.length).toBeLessThanOrEqual(5);
    expect(data).toMatchObject({ page: 1, pageSize: 5 }); expect(typeof data.total).toBe('number');
    // ล็อกอินสำเร็จของ win ต้องปรากฏในประวัติจริง
    expect(data.items.some((entry: { action: string }) => entry.action === 'LOGIN_SUCCESS')).toBe(true);
  });
  it('rejects activity and dashboard summary without authentication', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/activity' })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/dashboard/summary' })).statusCode).toBe(401);
  });
  it('rotates refresh tokens once and rejects reuse', async () => {
    const rotated = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } }); expect(rotated.statusCode).toBe(200); const next = rotated.json().data; expect(next.refreshToken).not.toBe(refreshToken);
    const reused = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } }); expect(reused.statusCode).toBe(401); refreshToken = next.refreshToken; accessToken = next.accessToken;
  });
  it('gives pueng MANAGER company permissions without SUPER_ADMIN access', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'pueng', password: '1234' } }); const data = login.json().data;
    expect(data.user.roles).toEqual(['MANAGER']); expect(data.user.permissions).toContain('USER_MANAGE');
    const users = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: `Bearer ${data.accessToken}` } }); expect(users.statusCode).toBe(403);
    const activity = await app.inject({ method: 'GET', url: '/api/activity', headers: { authorization: `Bearer ${data.accessToken}` } }); expect(activity.statusCode).toBe(403);
  });
  it('returns the same neutral forgot-password response for known and unknown accounts', async () => {
    const known = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { identifier: 'win' } });
    const unknown = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: { identifier: `unknown-${Date.now()}` } });
    expect(known.statusCode).toBe(200); expect(unknown.statusCode).toBe(200);
    expect(known.json().message).toBe(unknown.json().message);
    expect(known.json().data).toEqual(unknown.json().data);
  });
  it('rejects invalid, expired and used reset tokens, then resets once and revokes sessions', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { username: 'win' } });
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    const expired = randomBytes(32).toString('base64url'); const used = randomBytes(32).toString('base64url'); const valid = randomBytes(32).toString('base64url');
    await prisma.passwordResetToken.createMany({ data: [
      { userId: user.id, tokenHash: hash(expired), expiresAt: new Date(Date.now() - 1000) },
      { userId: user.id, tokenHash: hash(used), expiresAt: new Date(Date.now() + 60_000), usedAt: new Date() },
      { userId: user.id, tokenHash: hash(valid), expiresAt: new Date(Date.now() + 60_000) },
    ] });
    for (const token of ['not-a-valid-reset-token-value', expired, used]) expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token, newPassword: 'SelfReset123!' } })).statusCode).toBe(400);
    const reset = await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: valid, newPassword: 'SelfReset123!' } }); expect(reset.statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/reset-password', payload: { token: valid, newPassword: 'AgainReset123!' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'win', password: 'S2aTest3333!' } })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'win', password: 'SelfReset123!' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })).statusCode).toBe(401);
    expect(await prisma.auditLog.count({ where: { userId: user.id, action: 'PASSWORD_RESET_COMPLETED' } })).toBeGreaterThan(0);
  });
  it('logs out, revokes refresh and protects routes', async () => {
    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken } }); expect(logout.statusCode).toBe(200);
    const refresh = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } }); expect(refresh.statusCode).toBe(401);
    const protectedResponse = await app.inject({ method: 'GET', url: '/api/auth/dashboard' }); expect(protectedResponse.statusCode).toBe(401);
  });
  it('stores login logs without password or token fields', async () => {
    const log = await prisma.loginLog.findFirst({ where: { username: 'win' }, orderBy: { createdAt: 'desc' } }); expect(log).toBeTruthy(); expect(Object.keys(log ?? {})).not.toContain('password'); expect(Object.keys(log ?? {})).not.toContain('token');
  });
});
