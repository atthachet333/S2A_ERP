import 'dotenv/config';
import { z } from 'zod';

/**
 * โหลดและตรวจสอบ Environment Variables ด้วย Zod
 * ถ้าค่าไม่ถูกต้อง จะ throw ตั้งแต่ตอนบูตเพื่อกัน config ผิดพลาด
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(1415),
  // Runtime ใช้ DATABASE_URL (บัญชีสิทธิ์จำกัด s2a_app) เท่านั้น
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // ใช้เฉพาะ integration test (food_erp_test) — ไม่บังคับตอนรัน production
  TEST_DATABASE_URL: z.string().optional(),
  // ใช้เฉพาะ Prisma migration (บัญชี owner) — ไม่โหลดเข้าสู่ runtime logic
  DIRECT_URL: z.string().optional(),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters').default('change-this-secret'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  FRONTEND_URL: z.string().url().default('http://localhost:1414'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  // โฟลเดอร์เก็บไฟล์อัปโหลด (ไม่ commit เข้า git) — ค่าเริ่มต้นอยู่นอก src
  UPLOAD_DIR: z.string().default('./data/uploads'),
  UPLOAD_MAX_BYTES: z.coerce.number().int().positive().default(5 * 1024 * 1024),

  // Google Sheets (read-only, ปิดโดยค่าเริ่มต้น)
  GOOGLE_SHEETS_READ_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional().default(''),
  GOOGLE_PRIVATE_KEY: z.string().optional().default(''),
  GOOGLE_REFERENCE_SHEET_ID: z.string().optional().default(''),
  LINE_MESSAGING_ENABLED: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  LINE_CHANNEL_ACCESS_TOKEN: z.string().optional().default(''),
  MAIL_HOST: z.string().optional().default(''),
  MAIL_PORT: z.coerce.number().int().positive().default(587),
  MAIL_SECURE: z.string().default('false').transform((v) => v.toLowerCase() === 'true'),
  MAIL_USER: z.string().optional().default(''),
  MAIL_APP_PASSWORD: z.string().optional().default(''),
  MAIL_FROM_NAME: z.string().optional().default('S2 Accounting Consultant'),
  MAIL_FROM_EMAIL: z.string().optional().default(''),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // แสดง error แบบอ่านง่ายแล้วหยุดทำงาน
  console.error('❌ Invalid environment variables:');
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
