# DATABASE SCHEMA — S2A ERP

## Food Costing persistence
Menu reuse `Item(FINISHED_GOOD)`; สูตรใช้ `Recipe`, `RecipeVersion`, `RecipeIngredient`, `RecipeCost`; ราคาขายใช้ `SellingPrice`; conversion เฉพาะวัตถุดิบใช้ `Item.purchaseToBaseFactor` โดยไม่มี model ซ้ำ

## Native PostgreSQL status

- Database: `food_erp`; integration test database: `food_erp_test`
- Migration: `20260805151518_init`
- `RefreshToken` เก็บ token hash, expiry, revocation, replacement chain, IP และ user agent
- `LoginLog` และ `AuditLog` ห้ามเก็บ password หรือ token
- **Access**: PostgreSQL รับเฉพาะ `localhost:5432`; runtime ใช้บัญชีสิทธิ์จำกัด `s2a_app` (DML เท่านั้น), migration ใช้ owner ผ่าน `DIRECT_URL` — ดู `docs/DEPLOYMENT.md` และ `docs/SECURITY.md`
- `schema.prisma` datasource: `url = env("DATABASE_URL")` (runtime), `directUrl = env("DIRECT_URL")` (migration)

ฐานข้อมูล: **PostgreSQL 16** ผ่าน **Prisma ORM**
ไฟล์จริง: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma)

## หลักการ
- เงิน/ปริมาณ ใช้ `Decimal` — ราคา `Decimal(18,4)`, ปริมาณ `Decimal(18,4)`, เปอร์เซ็นต์ `Decimal(9,4)`
- ทุก entity หลัก: `id`, `createdAt`, `updatedAt`, `createdById`, `updatedById`
- Soft delete: `deletedAt DateTime?` + `isActive Boolean`
- Optimistic locking: `version Int @default(1)` ในตารางที่มีการแก้ไขพร้อมกันบ่อย
- ห้ามแก้ StockBalance โดยไม่มี StockLedger

## กลุ่ม Models (Phase 1 = ครบทุก model ด้านล่าง, business logic เติมภายหลัง)

### Auth & Audit
- `User` — บัญชีผู้ใช้ (username, email, passwordHash, mustChangePassword, isActive)
- `Role` — บทบาท (enum `RoleName`)
- `Permission` — สิทธิ์ย่อย (code, description)
- `UserRole` — many-to-many User↔Role
- `RolePermission` — many-to-many Role↔Permission
- `AuditLog` — บันทึกการแก้ไขข้อมูลสำคัญ (entity, entityId, action, before, after)
- `LoginLog` — บันทึกการ login (userId, ip, userAgent, success)

### Master Data
- `Unit`, `UnitConversion`
- `Category`
- `Item` (enum `ItemType`: RAW_MATERIAL, PACKAGING, SEMI_FINISHED, FINISHED_GOOD, CONSUMABLE, WASTE)
- `ItemPriceHistory`
- `Supplier`
- `Warehouse`, `WarehouseLocation`

### Inventory
- `InventoryLot` — lot, วันผลิต/หมดอายุ
- `StockBalance` — ยอดคงเหลือ/จอง/พร้อมใช้ ต่อ (item, warehouse, location, lot)
- `StockLedger` — บัญชีการเคลื่อนไหว (enum `StockMovementType`)

### Recipe & Cost
- `Recipe`, `RecipeVersion`, `RecipeIngredient`, `RecipeCost`
- `SellingPrice`

### Production
- `ProductionOrder` (enum `ProductionStatus`)
- `ProductionMaterial`, `ProductionOutput`, `ProductionWaste`

### Transactions
- `GoodsReceipt`, `GoodsReceiptItem`
- `StockTransfer`, `StockTransferItem`
- `StockAdjustment`, `StockAdjustmentItem`

### System
- `SystemSetting` (key/value)

## Enums
- `RoleName`: SUPER_ADMIN, ADMIN, EXECUTIVE, PURCHASING, WAREHOUSE, PRODUCTION, SALES, VIEWER
- `ItemType`: RAW_MATERIAL, PACKAGING, SEMI_FINISHED, FINISHED_GOOD, CONSUMABLE, WASTE
- `StockMovementType`: PURCHASE_RECEIPT, PRODUCTION_ISSUE, PRODUCTION_RETURN, PRODUCTION_OUTPUT, SALE, SALES_RETURN, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT_IN, ADJUSTMENT_OUT, WASTE, EXPIRED, STOCK_COUNT
- `ProductionStatus`: DRAFT, PLANNED, APPROVED, IN_PROGRESS, COMPLETED, CANCELLED

## Indexes & Constraints (ตัวอย่าง)
- `Item.code` unique, `Item.barcode` unique (nullable)
- `StockBalance` unique composite (itemId, warehouseId, locationId, lotId)
- `StockLedger` index (itemId, warehouseId, createdAt)
- `RecipeVersion` unique (recipeId, versionNo)

## หมายเหตุ
เมื่อมีการเปลี่ยนแปลง schema ต้องอัปเดตไฟล์นี้และรัน migration ใหม่
