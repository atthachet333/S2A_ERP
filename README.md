# S2A ERP — ระบบ ERP สำหรับธุรกิจผลิตอาหารสำเร็จรูป

## Food Costing Core
รองรับวัตถุดิบและราคาซื้อ เมนูพร้อมรูป สูตรแบบ versioned ต้นทุนที่ backend คำนวณซ้ำ การจำลอง markup/margin และ SellingPrice ผ่าน `/items`, `/menus`, `/recipes`, `/costing` โดยใช้ PostgreSQL จริง

> สถานะ 2026-08-06: UI/UX redesign เป็น enterprise shell (Sidebar 14 เมนู + Header + Dashboard 6 ส่วน) บน PostgreSQL Native `localhost:5432`, frontend port 1414 และ backend port 1415 โดยไม่ใช้ Docker
>
> **UI Shell**: layout ใหม่แยก `AppLayout`/`Sidebar`/`Header`, design token กลาง, placeholder สำหรับโมดูลที่ยังไม่พัฒนา, System Status จาก Health API จริง — ดู [`docs/UI_UX_GUIDELINES.md`](./docs/UI_UX_GUIDELINES.md)
>
> **API read-only ใหม่**: `GET /api/dashboard/summary` (นับข้อมูลจริง), `GET /api/activity` (audit+login log, SUPER_ADMIN, pagination)
>
> **Security (DB access)**: PostgreSQL รับเฉพาะ `localhost:5432`; runtime ใช้บัญชีสิทธิ์จำกัด `s2a_app`, migration ใช้ owner ผ่าน `DIRECT_URL`; ผู้ใช้เข้าถึงผ่านเว็บ (1414) → API (1415) เท่านั้น — ห้ามต่อ 5432 ตรง/ห้าม tunnel ไป 5432 (ดู [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md), [`docs/SECURITY.md`](./docs/SECURITY.md))

ระบบบริหารต้นทุนการผลิตและคลังสินค้า แยก React/Vite frontend และ Fastify/Prisma backend พร้อม first-login password flow, JWT access token, rotating refresh token และ RBAC

ระบบ ERP แบบ Full-Stack สำหรับโรงงานผลิตอาหารสำเร็จรูป ครอบคลุมตั้งแต่การจัดการวัตถุดิบ
บรรจุภัณฑ์ สูตรการผลิต (BOM) การคำนวณต้นทุนอัตโนมัติ การรับเข้า/เบิกจ่ายสต๊อก การผลิต
ไปจนถึง Dashboard และรายงานแบบ Real-time

> เอกสารฉบับนี้เป็น **ภาพรวมและคู่มือเริ่มต้นใช้งาน** รายละเอียดเชิงลึกอยู่ในโฟลเดอร์ [`docs/`](./docs)

---

## 1. ภาพรวมระบบ (Overview)

ระบบถูกออกแบบเพื่อ **ลดเวลาการกรอกข้อมูลของพนักงาน** และให้ทำงานทุกขั้นตอนจบภายในเว็บเดียว
ตั้งแต่ข้อมูลวัตถุดิบ → สูตร → ต้นทุน → ราคาขาย → คำสั่งผลิต → เบิก/ตัดสต๊อก → รับสินค้าสำเร็จรูป → รายงาน

Flow หลักของธุรกิจ:

```
วัตถุดิบ → สร้างสูตร (BOM) → คำนวณต้นทุน → กำหนดราคาขาย/กำไร
        → สร้างคำสั่งผลิต → ตรวจวัตถุดิบ → เบิก/ตัดสต๊อก
        → บันทึกผลผลิตจริง → รับสินค้าสำเร็จรูปเข้าคลัง
        → คำนวณต้นทุนจริง → Dashboard & รายงานอัปเดตทันที
```

## 2. เทคโนโลยีที่ใช้ (Tech Stack)

| ส่วน | เทคโนโลยี |
|------|-----------|
| Frontend | React, Vite, TypeScript, Tailwind CSS, shadcn/ui, React Router, TanStack Query, TanStack Table, React Hook Form, Zod, Recharts, Lucide |
| Backend | Node.js, TypeScript, Fastify, Prisma ORM, PostgreSQL, Zod, JWT, bcrypt, Pino, Vitest |
| Database | PostgreSQL 18 (Native, `localhost:5432` เท่านั้น — ไม่ใช้ Docker) |
| อื่น ๆ | Google Sheets (อ้างอิงอ่านอย่างเดียว, ปิดโดยค่าเริ่มต้น) |

## 3. โครงสร้างโฟลเดอร์ (Folder Structure)

```
S2A_ERP/
├── frontend/            # React + Vite (Port 1414)
├── backend/             # Fastify + Prisma (Port 1415)
├── docs/                # เอกสารทั้งหมด (spec, schema, api, ...)
├── docker-compose.yml   # PostgreSQL
├── .gitignore
├── README.md
└── package.json         # npm workspaces + สคริปต์รวม
```

## 4. วิธีติดตั้ง (Installation)

ต้องมี: **Node.js >= 20**, **PostgreSQL 18 (Native, localhost)**, **npm >= 10** — ไม่ใช้ Docker

```bash
# ที่ root ของโปรเจกต์
npm install
```

คำสั่งเดียวจะติดตั้ง dependency ให้ทั้ง `backend` และ `frontend` (npm workspaces)

## 5. ตั้งค่า Environment Variables

คัดลอกไฟล์ตัวอย่างแล้วปรับค่า:

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

ตัวแปรสำคัญ (ดูรายละเอียดใน `docs/DEPLOYMENT.md`):

- `backend/.env` — `PORT=1415`, `DATABASE_URL`, `JWT_SECRET`, `FRONTEND_URL`, `GOOGLE_SHEETS_READ_ENABLED=false`
- `frontend/.env` — `VITE_API_URL=/api`, `VITE_APP_PORT=1414`

> ⚠️ **Google Sheets ปิดโดยค่าเริ่มต้น** (`GOOGLE_SHEETS_READ_ENABLED=false`) และเชื่อมต่อได้แบบ **อ่านอย่างเดียว** เท่านั้น

## 6. สร้างฐานข้อมูล (Database)

```bash
# ต้องมี PostgreSQL 18 Native รันอยู่ที่ localhost:5432 (ไม่ใช้ Docker)
# และสร้างบัญชี runtime s2a_app ก่อน — ดู docs/DEPLOYMENT.md (Runbook B)

# 1) สร้าง Prisma Client
npm run db:generate

# 2) รัน migration (ใช้ DIRECT_URL = owner/postgres)
npm --workspace backend run prisma:deploy

# 3) ใส่ข้อมูลตัวอย่าง (seed)
npm run db:seed
```

## 7. วิธีรัน

```bash
# รันทั้งระบบพร้อมกัน (แนะนำ)
npm run dev

# หรือแยกรัน
npm run dev:backend    # http://localhost:1415
npm run dev:frontend   # http://localhost:1414
```

## 8. URL สำหรับเข้าใช้งาน

| ระบบ | URL |
|------|-----|
| Frontend (เข้าใช้งานจริง) | http://localhost:1414 |
| Backend API | http://localhost:1415 |
| Health check (ตรง) | http://localhost:1415/api/health |
| Health check (ผ่าน proxy) | http://localhost:1414/api/health |

> ผู้ใช้งานควรเข้าผ่าน **Port 1414** เท่านั้น (เรียก backend ผ่าน Vite proxy `/api`)

## 9. บัญชีทดสอบ (Seed Account)

| Username | Password | Role |
|----------|----------|------|
| `admin` | `ChangeMe123!` | SUPER_ADMIN (บังคับเปลี่ยนรหัสผ่านครั้งแรก) |

## 10. แก้ปัญหาที่พบบ่อย (Troubleshooting)

| อาการ | วิธีแก้ |
|-------|---------|
| Port 1414/1415 ถูกใช้งาน | ปิดโปรแกรมที่ใช้พอร์ต หรือแก้ค่าใน `.env` (ยังต้องกลับมาที่ 1414/1415 ตาม spec) |
| เชื่อม DB ไม่ได้ | ตรวจว่า `npm run db:up` แล้ว container `food-erp-postgres` เป็น healthy (`docker ps`) |
| `prisma generate` ล้มเหลว | ตรวจ `DATABASE_URL` และรัน `npm run db:generate` ใหม่ |
| Frontend เรียก `/api` ไม่ติด | ตรวจว่า backend รันที่ 1415 และ `vite.config.ts` proxy ชี้ถูก |
| Google Sheets error | ปล่อย `GOOGLE_SHEETS_READ_ENABLED=false` (เป็นค่าเริ่มต้นและปลอดภัย) |

---

## เอกสารเพิ่มเติม

ดูโฟลเดอร์ [`docs/`](./docs) — เริ่มที่ [`docs/PROJECT_SPEC.md`](./docs/PROJECT_SPEC.md) และ
[`docs/PROGRESS.md`](./docs/PROGRESS.md) เพื่อดูสถานะการพัฒนา
