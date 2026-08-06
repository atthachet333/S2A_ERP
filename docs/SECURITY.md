# SECURITY — S2A ERP

## Database access hardening (localhost-only) — 2026-08-06

- **PostgreSQL รับเฉพาะ localhost** (`listen_addresses = 'localhost'`, port 5432) — เครื่องพนักงาน/เครื่องอื่น **ห้ามต่อ 5432 โดยตรง**
- `pg_hba.conf` อนุญาตเฉพาะ loopback `127.0.0.1/32` และ `::1/128` ด้วย `scram-sha-256` — ลบกฎ LAN (`192.168.x.x`) และ `0.0.0.0/0` ทั้งหมด, ห้าม `trust`
- **Backend เป็นชั้นเดียวที่เข้าถึง DB**; ผู้ใช้เข้าถึงผ่านเว็บ (1414) → API (1415) เท่านั้น; Browser ไม่ต่อ DB โดยตรง
- **Runtime user = `s2a_app`** (LOGIN, NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOINHERIT, สิทธิ์ SELECT/INSERT/UPDATE/DELETE เท่านั้น) ผ่าน `DATABASE_URL`
- **`postgres`/owner ใช้เฉพาะ migration/admin** ผ่าน `DIRECT_URL` (ไม่โหลดเข้าสู่ runtime logic)
- Windows Firewall: ปิด rule ที่เปิด TCP 5432 ให้ LAN (ไม่ปิด firewall ทั้งระบบ, ไม่เปิด port ใหม่)
- **ห้าม tunnel/port-forward/public IP ไป 5432**; Cloudflare Tunnel/Reverse proxy ให้ชี้ frontend เท่านั้น
- DBeaver ใช้เฉพาะบน Server/RDP; ห้ามเก็บบัญชี postgres บนเครื่องพนักงาน; ลบ profile ที่ชี้ `192.168.x.x:5432`
- ขั้นตอนปฏิบัติ (conf/pg_hba/firewall/restart/verify/rollback/rotate) + SQL สร้าง role อยู่ใน `docs/DEPLOYMENT.md` และ `backend/scripts/create-s2a-app-role.sql`

> **ไม่มี secret จริงถูก commit**: ตรวจ (`git grep`) แล้วพบเฉพาะค่า placeholder ใน `.env.example`, ค่า default ใน source (`JWT_SECRET` fallback) และรหัส seed dev (`win`/`pueng` ที่บังคับเปลี่ยนครั้งแรก) — `backend/.env` ถูก gitignore. Frontend bundle ไม่มี DB URL/credential

## npm audit — สถานะช่องโหว่ (ตรวจ 2026-08-06)

`npm audit` พบ **9 ช่องโหว่** (critical 3, high 1, moderate 5) ทั้งหมดอยู่ใน dependency ทางอ้อม และการแก้ทุกตัวต้อง **major upgrade (breaking)** — จึง **ไม่ใช้ `npm audit fix --force`**

| Package | Severity | มาจาก | Fix ที่ต้องใช้ | การตัดสินใจ |
|---------|----------|-------|----------------|-------------|
| `react-router` / `react-router-dom` | moderate | frontend routing | major → v7 | เลื่อน — ปักที่ 6.30.4 (patch ล่าสุด v6) อยู่แล้ว; การแก้ advisory จริงต้อง v7 (breaking) |
| `fast-jwt` (ผ่าน `@fastify/jwt`) | critical ×3 | backend auth | `@fastify/jwt@10` (breaking) | เลื่อน — เสี่ยงกระทบ auth flow ที่ใช้งานได้; วางแผนอัปเกรดพร้อมทดสอบ integration เต็ม |
| `vitest`/`vite`/`vite-node`/`esbuild`/`@vitest/mocker` | moderate+high | dev tooling เท่านั้น | `vitest@4` / `vite@6+` (breaking) | เลื่อน — เป็น devDependency ไม่ขึ้น production bundle |

**แผนแก้ (รอบถัดไป)**: อัปเกรด `@fastify/jwt@10` + `vitest@4` + `react-router@7` แยกเป็นงานเฉพาะ พร้อมรัน typecheck/lint/test/build และ auth integration tests ให้ผ่านก่อน merge

## Implemented controls

- bcryptjs hash (cost 12 สำหรับบัญชี seed ใหม่และการเปลี่ยนรหัสผ่าน)
- password policy อย่างน้อย 10 ตัว พร้อมตัวพิมพ์ใหญ่/เล็ก ตัวเลข และอักขระพิเศษ
- JWT access token และ opaque refresh token; ฐานข้อมูลเก็บเฉพาะ SHA-256 hash
- refresh rotation/reuse rejection, logout revocation และ revoke ทุก session เมื่อเปลี่ยนรหัสผ่าน
- ไม่มี password/token ใน audit หรือ login log; `.env` ถูก ignore จาก Git

## Authentication
- JWT: Access token (อายุสั้น ตาม `JWT_EXPIRES_IN`, ค่าเริ่มต้น 8h) + refresh mechanism
- รหัสผ่าน hash ด้วย **bcrypt** (cost >= 10) — ห้ามเก็บ plaintext
- บังคับเปลี่ยนรหัสผ่านครั้งแรก (`mustChangePassword`)
- ล็อก/ปิดบัญชีได้ (`isActive`)

## Authorization (RBAC)
ตรวจสิทธิ์ทั้ง **Frontend (ซ่อน UI)** และ **Backend (บังคับจริง)**

| Role | ขอบเขต (สรุป) |
|------|----------------|
| SUPER_ADMIN | ทุกอย่าง + ตั้งค่าระบบ/ผู้ใช้ |
| ADMIN | จัดการข้อมูลหลักและ transaction ส่วนใหญ่ |
| EXECUTIVE | ดู Dashboard/รายงานทั้งหมด (read) |
| PURCHASING | Supplier, Goods Receipt, ราคาวัตถุดิบ |
| WAREHOUSE | คลัง, โอน, ปรับสต๊อก, ตรวจนับ |
| PRODUCTION | สูตร (ดู), คำสั่งผลิต, เบิก, output |
| SALES | ราคาขาย, รายงานกำไร |
| VIEWER | อ่านอย่างเดียว |

Permission ละเอียดเก็บใน `Permission` + `RolePermission`

## Audit
- `LoginLog` — ทุกการ login (สำเร็จ/ล้มเหลว, ip, user-agent)
- `AuditLog` — การแก้ไขข้อมูลสำคัญ (before/after, ผู้ทำ, เวลา)

## Input & Transport
- Validate ทุก input ด้วย Zod (backend เป็นด่านตัดสิน)
- CORS: อนุญาตเฉพาะ `FRONTEND_URL`
- ตั้ง security headers, rate limit (Phase 8)
- Request ID ต่อ request เพื่อ trace

## Secrets
- ห้าม commit `.env` จริง (มีใน `.gitignore`)
- `JWT_SECRET` ต้องสุ่มยาวใน production

## Google Sheets
- อ่านอย่างเดียว, ปิดโดยค่าเริ่มต้น (`GOOGLE_SHEETS_READ_ENABLED=false`)
- ใช้ scope read-only เท่านั้น, ห้าม endpoint ที่เขียนกลับ

## Data Integrity
- Decimal สำหรับเงิน/ปริมาณ
- Stock เปลี่ยนผ่าน ledger เท่านั้น
- Soft delete สำหรับข้อมูลที่มีประวัติ
