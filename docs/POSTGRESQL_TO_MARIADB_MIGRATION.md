# PostgreSQL to MariaDB migration

## Purpose and safety boundary

S2A ERP now uses MariaDB. Prisma uses the `mysql` provider for MariaDB. The old PostgreSQL database is not modified or used by this baseline; copying legacy business data is a separate, explicitly authorized project.

- Active database: `s2a_erp` on MariaDB, default port `3306`
- Test database: `s2a_erp_test`
- Character set/collation: `utf8mb4` / `utf8mb4_unicode_ci`
- Docker is not used.
- Credentials and connection URLs must stay in ignored environment files.

## Migration history strategy

`backend/prisma/migrations-postgresql-legacy/` is audit-only PostgreSQL history and must never be deployed to MariaDB. `backend/prisma/migrations/` is the active MariaDB history. The initial migration was generated from an empty database to the validated datamodel with Prisma 6.19.3, inspected for PostgreSQL-only syntax, and applied with `prisma migrate deploy`.

Future deployment:

```sh
npm --workspace backend run prisma:deploy
```

Never use `prisma migrate reset` on `s2a_erp`.

## Test database

Integration tests refuse to start unless `TEST_DATABASE_URL` names exactly `s2a_erp_test`. An administrator must create that database and grant the test account privileges only on it. Then run:

```sh
npm --workspace backend run prisma:test-db
npm --workspace backend test
```

## Validation and rollback

Validation covers connectivity, empty-target confirmation, generated SQL inspection, migrations, schema objects, charset, seed, and application quality checks. See `PROGRESS.md` for executed results and blockers.

Rollback means switching configuration back to the untouched PostgreSQL system after compatibility review. Existing PostgreSQL business data is not copied automatically; valuable legacy data requires a separately reviewed migration with reconciliation and a write freeze.
