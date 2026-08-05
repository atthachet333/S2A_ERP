# CHANGELOG — S2A ERP

## [0.2.0] — 2026-08-05

### Added

- PostgreSQL Native migration/seed และ development accounts แบบบังคับเปลี่ยนรหัสผ่าน
- Authentication API, rotating refresh token, RBAC, audit และ integration tests
- Login, first-login, dashboard, profile, users, unauthorized และ error pages

### Fixed

- Session restore ไม่ส่ง `Content-Type` ใน request ที่ไม่มี body และจำกัด refresh retry เพียงครั้งเดียว
- Empty JSON body และ malformed JSON ไม่กลายเป็น `INTERNAL_ERROR`

รูปแบบอ้างอิง [Keep a Changelog](https://keepachangelog.com/) · วันที่แบบ YYYY-MM-DD

## [Unreleased]

### Phase 1 — Foundation — 2026-08-05
#### Added
- โครงสร้างโปรเจกต์ `S2A_ERP/` (frontend, backend, docs) แบบ npm workspaces
- เอกสาร Markdown ครบ 16 ไฟล์ใน `docs/` + `README.md`
- Root `package.json` พร้อมสคริปต์ `dev` (concurrently), `build`, `typecheck`, `test`, `db:*`
- Backend: Fastify + TypeScript, config โหลด/ตรวจ env ด้วย Zod, Pino logger,
  request-id, error handler แบบ envelope, CORS
- Backend: Health API `GET /api/health` (ตรวจ DB/สถานะ), Vitest test สำหรับ health
- Frontend: React + Vite + TypeScript + Tailwind + TanStack Query,
  API client กลาง (`lib/api-client.ts`), หน้าเช็ค health ผ่าน proxy
- Vite proxy `/api` → `http://localhost:1415`, FE port 1414 / BE port 1415
- Prisma schema เวอร์ชันเริ่มต้น (ครบทุก model หลักตาม spec) + seed script
- `docker-compose.yml` สำหรับ PostgreSQL 16 (health check + volume)
- `.env.example` ทั้ง backend และ frontend, `.gitignore`

#### Notes
- Google Sheets ปิดโดยค่าเริ่มต้น (`GOOGLE_SHEETS_READ_ENABLED=false`), read-only เท่านั้น
