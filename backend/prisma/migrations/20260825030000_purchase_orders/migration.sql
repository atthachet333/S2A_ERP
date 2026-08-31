CREATE TABLE `purchase_orders` (
  `id` VARCHAR(191) NOT NULL,
  `companyId` VARCHAR(191) NOT NULL,
  `poNo` VARCHAR(191) NOT NULL,
  `status` ENUM('DRAFT','CONFIRMED','PARTIALLY_RECEIVED','RECEIVED','CANCELLED') NOT NULL DEFAULT 'DRAFT',
  `orderDate` DATETIME(3) NOT NULL,
  `expectedDeliveryAt` DATETIME(3) NULL,
  `supplierId` VARCHAR(191) NOT NULL,
  `warehouseId` VARCHAR(191) NOT NULL,
  `purchasePlanId` VARCHAR(191) NULL,
  `subtotal` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `discount` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `tax` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `grandTotal` DECIMAL(18,4) NOT NULL DEFAULT 0,
  `note` TEXT NULL,
  `cancellationReason` TEXT NULL,
  `confirmedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,
  `version` INTEGER NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `createdById` VARCHAR(191) NULL,
  `updatedById` VARCHAR(191) NULL,
  UNIQUE INDEX `purchase_orders_poNo_key`(`poNo`),
  INDEX `purchase_orders_companyId_status_expectedDeliveryAt_idx`(`companyId`,`status`,`expectedDeliveryAt`),
  INDEX `purchase_orders_supplierId_status_idx`(`supplierId`,`status`),
  INDEX `purchase_orders_purchasePlanId_idx`(`purchasePlanId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchase_order_items` (
  `id` VARCHAR(191) NOT NULL,
  `purchaseOrderId` VARCHAR(191) NOT NULL,
  `itemId` VARCHAR(191) NOT NULL,
  `purchasePlanRequirementId` VARCHAR(191) NULL,
  `itemCode` VARCHAR(191) NOT NULL,
  `itemName` VARCHAR(191) NOT NULL,
  `purchaseUnitId` VARCHAR(191) NULL,
  `purchaseUnitCode` VARCHAR(191) NOT NULL,
  `purchaseToBaseFactor` DECIMAL(18,6) NOT NULL,
  `orderedQty` DECIMAL(18,4) NOT NULL,
  `orderedBaseQty` DECIMAL(18,4) NOT NULL,
  `unitPrice` DECIMAL(18,4) NOT NULL,
  `lineSubtotal` DECIMAL(18,4) NOT NULL,
  `note` TEXT NULL,
  INDEX `purchase_order_items_purchaseOrderId_idx`(`purchaseOrderId`),
  INDEX `purchase_order_items_purchasePlanRequirementId_idx`(`purchasePlanRequirementId`),
  INDEX `purchase_order_items_itemId_idx`(`itemId`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `goods_receipts`
  ADD COLUMN `purchaseOrderId` VARCHAR(191) NULL;
ALTER TABLE `goods_receipt_items`
  ADD COLUMN `purchaseOrderItemId` VARCHAR(191) NULL,
  ADD COLUMN `purchaseUnitCode` VARCHAR(191) NULL,
  ADD COLUMN `purchaseToBaseFactor` DECIMAL(18,6) NULL;

CREATE INDEX `goods_receipts_purchaseOrderId_status_idx` ON `goods_receipts`(`purchaseOrderId`,`status`);
CREATE INDEX `goods_receipt_items_purchaseOrderItemId_idx` ON `goods_receipt_items`(`purchaseOrderItemId`);

ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_supplierId_fkey` FOREIGN KEY (`supplierId`) REFERENCES `suppliers`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_warehouseId_fkey` FOREIGN KEY (`warehouseId`) REFERENCES `warehouses`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_orders` ADD CONSTRAINT `purchase_orders_purchasePlanId_fkey` FOREIGN KEY (`purchasePlanId`) REFERENCES `purchase_plans`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_itemId_fkey` FOREIGN KEY (`itemId`) REFERENCES `items`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchase_order_items` ADD CONSTRAINT `purchase_order_items_purchasePlanRequirementId_fkey` FOREIGN KEY (`purchasePlanRequirementId`) REFERENCES `purchase_plan_requirements`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `goods_receipts` ADD CONSTRAINT `goods_receipts_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `purchase_orders`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `goods_receipt_items` ADD CONSTRAINT `goods_receipt_items_purchaseOrderItemId_fkey` FOREIGN KEY (`purchaseOrderItemId`) REFERENCES `purchase_order_items`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
