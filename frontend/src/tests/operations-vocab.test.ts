import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STATUS_BADGE, movementInfo, refTypeLink, statusInfo, statusLabel, REF_TYPE_TH,
} from '@/lib/operations-vocab';

/** PHASE 6 — คำศัพท์กลางของ Operations และโครงหน้าที่ย้ายมาใช้ design system */

describe('status vocabulary', () => {
  it('1 ใบรับของ: DRAFT / CONFIRMED / REVERSED เป็นภาษาไทยตามที่ spec กำหนด', () => {
    expect(statusLabel('receiving', 'DRAFT')).toBe('ร่าง');
    expect(statusLabel('receiving', 'CONFIRMED')).toBe('รับเข้าสต็อกแล้ว');
    expect(statusLabel('receiving', 'REVERSED')).toBe('กลับรายการแล้ว');
  });

  it('2 ใบเบิก: ISSUED และ CONFIRMED สื่อความหมายเดียวกันคือตัดสต็อกแล้ว', () => {
    expect(statusLabel('issue', 'DRAFT')).toBe('ร่าง');
    expect(statusLabel('issue', 'ISSUED')).toBe('ตัดสต็อกแล้ว');
    expect(statusLabel('issue', 'CONFIRMED')).toBe('ตัดสต็อกแล้ว');
    expect(statusLabel('issue', 'REVERSED')).toBe('กลับรายการแล้ว');
  });

  it('3 ใบปรับปรุงสต็อก', () => {
    expect(statusLabel('adjustment', 'CONFIRMED')).toBe('ปรับสต็อกแล้ว');
    expect(statusLabel('adjustment', 'REVERSED')).toBe('กลับรายการแล้ว');
  });

  it('4 สถานะชื่อเดียวกันแต่คนละชนิดเอกสาร ต้องแปลต่างกัน', () => {
    // นี่คือเหตุผลที่แยกตารางตามชนิดเอกสาร ไม่ยุบเป็นตารางเดียว
    expect(statusLabel('receiving', 'CONFIRMED')).not.toBe(statusLabel('order', 'CONFIRMED'));
    expect(statusLabel('issue', 'ISSUED')).not.toBe(statusLabel('order', 'ISSUED'));
  });

  it('5 ออเดอร์ครบทุกค่าใน enum SalesOrderStatus จริง', () => {
    const enumValues = ['DRAFT', 'CONFIRMED', 'SENT_TO_PREP', 'PICKING', 'ISSUED', 'READY', 'DELIVERED', 'CANCELLED'];
    for (const v of enumValues) {
      const label = statusLabel('order', v);
      expect(label).not.toBe(v);          // ต้องถูกแปล ไม่ใช่คืน enum ดิบ
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it('6 สถานะที่ไม่รู้จัก คืนค่าดิบ ไม่เดาความหมาย', () => {
    expect(statusLabel('receiving', 'SOMETHING_NEW')).toBe('SOMETHING_NEW');
    expect(statusLabel('receiving', null)).toBe('—');
  });

  it('7 ทุก tone มีคลาส badge ของ design system รองรับ', () => {
    for (const kind of ['receiving', 'issue', 'adjustment', 'order'] as const) {
      for (const st of ['DRAFT', 'CONFIRMED', 'ISSUED', 'REVERSED', 'CANCELLED', 'DELIVERED']) {
        expect(STATUS_BADGE[statusInfo(kind, st).tone]).toBeTruthy();
      }
    }
  });
});

describe('movement vocabulary', () => {
  it('8 แปลประเภทการเคลื่อนไหวพร้อมทิศทาง', () => {
    expect(movementInfo('PURCHASE_RECEIPT')).toEqual({ label: 'รับเข้า', tone: 'in' });
    expect(movementInfo('PRODUCTION_ISSUE')).toEqual({ label: 'เบิกออก', tone: 'out' });
    expect(movementInfo('ADJUSTMENT_IN')).toEqual({ label: 'ปรับเพิ่ม', tone: 'in' });
    expect(movementInfo('ADJUSTMENT_OUT')).toEqual({ label: 'ปรับลด', tone: 'out' });
  });

  it('9 REVERSAL มาก่อนชนิดเดิมเสมอ', () => {
    expect(movementInfo('PURCHASE_RECEIPT', 'REVERSAL').label).toBe('กลับรายการ');
    expect(movementInfo('PRODUCTION_ISSUE', 'REVERSAL').tone).toBe('reversal');
  });

  it('10 ประเภทที่ไม่รู้จักคืนค่าดิบ', () => {
    expect(movementInfo('WEIRD_TYPE').label).toBe('WEIRD_TYPE');
  });
});

describe('document navigation', () => {
  it('11 อ้างอิงกลับเอกสารต้นทางได้ทั้งสามชนิด', () => {
    expect(refTypeLink('GOODS_RECEIPT')).toBe('/receiving');
    expect(refTypeLink('STOCK_ISSUE')).toBe('/stock-issues');
    expect(refTypeLink('STOCK_ADJUSTMENT')).toBe('/inventory/adjustments');
  });

  it('12 ชนิดที่ไม่รู้จักคืน null ไม่สร้างลิงก์เสีย', () => {
    expect(refTypeLink('UNKNOWN')).toBeNull();
    expect(refTypeLink(null)).toBeNull();
  });

  it('13 มีชื่อไทยของชนิดเอกสารครบ', () => {
    expect(REF_TYPE_TH.GOODS_RECEIPT).toBe('ใบรับของ');
    expect(REF_TYPE_TH.STOCK_ISSUE).toBe('ใบเบิก');
    expect(REF_TYPE_TH.STOCK_ADJUSTMENT).toBe('ใบปรับปรุงสต็อก');
  });
});

/* ---------- โครงหน้า ---------- */
const SRC = path.resolve(__dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(SRC, p), 'utf8');
const ops = read('pages/OperationsPages.tsx');
const inv = read('pages/InventoryPages.tsx');
const detail = read('pages/OperationDetailPages.tsx');
const css = read('styles/operations.css');
const dash = read('pages/DashboardPage.tsx');

describe('operations pages structure', () => {
  it('14 หน้ารายการใช้ primitive จาก Phase 2+3 ไม่ใช่ hero/ตารางเฉพาะกิจ', () => {
    expect(ops).toContain('<PageContainer size="wide"');
    expect(ops).toContain('<PageHeader');
    expect(ops).toContain('<FilterBar');
    expect(ops).toContain('<ContentCard');
    expect(ops).toContain('<KPIGrid');
  });

  it('15 เลิกใช้ WorkspaceHero / Kpis / ตาราง ops-history ในหน้ารายการแล้ว', () => {
    expect(ops).not.toContain('<Kpis ');
    expect(ops).not.toContain('ops-history-table');
    expect(ops).not.toContain('<WorkspaceHero eyebrow="INBOUND OPERATIONS"');
    expect(ops).not.toContain('<WorkspaceHero eyebrow="OUTBOUND OPERATIONS"');
  });

  it('16 ไม่มี mapping สถานะแบบ inline ในหน้ารายการอีก', () => {
    expect(ops).not.toContain("status==='DRAFT'?'ร่าง'");
    expect(ops).toContain("statusInfo('receiving'");
    expect(ops).toContain("statusInfo('issue'");
  });

  it('17 คลังสินค้าใช้ KPICard ที่กดกรองได้ (คงพฤติกรรมเดิม)', () => {
    expect(inv).toContain('<KPIGrid columns={5}>');
    expect(inv).toContain("onClick={() => setStatus('LOW')}");
    expect(inv).toContain("active={status === 'LOW'}");
    expect(inv).toContain('<FilterBar');
    expect(inv).toContain('ล้างตัวกรอง');
  });

  it('18 คลังสินค้าเลิกใช้ตารางสถานะ/ประเภทของตัวเอง หันไปใช้ vocab กลาง', () => {
    expect(inv).not.toContain('const MOVEMENT_TH');
    expect(inv).toContain('movementInfo(');
    expect(inv).toContain("statusInfo('adjustment'");
  });

  it('19 ตารางเอกสารมี data-label ครบเพื่อกลายเป็นการ์ดบนมือถือ', () => {
    expect(ops.match(/data-label=/g)?.length).toBeGreaterThanOrEqual(10);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?content: attr\(data-label\)/);
  });

  it('20 มีลิงก์เข้าเอกสารจากแถวในตาราง', () => {
    expect(ops).toContain('/receiving/${receipt.id}');
    expect(ops).toContain('/stock-issues/${issue.id}');
    expect(ops).toContain('ops-doc-link');
  });
});

describe('confirm / reverse UX', () => {
  it('21 เลิกใช้ window.confirm ในหน้ารายละเอียดเอกสารแล้ว', () => {
    // ตรวจการเรียกใช้จริง (คอมเมนต์ที่อ้างถึงของเดิมไม่นับ)
    expect(detail).not.toContain('window.confirm(');
  });

  it('22 ใช้ ConfirmDialog ที่บอกเอกสาร คลัง จำนวนรายการ และผลกระทบต่อสต็อก', () => {
    expect(detail.match(/<ConfirmDialog/g)?.length).toBe(4);   // ยืนยัน + กลับรายการ ของทั้งสองเอกสาร
    expect(detail).toContain('op-confirm-impact');
    expect(detail).toContain('เพิ่มสต็อกจริง');
    expect(detail).toContain('ตัดสต็อกจริง');
    expect(detail).toContain('ไม่ลบประวัติเดิม');
  });

  it('23 การกลับรายการใช้ปุ่มโทน danger', () => {
    expect(detail).toContain('tone="danger"');
  });

  it('24 แถบสถานะในหน้ารายละเอียดต้องระบุชนิดเอกสาร', () => {
    expect(detail).not.toContain('const STATUS_TH');
    expect(detail).toContain('<StatusBadge kind="receiving"');
    expect(detail).toContain('<StatusBadge kind="issue"');
  });
});

describe('operations css', () => {
  it('25 ใช้ token ไม่ hardcode สีธีม', () => {
    expect(css).toContain('var(--space-');
    expect(css).toContain('var(--control-h)');
    expect(css).not.toMatch(/background:\s*#fff(f{3})?\b/i);
    expect(css).not.toMatch(/color:\s*#[0-9a-f]{6}/i);
  });

  it('26 breakpoint ตรงมาตรฐานระบบ', () => {
    const bps = [...css.matchAll(/@media \(max-width: (\d+)px\)/g)].map((m) => Number(m[1]));
    expect(bps.every((b) => [1024, 760, 430].includes(b))).toBe(true);
  });

  it('27 ประเภทการเคลื่อนไหวมีทั้งไอคอนและข้อความ', () => {
    expect(inv).toContain('mv-type');
    expect(inv).toContain('ArrowDownToLine');
    expect(inv).toContain('ArrowUpFromLine');
    expect(css).toContain('.mv-in');
    expect(css).toContain('.mv-out');
  });
});

describe('dashboard carryover (Phase 5)', () => {
  it('28 A: KPI บอกชัดว่านับจาก ledger', () => {
    expect(dash).toContain('รายการเคลื่อนไหวสต็อกวันนี้');
    expect(dash).toContain('นับจากบัญชีเดินสต็อก (ledger)');
  });

  it('29 B: การ์ดเอกสารใช้คำต่างจาก KPI เพื่อไม่ให้เข้าใจว่าเลขต้องเท่ากัน', () => {
    expect(dash).toContain('เอกสารปฏิบัติการวันนี้');
    expect(dash).toContain('ไม่ใช่จำนวนรายการเดินสต็อก');
    expect(dash).not.toContain('title="การเคลื่อนไหววันนี้"');
  });

  it('30 C: สถานะออเดอร์แปลไทยจาก enum จริง ไม่ใช่ค่าดิบ', () => {
    expect(dash).toContain("statusLabel('order', o.status)");
    expect(dash).not.toContain('<span className="badge muted">{o.status}</span>');
  });
});
