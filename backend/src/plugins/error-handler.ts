import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import type { FastifyInstance } from 'fastify';
import { AppError } from '../lib/errors.js';
import { fail } from '../lib/response.js';

/**
 * Error handler กลาง — แปลง error ทุกชนิดเป็น envelope มาตรฐาน
 */
export default fp(async function errorHandler(app: FastifyInstance) {
  app.setNotFoundHandler((req, reply) => {
    reply.status(404).send(fail('NOT_FOUND', `ไม่พบเส้นทาง ${req.method} ${req.url}`));
  });

  app.setErrorHandler((error, req, reply) => {
    if ((error as { code?: string }).code === 'FST_ERR_CTP_INVALID_JSON_BODY') {
      return reply.status(400).send(fail('INVALID_JSON', 'รูปแบบ JSON ไม่ถูกต้อง'));
    }

    // Zod validation error
    if (error instanceof ZodError) {
      req.log.warn({ err: error }, 'validation error');
      return reply
        .status(400)
        .send(fail('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', error.flatten()));
    }

    // AppError ที่เรานิยามเอง
    if (error instanceof AppError) {
      req.log.warn({ err: error, code: error.code }, 'app error');
      return reply.status(error.statusCode).send(fail(error.code, error.message, error.details));
    }

    // Fastify validation (schema) error
    if ((error as { validation?: unknown }).validation) {
      return reply
        .status(400)
        .send(fail('VALIDATION_ERROR', 'ข้อมูลไม่ถูกต้อง', (error as { validation?: unknown }).validation));
    }

    // อื่น ๆ = internal error
    req.log.error({ err: error }, 'unhandled error');
    const rawStatus = (error as { statusCode?: number }).statusCode;
    const statusCode = rawStatus && rawStatus >= 400 ? rawStatus : 500;
    return reply
      .status(statusCode)
      .send(fail('INTERNAL_ERROR', 'เกิดข้อผิดพลาดภายในระบบ'));
  });
});
