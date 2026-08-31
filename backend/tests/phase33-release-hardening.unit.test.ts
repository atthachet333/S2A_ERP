import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const audit=readFileSync('scripts/audit-system.mjs','utf8'),db=readFileSync('scripts/db-safety.mjs','utf8'),pkg=JSON.parse(readFileSync('package.json','utf8')) as{scripts:Record<string,string>};
describe('Phase 33 release safeguards',()=>{
 it('fails closed unless the database target is explicit and exact',()=>{expect(db).toContain("Explicit --target=test or --target=production");expect(db).toContain("expected=target==='test'?'s2a_erp_test':'s2a_erp_main'");expect(db).toContain('Connected to ${selected}')});
 it('requires a production-specific confirmation before migration',()=>{expect(db).toContain("CONFIRM_PRODUCTION_MIGRATION!=='s2a_erp_main'");expect(pkg.scripts['db:prod:migrate']).toContain('--target=production')});
 it('never exposes reset or db push through release commands',()=>{const commands=Object.values(pkg.scripts).join(' ');expect(commands).not.toMatch(/migrate reset|db push/)});
 it('keeps system reconciliation read-only and returns a failing exit code',()=>{expect(audit).not.toMatch(/\.(create|update|delete|upsert|executeRaw)/);expect(audit).toContain('process.exitCode=2');expect(audit).toContain('ledger_balance_mismatch');expect(audit).toContain('draft_documents_with_ledgers')});
 it('documents production and integration database separation',()=>{expect(readFileSync('../docs/OPERATIONS_RUNBOOK.md','utf8')).toMatch(/s2a_erp_main[\s\S]*s2a_erp_test/)});
});
