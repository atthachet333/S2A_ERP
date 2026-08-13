-- Additive migration: extra optional customer contact fields
-- ปลอดภัยแบบ additive: เพิ่มคอลัมน์ nullable ทั้งหมด ไม่แตะข้อมูล/คอลัมน์เดิม ไม่มี DROP
-- ห้ามแก้ไข baseline migration และห้ามใช้ prisma migrate reset

ALTER TABLE `customers`
    ADD COLUMN `billingAddress` VARCHAR(191) NULL,
    ADD COLUMN `lineId` VARCHAR(191) NULL,
    ADD COLUMN `branch` VARCHAR(191) NULL;
