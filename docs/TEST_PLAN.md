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

## เกณฑ์
- ทุก PR: typecheck + lint + test + build ต้องผ่าน
- เป้าหมาย coverage โมดูลการเงิน/สต๊อก > 80% (Phase 8)

## คำสั่ง
```bash
npm test                 # ทั้งระบบ
npm --workspace backend run test
npm --workspace frontend run test
```
