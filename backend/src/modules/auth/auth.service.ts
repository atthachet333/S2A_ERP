import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { prisma } from '../../lib/prisma.js';
import { env } from '../../config/env.js';
import type { AuthUser } from './auth.types.js';

const includeAccess = {
  userRoles: { include: { role: { include: { rolePermissions: { include: { permission: true } } } } } },
} as const;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

export const findUser = (username: string) => prisma.user.findFirst({
  where: { username: { equals: username, mode: 'insensitive' }, deletedAt: null },
  include: includeAccess,
});
export const findUserById = (id: string) => prisma.user.findFirst({ where: { id, deletedAt: null }, include: includeAccess });
type UserWithAccess = NonNullable<Awaited<ReturnType<typeof findUser>>>;

export function toAuthUser(user: UserWithAccess): AuthUser {
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    fullName: user.fullName,
    mustChangePassword: user.mustChangePassword,
    roles: user.userRoles.map(({ role }) => role.name),
    permissions: [...new Set(user.userRoles.flatMap(({ role }) => role.rolePermissions.map(({ permission }) => permission.code)))],
  };
}

export async function createRefreshToken(userId: string, ip?: string, userAgent?: string) {
  const token = randomBytes(48).toString('base64url');
  await prisma.refreshToken.create({ data: { userId, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000), ip, userAgent } });
  return token;
}

export async function rotateRefreshToken(token: string, ip?: string, userAgent?: string) {
  const current = await prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: includeAccess } } });
  if (!current || current.revokedAt || current.expiresAt <= new Date() || !current.user.isActive || current.user.deletedAt) return null;
  const replacement = randomBytes(48).toString('base64url');
  await prisma.$transaction(async (tx) => {
    const created = await tx.refreshToken.create({ data: { userId: current.userId, tokenHash: hashToken(replacement), expiresAt: new Date(Date.now() + env.REFRESH_TOKEN_DAYS * 86_400_000), ip, userAgent } });
    await tx.refreshToken.update({ where: { id: current.id }, data: { revokedAt: new Date(), replacedByTokenId: created.id } });
  });
  return { user: toAuthUser(current.user), refreshToken: replacement };
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
