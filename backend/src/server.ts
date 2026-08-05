import { buildApp } from './app.js';
import { env } from './config/env.js';

/**
 * จุดเริ่มต้นของ Backend — เปิด HTTP server ที่ PORT (ค่าเริ่มต้น 1415)
 */
async function main() {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`ได้รับสัญญาณ ${signal} — กำลังปิดระบบ`);
    await app.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`🚀 Backend พร้อมใช้งานที่ http://localhost:${env.PORT}/api`);
    app.log.info(`   Google Sheets read: ${env.GOOGLE_SHEETS_READ_ENABLED ? 'ENABLED (read-only)' : 'disabled'}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

void main();
