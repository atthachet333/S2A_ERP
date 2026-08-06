# DECISIONS (ADR) — S2A ERP

## ADR-008: PostgreSQL Native และ session token rotation

ใช้ PostgreSQL 18 Native ที่ port 5432 โดยไม่ใช้ Docker เก็บ refresh token เฉพาะ SHA-256 hash ในฐานข้อมูล หมุน token ทุกครั้งที่ refresh และ revoke เมื่อเปลี่ยนรหัสผ่านหรือ logout

บันทึกการตัดสินใจเชิงสถาปัตยกรรม (Architecture Decision Records)

## ADR-001: แยก Frontend / Backend เป็นคนละแอป
- **บริบท**: โจทย์ห้ามรวม FE/BE ใน Next.js เดียว
- **ตัดสินใจ**: FE = React+Vite (1414), BE = Fastify (1415), จัดการด้วย npm workspaces
- **ผล**: deploy/scale แยกกันได้ ชัดเจน แต่ต้องตั้ง proxy `/api`

## ADR-002: PostgreSQL เป็นฐานข้อมูลหลัก + Prisma
- **บริบท**: ต้องรองรับ transaction/ledger และข้อมูลจำนวนมาก
- **ตัดสินใจ**: PostgreSQL 16 (Docker) + Prisma ORM
- **ผล**: type-safe, migration ชัดเจน; ใช้ Decimal ได้

## ADR-003: Decimal สำหรับเงินและปริมาณ
- **ตัดสินใจ**: ใช้ Prisma `Decimal` (ราคา 18,4 / ปริมาณ 18,4 / % 9,4) ห้าม Float
- **ผล**: กันปัญหาปัดเศษทางการเงิน

## ADR-004: Stock Ledger เป็น single source of truth
- **ตัดสินใจ**: ทุกการเปลี่ยนสต๊อกผ่าน StockLedger, StockBalance เป็น projection
- **ผล**: ตรวจสอบย้อนหลัง/rebuild ได้ ห้ามแก้ยอดตรง

## ADR-005: Moving Average Cost ในเวอร์ชันแรก
- **ตัดสินใจ**: ใช้ต้นทุนเฉลี่ยเคลื่อนที่ (คำนวณตอนรับเข้า)
- **ผล**: เรียบง่าย เข้าใจง่าย; เผื่อเปลี่ยนเป็น FIFO ภายหลัง

## ADR-006: Google Sheets read-only + ปิดโดยค่าเริ่มต้น
- **ตัดสินใจ**: `GOOGLE_SHEETS_READ_ENABLED=false`, scope readonly เท่านั้น
- **ผล**: ป้องกันกระทบข้อมูลต้นฉบับ

## ADR-007: Response Envelope มาตรฐาน
- **ตัดสินใจ**: `{ success, data, message }` / `{ success, error{code,message,details} }`
- **ผล**: frontend จัดการ error สม่ำเสมอ

## ADR-008: Realtime เริ่มด้วย Polling
- **ตัดสินใจ**: TanStack Query polling 10s ก่อน แล้วต่อยอด SSE/WebSocket
- **ผล**: ลดความซับซ้อนช่วงแรก, โครงสร้างเผื่ออนาคต

## ADR-009: Soft Delete
- **ตัดสินใจ**: ข้อมูลที่มี transaction ใช้ `isActive`/`deletedAt` แทนการลบจริง
- **ผล**: รักษาความสมบูรณ์ของประวัติ

## ADR-010: Placeholder-driven navigation สำหรับโมดูลที่ยังไม่พัฒนา
- **บริบท**: Sidebar ต้องแสดงครบ 14 เมนูตาม spec แต่หลายโมดูลยังไม่มี backend
- **ตัดสินใจ**: ใช้ single source `components/layout/nav-config.ts` (เมนู + metadata + สถานะการพัฒนา) และ `ModulePlaceholder` component เดียว render ทุกเมนูที่ยังไม่พร้อม โดยแสดงสถานะ "กำลังพัฒนา/วางแผนไว้" อย่างชัดเจน ห้ามใส่ตัวเลขธุรกิจปลอม
- **ผล**: เพิ่มเมนู/โมดูลใหม่ได้จากไฟล์เดียว, ผู้ใช้ไม่สับสนว่าอะไรใช้ได้จริง, ไม่มี broken link

## ADR-011: Design tokens เป็น CSS variables (ไม่เพิ่ม dependency)
- **บริบท**: ต้องการธีมสม่ำเสมอ (ขาว/น้ำเงิน/กรม/ทอง) โดยไม่พึ่ง component library ใหม่
- **ตัดสินใจ**: นิยาม token (สี/surface/สถานะ/radius/shadow/layout) เป็น CSS variables ใน `index.css` และเขียน component class เอง ต่อยอดจากแนวเดิม (hand-written CSS) แทนการติดตั้ง UI kit
- **ผล**: ไม่เพิ่ม bundle/deps, ปรับธีมจุดเดียว, ไม่ hardcode สีซ้ำ; แลกกับการดูแล CSS เอง

## ADR-013: PostgreSQL localhost-only + แยกบัญชี runtime/migration
- **บริบท**: ต้องกันเครื่องพนักงาน/เครื่องอื่นต่อ PostgreSQL 5432 โดยตรง และไม่ให้ backend ใช้บัญชี `postgres` เป็น runtime
- **ตัดสินใจ**:
  - `listen_addresses = 'localhost'` + `pg_hba.conf` อนุญาตเฉพาะ `127.0.0.1/32` และ `::1/128` (scram-sha-256); ปิด firewall rule ของ 5432 ที่เปิด LAN
  - Runtime ใช้บัญชีสิทธิ์จำกัด `s2a_app` (DML เท่านั้น) ผ่าน `DATABASE_URL`
  - Migration/admin ใช้ owner/`postgres` ผ่าน `DIRECT_URL` (schema.prisma `directUrl`) — ไม่โหลดเข้าสู่ runtime
  - Backend เป็นชั้นเดียวที่แตะ DB; ห้าม tunnel/expose 5432; DBeaver ใช้บน Server/RDP เท่านั้น
- **ผล**: ลด attack surface ของฐานข้อมูลอย่างมาก, จำกัดความเสียหายถ้า runtime credential รั่ว; แลกกับการต้องดูแล 3 connection string แยกบทบาท
- **หมายเหตุ**: `env.ts` ทำให้ `TEST_DATABASE_URL`/`DIRECT_URL` เป็น optional เพื่อไม่ให้ runtime boot พังหากไม่ได้ตั้ง; runbook + SQL template อยู่ใน DEPLOYMENT.md / `backend/scripts/create-s2a-app-role.sql`

## ADR-012: เลื่อนการย้ายไป Prisma config file (Technical Debt)
- **บริบท**: Prisma 6 เตือนว่า `package.json#prisma` (`seed`) จะ deprecated ใน Prisma 7 ให้ย้ายไป `prisma.config.ts`
- **ตัดสินใจ**: ยังไม่ย้ายในรอบ UI/UX นี้ และ **ไม่อัปเกรด Prisma 7 ทันที** เพื่อลดความเสี่ยงต่อ auth/migration ที่ใช้งานได้แล้ว
- **แผนแก้**: เมื่อขึ้น Prisma 7 ให้ย้าย config การ seed ไป `backend/prisma.config.ts` (`export default { schema, migrations, seed }`), ลบคีย์ `prisma` ออกจาก `package.json`, แล้วทดสอบ `prisma:generate` + `prisma:seed` + integration tests ให้ผ่านก่อน
- **ผล**: ระบบปัจจุบันเสถียร; บันทึกเป็นหนี้ทางเทคนิคใน PROGRESS/SECURITY
