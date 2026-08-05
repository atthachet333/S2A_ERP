# INVENTORY RULES — S2A ERP

## กติกาหลัก
1. **ทุกการเปลี่ยนแปลงสต๊อกต้องมี Stock Ledger** — ห้ามแก้ StockBalance ตรง
2. StockBalance เป็น **projection** ของ StockLedger (สามารถ rebuild ได้)
3. ห้ามให้ยอดคงเหลือติดลบ (ตรวจก่อนตัด + DB transaction + row lock)
4. ป้องกันการโพสต์ซ้ำ (idempotency ต่อเอกสาร)
5. ราคา/ปริมาณเป็น Decimal

## ประเภทการเคลื่อนไหว (StockMovementType)
| ประเภท | ทิศทาง | ใช้เมื่อ |
|--------|--------|---------|
| PURCHASE_RECEIPT | เข้า | รับซื้อวัตถุดิบ |
| PRODUCTION_ISSUE | ออก | เบิกไปผลิต |
| PRODUCTION_RETURN | เข้า | คืนวัตถุดิบจากการผลิต |
| PRODUCTION_OUTPUT | เข้า | รับสินค้าสำเร็จรูป |
| SALE | ออก | ขาย |
| SALES_RETURN | เข้า | รับคืนจากลูกค้า |
| TRANSFER_OUT | ออก | โอนออกจากคลัง |
| TRANSFER_IN | เข้า | โอนเข้าคลัง |
| ADJUSTMENT_IN | เข้า | ปรับเพิ่ม |
| ADJUSTMENT_OUT | ออก | ปรับลด |
| WASTE | ออก | ของเสีย |
| EXPIRED | ออก | หมดอายุ |
| STOCK_COUNT | ปรับ | ผลตรวจนับ |

## ข้อมูลใน Stock Ledger (ต่อรายการ)
วันเวลา, ประเภท, เอกสารอ้างอิง, สินค้า, คลัง, ตำแหน่ง, Lot, จำนวนเข้า, จำนวนออก,
คงเหลือหลังรายการ, ต้นทุนต่อหน่วย, มูลค่ารวม, ผู้ทำรายการ, หมายเหตุ

## Lot & วันหมดอายุ
- Item ที่ `isLotTracked` ต้องระบุ Lot ทุกครั้งที่รับเข้า
- Item ที่ `isExpiryTracked` ต้องระบุวันหมดอายุ
- การตัดสต๊อกแนะนำ FEFO (First-Expired-First-Out) — เริ่มใช้จริงใน Phase 4+

## StockBalance
เก็บ `onHand` (คงเหลือ), `reserved` (จอง), `available = onHand - reserved`
ต่อ (item, warehouse, location, lot)

## Soft Delete
ห้ามลบ item/warehouse ที่มี ledger — เปลี่ยนเป็น `isActive=false` / ตั้ง `deletedAt`
