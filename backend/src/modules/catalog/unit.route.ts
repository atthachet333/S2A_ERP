import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { fail, ok } from '../../lib/response.js';
import { requirePasswordChanged } from '../auth/auth.guard.js';
import { requireRoles, writeAudit } from '../../lib/http.js';

const MANAGE = requireRoles('ADMIN', 'PURCHASING', 'PRODUCTION');

const createSchema = z.object({
  code: z.string().trim().min(1).max(20),
  name: z.string().trim().min(1).max(60),
});

const conversionSchema = z.object({
  fromUnitId: z.string().min(1),
  toUnitId: z.string().min(1),
  factor: z.number().positive(),
});

/**
 * หน่วยนับ (Unit) + Unit Conversion มาตรฐาน
 * หมายเหตุ: การแปลงหน่วยเฉพาะวัตถุดิบ (เช่น 1 กำ = 80 กรัม) เก็บที่ Item.purchaseToBaseFactor
 * ส่วน UnitConversion ที่นี่ใช้สำหรับการแปลงมาตรฐานทั่วไป (kg↔g, l↔ml)
 */
export default async function unitRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: requirePasswordChanged }, async () => {
    const units = await prisma.unit.findMany({
      where: { deletedAt: null },
      orderBy: { code: 'asc' },
      select: { id: true, code: true, name: true, isActive: true },
    });
    return ok(units);
  });

  app.get('/conversions', { preHandler: requirePasswordChanged }, async () => {
    const conversions = await prisma.unitConversion.findMany({
      include: { fromUnit: { select: { code: true } }, toUnit: { select: { code: true } } },
    });
    return ok(conversions.map((c) => ({
      id: c.id,
      fromUnitId: c.fromUnitId,
      toUnitId: c.toUnitId,
      fromCode: c.fromUnit.code,
      toCode: c.toUnit.code,
      factor: Number(c.factor.toString()),
    })));
  });

  app.post('/', { preHandler: MANAGE }, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const existing = await prisma.unit.findUnique({ where: { code: body.code } });
    if (existing) return reply.status(409).send(fail('CONFLICT', `มีหน่วยรหัส ${body.code} อยู่แล้ว`));
    const unit = await prisma.unit.create({ data: { code: body.code, name: body.name } });
    await writeAudit(req, { action: 'CREATE', entity: 'Unit', entityId: unit.id, after: unit });
    return reply.status(201).send(ok(unit, 'เพิ่มหน่วยนับสำเร็จ'));
  });

  app.post('/conversions', { preHandler: MANAGE }, async (req, reply) => {
    const body = conversionSchema.parse(req.body);
    if (body.fromUnitId === body.toUnitId) return reply.status(400).send(fail('VALIDATION_ERROR', 'หน่วยต้นทางและปลายทางต้องต่างกัน'));
    const conversion = await prisma.unitConversion.upsert({
      where: { fromUnitId_toUnitId: { fromUnitId: body.fromUnitId, toUnitId: body.toUnitId } },
      update: { factor: new Prisma.Decimal(body.factor) },
      create: { fromUnitId: body.fromUnitId, toUnitId: body.toUnitId, factor: new Prisma.Decimal(body.factor) },
    });
    await writeAudit(req, { action: 'UPSERT', entity: 'UnitConversion', entityId: conversion.id, after: { factor: body.factor } });
    return reply.status(201).send(ok({ id: conversion.id }, 'บันทึกการแปลงหน่วยสำเร็จ'));
  });
}
