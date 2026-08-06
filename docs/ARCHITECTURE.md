# ARCHITECTURE — S2A ERP

## Authentication flow

Frontend เก็บ access/refresh token ใน local storage เพื่อ session restore, ส่ง Bearer access token ไป Fastify และ refresh ได้หนึ่งครั้งเมื่อพบ 401 Backend ตรวจสถานะผู้ใช้และ `mustChangePassword` จาก PostgreSQL ทุก protected request ก่อนอนุญาต dashboard หรือ users API

## 1. ภาพรวมสถาปัตยกรรม

```
┌────────────────────┐        /api (Vite proxy)        ┌────────────────────┐
│   Frontend (SPA)   │  ───────────────────────────►   │   Backend (API)    │
│  React + Vite      │                                 │  Fastify + Prisma  │
│  Port 1414         │  ◄───────────────────────────   │  Port 1415         │
└────────────────────┘        JSON (standard envelope) └─────────┬──────────┘
                                                                  │ Prisma
                                                        ┌─────────▼──────────┐
                                                        │   PostgreSQL 18    │
                                                        │ (Native 127.0.0.1) │
                                                        └────────────────────┘

(อ่านอย่างเดียว, ปิดโดยค่าเริ่มต้น)  Google Sheets ──► Backend read-only service
```

## 2. หลักการออกแบบ
- **แยก Frontend / Backend** เป็นคนละแอป (คนละ package) — ห้ามรวมเป็น Next.js เดียว
- **API-first**: frontend เรียกผ่าน API client กลาง (`frontend/src/lib/api-client.ts`)
- **Modular backend**: จัดโค้ดตาม module (health, auth, items, inventory, ...)
- **Single source of truth** สำหรับสต๊อก = StockLedger (StockBalance เป็น projection)

## 3. Backend Layers
```
routes (Fastify)  →  schema (Zod validation)  →  service (business logic)
                                                      │
                                                 Prisma (repository)  →  PostgreSQL
```
- `plugins/` — cross-cutting (cors, jwt, error handler, request-id, logging)
- `config/` — env loading & validation (Zod)
- `modules/<name>/` — route + schema + service ต่อโดเมน

## 4. Frontend Structure
- `lib/api-client.ts` — fetch wrapper กลาง + envelope handling
- `lib/query.ts` — TanStack Query client
- `components/layout/` — Sidebar, Header, Breadcrumb
- `components/ui/` — shadcn/ui primitives
- `pages/` — หน้าจอตามเมนู
- `hooks/` — custom hooks (เช่น useHealth)

## 5. Cross-cutting Concerns
| ด้าน | วิธีการ |
|------|---------|
| Auth | JWT (access + refresh), bcrypt hashing |
| Validation | Zod ทั้ง backend และ frontend |
| Logging | Pino (structured) + Request ID ต่อ request |
| Error | Envelope `{ success, error: { code, message, details } }` |
| Money/Qty | Prisma `Decimal` |
| Realtime | Polling ก่อน แล้วต่อยอดเป็น SSE/WebSocket |

## 6. Environments
- Local dev: Vite dev server + Fastify + Postgres (Native, localhost เท่านั้น — ไม่ใช้ Docker)
- Prod: ดู `DEPLOYMENT.md`

## 7. Database access boundary (2026-08-06)
- PostgreSQL รับเฉพาะ `127.0.0.1:5432` (`listen_addresses='localhost'`) — เครื่องอื่นห้ามต่อ DB ตรง
- Backend เป็น **ชั้นเดียว** ที่เข้าถึง DB; ผู้ใช้เข้าผ่าน Frontend (1414) → API (1415)
- Runtime ใช้บัญชีสิทธิ์จำกัด **`s2a_app`** (`DATABASE_URL`); migration ใช้ owner ผ่าน **`DIRECT_URL`** (`schema.prisma` → `directUrl`)
- ห้ามใส่ `DATABASE_URL`/`DIRECT_URL` ใน frontend หรือ client bundle
