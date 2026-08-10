import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '../src/lib/prisma.js';

const username = 'public_signup_test';
const email = 'public-signup-test@example.com';
const valid = { fullName: 'Public Test User', username, email, password: 'Strong!Pass123', termsAccepted: true };

describe.sequential('public registration security', () => {
  let app: FastifyInstance;
  beforeAll(async () => { await prisma.user.deleteMany({ where: { username } }); app = await buildApp(); await app.ready(); });
  afterAll(async () => { const user = await prisma.user.findUnique({ where: { username } }); if (user) { await prisma.auditLog.deleteMany({ where: { userId: user.id } }); await prisma.user.delete({ where: { id: user.id } }); } await app.close(); await prisma.$disconnect(); });

  it('requires strong passwords and accepted terms', async () => {
    const weak = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { ...valid, password: 'weak', termsAccepted: false } });
    expect(weak.statusCode).toBe(400);
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

  it('returns a conflict for duplicate username or email', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/auth/register', payload: valid });
    expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('ACCOUNT_ALREADY_EXISTS');
  });
});
