import type { FastifyReply, FastifyRequest } from 'fastify';
import { fail } from '../../lib/response.js';
import { findUserById } from './auth.service.js';

export async function authenticate(req: FastifyRequest, reply: FastifyReply) {
  try { await req.jwtVerify(); } catch { return reply.status(401).send(fail('UNAUTHORIZED', 'กรุณาเข้าสู่ระบบ')); }
  const user = await findUserById(req.user.sub);
  if (!user?.isActive) return reply.status(401).send(fail('UNAUTHORIZED', 'บัญชีผู้ใช้ไม่พร้อมใช้งาน'));
}

export async function requirePasswordChanged(req: FastifyRequest, reply: FastifyReply) {
  await authenticate(req, reply);
  if (reply.sent) return;
  const user = await findUserById(req.user.sub);
  if (user?.mustChangePassword) return reply.status(403).send(fail('PASSWORD_CHANGE_REQUIRED', 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งานระบบ'));
}
