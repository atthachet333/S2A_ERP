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
