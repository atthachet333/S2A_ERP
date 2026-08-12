# DEPLOYMENT — S2A ERP

## Current MariaDB deployment (authoritative, 2026-08-12)

S2A ERP uses native MariaDB on port 3306 and does not use Docker. URLs use Prisma's `mysql://` scheme and must never be committed or copied into frontend configuration. The application database is `s2a_erp`; integration tests must use only `s2a_erp_test`.

```sh
npm run db:generate
npm --workspace backend run prisma:deploy
npm run db:seed
npm run dev
```

Active MariaDB migrations are under `backend/prisma/migrations`. PostgreSQL migrations under `backend/prisma/migrations-postgresql-legacy` are reference-only. See `POSTGRESQL_TO_MARIADB_MIGRATION.md`.

## Legacy PostgreSQL deployment reference

## Food Costing runtime
ใช้ PostgreSQL native บน localhost; `DATABASE_URL` สำหรับ runtime และ `DIRECT_URL` สำหรับ migration เท่านั้น ห้ามส่งค่าเหล่านี้เข้า frontend bundleหรือ commit `.env`

## PostgreSQL Native (required, localhost-only)

ใช้ service `postgresql-x64-18` ที่ `localhost:5432` และฐานข้อมูล `food_erp` / `food_erp_test`
**ห้ามใช้ Docker** และ **PostgreSQL ต้องรับการเชื่อมต่อเฉพาะภายในเครื่อง (localhost) เท่านั้น** — เครื่องพนักงาน/เครื่องอื่นห้ามต่อ port 5432 โดยตรง ผู้ใช้เข้าถึงระบบผ่านเว็บ (port 1414) เท่านั้น

> `docker-compose.yml` ในโปรเจกต์ **ไม่ใช้งาน** (คงไว้เพื่ออ้างอิงเท่านั้น) — ดู ADR-008

## สถาปัตยกรรมการเข้าถึงข้อมูล (Trust boundary)
```
เครื่องผู้ใช้ (Browser)
   │  HTTP/HTTPS
   ▼
Frontend :1414 ──(Vite proxy /api)──► Backend API :1415
                                          │  DATABASE_URL (s2a_app, สิทธิ์จำกัด)
                                          ▼
                                   PostgreSQL 127.0.0.1:5432  ← ชั้นเดียวที่แตะ DB
```
- Backend เป็น **ชั้นเดียว** ที่เชื่อม PostgreSQL
- Runtime ใช้บัญชี **`s2a_app`** (SELECT/INSERT/UPDATE/DELETE เท่านั้น) — **ห้ามใช้ `postgres`**
- `postgres`/owner ใช้เฉพาะงาน **admin / migration** ผ่าน `DIRECT_URL`

## Local Development
```bash
npm install
cp backend/.env.example backend/.env      # แล้วแก้ค่าให้ตรงกับ s2a_app + owner จริง
cp frontend/.env.example frontend/.env
npm run db:generate
npm --workspace backend run prisma:deploy  # migrate (ใช้ DIRECT_URL)
npm run db:seed
npm run dev                                # FE :1414, BE :1415
```

## Environment Variables
### backend/.env  (ห้าม commit — อยู่ใน .gitignore)
```
PORT=1415
# Runtime: บัญชีสิทธิ์จำกัด (localhost เท่านั้น)
DATABASE_URL=postgresql://s2a_app:<APP_PASSWORD>@localhost:5432/food_erp
TEST_DATABASE_URL=postgresql://s2a_app:<APP_PASSWORD>@localhost:5432/food_erp_test
# Migration/introspection เท่านั้น: owner/postgres — ห้ามส่งไป frontend/runtime
DIRECT_URL=postgresql://postgres:<ADMIN_PASSWORD>@localhost:5432/food_erp
JWT_SECRET=<สุ่มยาว>=
JWT_EXPIRES_IN=8h
FRONTEND_URL=http://localhost:1414
GOOGLE_SHEETS_READ_ENABLED=false
```
### frontend/.env
```
VITE_APP_NAME=S2A ERP
VITE_API_URL=/api
VITE_APP_PORT=1414
```
> ⚠️ **ห้ามใส่ `DATABASE_URL`/`DIRECT_URL`/รหัสผ่าน DB ใน `frontend/.env` หรือ client bundle ใด ๆ**

---

## Runbook A — Hardening PostgreSQL ให้รับเฉพาะ localhost
> รันบน **เครื่อง Server ที่มี PostgreSQL** (PowerShell as Administrator) — คำสั่งด้านล่างไม่ทำงานบนเครื่องที่ไม่มี PostgreSQL

### A1. หา data directory จริง (ห้ามเดา)
```powershell
Get-CimInstance Win32_Service | Where-Object { $_.Name -like '*postgres*' } |
  Select-Object Name, State, PathName
# ดู -D ใน PathName เช่น "D:\PostgreSQL\18\data"
```

### A2. สำรอง config ก่อนแก้ (ตั้งชื่อพร้อม timestamp)
```powershell
$data = 'D:\PostgreSQL\18\data'          # ← แก้ให้ตรงของจริง
$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item "$data\postgresql.conf" "$data\postgresql.conf.$ts.bak"
Copy-Item "$data\pg_hba.conf"     "$data\pg_hba.conf.$ts.bak"
```

### A3. postgresql.conf → รับเฉพาะ localhost
ตั้ง (ตรวจว่าไม่มีบรรทัดซ้ำที่ทับค่ากันภายหลัง):
```
listen_addresses = 'localhost'
port = 5432
```
ห้ามใช้ `'*'`, `'0.0.0.0'`, หรือ IP ของ LAN

### A4. pg_hba.conf → อนุญาตเฉพาะ loopback (scram-sha-256)
คงไว้เฉพาะ:
```
host    all     all     127.0.0.1/32     scram-sha-256
host    all     all     ::1/128          scram-sha-256
```
**ลบ/คอมเมนต์** ทุกบรรทัดที่เปิด LAN/Internet เช่น `192.168.0.0/16`, `192.168.1.0/24`, `0.0.0.0/0`
- ห้ามใช้ `trust`
- คงกฎ local socket เดิมไว้ (ถ้ามี)

### A5. ปิด Windows Firewall rule ของ 5432 (เฉพาะที่เปิด LAN)
```powershell
Get-NetFirewallRule | Where-Object { $_.DisplayName -match 'PostgreSQL|5432|S2A ERP' } |
  Select-Object DisplayName, Enabled, Direction, Action
# ปิดเฉพาะ rule ที่เปิด TCP 5432 เข้าเครื่อง — อย่าปิด firewall ทั้งระบบ, อย่าลบ rule อื่น
Disable-NetFirewallRule -DisplayName '<ชื่อ rule ที่เปิด 5432 จาก LAN>'
```

### A6. Restart + ตรวจผล (ต้องมีเฉพาะ 127.0.0.1 / ::1)
```powershell
Get-Service *postgres*
Restart-Service postgresql-x64-18       # ← ชื่อ service จริง
Get-NetTCPConnection -LocalPort 5432 -State Listen |
  Format-Table LocalAddress, LocalPort, State, OwningProcess
Test-NetConnection localhost -Port 5432          # TcpTestSucceeded = True
Test-NetConnection <SERVER-LAN-IP> -Port 5432    # ควร False (ไม่รับผ่าน LAN)
```
ผลที่ยอมรับ: `127.0.0.1`, `::1` — **ห้ามมี** `0.0.0.0` หรือ IP LAN/Public

### A7. Rollback (ถ้าพัง)
```powershell
Copy-Item "$data\postgresql.conf.$ts.bak" "$data\postgresql.conf" -Force
Copy-Item "$data\pg_hba.conf.$ts.bak"     "$data\pg_hba.conf"     -Force
Restart-Service postgresql-x64-18
```

---

## Runbook B — สร้างบัญชี Runtime `s2a_app` (สิทธิ์จำกัด)
รันด้วย `psql` บน Server เท่านั้น (ดูไฟล์ template: `backend/scripts/create-s2a-app-role.sql`)
```sql
-- เชื่อมด้วย postgres/owner
CREATE ROLE s2a_app WITH LOGIN PASSWORD '<STRONG_RANDOM_>=32_CHARS>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
GRANT CONNECT ON DATABASE food_erp      TO s2a_app;
GRANT CONNECT ON DATABASE food_erp_test TO s2a_app;
-- \c food_erp  (ทำซ้ำใน food_erp_test)
GRANT USAGE ON SCHEMA public TO s2a_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO s2a_app;
GRANT USAGE, SELECT, UPDATE          ON ALL SEQUENCES IN SCHEMA public TO s2a_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES    TO s2a_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE          ON SEQUENCES TO s2a_app;
```
**ห้ามให้** SUPERUSER / CREATEDB / CREATEROLE / BYPASSRLS และห้ามเปลี่ยน owner ของ system database

ตรวจว่า s2a_app ทำสิ่งต้องห้ามไม่ได้ (ต้อง error/permission denied):
```sql
-- ต่อด้วย s2a_app แล้วลอง (ต้องล้มเหลว):
CREATE DATABASE x;   CREATE ROLE y;   DROP DATABASE food_erp;   ALTER SYSTEM SET listen_addresses = '*';
```

## Runbook C — Rotate รหัสผ่าน DB
```sql
ALTER ROLE s2a_app WITH PASSWORD '<NEW_STRONG_RANDOM>';
```
แล้วอัปเดต `DATABASE_URL`/`TEST_DATABASE_URL` ใน `backend/.env` (และ restart backend) — ห้าม commit ค่าใหม่

## DBeaver / เครื่องมือ DB — Policy
- ใช้เฉพาะ **บน Server** หรือผ่าน **Remote Desktop** เข้า Server เท่านั้น
- **ห้ามบันทึกบัญชี `postgres`** ไว้บนเครื่องพนักงาน และห้ามสร้าง connection profile ที่ชี้ `192.168.x.x:5432`
- อนาคตถ้าต้องดู DB จากเครื่อง admin: ใช้ RDP / SSH tunnel / VPN แบบควบคุมสิทธิ์ (ยังไม่เปิดในรอบนี้)

## Tunnel / Reverse Proxy — Policy
- Tunnel/Reverse proxy (Cloudflare Tunnel, Nginx) ให้ชี้เฉพาะ **Frontend/Reverse proxy** เท่านั้น
- **ห้ามสร้าง tunnel/port-forward/public IP ไป port 5432** เด็ดขาด

## Build (production)
```bash
npm run build   # backend → backend/dist ; frontend → frontend/dist (static)
```

## Migration บน server
```bash
npm --workspace backend run prisma:deploy   # ใช้ DIRECT_URL (owner), ไม่ใช่ runtime user
```
