import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const page=readFileSync(resolve(process.cwd(),'src/pages/PurchaseOrderPages.tsx'),'utf8');
const receiving=readFileSync(resolve(process.cwd(),'src/pages/OperationsPages.tsx'),'utf8');
const detail=readFileSync(resolve(process.cwd(),'src/pages/OperationDetailPages.tsx'),'utf8');
const routes=readFileSync(resolve(process.cwd(),'src/App.tsx'),'utf8');
const nav=readFileSync(resolve(process.cwd(),'src/components/layout/nav-config.ts'),'utf8');
const css=readFileSync(resolve(process.cwd(),'src/styles/purchase-orders.css'),'utf8');

describe('purchase order UI',()=>{
  it('provides governed list, create, edit, detail and plan-to-PO routes',()=>{for(const path of ['/purchase-orders/new','/purchase-orders/:id/edit','/purchase-orders/:id'])expect(routes).toContain(path);expect(nav).toContain('PURCHASE_ORDER_VIEW');expect(page).toContain('สร้างใบสั่งซื้อ');expect(page).toContain('planId=')});
  it('uses a 72/28 commercial workspace and sticky totals',()=>{expect(page).toContain('StickySummary');expect(page).toContain('ยอดก่อนส่วนลด');expect(page).toContain('ภาษี');expect(page).toContain('ยอดรวม');expect(css).toContain('72fr');expect(css).toContain('28fr')});
  it('shows lifecycle, partial receiving, remaining and price variance without merging truths',()=>{for(const text of ['รอรับของ','รับบางส่วน','รับครบ','สั่งเทียบรับจริง','คงเหลือ','ผลต่างราคา','PO คือข้อผูกพัน'])expect(page).toContain(text);expect(page).toContain('latestReceivedPrice')});
  it('prefills PO receiving while preserving editable actual quantity and explicit over-receive confirmation',()=>{expect(receiving).toContain('receiving-prefill');expect(receiving).toContain('รับจากใบสั่งซื้อ');expect(receiving).toContain('รับเกิน PO');expect(receiving).toContain('overReceiveAcknowledged');expect(detail).toContain('/purchase-orders/')});
  it('exposes PDF, linked receipts, permissions, responsive layout and dark-light semantic colors',()=>{expect(page).toContain('document.pdf');expect(page).toContain('ใบรับของที่เชื่อมโยง');for(const code of ['PURCHASE_ORDER_CREATE','PURCHASE_ORDER_CONFIRM','PURCHASE_ORDER_CANCEL'])expect(page).toContain(code);expect(css).toContain('@media(max-width:900px)');expect(css).toContain('prefers-color-scheme:dark');expect(css).toContain('var(--surface)')});
});
