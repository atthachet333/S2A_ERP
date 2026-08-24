import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addTransferLine, buildTransferPayload, destAfter, searchTransferable, sourceAfter,
  summarizeTransfer, transferableItems, transferImpact, validateTransferLine, warehouseIssue,
  type TransferLine, type TransferMovement,
} from '@/lib/stock-transfer';
import { movementInfo, refTypeLink, statusInfo, statusLabel, REF_TYPE_TH } from '@/lib/operations-vocab';
import type { StockItem } from '@/lib/issue-stock';

/**
 * PHASE 18 — ตรรกะหน้าโอนย้ายระหว่างคลัง
 * ทุกเทสต์ยึดหลักเดียว: ใบเดียวสองฝั่ง ต้นทางลดเท่าไร ปลายทางเพิ่มเท่านั้นพอดี
 */

const A = 'wh-a';
const B = 'wh-b';

const item = (id: string, code: string, name: string, balances: { warehouseId: string; onHand: number; reserved: number }[]): StockItem => ({
  id, code, name, type: 'RAW_MATERIAL', baseUnit: { code: 'KG', name: 'กิโลกรัม' }, stockBalances: balances,
});

const ITEMS: StockItem[] = [
  item('i1', 'RM-001', 'น้ำมันพืช', [{ warehouseId: A, onHand: 100, reserved: 0 }, { warehouseId: B, onHand: 20, reserved: 0 }]),
  item('i2', 'RM-002', 'แป้งสาลี', [{ warehouseId: A, onHand: 50, reserved: 5 }]),
  item('i3', 'RM-003', 'ของหมดในคลัง A', [{ warehouseId: A, onHand: 0, reserved: 0 }, { warehouseId: B, onHand: 80, reserved: 0 }]),
];

describe('สินค้าที่โอนย้ายได้', () => {
  it('แสดงเฉพาะสินค้าที่มีของพร้อมใช้ในคลังต้นทาง', () => {
    const list = transferableItems(ITEMS, A, B);
    expect(list.map((x) => x.id).sort()).toEqual(['i1', 'i2']);   // i3 ไม่มีของที่ A
  });

  it('พร้อมใช้ของต้นทางหักของที่จองไว้ และแสดงยอดปลายทางคู่กัน', () => {
    const list = transferableItems(ITEMS, A, B);
    const oil = list.find((x) => x.id === 'i1')!;
    expect(oil.sourceOnHand).toBe(100);
    expect(oil.sourceAvailable).toBe(100);
    expect(oil.destOnHand).toBe(20);

    const flour = list.find((x) => x.id === 'i2')!;
    expect(flour.sourceAvailable).toBe(45);   // 50 − 5 ที่จองไว้
    expect(flour.destOnHand).toBe(0);         // ปลายทางยังไม่เคยมีสินค้านี้
  });

  it('ยังไม่เลือกคลัง หรือเลือกคลังเดียวกัน ต้องไม่แสดงรายการใด', () => {
    expect(transferableItems(ITEMS, '', B)).toHaveLength(0);
    expect(transferableItems(ITEMS, A, A)).toHaveLength(0);
  });

  it('ค้นหาจากรหัสหรือชื่อได้', () => {
    const list = transferableItems(ITEMS, A, B);
    expect(searchTransferable(list, 'RM-002').map((x) => x.id)).toEqual(['i2']);
    expect(searchTransferable(list, 'น้ำมัน').map((x) => x.id)).toEqual(['i1']);
    expect(searchTransferable(list, '')).toHaveLength(2);
  });
});

describe('หัวเอกสาร', () => {
  it('ต้องเลือกครบทั้งสองคลัง และต้องไม่ใช่คลังเดียวกัน', () => {
    expect(warehouseIssue('', B)).toBe('MISSING');
    expect(warehouseIssue(A, '')).toBe('MISSING');
    expect(warehouseIssue(A, A)).toBe('SAME');
    expect(warehouseIssue(A, B)).toBe('NONE');
  });
});

describe('รายการในใบโอนย้าย', () => {
  const list = transferableItems(ITEMS, A, B);
  const oil = list.find((x) => x.id === 'i1')!;

  it('เพิ่มรายการใหม่ได้ และเริ่มที่จำนวน 0', () => {
    const result = addTransferLine([], oil, () => 'k1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ key: 'k1', itemId: 'i1', code: 'RM-001', unit: 'KG', quantity: 0 });
  });

  it('เพิ่มสินค้าซ้ำไม่ได้ และชี้กลับไปที่บรรทัดเดิม', () => {
    const first = addTransferLine([], oil, () => 'k1');
    if (!first.ok) throw new Error('setup');
    const second = addTransferLine(first.lines, oil, () => 'k2');
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toBe('DUPLICATE');
    expect(second.existingKey).toBe('k1');
  });
});

describe('สมการสองฝั่ง', () => {
  it('ต้นทางลดเท่าไร ปลายทางเพิ่มเท่านั้นพอดี', () => {
    // 100 − 5 = 95 ที่ต้นทาง และ 20 + 5 = 25 ที่ปลายทาง
    expect(sourceAfter(100, 5)).toBe(95);
    expect(destAfter(20, 5)).toBe(25);
    // ผลรวมสองฝั่งต้องไม่เปลี่ยน
    expect(sourceAfter(100, 5) + destAfter(20, 5)).toBe(100 + 20);
  });

  it('โอนเกินของที่พร้อมใช้ ต้องเห็นยอดต้นทางติดลบเพื่อเตือน', () => {
    expect(sourceAfter(10, 25)).toBe(-15);
    expect(validateTransferLine(25, 10)).toBe('OVER_AVAILABLE');
  });

  it('ยังไม่ใส่จำนวนถือว่ายังไม่พร้อม', () => {
    expect(validateTransferLine(0, 10)).toBe('EMPTY');
    expect(validateTransferLine(-1, 10)).toBe('EMPTY');
    expect(validateTransferLine(10, 10)).toBe('NONE');
  });
});

describe('สรุปใบโอนย้าย', () => {
  const availableOf = (itemId: string) => (itemId === 'i1' ? 100 : 45);
  const line = (itemId: string, quantity: number): TransferLine =>
    ({ key: itemId, itemId, code: itemId, name: itemId, unit: 'KG', quantity });

  it('ส่งได้เมื่อทุกบรรทัดมีจำนวนและไม่มีบรรทัดใดเกิน', () => {
    const s = summarizeTransfer([line('i1', 10), line('i2', 5)], availableOf);
    expect(s).toMatchObject({ lineCount: 2, totalQty: 15, emptyQtyCount: 0, insufficientCount: 0, canSubmit: true });
  });

  it('ยังไม่ใส่จำนวนแม้บรรทัดเดียวก็ส่งไม่ได้', () => {
    const s = summarizeTransfer([line('i1', 10), line('i2', 0)], availableOf);
    expect(s.emptyQtyCount).toBe(1);
    expect(s.canSubmit).toBe(false);
  });

  it('มีบรรทัดที่เกินของพร้อมใช้ก็ส่งไม่ได้', () => {
    const s = summarizeTransfer([line('i2', 999)], availableOf);
    expect(s.insufficientCount).toBe(1);
    expect(s.canSubmit).toBe(false);
  });

  it('ไม่มีรายการเลยก็ส่งไม่ได้', () => {
    expect(summarizeTransfer([], availableOf).canSubmit).toBe(false);
  });
});

describe('payload ที่ส่งให้ backend', () => {
  it('ส่งเฉพาะฟิลด์ตามสัญญาของ API และไม่ส่งหมายเหตุว่าง', () => {
    const payload = buildTransferPayload({
      fromWarehouseId: A, toWarehouseId: B, confirm: true,
      lines: [{ key: 'k1', itemId: 'i1', code: 'RM-001', name: 'น้ำมันพืช', unit: 'KG', quantity: 5 }],
    });
    expect(payload).toEqual({ fromWarehouseId: A, toWarehouseId: B, confirm: true, items: [{ itemId: 'i1', quantity: 5 }] });
    expect('note' in payload).toBe(false);
  });

  it('มีหมายเหตุก็ส่งไปด้วย', () => {
    const payload = buildTransferPayload({ fromWarehouseId: A, toWarehouseId: B, note: 'ย้ายด่วน', confirm: false, lines: [] });
    expect(payload.note).toBe('ย้ายด่วน');
    expect(payload.confirm).toBe(false);
  });
});

describe('ผลกระทบย้อนหลังต้องมาจากบัญชีเดินสต็อกเท่านั้น', () => {
  const movements: TransferMovement[] = [
    { itemCode: 'RM-001', warehouseCode: 'WH-A', movementType: 'TRANSFER_OUT', reason: null, beforeQty: 100, qtyIn: 0, qtyOut: 5, balanceAfter: 95 },
    { itemCode: 'RM-001', warehouseCode: 'WH-B', movementType: 'TRANSFER_IN', reason: null, beforeQty: 20, qtyIn: 5, qtyOut: 0, balanceAfter: 25 },
    { itemCode: 'RM-001', warehouseCode: 'WH-A', movementType: 'TRANSFER_IN', reason: 'REVERSAL', beforeQty: 95, qtyIn: 5, qtyOut: 0, balanceAfter: 100 },
  ];

  it('อ่านฝั่งต้นทางและปลายทางแยกกันตามคลัง', () => {
    expect(transferImpact(movements, 'RM-001', 'WH-A')).toEqual({ before: 100, change: -5, after: 95 });
    expect(transferImpact(movements, 'RM-001', 'WH-B')).toEqual({ before: 20, change: 5, after: 25 });
  });

  it('ข้ามแถวกลับรายการ เพื่อไม่ให้ทับผลของเอกสารต้นฉบับ', () => {
    const impact = transferImpact(movements, 'RM-001', 'WH-A');
    expect(impact?.after).toBe(95);   // ไม่ใช่ 100 ของแถว REVERSAL
  });

  it('ไม่มีข้อมูลก็คืน null ไม่เดาจากสต็อกปัจจุบัน', () => {
    expect(transferImpact(movements, 'RM-999', 'WH-A')).toBeNull();
    expect(transferImpact([], 'RM-001', 'WH-A')).toBeNull();
  });
});

describe('คำศัพท์ของงานโอนย้าย', () => {
  it('สถานะของใบโอนย้ายสื่อความหมายเฉพาะของเอกสารชนิดนี้', () => {
    expect(statusLabel('transfer', 'DRAFT')).toBe('ร่าง');
    expect(statusLabel('transfer', 'CONFIRMED')).toBe('โอนย้ายแล้ว');
    expect(statusLabel('transfer', 'REVERSED')).toBe('กลับรายการแล้ว');
    expect(statusInfo('transfer', 'CONFIRMED').tone).toBe('done');
    // ต้องไม่ยืมคำของใบรับของ ซึ่งหมายถึงรับเข้าสต็อก
    expect(statusLabel('transfer', 'CONFIRMED')).not.toBe(statusLabel('receiving', 'CONFIRMED'));
  });

  it('สถานะที่ไม่รู้จักคืนค่าดิบ ไม่เดาความหมาย', () => {
    expect(statusLabel('transfer', 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(statusLabel('transfer', null)).toBe('—');
  });

  it('สองขาของการโอนย้ายแยกกันชัดเจน และการกลับรายการมาก่อนเสมอ', () => {
    expect(movementInfo('TRANSFER_OUT')).toEqual({ label: 'โอนออก', tone: 'out' });
    expect(movementInfo('TRANSFER_IN')).toEqual({ label: 'โอนเข้า', tone: 'in' });
    expect(movementInfo('TRANSFER_OUT', 'REVERSAL').label).toBe('กลับรายการ');
  });

  it('ลิงก์กลับไปเอกสารต้นทางถูกต้อง', () => {
    expect(refTypeLink('STOCK_TRANSFER')).toBe('/stock-transfers');
    expect(REF_TYPE_TH.STOCK_TRANSFER).toBe('ใบโอนย้ายระหว่างคลัง');
  });
});

/* ---------- โครงหน้าจอและสิทธิ์ ---------- */

const read = (rel: string) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('หน้าโอนย้าย: โครงและสิทธิ์', () => {
  const page = stripComments(read('../pages/StockTransferPages.tsx'));

  it('ใช้โครงหน้าเดียวกับงาน Operations อื่น', () => {
    for (const piece of ['PageContainer', 'PageHeader', 'ContentCard', 'StickySummary', 'ConfirmDialog', 'EmptyState']) {
      expect(page, piece).toContain(piece);
    }
  });

  it('ปุ่มสร้าง/ยืนยัน/กลับรายการ ถูกกั้นด้วยสิทธิ์ที่ backend ตรวจจริง', () => {
    expect(page).toContain("has('STOCK_TRANSFER_CREATE')");
    expect(page).toContain("has('STOCK_TRANSFER_CONFIRM')");
    expect(page).toContain("has('STOCK_TRANSFER_REVERSE')");
    expect(page).toContain("user?.roles.includes('SUPER_ADMIN')");
  });

  it('ปุ่มยืนยันและกลับรายการต้องผ่าน ConfirmDialog ไม่ยิงทันที', () => {
    expect(page).toMatch(/setPending\('confirm'\)/);
    expect(page).toMatch(/setPending\('reverse'\)/);
    expect(page).toMatch(/setConfirmOpen\(true\)/);
  });

  it('แถวสินค้าแสดงสมการทั้งสองฝั่งเสมอ', () => {
    expect(page).toContain('sourceAfter(');
    expect(page).toContain('destAfter(');
    expect(page).toMatch(/data-label="ต้นทาง"/);
    expect(page).toMatch(/data-label="ปลายทาง"/);
  });

  it('ยอดก่อน/หลังของเอกสารที่ยืนยันแล้วอ่านจาก ledger ไม่ใช่สต็อกปัจจุบัน', () => {
    expect(page).toContain('transferImpact(movements');
    expect(page).toContain('/business/stock-movements?refId=');
    // ต้องไม่มีการเอา lookups มาคำนวณย้อนหลังในหน้ารายละเอียด
    expect(page).not.toMatch(/StockTransferDetailPage[\s\S]*transferableItems\(/);
  });

  it('เปิด PDF ผ่าน blob ไม่ใช่ลิงก์ตรง', () => {
    expect(page).toContain("apiClient.blob(path, 'pdf')");
    expect(page).toContain('STOCK_TRANSFER_SLIP');
  });
});

describe('เส้นทางและเมนู', () => {
  const app = stripComments(read('../App.tsx'));
  const nav = stripComments(read('../components/layout/nav-config.ts'));

  it('มีเส้นทางครบทั้งรายการ สร้าง แก้ไข และรายละเอียด', () => {
    for (const route of ['/stock-transfers', '/stock-transfers/new', '/stock-transfers/:id/edit', '/stock-transfers/:id']) {
      expect(app, route).toContain(`path="${route}"`);
    }
  });

  it('เมนูถูกกั้นด้วยสิทธิ์ดูของงานโอนย้าย', () => {
    expect(nav).toContain("path: '/stock-transfers'");
    expect(nav).toMatch(/requiredAnyPermission: \['STOCK_TRANSFER_VIEW', 'STOCK_VIEW'\]/);
  });
});
