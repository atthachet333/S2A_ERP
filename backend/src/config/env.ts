import 'dotenv/config';
import { z } from 'zod';

/**
 * โหลดและตรวจสอบ Environment Variables ด้วย Zod
 * ถ้าค่าไม่ถูกต้อง จะ throw ตั้งแต่ตอนบูตเพื่อกัน config ผิดพลาด
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(1415),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(8, 'JWT_SECRET must be at least 8 characters').default('change-this-secret'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  REFRESH_TOKEN_DAYS: z.coerce.number().int().positive().default(7),
  FRONTEND_URL: z.string().url().default('http://localhost:1414'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Google Sheets (read-only, ปิดโดยค่าเริ่มต้น)
  GOOGLE_SHEETS_READ_ENABLED: z
    .string()
    .default('false')
    .transform((v) => v.toLowerCase() === 'true'),
  GOOGLE_SERVICE_ACCOUNT_EMAIL: z.string().optional().default(''),
  GOOGLE_PRIVATE_KEY: z.string().optional().default(''),
  GOOGLE_REFERENCE_SHEET_ID: z.string().optional().default(''),
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
