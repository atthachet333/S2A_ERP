import fp from 'fastify-plugin';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * ใส่ Request ID ให้ทุก request (header: x-request-id) เพื่อ trace/logging
 */
export default fp(async function requestContext(app: FastifyInstance) {
  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-request-id'];
    const requestId = (Array.isArray(incoming) ? incoming[0] : incoming) || randomUUID();
    req.id = requestId;
    reply.header('x-request-id', requestId);
  });
});
