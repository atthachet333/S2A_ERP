# PROGRESS — S2A ERP

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
