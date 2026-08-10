import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from './prisma.js';
import { fail } from './response.js';
import { requireCompany } from '../modules/auth/auth.guard.js';

/**
 * ตัวช่วย HTTP กลางสำหรับโมดูล catalog/recipe/costing
 * - requireRoles: ตรวจ auth + password changed + role (SUPER_ADMIN ผ่านเสมอ)
 * - writeAudit: บันทึก audit log แบบสม่ำเสมอ
 * - dec/num: จัดการ Prisma Decimal ให้ serialize เป็นตัวเลข
 * Backend เป็น source of truth ของสิทธิ์เสมอ (frontend คุมแค่การแสดงผล)
 */

/** preHandler: ต้อง login + เปลี่ยนรหัสแล้ว + มี role อย่างน้อยหนึ่งใน list (หรือเป็น SUPER_ADMIN) */
export function requireRoles(...roles: string[]) {
  return async function (req: FastifyRequest, reply: FastifyReply) {
    await requireCompany(req, reply);
    if (reply.sent) return;
    const userRoles = req.user.roles ?? [];
    if (userRoles.includes('SUPER_ADMIN')) return;
    if (!roles.some((r) => userRoles.includes(r))) {
      return reply.status(403).send(fail('FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้'));
    }
  };
}

export function clientIp(req: FastifyRequest): string | undefined {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0]?.trim();
  return req.ip;
}

export async function writeAudit(
  req: FastifyRequest,
  data: { action: string; entity: string; entityId?: string; before?: unknown; after?: unknown },
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.sub,
        companyId: req.user?.companyId,
        action: data.action,
        entity: data.entity,
        entityId: data.entityId,
        before: data.before === undefined ? undefined : (data.before as Prisma.InputJsonValue),
        after: data.after === undefined ? undefined : (data.after as Prisma.InputJsonValue),
        ip: clientIp(req),
      },
    });
  } catch (err) {
    req.log.warn({ err }, 'ไม่สามารถบันทึก audit log');
  }
}

/** แปลง Prisma Decimal / ค่าตัวเลข → number (ปลอดภัยสำหรับเงิน/ปริมาณในช่วง JS) */
export function num(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value.toString());
}
