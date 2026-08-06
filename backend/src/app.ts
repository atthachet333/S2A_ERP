import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { env } from './config/env.js';
import requestContext from './plugins/request-context.js';
import errorHandler from './plugins/error-handler.js';
import healthRoutes from './modules/health/health.route.js';
import authRoutes from './modules/auth/auth.route.js';
import userRoutes from './modules/users/user.route.js';
import dashboardRoutes from './modules/dashboard/dashboard.route.js';
import activityRoutes from './modules/activity/activity.route.js';

/**
 * สร้าง Fastify instance พร้อม plugin และ route ทั้งหมด
 * แยกออกจาก server.ts เพื่อให้ทดสอบด้วย app.inject() ได้
 */
export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' } }
          : undefined,
    },
    // ใช้ request-id ของเราเอง (จาก header) แทนการ gen ของ fastify
    genReqId: (req) => (req.headers['x-request-id'] as string) || randomUUID(),
  });

  // Cross-cutting plugins
  await app.register(requestContext);
  await app.register(errorHandler);

  await app.register(cors, {
    origin: env.FRONTEND_URL,
    credentials: true,
  });

  await app.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_EXPIRES_IN },
  });

  // Routes (ทั้งหมดอยู่ใต้ /api)
  await app.register(
    async (api) => {
      await api.register(healthRoutes);
      await api.register(authRoutes, { prefix: '/auth' });
      await api.register(userRoutes, { prefix: '/users' });
      await api.register(dashboardRoutes, { prefix: '/dashboard' });
      await api.register(activityRoutes, { prefix: '/activity' });
    },
    { prefix: '/api' },
  );

  return app;
}
