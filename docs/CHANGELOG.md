# CHANGELOG — S2A ERP

## [0.3.2] — 2026-08-09

### Added — ERP Module Scaffolds (bridge to real screens)

- เพิ่ม `components/ModuleScaffold.tsx` + `components/layout/module-structure.ts`: หน้าโมดูลแบบ **โครงหน้าจอละเอียด** (การ์ดสรุป · ตัวกรอง · คอลัมน์ตาราง · ปุ่มการทำงาน · empty state) ใช้ดีไซน์ระบบเดิม (Enterprise shell) ต่อยอดจาก `ModulePlaceholder`
- ครอบคลุมโมดูล: วัตถุดิบและสินค้า, สูตรและเมนู, คำนวณต้นทุน, ราคาขายและกำไร, รับสินค้าเข้าคลัง, การผลิต, คลังสินค้า, โอนคลัง, ตรวจนับและปรับสต๊อก, รายงาน
- `App.tsx` เปลี่ยน route โมดูลจาก `ModulePlaceholder` → `ModuleScaffold` (path ที่ไม่มีโครงสร้าง เช่น `/settings` fallback กลับหน้า placeholder เดิม)
- Tests: เพิ่ม `module-scaffold.test.tsx` (3) — รวม frontend tests เป็น 38 ผ่าน

### Notes

- ยังไม่มีข้อมูลปลอม — ทุกค่าเป็น `—`/`0`/empty state จนกว่า Backend ของแต่ละโมดูลพร้อม
- ไม่แตะ Authentication / Token flow / DB / Security / Backend logic เดิม · ไม่มี force push

## [0.3.1] — 2026-08-06

### Security

- แยกบทบาทการเข้าถึง DB: `schema.prisma` เพิ่ม `directUrl` (runtime=`DATABASE_URL`/s2a_app, migration=`DIRECT_URL`/owner)
- `env.ts` validate `TEST_DATABASE_URL`/`DIRECT_URL` (optional, ไม่โหลด DIRECT_URL เข้า runtime logic)
- `.env.example` → รูปแบบ s2a_app + DIRECT_URL + TEST_DATABASE_URL (placeholder), เพิ่ม `backend/scripts/create-s2a-app-role.sql`
- เอกสาร hardening ครบ (localhost-only, pg_hba, firewall, s2a_app, rotate, DBeaver, no-tunnel-to-5432) + runbook ใน DEPLOYMENT.md, ADR-013
- ยืนยัน: ไม่มี secret จริงถูก commit, frontend bundle ไม่มี DB URL/credential

### Notes

- การ hardening ระดับ PostgreSQL server (conf/pg_hba/firewall/role/restart/db=up) ต้องรันบนเครื่อง Server จริง (runbook ให้ไว้แล้ว) — รันบนเครื่องพัฒนานี้ไม่ได้เพราะไม่มี PostgreSQL และห้าม Docker

## [0.3.0] — 2026-08-06

### Added — UI/UX Redesign (Enterprise ERP shell)

- Design token system กลางใน `index.css` (แบรนด์ ขาว/น้ำเงิน/กรม/ทอง, พื้นหลังเทาอมฟ้า + grid/radial glow, การ์ด radius 14–18px shadow เบา)
- Layout ใหม่: `AppLayout` + `Sidebar` + `Header` แยก component, content container `max-width` 1560px, responsive desktop/tablet/mobile (drawer)
- Sidebar: เมนู 14 รายการจัด 4 หมวด, Lucide icons, active state + แถบทอง, ย่อ/ขยาย (จำค่าใน localStorage), tooltip เมื่อย่อ, brand โลโก้จริง, ส่วนล่างแสดง user/role/logout, กรองตาม permission เดิม
- Header: ปุ่มย่อ/ขยาย + เปิด drawer, page title + breadcrumb, global search placeholder, System Status (จาก Health API จริง), วันที่, ปุ่มแจ้งเตือน, user dropdown (โปรไฟล์/เปลี่ยนรหัสผ่าน/ออกจากระบบ)
- Dashboard 6 ส่วน: Welcome + Quick Actions, System Overview (ข้อมูลจริง), ERP Module Status (สถานะการพัฒนา), Quick Navigation (bento), Recent Activity (audit จริง), Setup Progress (นับจาก DB จริง)
- Profile ใหม่ 2 คอลัมน์: บัตรประจำตัว + ข้อมูลบัญชี/สิทธิ์/ความปลอดภัย + วันที่สร้าง/แก้ไข/เข้าสู่ระบบล่าสุด
- Users ใหม่: toolbar (ค้นหา/กรอง role/กรอง status/นับ/รีเฟรช/เพิ่ม), ตาราง avatar+badge, skeleton/empty/error state, pagination ฝั่ง client, confirmation dialog + toast ภาษาไทย
- `ModulePlaceholder` component กลางสำหรับเมนูที่ยังไม่พัฒนา (11 หน้า) + หน้า `Activity` จริง
- Reusable UI: `Badge`, `Avatar`, `Skeleton`, `EmptyState`, `SystemStatus`, `Toast`, `ConfirmDialog`
- Backend read-only APIs: `GET /api/dashboard/summary` (นับข้อมูลจริง), `GET /api/activity` (audit+login log, SUPER_ADMIN, pagination)
- `toAuthUser` และ `/api/users` เพิ่มฟิลด์ `lastLoginAt`, `createdAt`, `updatedAt` (additive)
- Frontend tests เพิ่ม 33 รายการ (Sidebar/Header/Dashboard/Placeholder/Profile/Users/states)

### Security

- รัน `npm audit fix` (ไม่ force) — lockfile ปัก `react-router-dom` ที่ 6.30.4 (patch ล่าสุด v6) อยู่แล้ว ไม่มีการเปลี่ยน dependency
- ช่องโหว่ที่เหลือทั้งหมดต้อง major upgrade (breaking) → บันทึกใน `docs/SECURITY.md`, ไม่ใช้ `npm audit fix --force`

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
