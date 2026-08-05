# IMPLEMENTATION PLAN — S2A ERP

การพัฒนาแบ่งเป็น Phase ตามลำดับ (ดูสถานะจริงใน `PROGRESS.md`)

## Phase 1 — Foundation ✅ (รอบนี้)
- โครงสร้างโปรเจกต์ (frontend/backend/docs)
- เอกสาร Markdown ทั้งหมด
- package.json + สคริปต์รวม (concurrently)
- Port 1414 (FE) / 1415 (BE) + Vite proxy `/api`
- Backend Health API `/api/health`
- Frontend หน้าเช็ค health ผ่าน proxy
- PostgreSQL docker-compose
- Prisma schema เวอร์ชันเริ่มต้น + generate
- `.env.example` ทั้งสองฝั่ง
- Seed script (โครง)
- Type check / test / build ผ่าน

## Phase 2 — Auth & Users
Login, Logout, Refresh, Change password, RBAC (roles/permissions), Layout + Sidebar, Audit/Login log

## Phase 3 — Master Data
Units + conversions, Categories, Items, Suppliers, Warehouses + locations

## Phase 4 — Inbound & Inventory
Goods Receipt, Stock Ledger, Stock Balance, Moving Average Cost

## Phase 5 — Recipe & Cost
Recipe + Version, Cost Calculation, Selling Price, Profit

## Phase 6 — Production
Production Order, Material Issue, Output, Waste, Actual Cost, Transfers, Adjustments

## Phase 7 — Dashboard & Reports
Dashboard (polling 10s), Reports, Export (Excel/CSV/PDF)

## Phase 8 — Hardening
Testing, Security review, Performance, Documentation

## Definition of Done (ต่อ Phase)
1. TypeScript check ผ่าน
2. Lint ผ่าน
3. Test ผ่าน
4. Build ผ่าน
5. อัปเดต `PROGRESS.md`, `CHANGELOG.md` (+ `API_SPEC.md`/`DATABASE_SCHEMA.md`/`DECISIONS.md` ตามการเปลี่ยนแปลง)
