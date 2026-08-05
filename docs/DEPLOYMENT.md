# DEPLOYMENT — S2A ERP

## PostgreSQL Native (required)

ใช้ service `postgresql-x64-18` ที่ `localhost:5432` และฐานข้อมูล `food_erp`; ห้ามใช้ Docker ใน environment นี้ รัน `npm run db:generate`, ตรวจ migration status และ seed ก่อนเปิด `npm run dev`

## Local Development
```bash
npm install
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
npm run db:up          # PostgreSQL (Docker)
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev            # FE :1414, BE :1415
```

## PostgreSQL (Docker Compose)
- Service: `postgres` (image `postgres:16-alpine`)
- DB: `food_erp`, Port `5432`, Volume `postgres-data`, Health check `pg_isready`
```bash
npm run db:up      # docker compose up -d
npm run db:down    # docker compose down
docker ps          # ตรวจสถานะ healthy
```

## Environment Variables
### backend/.env
```
PORT=1415
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/food_erp
JWT_SECRET=change-this-secret
JWT_EXPIRES_IN=8h
FRONTEND_URL=http://localhost:1414
GOOGLE_SHEETS_READ_ENABLED=false
GOOGLE_SERVICE_ACCOUNT_EMAIL=
GOOGLE_PRIVATE_KEY=
GOOGLE_REFERENCE_SHEET_ID=
```
### frontend/.env
```
VITE_APP_NAME=S2A ERP
VITE_API_URL=/api
VITE_APP_PORT=1414
```

## Build (production)
```bash
npm run build
# backend → backend/dist (node dist/server.js)
# frontend → frontend/dist (serve เป็น static)
```

## แนวทาง Production (อนาคต — ยังไม่ทำใน Phase 1)
- Frontend: serve `frontend/dist` ด้วย Nginx/CDN, proxy `/api` → backend
- Backend: รันด้วย process manager (pm2/systemd) หรือ container
- Database: managed PostgreSQL + backup + connection pool
- ใส่ backend/frontend เข้า Docker ในภายหลัง (ระยะแรกเฉพาะ Postgres อยู่ใน Docker)
- ตั้ง `JWT_SECRET` แบบสุ่ม, เปิด HTTPS, ตั้ง CORS ให้ตรง domain จริง

## Migration บน server
```bash
npm --workspace backend run prisma:deploy   # prisma migrate deploy
```
