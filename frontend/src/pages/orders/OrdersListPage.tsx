import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, ClipboardCheck, FileDown, Plus, TrendingUp, Truck } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { orderApi, type Order } from '@/lib/order-api';
import { orderBadgeClass, orderStatusLabel } from '@/lib/order-vocab';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useAuth } from '@/auth/AuthContext';

/**
 * PHASE 8 — รายการคำสั่งซื้อ
 *
 * GET /business/orders คืน dataset เต็ม (ไม่แบ่งหน้า) พร้อม customer + items
 * KPI จึงนับจากทั้งชุดได้จริง ไม่ใช่นับจากหน้าที่เปิดอยู่
 */

const money = (v: number | string) => `฿${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dateText = (v: string) => (v ? new Date(v).toLocaleDateString('th-TH') : '—');

const openDocument = async (path: string) => {
  const blob = await apiClient.blob(path, 'pdf');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};

/** สถานะที่ถือว่า "กำลังดำเนินการ" — อยู่ระหว่างยืนยันแล้วกับยังไม่ส่งมอบ */
const IN_PROGRESS = ['CONFIRMED', 'SENT_TO_PREP', 'PICKING', 'ISSUED'];

export default function OrdersListPage() {
  const { user } = useAuth();
  const canCreate = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('ORDER_CREATE'));

  const [keyword, setKeyword] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const list = useQuery({ queryKey: ['orders'], queryFn: () => orderApi.orders() });
  const all = useMemo(() => list.data ?? [], [list.data]);

  // KPI จาก dataset เต็ม ไม่ใช่จากผลที่กรองแล้ว
  const kpi = useMemo(() => ({
    total: all.length,
    draft: all.filter((o) => o.status === 'DRAFT').length,
    progress: all.filter((o) => IN_PROGRESS.includes(o.status)).length,
    ready: all.filter((o) => o.status === 'READY').length,
    delivered: all.filter((o) => o.status === 'DELIVERED').length,
  }), [all]);

  const rows = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return all.filter((o) => {
      if (status && o.status !== status) return false;
      const day = o.deliveryDate.slice(0, 10);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (!q) return true;
      return `${o.orderNo} ${o.customer?.name ?? ''} ${o.customer?.code ?? ''}`.toLowerCase().includes(q);
    });
  }, [all, keyword, status, from, to]);

  const hasFilter = Boolean(keyword || status || from || to);
  const clear = () => { setKeyword(''); setStatus(''); setFrom(''); setTo(''); };

  return (
    <PageContainer size="wide" className="order-page orders-list-page">
      <PageHeader
        breadcrumb="ออเดอร์และปฏิบัติการ"
        title="คำสั่งซื้อ"
        description="ออเดอร์ทั้งหมดพร้อมกำหนดส่ง ยอดเงิน และสถานะการทำงาน"
        actions={canCreate
          ? <Link to="/orders/new" className="btn primary"><Plus aria-hidden width={16} />สร้างออเดอร์</Link>
          : undefined}
      />

      {list.isError && <div className="rb-callout warn" role="alert">
        <AlertTriangle aria-hidden />
        <div><strong>{list.error instanceof Error ? list.error.message : 'โหลดออเดอร์ไม่สำเร็จ'}</strong></div>
        <button type="button" className="btn" onClick={() => void list.refetch()}>ลองใหม่</button>
      </div>}

      <KPIGrid columns={5}>
        <KPICard label="ออเดอร์ทั้งหมด" value={list.isLoading ? '—' : kpi.total} icon={<ClipboardCheck />}
          hint="ทุกสถานะ" onClick={() => setStatus('')} active={!status} />
        <KPICard label="ร่าง" value={list.isLoading ? '—' : kpi.draft} icon={<CalendarDays />}
          hint="ยังไม่ยืนยัน" onClick={() => setStatus('DRAFT')} active={status === 'DRAFT'} />
        <KPICard label="กำลังดำเนินการ" value={list.isLoading ? '—' : kpi.progress} icon={<Truck />}
          hint="ยืนยันแล้วถึงจ่ายของ" />
        <KPICard label="พร้อมส่ง" value={list.isLoading ? '—' : kpi.ready} icon={<ClipboardCheck />}
          hint="รอส่งมอบ" onClick={() => setStatus('READY')} active={status === 'READY'} />
        <KPICard label="ส่งมอบแล้ว" value={list.isLoading ? '—' : kpi.delivered} icon={<TrendingUp />}
          hint="ปิดงานแล้ว" onClick={() => setStatus('DELIVERED')} active={status === 'DELIVERED'} />
      </KPIGrid>

      <FilterBar actions={hasFilter ? <button type="button" className="btn" onClick={clear}>ล้างตัวกรอง</button> : undefined}>
        <input className="s2-search" value={keyword} onChange={(e) => setKeyword(e.target.value)}
          placeholder="ค้นหาเลขออเดอร์หรือชื่อลูกค้า" aria-label="ค้นหาออเดอร์" />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          {['DRAFT', 'CONFIRMED', 'SENT_TO_PREP', 'PICKING', 'ISSUED', 'READY', 'DELIVERED', 'CANCELLED'].map((s) => (
            <option key={s} value={s}>{orderStatusLabel(s)}</option>
          ))}
        </select>
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="ส่งตั้งแต่วันที่" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="ถึงวันที่" />
      </FilterBar>

      <ContentCard padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table ops-table">
            <thead>
              <tr>
                <th>เลขออเดอร์</th><th>วันที่ส่ง</th><th>ลูกค้า</th>
                <th className="num">รายการ</th><th className="num">ยอดสุทธิ</th>
                <th>สถานะ</th><th>จัดการ</th>
              </tr>
            </thead>
            {list.isLoading ? <SkeletonRows rows={8} cols={7} /> : (
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td data-label="เลขออเดอร์">
                      <Link className="ops-doc-link" to={`/orders/${o.id}`}>{o.orderNo}</Link>
                    </td>
                    <td data-label="วันที่ส่ง">{dateText(o.deliveryDate)}{o.deliveryTime ? ` ${o.deliveryTime}` : ''}</td>
                    <td data-label="ลูกค้า">
                      <Link className="inline-link" to={`/customers/${o.customerId}`}>{o.customer?.name ?? '—'}</Link>
                    </td>
                    <td className="num" data-label="รายการ">{o.items?.length ?? 0}</td>
                    <td className="num" data-label="ยอดสุทธิ"><b>{money(o.totalAmount)}</b></td>
                    <td data-label="สถานะ">
                      <span className={`badge ${orderBadgeClass(o.status)}`}>{orderStatusLabel(o.status)}</span>
                    </td>
                    <td data-label="จัดการ">
                      <span className="md-row-actions">
                        <Link className="btn" to={`/orders/${o.id}`}>ดูรายละเอียด</Link>
                        <button type="button" className="icon-btn" aria-label={`ดาวน์โหลดใบสั่งซื้อ ${o.orderNo}`}
                          title="ใบสั่งซื้อ PDF"
                          onClick={() => void openDocument(`/business/documents/ORDER_SLIP/${o.id}.pdf`)}>
                          <FileDown aria-hidden width={16} />
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {!list.isLoading && !list.isError && rows.length === 0 && (
          hasFilter
            ? <EmptyState icon={ClipboardCheck} title="ไม่พบออเดอร์ที่ตรงกับตัวกรอง" description="ลองเปลี่ยนคำค้น ช่วงวันที่ หรือล้างตัวกรอง"
                action={<button type="button" className="btn" onClick={clear}>ล้างตัวกรอง</button>} />
            : <EmptyState icon={ClipboardCheck} title="ยังไม่มีออเดอร์" description="สร้างออเดอร์แรกเพื่อเริ่มวางแผนการผลิตและจัดส่ง"
                action={canCreate ? <Link to="/orders/new" className="btn primary"><Plus aria-hidden />สร้างออเดอร์</Link> : undefined} />
        )}
      </ContentCard>

      {!list.isLoading && rows.length > 0 && (
        <p className="md-note"><ClipboardCheck aria-hidden />แสดง {rows.length} จาก {all.length} ออเดอร์</p>
      )}
    </PageContainer>
  );
}

export type { Order };
