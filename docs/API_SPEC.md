# API SPEC — S2A ERP

## Authentication endpoints (implemented)

- `POST /api/auth/login`
- `POST /api/auth/refresh` (bodyless request คืน `INVALID_REFRESH_TOKEN`)
- `POST /api/auth/logout` (รองรับ bodyless request)
- `GET /api/auth/me`
- `GET /api/auth/dashboard`
- `POST /api/auth/change-password`
- `GET /api/users` (SUPER_ADMIN)

Base path: `/api` (frontend เรียกผ่าน Vite proxy → `http://localhost:1415`)

## รูปแบบ Response มาตรฐาน (Envelope)

สำเร็จ:
```json
{ "success": true, "data": {}, "message": "ดำเนินการสำเร็จ" }
```

ผิดพลาด:
```json
{
  "success": false,
  "error": { "code": "INSUFFICIENT_STOCK", "message": "วัตถุดิบคงเหลือไม่เพียงพอ", "details": {} }
}
```

ทุก response มี header `x-request-id` สำหรับ trace.

## Query Params มาตรฐาน (list endpoints)
`?page=1&pageSize=20&search=...&sortBy=field&sortDir=asc|desc&filter[...]=...`

Response ของ list จะห่อ `data` เป็น:
```json
{ "items": [], "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
```

## Error Codes (เริ่มต้น)
| code | ความหมาย |
|------|----------|
| `VALIDATION_ERROR` | ข้อมูลไม่ผ่าน validation (details = field errors) |
| `UNAUTHORIZED` | ยังไม่ได้ login / token ไม่ถูกต้อง |
| `FORBIDDEN` | ไม่มีสิทธิ์ |
| `NOT_FOUND` | ไม่พบข้อมูล |
| `CONFLICT` | ข้อมูลซ้ำ / optimistic lock |
| `INSUFFICIENT_STOCK` | สต๊อกไม่พอ |
| `INTERNAL_ERROR` | ข้อผิดพลาดภายใน |

---

## Endpoints

### Health (Phase 1 — พร้อมใช้งาน)
- `GET /api/health` → `{ status, uptime, timestamp, db }`
  ```json
  { "success": true, "data": { "status": "ok", "uptime": 12.3, "timestamp": "...", "db": "up|down|disabled" }, "message": "..." }
  ```

### Authentication (Phase 2)
- `POST /api/auth/login` — `{ username, password }` → `{ accessToken, user }`
- `POST /api/auth/logout`
- `POST /api/auth/refresh`
- `POST /api/auth/change-password`
- `GET /api/auth/me`

### Users (Phase 2)
- `GET /api/users` · `POST /api/users` · `GET /api/users/:id` · `PATCH /api/users/:id` · `PATCH /api/users/:id/status`

### Master Data (Phase 3)
- `/api/units`, `/api/units/conversions`
- `/api/categories`
- `/api/items`, `/api/items/:id/price-history`
- `/api/suppliers`
- `/api/warehouses`, `/api/warehouses/:id/locations`

### Inventory (Phase 4)
- `/api/inventory/balances`, `/api/inventory/lots`
- `/api/stock-ledger`

### Goods Receipts (Phase 4)
- `/api/goods-receipts` (create → posts ledger)

### Recipes & Cost (Phase 5)
- `/api/recipes`, `/api/recipes/:id/versions`
- `/api/cost/calculate`
- `/api/selling-prices`

### Production (Phase 6)
- `/api/production-orders` (+ issue, output, waste)

### Stock ops (Phase 6)
- `/api/stock-transfers`, `/api/stock-adjustments`

### Dashboard & Reports (Phase 7)
- `/api/dashboard/summary`
- `/api/reports/*` (+ export excel/csv/pdf)

### Audit (Phase 2+)
- `/api/audit-logs`, `/api/login-logs`

> เมื่อเพิ่ม/แก้ endpoint ต้องอัปเดตไฟล์นี้ (กติกาในโจทย์ข้อ 5)
