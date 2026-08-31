# Backup and Restore

Backups must pair the database and upload tree under one timestamp. Store credentials in a restricted MariaDB option file outside the repository; never place passwords on the command line or in Git.

## Backup

1. Create timestamp `yyyyMMdd-HHmmss` and a protected directory outside the repository.
2. Run `mariadb-dump --defaults-extra-file=<restricted-config> --single-transaction --quick --routines --events --triggers --databases s2a_erp_main --result-file=<backup>\s2a_erp_main-<timestamp>.sql`.
3. Archive `D:\S2A_ERP\backend\data\uploads` as `uploads-<timestamp>.zip` using an approved backup tool.
4. Verify both files exist and are nonzero. Record hashes and timestamp together.

Suggested retention: daily 7 days, weekly 4 weeks, monthly 6 months. Deletion automation is intentionally not included.

## Restore drill (never production)

Use a database administrator account only for database creation/import:

1. Create isolated `s2a_erp_restore_test` with the same character set/collation.
2. Import the selected SQL dump into that database. Never target `s2a_erp_main`.
3. Configure a temporary URL whose parsed database name is exactly `s2a_erp_restore_test`.
4. Run Prisma validation/status and the integrity queries from `audit-system.mjs` adapted to the restore target.
5. Compare table counts, sample documents, balance/ledger reconciliation, and attachment manifest against the paired archive.
6. Drop the restore database only after explicit administrator approval.

The application account intentionally may not have database-creation privileges. If creation/import fails, an administrator must perform steps 1–2. A dump is not considered validated until this drill succeeds.
