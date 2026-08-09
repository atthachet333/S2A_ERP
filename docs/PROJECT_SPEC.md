# PROJECT SPEC — S2A ERP

## Food Costing Core
ขอบเขตที่ implement: Item/price history, Menu, Recipe/RecipeVersion, item-specific purchase-to-base conversion, RecipeCost และ SellingPrice ระดับ RETAIL/WHOLESALE/AGENT/SPECIAL

## 1. วัตถุประสงค์
ระบบ ERP สำหรับธุรกิจผลิตอาหารสำเร็จรูป เพื่อลดเวลาการกรอกข้อมูลและรวมทุกกระบวนการไว้ในเว็บเดียว

## 2. ขอบเขตฟีเจอร์ (Feature Scope)
1. จัดการวัตถุดิบ / บรรจุภัณฑ์ / เมนู (สินค้าสำเร็จรูป)
2. สร้างสูตรการผลิต (BOM) พร้อม Versioning
3. คำนวณต้นทุนสินค้าอัตโนมัติ (Moving Average Cost)
4. คำนวณราคาขายและกำไร (Markup / Margin)
5. รับวัตถุดิบเข้าคลัง / เบิกไปผลิต / ตัดสต๊อกอัตโนมัติ
6. รับสินค้าสำเร็จรูปเข้าคลัง
7. จัดการ Lot และวันหมดอายุ
8. ตรวจสอบสต๊อกแบบ Real-time
9. Dashboard และรายงาน
10. เพิ่ม / แก้ไข / ปิดใช้งาน / ลบ (soft) เมนูและวัตถุดิบ
11. เก็บประวัติการแก้ไข (Audit Log) และการเคลื่อนไหวสต๊อก (Stock Ledger)

## 3. ผู้ใช้งานและสิทธิ์ (Roles)
`SUPER_ADMIN`, `ADMIN`, `EXECUTIVE`, `PURCHASING`, `WAREHOUSE`, `PRODUCTION`, `SALES`, `VIEWER`
(รายละเอียด permission ดู `SECURITY.md`)

## 4. ข้อกำหนดไม่ใช่ฟังก์ชัน (Non-Functional)
- ใช้ **PostgreSQL** เป็นฐานข้อมูลหลัก (ห้ามใช้ Google Sheets เป็น DB)
- ใช้ **Decimal** สำหรับข้อมูลเงินและปริมาณ (ห้าม Float)
- ทุกการเปลี่ยนแปลงสต๊อกต้องผ่าน **Stock Ledger** (ไม่แก้ยอดตรง)
- Soft Delete สำหรับข้อมูลที่มีประวัติ transaction
- แยก Frontend / Backend ชัดเจน
- Frontend เรียก Backend ผ่าน API จริง (ห้าม mock ถาวร)

## 5. ข้อกำหนด Google Sheets
- ใช้เป็น **ข้อมูลอ้างอิงอ่านอย่างเดียว** เพื่อศึกษ ากระบวนการ/สูตร/รายงานเดิม
- ห้ามเขียน / แก้ / ลบ / เปลี่ยนชื่อ sheet / เปลี่ยนสูตร
- ปิดโดยค่าเริ่มต้น: `GOOGLE_SHEETS_READ_ENABLED=false`
- Sheet อ้างอิง: ดู `GOOGLE_SHEETS_MAPPING.md`

## 6. พอร์ตและการเชื่อมต่อ
- Frontend: `http://localhost:1414`
- Backend: `http://localhost:1415`
- Vite proxy: `/api` → `http://localhost:1415`

## 7. เกณฑ์ความสำเร็จของ Phase 1
ดู `IMPLEMENTATION_PLAN.md` และ Checklist ใน `PROGRESS.md`
