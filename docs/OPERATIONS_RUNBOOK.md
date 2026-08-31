# Operations Runbook

## Runtime

- Frontend: `127.0.0.1:1414`, PM2 app `s2a-frontend`
- Backend: `127.0.0.1:1415`, PM2 app `s2a-backend`
- Health: `GET http://127.0.0.1:1415/api/health`
- Production DB: `s2a_erp_main`; integration DB: `s2a_erp_test`

Required production variable names: `NODE_ENV`, `PORT`, `DATABASE_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `REFRESH_TOKEN_DAYS`, `FRONTEND_URL`, `LOG_LEVEL`, `UPLOAD_DIR`, `UPLOAD_MAX_BYTES`. Mail, LINE, and Google variables are optional and disabled unless explicitly enabled. Production runtime does not require `TEST_DATABASE_URL`.

## Safe checks

Run from `backend`:

1. `npm run db:prod:status`
2. `npm run audit:inventory`
3. `npm run db:test:status`
4. `npm run permissions:audit`

Never use `prisma migrate reset` or `prisma db push`. Test migrations use `npm run db:test:migrate`. Production migration requires a reviewed maintenance window and `CONFIRM_PRODUCTION_MIGRATION=s2a_erp_main npm run db:prod:migrate`.

## Deployment

Build and test first. For each changed service: `pm2 stop <name>`, wait until its port is no longer listening, then `pm2 start <name>`. Never use `pm2 restart`. Verify health, one listener per port, and listener PID equals PM2 PID.

Do not run `pm2 save` while the live daemon omits unrelated definitions retained in `dump.pm2` (`hr-line-bot`, `bot-cron`, `pos-app`). Resolve startup definitions during a planned maintenance window. Do not reboot merely to test startup.

## Common failures

- Health DB not up: stop deployment and verify `DATABASE_URL`, MariaDB service, and application grants.
- Audit mismatch: retain output/IDs, stop posting for the affected company/item, investigate; never auto-fix.
- Port already occupied: identify the listener PID and PM2 ownership; do not kill unrelated Node processes.
- Missing attachment: verify `UPLOAD_DIR` and paired file backup before changing metadata.
