import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const username = 'public_signup_test';
const email = 'public-signup-test@example.com';
const valid = { fullName: 'Public Test User', username, email, password: 'Strong!Pass123', termsAccepted: true };
const cleanupUsernames = [username, 'public_signup_email'];

describe.sequential('public registration security', () => {
  let app: FastifyInstance;
  beforeAll(async () => { await prisma.user.deleteMany({ where: { username: { in: cleanupUsernames } } }); app = await buildApp(); await app.ready(); });
  afterAll(async () => { const users = await prisma.user.findMany({ where: { username: { in: cleanupUsernames } }, select: { id: true } }); await prisma.auditLog.deleteMany({ where: { userId: { in: users.map(({ id }) => id) } } }); await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } }); await app.close(); await prisma.$disconnect(); });

  it('reproduces the real invalid username failure with a safe field message', async () => {
    const payload = { ...valid, username: 'ผู้ใช้ทดสอบ' };
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR', details: { fieldErrors: { username: ['ชื่อผู้ใช้ใช้ได้เฉพาะตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง และขีดล่าง'] } } } });
    expect(await prisma.user.count({ where: { email } })).toBe(0);
  });

  it('requires strong passwords and accepted terms', async () => {
    const weak = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...valid, password: 'weak', termsAccepted: false } });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.details.fieldErrors).toMatchObject({ password: expect.any(Array), termsAccepted: expect.any(Array) });
  });

  it('returns field-level errors for missing fields and invalid email', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, email: 'not-an-email', password: valid.password, termsAccepted: true } });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.details.fieldErrors).toMatchObject({ fullName: expect.any(Array), email: ['รูปแบบอีเมลไม่ถูกต้อง'] });
  });

  it('rejects privilege and existing-company injection fields', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...valid, role: 'SUPER_ADMIN', companyId: 'S2A-PRIMARY' } });
    expect(response.statusCode).toBe(400);
  });

  it('creates an account without any role or company membership', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: valid });
    expect(response.statusCode).toBe(201); expect(response.json().data).toMatchObject({ username, email, status: 'PENDING_WORKSPACE', emailVerificationRequired: false });
    const created = await prisma.user.findUniqueOrThrow({ where: { username }, include: { userRoles: true, companyMemberships: true, auditLogs: true } });
    expect(created.passwordHash).not.toBe(valid.password); expect(created.userRoles).toHaveLength(0); expect(created.companyMemberships).toHaveLength(0); expect(created.auditLogs.some(({ action }) => action === 'USER_SELF_REGISTERED')).toBe(true);
  });

  it('returns a specific conflict for duplicate username', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...valid, email: 'another-public-signup@example.com' } });
    expect(response.statusCode).toBe(409); expect(response.json().error).toMatchObject({ code: 'USERNAME_ALREADY_EXISTS', message: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
  });

  it('returns a specific conflict for duplicate email', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...valid, username: 'public_signup_email' } });
    expect(response.statusCode).toBe(409); expect(response.json().error).toMatchObject({ code: 'EMAIL_ALREADY_EXISTS', message: 'อีเมลนี้ถูกใช้แล้ว' });
  });
});
