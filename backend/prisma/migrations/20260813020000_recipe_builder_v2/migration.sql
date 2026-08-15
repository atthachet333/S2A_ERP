-- Recipe Builder 2.0 — additive migration
-- ปลอดภัยแบบ additive: เพิ่มคอลัมน์ nullable / ผ่อนคลาย NOT NULL / เพิ่ม index+FK
-- ไม่มี DROP COLUMN, ไม่มีการแปลงข้อมูล, ไม่แตะ baseline, ห้าม migrate reset
-- แถวเดิมของ recipe_ingredients จะได้ componentType='ITEM' และ sortOrder=0 อัตโนมัติ

-- recipe_ingredients: รองรับสูตรย่อย (sub-recipe) + จัดลำดับ
ALTER TABLE `recipe_ingredients`
    ADD COLUMN `componentType` VARCHAR(191) NOT NULL DEFAULT 'ITEM',
    ADD COLUMN `childRecipeId` VARCHAR(191) NULL,
    ADD COLUMN `sortOrder` INTEGER NOT NULL DEFAULT 0,
    MODIFY `itemId` VARCHAR(191) NULL;

CREATE INDEX `recipe_ingredients_childRecipeId_idx` ON `recipe_ingredients`(`childRecipeId`);

ALTER TABLE `recipe_ingredients`
    ADD CONSTRAINT `recipe_ingredients_childRecipeId_fkey`
    FOREIGN KEY (`childRecipeId`) REFERENCES `recipes`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- recipe_versions: หน่วยผลผลิต + portion + overhead แบบยืดหยุ่น
ALTER TABLE `recipe_versions`
    ADD COLUMN `yieldUnitId` VARCHAR(191) NULL,
    ADD COLUMN `portionQty` DECIMAL(18, 4) NULL,
    ADD COLUMN `portionUnit` VARCHAR(191) NULL,
    ADD COLUMN `overheadMode` VARCHAR(191) NULL,
    ADD COLUMN `overheadPercent` DECIMAL(9, 4) NULL,
    ADD COLUMN `overheadBase` VARCHAR(191) NULL,
    ADD COLUMN `overheadTotal` DECIMAL(18, 4) NULL,
    ADD COLUMN `overheadDetails` JSON NULL;

CREATE INDEX `recipe_versions_yieldUnitId_idx` ON `recipe_versions`(`yieldUnitId`);

ALTER TABLE `recipe_versions`
    ADD CONSTRAINT `recipe_versions_yieldUnitId_fkey`
    FOREIGN KEY (`yieldUnitId`) REFERENCES `units`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- recipes: index ช่วยหน้ารายการ/archived filter
CREATE INDEX `recipes_companyId_isActive_deletedAt_idx` ON `recipes`(`companyId`, `isActive`, `deletedAt`);
