# SECURITY — S2A ERP

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
