import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

async function resetDevelopmentUsers() {
  for (const [username, password] of [['win', '3333'], ['pueng', '1234']] as const) {
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.update({ where: { username }, data: { passwordHash, mustChangePassword: true, isActive: true } });
    await prisma.refreshToken.deleteMany({ where: { userId: user.id } });
  }
}

describe.sequential('authentication integration', () => {
  let app: FastifyInstance; let accessToken = ''; let refreshToken = '';
  beforeAll(async () => { await resetDevelopmentUsers(); app = await buildApp(); await app.ready(); });
  afterAll(async () => { if (app) await app.close(); await resetDevelopmentUsers(); await prisma.$disconnect(); });

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
  it('rotates refresh tokens once and rejects reuse', async () => {
    const rotated = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } }); expect(rotated.statusCode).toBe(200); const next = rotated.json().data; expect(next.refreshToken).not.toBe(refreshToken);
    const reused = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } }); expect(reused.statusCode).toBe(401); refreshToken = next.refreshToken; accessToken = next.accessToken;
  });
  it('gives pueng ADMIN permissions without SUPER_ADMIN access', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'pueng', password: '1234' } }); const data = login.json().data;
    expect(data.user.roles).toEqual(['ADMIN']); expect(data.user.permissions).not.toContain('USER_MANAGE');
    const users = await app.inject({ method: 'GET', url: '/api/users', headers: { authorization: `Bearer ${data.accessToken}` } }); expect(users.statusCode).toBe(403);
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
