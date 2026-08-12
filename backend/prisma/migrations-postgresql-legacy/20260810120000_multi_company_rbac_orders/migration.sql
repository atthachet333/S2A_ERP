-- Additive multi-company foundation. Existing business rows are assigned to the
-- primary company before company_id becomes required; no data is deleted.
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'MANAGER';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'OPERATIONS';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'ORDER_COORDINATOR';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'CHEF';
ALTER TYPE "RoleName" ADD VALUE IF NOT EXISTS 'COSTING_STAFF';

CREATE TYPE "SalesOrderStatus" AS ENUM ('DRAFT','CONFIRMED','SENT_TO_PREP','PICKING','ISSUED','READY','DELIVERED','CANCELLED');
CREATE TYPE "StockIssueStatus" AS ENUM ('DRAFT','ISSUED','CANCELLED');
CREATE TYPE "NotificationSeverity" AS ENUM ('INFO','ACTION_REQUIRED','WARNING','CRITICAL');

CREATE TABLE "companies" (
  "id" TEXT NOT NULL, "code" TEXT NOT NULL, "nameTh" TEXT NOT NULL, "nameEn" TEXT,
  "logoUrl" TEXT, "taxId" TEXT, "address" TEXT, "phone" TEXT, "email" TEXT,
  "website" TEXT, "authorizedName" TEXT, "documentFooter" TEXT, "signatureUrl" TEXT,
  "stampUrl" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "companies_code_key" ON "companies"("code");
CREATE INDEX "companies_isActive_idx" ON "companies"("isActive");
INSERT INTO "companies" ("id","code","nameTh","nameEn","updatedAt")
VALUES ('s2a_primary_company','S2A-PRIMARY','บริษัทหลัก','Primary Company',CURRENT_TIMESTAMP)
ON CONFLICT ("code") DO NOTHING;

CREATE TABLE "company_memberships" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "companyId" TEXT NOT NULL, "roleId" TEXT NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true, "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "company_memberships_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "company_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE,
  CONSTRAINT "company_memberships_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE,
  CONSTRAINT "company_memberships_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "roles"("id")
);
CREATE UNIQUE INDEX "company_memberships_userId_companyId_key" ON "company_memberships"("userId","companyId");
CREATE INDEX "company_memberships_companyId_isActive_idx" ON "company_memberships"("companyId","isActive");
INSERT INTO "company_memberships" ("id","userId","companyId","roleId","isDefault","updatedAt")
SELECT 'm_' || substr(md5(u."id"),1,22), u."id", 's2a_primary_company', ur."roleId", true, CURRENT_TIMESTAMP
FROM "users" u JOIN LATERAL (SELECT "roleId" FROM "user_roles" WHERE "userId"=u."id" LIMIT 1) ur ON true
ON CONFLICT ("userId","companyId") DO NOTHING;

ALTER TABLE "audit_logs" ADD COLUMN "companyId" TEXT;
UPDATE "audit_logs" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;

ALTER TABLE "categories" ADD COLUMN "companyId" TEXT;
ALTER TABLE "items" ADD COLUMN "companyId" TEXT;
ALTER TABLE "item_price_history" ADD COLUMN "companyId" TEXT;
ALTER TABLE "suppliers" ADD COLUMN "companyId" TEXT;
ALTER TABLE "warehouses" ADD COLUMN "companyId" TEXT;
ALTER TABLE "recipes" ADD COLUMN "companyId" TEXT;
ALTER TABLE "selling_prices" ADD COLUMN "companyId" TEXT;
ALTER TABLE "production_orders" ADD COLUMN "companyId" TEXT;
ALTER TABLE "goods_receipts" ADD COLUMN "companyId" TEXT;
ALTER TABLE "stock_transfers" ADD COLUMN "companyId" TEXT;
ALTER TABLE "stock_adjustments" ADD COLUMN "companyId" TEXT;

UPDATE "categories" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "items" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "item_price_history" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "suppliers" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "warehouses" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "recipes" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "selling_prices" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "production_orders" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "goods_receipts" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "stock_transfers" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;
UPDATE "stock_adjustments" SET "companyId"='s2a_primary_company' WHERE "companyId" IS NULL;

ALTER TABLE "categories" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "items" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "item_price_history" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "suppliers" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "warehouses" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "recipes" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "selling_prices" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "production_orders" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "goods_receipts" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "stock_transfers" ALTER COLUMN "companyId" SET NOT NULL;
ALTER TABLE "stock_adjustments" ALTER COLUMN "companyId" SET NOT NULL;

CREATE INDEX "items_companyId_idx" ON "items"("companyId");
CREATE INDEX "recipes_companyId_idx" ON "recipes"("companyId");
CREATE INDEX "goods_receipts_companyId_idx" ON "goods_receipts"("companyId");

CREATE TABLE "customers" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "code" TEXT NOT NULL, "name" TEXT NOT NULL,
  "customerType" TEXT, "contactName" TEXT, "phone" TEXT, "email" TEXT, "address" TEXT,
  "taxId" TEXT, "note" TEXT, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id")
);
CREATE UNIQUE INDEX "customers_companyId_code_key" ON "customers"("companyId","code");
CREATE INDEX "customers_companyId_isActive_idx" ON "customers"("companyId","isActive");

CREATE TABLE "sales_orders" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "orderNo" TEXT NOT NULL, "customerId" TEXT NOT NULL,
  "contactName" TEXT, "phone" TEXT, "email" TEXT, "deliveryAddress" TEXT, "deliveryDate" TIMESTAMP(3) NOT NULL,
  "deliveryTime" TEXT, "status" "SalesOrderStatus" NOT NULL DEFAULT 'DRAFT',
  "subtotal" DECIMAL(18,4) NOT NULL DEFAULT 0, "discount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "tax" DECIMAL(18,4) NOT NULL DEFAULT 0, "totalAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "note" TEXT, "createdByUserId" TEXT NOT NULL, "sentToOperationsAt" TIMESTAMP(3), "confirmedAt" TIMESTAMP(3),
  "issuedAt" TIMESTAMP(3), "readyAt" TIMESTAMP(3), "deliveredAt" TIMESTAMP(3), "cancelledAt" TIMESTAMP(3),
  "cancellationReason" TEXT, "idempotencyKey" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sales_orders_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_orders_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id"),
  CONSTRAINT "sales_orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id"),
  CONSTRAINT "sales_orders_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
);
CREATE UNIQUE INDEX "sales_orders_companyId_orderNo_key" ON "sales_orders"("companyId","orderNo");
CREATE UNIQUE INDEX "sales_orders_companyId_idempotencyKey_key" ON "sales_orders"("companyId","idempotencyKey");
CREATE INDEX "sales_orders_companyId_status_deliveryDate_idx" ON "sales_orders"("companyId","status","deliveryDate");

CREATE TABLE "sales_order_items" (
  "id" TEXT NOT NULL, "orderId" TEXT NOT NULL, "menuId" TEXT NOT NULL, "menuNameSnapshot" TEXT NOT NULL,
  "quantity" DECIMAL(18,4) NOT NULL, "unit" TEXT NOT NULL, "unitPrice" DECIMAL(18,4) NOT NULL,
  "lineTotal" DECIMAL(18,4) NOT NULL, "note" TEXT,
  CONSTRAINT "sales_order_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sales_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_orders"("id") ON DELETE CASCADE
);
CREATE INDEX "sales_order_items_orderId_idx" ON "sales_order_items"("orderId");

CREATE TABLE "stock_issues" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "issueNo" TEXT NOT NULL, "orderId" TEXT,
  "warehouseId" TEXT NOT NULL, "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "destination" TEXT NOT NULL DEFAULT 'CENTRAL_KITCHEN', "status" "StockIssueStatus" NOT NULL DEFAULT 'DRAFT',
  "note" TEXT, "createdByUserId" TEXT NOT NULL, "issuedAt" TIMESTAMP(3), "idempotencyKey" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "stock_issues_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_issues_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id"),
  CONSTRAINT "stock_issues_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "sales_orders"("id"),
  CONSTRAINT "stock_issues_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id")
);
CREATE UNIQUE INDEX "stock_issues_companyId_issueNo_key" ON "stock_issues"("companyId","issueNo");
CREATE UNIQUE INDEX "stock_issues_companyId_idempotencyKey_key" ON "stock_issues"("companyId","idempotencyKey");
CREATE INDEX "stock_issues_companyId_status_idx" ON "stock_issues"("companyId","status");

CREATE TABLE "stock_issue_items" (
  "id" TEXT NOT NULL, "stockIssueId" TEXT NOT NULL, "itemId" TEXT NOT NULL,
  "requiredQty" DECIMAL(18,4) NOT NULL DEFAULT 0, "issuedQty" DECIMAL(18,4) NOT NULL,
  "unit" TEXT NOT NULL, "baseQty" DECIMAL(18,4) NOT NULL, "note" TEXT,
  CONSTRAINT "stock_issue_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stock_issue_items_stockIssueId_fkey" FOREIGN KEY ("stockIssueId") REFERENCES "stock_issues"("id") ON DELETE CASCADE
);
CREATE INDEX "stock_issue_items_stockIssueId_idx" ON "stock_issue_items"("stockIssueId");

CREATE TABLE "notifications" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
  "severity" "NotificationSeverity" NOT NULL DEFAULT 'INFO', "title" TEXT NOT NULL, "message" TEXT NOT NULL,
  "entityType" TEXT, "entityId" TEXT, "actionUrl" TEXT, "readAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id"),
  CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE INDEX "notifications_companyId_userId_readAt_createdAt_idx" ON "notifications"("companyId","userId","readAt","createdAt");

CREATE TABLE "notification_preferences" (
  "id" TEXT NOT NULL, "companyId" TEXT NOT NULL, "userId" TEXT NOT NULL, "channel" TEXT NOT NULL,
  "eventType" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notification_preferences_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id"),
  CONSTRAINT "notification_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "notification_preferences_companyId_userId_channel_eventType_key" ON "notification_preferences"("companyId","userId","channel","eventType");
