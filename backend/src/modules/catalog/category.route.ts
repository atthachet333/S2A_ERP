import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ItemType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePasswordChanged } from '../auth/auth.guard.js';
import { requireRoles, writeAudit } from '../../lib/http.js';

const MANAGE = requireRoles('ADMIN', 'PURCHASING', 'PRODUCTION');

const createSchema = z.object({
  code: z.string().trim().min(1).max(30),
  name: z.string().trim().min(1).max(80),
  type: z.nativeEnum(ItemType).optional(),
});
const updateSchema = createSchema.partial().extend({ isActive: z.boolean().optional() });

/** หมวดหมู่วัตถุดิบ/สินค้า */
export default async function categoryRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePasswordChanged }, async () => {
    const categories = await prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, code: true, name: true, type: true, isActive: true, _count: { select: { items: true } } },
    });
    return ok(categories.map((c) => ({ id: c.id, code: c.code, name: c.name, type: c.type, isActive: c.isActive, itemCount: c._count.items })));
  });

  app.post('/', { preHandler: MANAGE }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const existing = await prisma.category.findUnique({ where: { code: body.code } });
    if (existing) return reply.status(409).send(fail('CONFLICT', `มีหมวดหมู่รหัส ${body.code} อยู่แล้ว`));
    const category = await prisma.category.create({ data: { code: body.code, name: body.name, type: body.type } });
    await writeAudit(req, { action: 'CREATE', entity: 'Category', entityId: category.id, after: category });
    return reply.status(201).send(ok(category, 'เพิ่มหมวดหมู่สำเร็จ'));
  });

  app.patch('/:id', { preHandler: MANAGE }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = updateSchema.parse(req.body);
    const existing = await prisma.category.findFirst({ where: { id, deletedAt: null } });
    if (!existing) return reply.status(404).send(fail('NOT_FOUND', 'ไม่พบหมวดหมู่'));
    if (body.code && body.code !== existing.code) {
      const duplicate = await prisma.category.findUnique({ where: { code: body.code } });
      if (duplicate) return reply.status(409).send(fail('CONFLICT', `มีหมวดหมู่รหัส ${body.code} อยู่แล้ว`));
    }
    const updated = await prisma.category.update({ where: { id }, data: body });
    await writeAudit(req, { action: 'UPDATE', entity: 'Category', entityId: id, before: existing, after: updated });
    return ok({ ...updated, itemCount: await prisma.item.count({ where: { categoryId: id, deletedAt: null } }) }, 'บันทึกหมวดหมู่สำเร็จ');
  });
}
