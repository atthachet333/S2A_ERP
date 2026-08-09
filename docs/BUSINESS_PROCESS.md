# BUSINESS PROCESS — S2A ERP

## Costing workflow
ราคาซื้อวัตถุดิบ → เมนู → Recipe V1 → วัตถุดิบ/ค่าใช้จ่าย → backend cost → version ใหม่เมื่อสูตรเปลี่ยน → pricing simulation → SellingPrice

กระบวนการทางธุรกิจหลักและสถานะเอกสารในแต่ละขั้นตอน

## 1. Master Data
- สร้างหน่วยนับ (Unit) + อัตราแปลงหน่วย (UnitConversion)
- สร้างหมวดหมู่ (Category)
- สร้างวัตถุดิบ / บรรจุภัณฑ์ / สินค้าสำเร็จรูป (Item)
- สร้าง Supplier, Warehouse, WarehouseLocation

## 2. สูตร (BOM)
1. สร้าง Recipe สำหรับสินค้าสำเร็จรูป
2. เพิ่ม RecipeVersion (สูตรที่ผลิตแล้วห้ามแก้ย้อนหลัง → สร้าง version ใหม่)
3. เพิ่ม RecipeIngredient (วัตถุดิบ + บรรจุภัณฑ์), กำหนด Yield, ของเสียมาตรฐาน, ค่าแรง/ไฟ/น้ำ/แก๊ส

## 3. ต้นทุน & ราคาขาย
- คำนวณต้นทุนมาตรฐานจากสูตร (RecipeCost)
- กำหนดราคาขายหลายระดับ (SellingPrice) พร้อมคำนวณ Markup/Margin/กำไร

## 4. จัดซื้อ & รับเข้า (Goods Receipt)
1. บันทึก GoodsReceipt + GoodsReceiptItem (Supplier, Lot, วันผลิต/หมดอายุ, ราคา)
2. ยืนยันรับ → สร้าง StockLedger (`PURCHASE_RECEIPT`), อัปเดต StockBalance, คำนวณ Moving Average Cost

## 5. การผลิต (Production)
สถานะ: `DRAFT → PLANNED → APPROVED → IN_PROGRESS → COMPLETED` (หรือ `CANCELLED`)
1. สร้าง ProductionOrder อ้างอิง Recipe + Version
2. ตรวจวัตถุดิบเพียงพอ
3. เบิกวัตถุดิบ → StockLedger (`PRODUCTION_ISSUE`) ภายใน DB transaction, ป้องกันยอดติดลบ/กดซ้ำ
4. บันทึกผลผลิตจริง + ของเสีย, คำนวณ Yield และต้นทุนจริง
5. รับสินค้าสำเร็จรูป → StockLedger (`PRODUCTION_OUTPUT`)

## 6. คลัง & ปรับสต๊อก
- โอนคลัง (StockTransfer): `TRANSFER_OUT` / `TRANSFER_IN`
- ปรับสต๊อก/ตรวจนับ (StockAdjustment): `ADJUSTMENT_IN` / `ADJUSTMENT_OUT` / `STOCK_COUNT`
- ของเสีย/หมดอายุ: `WASTE` / `EXPIRED`

## 7. Dashboard & รายงาน
อัปเดตทันทีจาก StockLedger/StockBalance — เริ่มด้วย TanStack Query polling ทุก 10 วินาที
(ออกแบบเผื่อ SSE/WebSocket ในอนาคต)

## กติกาสำคัญ
- ทุกการเคลื่อนไหวสต๊อกต้องมี Stock Ledger
- ห้ามลบข้อมูลที่มี transaction → ใช้ soft delete / inactive
- เงินและปริมาณใช้ Decimal เสมอ
