-- Additive migration: registration lifecycle fields on `users` (Issue 4)
-- ปลอดภัยแบบ additive: เพิ่มคอลัมน์ nullable ทั้งหมด ไม่แตะข้อมูล/คอลัมน์เดิม ไม่มี DROP
-- ห้ามแก้ไข baseline migration และห้ามใช้ prisma migrate reset

ALTER TABLE `users`
    ADD COLUMN `registrationStatus` VARCHAR(191) NULL,
    ADD COLUMN `approvedAt` DATETIME(3) NULL,
    ADD COLUMN `approvedById` VARCHAR(191) NULL,
    ADD COLUMN `rejectedAt` DATETIME(3) NULL,
    ADD COLUMN `rejectedById` VARCHAR(191) NULL,
    ADD COLUMN `rejectionReason` VARCHAR(191) NULL;

CREATE INDEX `users_registrationStatus_idx` ON `users`(`registrationStatus`);
