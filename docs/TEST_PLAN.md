# TEST PLAN — S2A ERP

## Authentication regression suite

ใช้ PostgreSQL จริงทดสอบ invalid login, first login redirect contract, dashboard blocking, change password, refresh rotation/reuse, session restore, logout, RBAC, audit/login log, empty body และ malformed JSON จากนั้นคืน development seed ทุกครั้ง

Framework: **Vitest** (ทั้ง backend และ frontend)

## Backend
### Unit
- Moving Average Cost (รวมกรณีหารศูนย์)
- คำนวณต้นทุน/Yield/Variance
- Markup vs Margin
- Envelope / error mapping

### Integration (Phase 2+)
- Login (สำเร็จ/ล้มเหลว/บัญชีปิด)
- Permission (allow/deny ตาม role)
- Goods Receipt → ledger + balance + avg cost
- ตัดสต๊อก / ป้องกันติดลบ
- การผลิต (issue/output/actual cost)
- ป้องกัน submit ซ้ำ (idempotency)
- Transaction rollback เมื่อเกิด error กลางทาง

### Phase 1 (รอบนี้)
- `GET /api/health` ตอบ envelope ถูกต้องและ status ok

## Frontend
- Login Form (validation, submit)
- Item Form
- Recipe Form
- Cost Calculator (Markup/Margin)
- Production Form
### Phase 1 (รอบนี้)
- api-client parse envelope (success/error)
- useHealth hook / หน้า health แสดงสถานะ

### UI/UX Redesign (รอบ 2026-08-06)
Frontend (Vitest + Testing Library) — **35 ผ่าน**:
- Sidebar: แสดงโลโก้จริง, เมนูตาม permission (SUPER_ADMIN เห็น/ADMIN ไม่เห็นเมนูผู้ดูแล), ปุ่ม logout
- Header: System Status จาก Health API (พร้อม/ขัดข้อง), เปิด user dropdown + ตัวเลือกออกจากระบบ
- Dashboard: render ชื่อผู้ใช้, Quick Navigation route ถูกต้อง, Setup Progress จากข้อมูลจริง, Recent Activity empty state (admin) + จำกัดเฉพาะผู้ดูแล (ผู้ใช้ทั่วไป)
- ModulePlaceholder: title/สถานะ/planned features/ปุ่มกลับ
- Profile: ข้อมูลบัญชี/สิทธิ์/ลิงก์เปลี่ยนรหัสผ่าน
- Users: unauthorized สำหรับ non-admin, ตารางจาก API + badge, empty state, loading skeleton + error state (deterministic)

Backend (Vitest + PostgreSQL จริง) — เพิ่มใน auth integration suite:
- `GET /api/dashboard/summary` คืนตัวเลขจริง (ต้อง auth)
- `GET /api/activity` paginated (SUPER_ADMIN), มี LOGIN_SUCCESS จริง
- Permission denied: `/api/activity` และ `/api/dashboard/summary` → 401 เมื่อไม่ login; pueng (ADMIN) → 403
> ต้องรันบนเครื่องที่มี PostgreSQL (`food_erp_test`). บนเครื่องที่ไม่มี DB จะรันได้เฉพาะ health tests (ออกแบบให้ db=down ได้)

### Database Access Hardening (รอบ 2026-08-06)
ตรวจแล้วบนเครื่องนี้:
- `prisma validate` ผ่านหลังเพิ่ม `directUrl`; typecheck/lint (BE+FE) ✅; frontend tests ✅ 35; build ✅
- Security audit `git grep`: ไม่มี secret จริงใน tracked files; `backend/.env` ถูก gitignore
- Frontend `dist/`: **ไม่มี** `postgresql://`, `:5432`, `DATABASE_URL`, `DIRECT_URL`, `s2a_app` (มีเพียง label "PostgreSQL" และ field "password")

ต้องตรวจบนเครื่อง Server จริง (มี PostgreSQL) — ยังทำไม่ได้บนเครื่องนี้:
- Runtime `s2a_app` เชื่อม + Login/Refresh/Change Password/Audit/User Management ทำงานได้โดยไม่ใช้ `postgres`
- Health `db=up`; integration test ใช้ `food_erp_test`
- `s2a_app` ทำ CREATE DATABASE/ROLE, DROP DATABASE, ALTER SYSTEM ไม่ได้ (permission denied)
- `Get-NetTCPConnection -LocalPort 5432` รับเฉพาะ `127.0.0.1`/`::1`; LAN IP ต่อไม่ได้

## เกณฑ์
- ทุก PR: typecheck + lint + test + build ต้องผ่าน
- เป้าหมาย coverage โมดูลการเงิน/สต๊อก > 80% (Phase 8)

## คำสั่ง
```bash
npm test                 # ทั้งระบบ
npm --workspace backend run test
npm --workspace frontend run test
```
