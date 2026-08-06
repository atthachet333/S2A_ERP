-- ============================================================
-- S2A ERP — สร้างบัญชี Runtime สิทธิ์จำกัด (s2a_app)
-- รันด้วย psql บน "เครื่อง Server" เท่านั้น ด้วยบัญชี postgres/owner
--   psql -h localhost -U postgres -d food_erp -f create-s2a-app-role.sql
--
-- ⚠️ อย่าใส่รหัสผ่านจริงในไฟล์นี้ (ไฟล์นี้ถูก track ใน git)
--    แทน :app_password ตอนรัน เช่น:
--   psql -v app_password="'<STRONG_RANDOM>'" -h localhost -U postgres -d food_erp -f create-s2a-app-role.sql
-- ============================================================

-- 1) สร้าง role (idempotent-ish: ถ้ามีแล้วให้แก้เป็น ALTER ROLE ... PASSWORD)
CREATE ROLE s2a_app WITH LOGIN PASSWORD :app_password
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

-- 2) สิทธิ์เชื่อมต่อฐานข้อมูล
GRANT CONNECT ON DATABASE food_erp      TO s2a_app;
GRANT CONNECT ON DATABASE food_erp_test TO s2a_app;

-- 3) สิทธิ์ระดับ schema/ตาราง/sequence (รันซ้ำใน food_erp_test ด้วย \c food_erp_test)
GRANT USAGE ON SCHEMA public TO s2a_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO s2a_app;
GRANT USAGE, SELECT, UPDATE          ON ALL SEQUENCES IN SCHEMA public TO s2a_app;

-- 4) Default privileges สำหรับตาราง/sequence ที่ migration สร้างใหม่ในอนาคต
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO s2a_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO s2a_app;

-- ห้ามให้: SUPERUSER / CREATEDB / CREATEROLE / BYPASSRLS
-- ห้ามเปลี่ยน owner ของ system database
