import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import type { AuthUser } from './auth.types.js';

const includeAccess = {
  userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
  companyMemberships: {
    where: { isActive: true, company: { isActive: true } },
    include: { company: true, role: { include: { rolePermissions: { include: { permission: true } } } } },
  },
} as const;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const findUser = (username: string) => prisma.user.findFirst({
  where: { username: { equals: username, mode: 'insensitive' }, deletedAt: null },
  include: includeAccess,
});
export const findUserById = (id: string) => prisma.user.findFirst({ where: { id, deletedAt: null }, include: includeAccess });
type UserWithAccess = NonNullable<Awaited<ReturnType<typeof findUser>>>;

const LANDING: Record<string, string> = {
  SUPER_ADMIN: '/admin', MANAGER: '/management', OPERATIONS: '/operations',
  ORDER_COORDINATOR: '/orders', CHEF: '/chef', COSTING_STAFF: '/costing-dashboard',
};

export function toAuthUser(user: UserWithAccess, activeCompanyId?: string): AuthUser {
  const membership = activeCompanyId
    ? user.companyMemberships.find(({ companyId }) => companyId === activeCompanyId)
    : undefined;
  const roles = membership ? [membership.role.name] : user.userRoles.map(({ role }) => role.name);
  const permissions = membership
    ? membership.role.rolePermissions.map(({ permission }) => permission.code)
    : user.userRoles.flatMap(({ role }) => role.rolePermissions.map(({ permission }) => permission.code));
  const companies = user.companyMemberships.map(({ company, role, isDefault }) => ({
    id: company.id, code: company.code, nameTh: company.code === 'S2A-PRIMARY' ? 'ครัวสดดี' : company.nameTh, nameEn: company.nameEn,
    logoUrl: company.logoUrl, role: role.name, isDefault,
  }));
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    mustChangePassword: user.mustChangePassword,
    roles,
    permissions: [...new Set(permissions)],
    companies,
    activeCompany: membership ? companies.find(({ id }) => id === membership.companyId) ?? null : null,
    defaultLandingPage: membership ? (LANDING[membership.role.name] ?? '/dashboard') : '/select-company',
    lastLoginAt: user.lastLoginAt ? user.lastLoginAt.toISOString() : null,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

export async function createRefreshToken(userId: string, ip?: string, userAgent?: string) {
  const token = randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000), ip, userAgent } });
  return token;
}

export async function rotateRefreshToken(token: string, ip?: string, userAgent?: string, companyId?: string) {
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: includeAccess } } });
  if (!current || current.revokedAt || current.expiresAt <= new Date() || !current.user.isActive || current.user.deletedAt) return null;
  const replacement = randomBytes(48).toString('base64url');
  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({ data: { userId: current.userId, tokenHash: hashToken(replacement), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000), ip, userAgent } });
    await tx.refreshToken.update({ where: { id: current.id }, data: { revokedAt: new Date(), replacedByTokenId: created.id } });
  });
  const allowedCompanyId = companyId && current.user.companyMemberships.some((membership) => membership.companyId === companyId) ? companyId : undefined;
  return { user: toAuthUser(current.user, allowedCompanyId), refreshToken: replacement, companyId: allowedCompanyId };
}

export async function revokeRefreshToken(token?: string) {
  if (token) await prisma.refreshToken.updateMany({ where: { tokenHash: hashToken(token), revokedAt: null }, data: { revokedAt: new Date() } });
}
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
export async function updatePassword(userId: string, password: string, ip?: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { passwordHash, mustChangePassword: false } }),
    prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.auditLog.create({ data: { userId, action: 'CHANGE_PASSWORD', entity: 'User', entityId: userId, ip } }),
  ]);
}
