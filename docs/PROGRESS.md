# PROGRESS — S2A ERP

## Multi-company checkpoint — 2026-08-10

Implemented the additive company/membership foundation, company-scoped functional RBAC, company selector, role landing pages, permission navigation, customers, orders, recipe demand warnings, delivered-order KPI, transactional receiving, idempotent stock issue, audit, and web notifications. LINE/email adapters degrade safely without credentials. Dedicated binary PDF rendering and complete receiving/issue frontend forms remain unfinished.

## Food Costing workflow
เชื่อม Menu form/detail, Recipe Builder/new version, Costing Workspace, pricing persistence และ dashboard KPI แล้ว ต้องผ่าน final gate และ user journey จริงก่อนประกาศ production complete

## ERP Module Scaffolds — 2026-08-09

- ต่อยอดจาก Enterprise shell เดิม (origin/main): เพิ่ม `ModuleScaffold` + `module-structure.ts` แสดงโครงหน้าจอละเอียดของแต่ละโมดูล (สรุป/ตัวกรอง/คอลัมน์/empty state) โดยใช้ดีไซน์ระบบเดียวกัน
- โมดูลที่ได้โครงหน้าจอ: items, recipes, costing, pricing, receiving, production, inventory, transfers, stock-count, reports (settings คง placeholder เดิม)
- ไม่มีข้อมูลปลอม · ไม่แตะ Auth/DB/Security/Backend · typecheck ✅ / lint ✅ / build ✅ / frontend tests ✅ 38
- แนวทาง: Additive/Restore/Expand บนฐาน origin/main (ไม่ reset repo, ไม่ force push)

## Database Access Hardening — 2026-08-06

- **Repo-side (ทำ + ตรวจแล้วบนเครื่องนี้)**:
  - `schema.prisma` เพิ่ม `directUrl = env("DIRECT_URL")` (runtime=url/s2a_app, migration=directUrl/owner) — `prisma validate` ✅
  - `env.ts` เพิ่ม validation `TEST_DATABASE_URL`, `DIRECT_URL` (optional, ไม่บังคับ runtime)
  - `.env.example` เปลี่ยนเป็นรูปแบบ s2a_app + DIRECT_URL + TEST_DATABASE_URL (placeholder เท่านั้น)
  - เพิ่ม `backend/scripts/create-s2a-app-role.sql` (template สิทธิ์จำกัด, ไม่มีรหัสจริง)
  - Security audit (`git grep`): ไม่มี secret จริงถูก commit; frontend bundle ไม่มี DB URL/credential (ตรวจ dist แล้ว)
  - typecheck ✅ / lint ✅ (BE+FE), frontend tests ✅ 35, build ✅
- **Server-side (⛔ ยังไม่ได้ทำบนเครื่องนี้ — ไม่มี PostgreSQL/ไม่มี D:\ และห้าม Docker)**: การแก้ `postgresql.conf`/`pg_hba.conf`, ปิด firewall 5432, restart service, สร้าง role `s2a_app`, และ health `db=up` **ต้องรันบนเครื่อง Server จริง** ตาม runbook ใน `docs/DEPLOYMENT.md`
- สถาปัตยกรรมเป้าหมาย: Browser → FE 1414 → API 1415 → PostgreSQL 127.0.0.1:5432 (backend ชั้นเดียวที่แตะ DB), ไม่เปิด 5432 ให้ LAN/Internet (ADR-013)

## UI/UX Redesign — Enterprise Shell — 2026-08-06

- ออกแบบ Layout ใหม่ (Sidebar + Header + Content) แยกเป็น component พร้อม design token กลาง
- Sidebar 14 เมนู/4 หมวด, ย่อ-ขยาย + tooltip, active state ทอง, กรองตาม permission เดิม
- Header: collapse toggle, breadcrumb, System Status จาก Health API จริง, user dropdown
- Dashboard 6 ส่วน (Welcome, System Overview, Module Status, Quick Nav, Recent Activity, Setup Progress) ใช้ข้อมูลจริงจาก DB/health; placeholder ระบุชัดว่าเป็นสถานะการพัฒนา
- Profile 2 คอลัมน์, Users toolbar+table+states+pagination, ModulePlaceholder กลาง 11 หน้า, Activity page จริง
- Backend: เพิ่ม `GET /api/dashboard/summary`, `GET /api/activity` (read-only, permission เดิม), เพิ่มฟิลด์ user (lastLoginAt/createdAt/updatedAt)
- Quality (เครื่องนี้): typecheck ✅ (BE+FE), lint ✅ (BE+FE), build ✅ (BE+FE), frontend tests ✅ **35 ผ่าน** (เดิม 2 + ใหม่ 33)
- Backend integration tests (auth/dashboard/activity) ⛔ รันไม่ได้บนเครื่องนี้ — ไม่มี PostgreSQL และห้ามใช้ Docker; health tests ✅ 3 ผ่าน (ออกแบบให้ db=down ได้)
- npm audit: 9 ช่องโหว่ที่เหลือทั้งหมดต้อง major upgrade (เสี่ยง breaking) → บันทึกใน SECURITY.md, ไม่ force
- Prisma 7 warning (config ใน package.json) → เลื่อนย้ายไป `prisma.config.ts` (ADR-012)

> หมายเหตุ workspace: repo อยู่จริงที่ `C:\Users\User\S2A_ERP` บนเครื่องพัฒนานี้ (ไม่ใช่ `D:\`) และยังไม่มี PostgreSQL รันอยู่ → health/db ตอบ `down` และหน้า UI แสดงสถานะตามจริง

## Authentication & Native Database — 2026-08-05

- ย้าย workspace ถาวรไป `D:\S2A_ERP`; TEMP, TMP และ npm cache อยู่บน D
- PostgreSQL 18 Native: `food_erp` และ `food_erp_test`; migration `20260805151518_init`
- Seed แบบ idempotent: `win` (SUPER_ADMIN) และ `pueng` (ADMIN) ต้องเปลี่ยนรหัสผ่านครั้งแรก
- เพิ่ม login, refresh rotation, session restore, change password, logout, audit/login log และ role-based users page
- แก้ bodyless refresh/logout และ malformed JSON ให้คืน error code ที่เหมาะสม
- Rebrand เป็น S2A ERP, IBM Plex Sans Thai, ธีมขาว/น้ำเงิน/กรม/ทอง และใช้ `frontend/public/s2a-logo.png`

สถานะ: ⬜ ยังไม่เริ่ม · 🟡 กำลังทำ · ✅ เสร็จแล้ว · 🔎 ต้องตรวจสอบ · ⛔ พบปัญหา

อัปเดตล่าสุด: 2026-08-05

## Phase 1 — Foundation
| งาน | สถานะ |
|-----|-------|
| สร้างโฟลเดอร์ frontend | ✅ |
| สร้างโฟลเดอร์ backend | ✅ |
| สร้างโฟลเดอร์ docs | ✅ |
| สร้างไฟล์ Markdown ทั้งหมด (16) | ✅ |
| React + Vite + TS ใน frontend | ✅ |
| Fastify + TS ใน backend | ✅ |
| Frontend Port 1414 | ✅ |
| Backend Port 1415 | ✅ |
| Vite Proxy `/api` → 1415 | ✅ |
| Backend Health API `/api/health` | ✅ |
| Frontend หน้าเช็ค Health ผ่าน proxy | ✅ |
| PostgreSQL docker-compose | ✅ |
| ติดตั้ง/ตั้งค่า Prisma | ✅ |
| Prisma Schema เวอร์ชันเริ่มต้น | ✅ |
| `.env.example` ทั้งสองฝั่ง | ✅ |
| Root script รันสองระบบ (concurrently) | ✅ |
| Seed Script | ✅ |
| Type Check | ✅ ผ่าน (backend + frontend) |
| Test | ✅ ผ่าน (backend 3, frontend 2) |
| Build | ✅ ผ่าน (backend → dist, frontend → dist) |
| Prisma Generate | ✅ ผ่าน (v6.19) |
| Backend `/api/health` ทดสอบจริง | ✅ ตอบ 200 + envelope (db=down เพราะยังไม่เปิด DB) |
| อัปเดต PROGRESS/CHANGELOG | ✅ |

> หมายเหตุ: PostgreSQL ยังไม่เปิด (ต้องมี Docker + พื้นที่ดิสก์) → `db` แสดง `down`/`degraded` ซึ่งเป็นพฤติกรรมที่ออกแบบไว้
> health API ยังตอบ HTTP 200 ตาม envelope มาตรฐาน

## Phase 2 — Auth & Users ⬜
Login, Logout, Refresh, Change password, RBAC, Layout+Sidebar, Audit/Login log

## Phase 3 — Master Data ⬜
Units, Categories, Items, Suppliers, Warehouses

## Phase 4 — Inbound & Inventory ⬜
Goods Receipt, Stock Ledger, Stock Balance, Moving Average Cost

## Phase 5 — Recipe & Cost ⬜
Recipe/Version, Cost Calculation, Selling Price, Profit

## Phase 6 — Production ⬜
Production Order, Issue, Output, Waste, Actual Cost, Transfer, Adjustment

## Phase 7 — Dashboard & Reports ⬜

## Phase 8 — Hardening ⬜
