import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { isDocumentNumberRace, withDocumentNumberRetry } from '../src/lib/tx-retry.js';
import { formatOrderNo, nextOrderNo } from '../src/lib/inventory-ledger.js';

/** PHASE 16 — ขอบเขตของการลองใหม่ต้องแคบ: เฉพาะการแย่งกันออกเลขเอกสารเท่านั้น */

const known = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('boom', { code, clientVersion: 'test', meta });

describe('การจำแนกข้อผิดพลาดของการออกเลขเอกสาร', () => {
  it('นับว่าเป็นการแย่งเลข: deadlock, ER_CHECKREAD, lock wait timeout', () => {
    expect(isDocumentNumberRace(known('P2034'))).toBe(true);
    expect(isDocumentNumberRace(known('P2010', { code: '1020' }))).toBe(true);
    expect(isDocumentNumberRace(known('P2010', { code: '1213' }))).toBe(true);
    expect(isDocumentNumberRace(known('P2010', { code: '1205' }))).toBe(true);
  });

  it('นับว่าเป็นการแย่งเลข: unique key ที่เกี่ยวกับเลขเอกสาร', () => {
    expect(isDocumentNumberRace(known('P2002', { target: 'document_counters_companyId_docType_periodKey_key' }))).toBe(true);
    expect(isDocumentNumberRace(known('P2002', { target: ['companyId', 'orderNo'] }))).toBe(true);
    expect(isDocumentNumberRace(known('P2002', { target: ['companyId', 'issueNo'] }))).toBe(true);
  });

  it('ไม่นับ: ข้อผิดพลาดทางธุรกิจและ unique key อื่น', () => {
    expect(isDocumentNumberRace(known('P2002', { target: ['username'] }))).toBe(false);
    expect(isDocumentNumberRace(known('P2002', { target: ['companyId', 'idempotencyKey'] }))).toBe(false);
    expect(isDocumentNumberRace(known('P2025'))).toBe(false);
    expect(isDocumentNumberRace(known('P2010', { code: '1064' }))).toBe(false);
    expect(isDocumentNumberRace(new Error('WAREHOUSE_NOT_FOUND'))).toBe(false);
    expect(isDocumentNumberRace(new Error('ITEM_NOT_IN_COMPANY'))).toBe(false);
  });
});

describe('การลองใหม่แบบมีขอบเขต', () => {
  it('ล้มเพราะแย่งเลขแล้วสำเร็จในครั้งถัดไป', async () => {
    let calls = 0;
    const run = vi.fn(async () => {
      calls += 1;
      if (calls < 3) throw known('P2010', { code: '1020' });
      return 'ok';
    });
    expect(await withDocumentNumberRetry(run)).toBe('ok');
    expect(calls).toBe(3);
  });

  it('ข้อผิดพลาดทางธุรกิจต้องไม่ถูกลองซ้ำ', async () => {
    const run = vi.fn(async () => { throw new Error('ITEM_NOT_IN_COMPANY'); });
    await expect(withDocumentNumberRetry(run)).rejects.toThrow('ITEM_NOT_IN_COMPANY');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ลองครบจำนวนแล้วยังไม่ผ่าน ต้องโยน error เดิมออกไป ไม่กลบ', async () => {
    const run = vi.fn(async () => { throw known('P2034'); });
    await expect(withDocumentNumberRetry(run, 3)).rejects.toMatchObject({ code: 'P2034' });
    expect(run).toHaveBeenCalledTimes(3);
  });
});

describe('เลขออเดอร์ขาย', () => {
  const NOW = new Date('2026-08-23T04:00:00.000Z');

  it('รูปแบบเดิมไม่เปลี่ยน: SO-YYYY-00001', () => {
    expect(formatOrderNo(1, NOW)).toBe(`SO-${NOW.getFullYear()}-00001`);
    expect(formatOrderNo(42, NOW)).toBe(`SO-${NOW.getFullYear()}-00042`);
  });

  it('ครั้งแรกเดินต่อจากจำนวนออเดอร์เดิม แล้วเพิ่มทีละหนึ่ง', async () => {
    const counters: Record<string, { lastSeq: number }> = {};
    /* จำลองสัญญาของคำสั่งจริง: INSERT IGNORE สร้างแถวครั้งเดียวโดย seed จากจำนวนออเดอร์เดิม
       (ของจริง seed มาจาก SELECT COUNT(*) ภายในคำสั่งเดียวกัน) แล้ว UPDATE เพิ่มทีละหนึ่ง */
    const existingOrders: Record<string, number> = { c1: 7, c2: 0 };
    const tx = {
      $executeRaw: async (strings: TemplateStringsArray, ...v: unknown[]) => {
        const companyId = String(v[1]);
        const key = [companyId, v[2], v[3]].join('|');
        // INSERT IGNORE ... SELECT COUNT(*) FROM sales_orders — สร้างแถวครั้งแรกพร้อม seed
        if (strings.join(' ').includes('INSERT')) {
          if (!counters[key]) counters[key] = { lastSeq: existingOrders[companyId] ?? 0 };
          return 1;
        }
        counters[key] = { lastSeq: Number(v[0]) };
        return 1;
      },
      $queryRaw: async (_s: TemplateStringsArray, ...v: unknown[]) => {
        const key = [v[0], v[1], v[2]].join('|');
        return counters[key] ? [{ lastSeq: counters[key].lastSeq }] : [];
      },
    } as never;

    // มีออเดอร์เดิมอยู่แล้ว 7 ใบ → ใบถัดไปต้องเป็นใบที่ 8 เท่าเดิมกับสูตร count + 1
    expect(await nextOrderNo(tx, 'c1', NOW)).toBe(`SO-${NOW.getFullYear()}-00008`);
    expect(await nextOrderNo(tx, 'c1', NOW)).toBe(`SO-${NOW.getFullYear()}-00009`);
    // คนละบริษัทใช้ตัวนับคนละตัว
    expect(await nextOrderNo(tx, 'c2', NOW)).toBe(`SO-${NOW.getFullYear()}-00001`);
  });
});
