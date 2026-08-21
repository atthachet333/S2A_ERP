import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Archive, ArrowLeft, ClipboardCheck, Info, Mail, Pencil, Phone, Plus, TrendingUp, UsersRound,
} from 'lucide-react';
import { orderApi, orderErrorMessage, searchCustomers, type CustomerPatch, type OrderCustomer } from '@/lib/order-api';
import { orderBadgeClass, orderStatusLabel, priceTierLabel } from '@/lib/order-vocab';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard, CardSkeleton } from '@/components/layout/page';
import { SkeletonRows } from '@/components/ui/Skeleton';
import EmptyState from '@/components/ui/EmptyState';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import CustomerQuickCreateModal from '@/components/customers/CustomerQuickCreateModal';
import MasterModal from '@/components/ui/MasterModal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';

/**
 * PHASE 8 — ลูกค้า
 *
 * GET /business/customers เติม orderCount / upcomingOrders / deliveredSales / lastOrder มาให้แล้ว
 * จึงใช้เป็น KPI และคอลัมน์ได้จริง ไม่ต้องประดิษฐ์ lifetime value ขึ้นเอง
 *
 * PHASE 8B — เพิ่ม GET /customers/:id (โปรไฟล์) และ PATCH /customers/:id (แก้ไข)
 * โปรไฟล์จึงไม่ต้องโหลดลูกค้าและออเดอร์ทั้งบริษัทมาค้นหาอีกต่อไป
 */

const money = (v: number | string) => `฿${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const d = (v?: string | null) => (v ? new Date(v).toLocaleDateString('th-TH') : '—');

export default function CustomersPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  const canCreate = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('CUSTOMER_CREATE'));
  const canEdit = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('CUSTOMER_EDIT'));
  const canCreateOrder = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('ORDER_CREATE'));

  const [keyword, setKeyword] = useState('');
  const [onlyWithOrders, setOnlyWithOrders] = useState(false);
  const [modal, setModal] = useState(false);
  const [archiving, setArchiving] = useState<OrderCustomer | null>(null);

  const list = useQuery({ queryKey: ['customers'], queryFn: () => orderApi.customers() });
  const all = useMemo(() => list.data ?? [], [list.data]);

  const kpi = useMemo(() => ({
    total: all.length,
    withOrders: all.filter((c) => (c.orderCount ?? 0) > 0).length,
    upcoming: all.reduce((s, c) => s + (c.upcomingOrders ?? 0), 0),
    sales: all.reduce((s, c) => s + Number(c.deliveredSales ?? 0), 0),
  }), [all]);

  const rows = useMemo(() => {
    const base = onlyWithOrders ? all.filter((c) => (c.orderCount ?? 0) > 0) : all;
    return searchCustomers(base, keyword);
  }, [all, keyword, onlyWithOrders]);

  const archive = useMutation({
    mutationFn: (c: OrderCustomer) => orderApi.archiveCustomer(c.id),
    onSuccess: async () => {
      toast({ title: 'นำลูกค้าออกจากรายชื่อแล้ว', variant: 'success' });
      setArchiving(null);
      await qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e) => toast({ title: e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ', variant: 'error' }),
  });

  const hasFilter = Boolean(keyword) || onlyWithOrders;

  return (
    <PageContainer size="wide" className="order-page customers-page">
      <PageHeader
        breadcrumb="ออเดอร์และปฏิบัติการ"
        title="ลูกค้า"
        description="ข้อมูลติดต่อ ยอดซื้อที่ส่งมอบแล้ว และออเดอร์ที่กำลังจะถึง"
        actions={canCreate
          ? <button type="button" className="btn primary" onClick={() => setModal(true)}><Plus aria-hidden width={16} />เพิ่มลูกค้า</button>
          : undefined}
      />

      {list.isError && <div className="rb-callout warn" role="alert">
        <AlertTriangle aria-hidden />
        <div><strong>{list.error instanceof Error ? list.error.message : 'โหลดรายชื่อลูกค้าไม่สำเร็จ'}</strong></div>
        <button type="button" className="btn" onClick={() => void list.refetch()}>ลองใหม่</button>
      </div>}

      <KPIGrid columns={4}>
        <KPICard label="ลูกค้าทั้งหมด" value={list.isLoading ? '—' : kpi.total} icon={<UsersRound />} hint="ที่ยังใช้งานอยู่" />
        <KPICard label="เคยสั่งซื้อแล้ว" value={list.isLoading ? '—' : kpi.withOrders} icon={<ClipboardCheck />} hint="มีออเดอร์อย่างน้อย 1 ใบ" />
        <KPICard label="ออเดอร์ที่กำลังจะถึง" value={list.isLoading ? '—' : kpi.upcoming} icon={<ClipboardCheck />} hint="ยังไม่ส่งมอบ" />
        <KPICard label="ยอดขายที่ส่งมอบแล้ว" value={list.isLoading ? '—' : money(kpi.sales)} icon={<TrendingUp />} hint="เฉพาะออเดอร์สถานะส่งแล้ว" />
      </KPIGrid>

      <FilterBar actions={<>
        {hasFilter && <button type="button" className="btn" onClick={() => { setKeyword(''); setOnlyWithOrders(false); }}>ล้างตัวกรอง</button>}
        <button type="button" className={`btn${onlyWithOrders ? ' primary' : ''}`} aria-pressed={onlyWithOrders}
          onClick={() => setOnlyWithOrders((v) => !v)}>เฉพาะที่เคยสั่งซื้อ</button>
      </>}>
        <input className="s2-search" value={keyword} onChange={(e) => setKeyword(e.target.value)}
          placeholder="ค้นหาชื่อ รหัส ผู้ติดต่อ เบอร์โทร หรืออีเมล" aria-label="ค้นหาลูกค้า" />
      </FilterBar>

      <ContentCard padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อลูกค้า</th><th>ผู้ติดต่อ</th><th>โทรศัพท์</th><th>อีเมล</th>
                <th className="num">ออเดอร์</th><th className="num">ยอดที่ส่งมอบแล้ว</th><th>จัดการ</th>
              </tr>
            </thead>
            {list.isLoading ? <SkeletonRows rows={8} cols={8} /> : (
              <tbody>
                {rows.map((c) => (
                  <tr key={c.id}>
                    <td data-label="รหัส"><span className="unit-code">{c.code}</span></td>
                    <td data-label="ชื่อลูกค้า">
                      <Link className="ops-doc-link" to={`/customers/${c.id}`}>{c.name}</Link>
                    </td>
                    <td data-label="ผู้ติดต่อ">{c.contactName || '—'}</td>
                    <td data-label="โทรศัพท์">{c.phone || '—'}</td>
                    <td data-label="อีเมล">{c.email || '—'}</td>
                    <td className="num" data-label="ออเดอร์">{c.orderCount ?? 0}</td>
                    <td className="num" data-label="ยอดที่ส่งมอบแล้ว">{money(Number(c.deliveredSales ?? 0))}</td>
                    <td data-label="จัดการ">
                      <span className="md-row-actions">
                        <Link className="btn" to={`/customers/${c.id}`}>ดูข้อมูล</Link>
                        {canEdit && <button type="button" className="icon-btn" onClick={() => setArchiving(c)}
                          aria-label={`นำ ${c.name} ออกจากรายชื่อ`} title="นำออกจากรายชื่อ">
                          <Archive aria-hidden width={16} />
                        </button>}
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
            ? <EmptyState icon={UsersRound} title="ไม่พบลูกค้าที่ตรงกับคำค้น" description="ลองเปลี่ยนคำค้นหรือล้างตัวกรอง"
                action={<button type="button" className="btn" onClick={() => { setKeyword(''); setOnlyWithOrders(false); }}>ล้างตัวกรอง</button>} />
            : <EmptyState icon={UsersRound} title="ยังไม่มีข้อมูลลูกค้า" description="เพิ่มลูกค้ารายแรกเพื่อเริ่มสร้างออเดอร์"
                action={canCreate ? <button type="button" className="btn primary" onClick={() => setModal(true)}><Plus aria-hidden />เพิ่มลูกค้า</button> : undefined} />
        )}
      </ContentCard>

      <p className="md-note">
        <Info aria-hidden />
        แก้ไขรายละเอียดได้ที่หน้าข้อมูลลูกค้า · นำออกจากรายชื่อเป็นแบบชั่วคราว ประวัติออเดอร์เดิมยังอยู่ครบ
      </p>

      {modal && <CustomerQuickCreateModal
        onClose={() => setModal(false)}
        onCreated={() => { setModal(false); void qc.invalidateQueries({ queryKey: ['customers'] }); }}
      />}

      <ConfirmDialog
        open={archiving !== null}
        title="นำลูกค้าออกจากรายชื่อ"
        tone="danger"
        confirmLabel="นำออกจากรายชื่อ"
        onClose={() => setArchiving(null)}
        onConfirm={archiving ? () => archive.mutate(archiving) : undefined}
        description={archiving ? <div className="op-confirm">
          <dl>
            <div><dt>ลูกค้า</dt><dd>{archiving.name}</dd></div>
            <div><dt>รหัส</dt><dd>{archiving.code}</dd></div>
            <div><dt>ออเดอร์ที่มี</dt><dd>{archiving.orderCount ?? 0} ใบ</dd></div>
          </dl>
          <p className="op-confirm-impact">
            ลูกค้าจะไม่ปรากฏให้เลือกตอนสร้างออเดอร์ใหม่ แต่<b>ประวัติออเดอร์เดิมยังอยู่ครบทุกใบ</b>
          </p>
        </div> : ''}
      />

      {canCreateOrder && null}
    </PageContainer>
  );
}

/* ============================================================
   โปรไฟล์ลูกค้า
   ============================================================ */
export function CustomerProfilePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const canCreateOrder = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('ORDER_CREATE'));

  const { toast } = useToast();
  const qc = useQueryClient();
  const canEdit = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('CUSTOMER_EDIT'));

  // PHASE 8B — ใบเดียวพร้อมออเดอร์ล่าสุด ไม่ดึงทั้งบริษัทมากรองในเบราว์เซอร์
  const detail = useQuery({
    queryKey: ['customer', id],
    queryFn: () => orderApi.customer(id as string),
    enabled: Boolean(id), retry: false,
  });
  const customer = detail.data ?? null;
  const myOrders = customer?.recentOrders ?? [];

  const [editOpen, setEditOpen] = useState(false);
  const [draft, setDraft] = useState<CustomerPatch>({});
  const [formError, setFormError] = useState('');

  const save = useMutation({
    mutationFn: () => orderApi.updateCustomer(id as string, draft),
    onSuccess: async () => {
      toast({ title: 'บันทึกข้อมูลลูกค้าแล้ว', variant: 'success' });
      setEditOpen(false);
      // ล้าง cache ทุกที่ที่ชื่อลูกค้าปรากฏ
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['customer', id] }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
        qc.invalidateQueries({ queryKey: ['order-customers'] }),
        qc.invalidateQueries({ queryKey: ['orders'] }),
      ]);
    },
    onError: (e) => setFormError(orderErrorMessage(e, 'บันทึกข้อมูลลูกค้าไม่สำเร็จ')),
  });

  const openEdit = () => {
    if (!customer) return;
    setDraft({
      name: customer.name, code: customer.code,
      customerType: customer.customerType ?? '', contactName: customer.contactName ?? '',
      phone: customer.phone ?? '', email: customer.email ?? '',
      address: customer.address ?? '', billingAddress: customer.billingAddress ?? '',
      lineId: customer.lineId ?? '', branch: customer.branch ?? '',
      taxId: customer.taxId ?? '', note: customer.note ?? '',
    });
    setFormError(''); setEditOpen(true);
  };
  const patch = (p: Partial<CustomerPatch>) => setDraft((d) => ({ ...d, ...p }));

  if (detail.isLoading) {
    return <PageContainer className="order-page"><CardSkeleton lines={5} /></PageContainer>;
  }
  if (!customer) {
    return <PageContainer className="order-page">
      <EmptyState icon={UsersRound} title="ไม่พบลูกค้ารายนี้"
        description="อาจถูกนำออกจากรายชื่อแล้ว หรือไม่ได้อยู่ในบริษัทปัจจุบัน"
        action={<Link className="btn" to="/customers">กลับหน้ารายชื่อ</Link>} />
    </PageContainer>;
  }

  // ตัวเลขสรุปนับจากฐานข้อมูลทั้งหมด ไม่ใช่จาก 10 ใบล่าสุดที่แสดง
  const totalOrders = customer.orderCount ?? myOrders.length;
  const deliveredSum = Number(customer.deliveredSales ?? 0);
  const upcoming = customer.upcomingOrders ?? 0;

  return (
    <PageContainer className="order-page customer-profile-page">
      <PageHeader
        breadcrumb={<><Link to="/customers">ลูกค้า</Link><span> · </span><span>ข้อมูลลูกค้า</span></>}
        title={customer.name}
        badge={<span className={`badge ${customer.isActive ? 'success' : 'muted'}`}>{customer.isActive ? 'ใช้งาน' : 'นำออกจากรายชื่อแล้ว'}</span>}
        description={customer.code}
        meta={<>
          {customer.phone && <span><Phone aria-hidden width={13} /> {customer.phone}</span>}
          {customer.email && <span><Mail aria-hidden width={13} /> {customer.email}</span>}
          <span>{customer.orderCount ?? myOrders.length} ออเดอร์</span>
        </>}
        actions={<>
          <Link to="/customers" className="btn"><ArrowLeft aria-hidden width={16} />กลับหน้ารายชื่อ</Link>
          {canEdit && <button type="button" className="btn" onClick={openEdit}>
            <Pencil aria-hidden width={16} />แก้ไขข้อมูล
          </button>}
          {canCreateOrder && <Link to={`/orders/new?customer=${customer.id}`} className="btn primary">
            <Plus aria-hidden width={16} />สร้างออเดอร์ให้ลูกค้านี้
          </Link>}
        </>}
      />

      <KPIGrid columns={3}>
        <KPICard label="ออเดอร์ทั้งหมด" value={totalOrders} icon={<ClipboardCheck />} hint="ทุกสถานะ" />
        <KPICard label="ออเดอร์ที่กำลังจะถึง" value={upcoming} icon={<ClipboardCheck />} hint="ยังไม่ส่งมอบ" />
        <KPICard label="ยอดที่ส่งมอบแล้ว" value={money(deliveredSum)} icon={<TrendingUp />} hint="รวมทุกออเดอร์ที่ส่งแล้ว" />
      </KPIGrid>

      <ContentCard title="ข้อมูลลูกค้า" description="ข้อมูลทะเบียนที่บันทึกไว้">
        <dl className="doc-grid">
          <div><dt>รหัสลูกค้า</dt><dd>{customer.code}</dd></div>
          <div><dt>ประเภทลูกค้า</dt><dd>{customer.customerType || '—'}</dd></div>
          <div><dt>ผู้ติดต่อ</dt><dd>{customer.contactName || '—'}</dd></div>
          <div><dt>เบอร์โทร</dt><dd>{customer.phone || '—'}</dd></div>
          <div><dt>อีเมล</dt><dd>{customer.email || '—'}</dd></div>
          <div><dt>LINE ID</dt><dd>{customer.lineId || '—'}</dd></div>
          <div><dt>สาขา / แผนก</dt><dd>{customer.branch || '—'}</dd></div>
          <div><dt>เลขผู้เสียภาษี</dt><dd>{customer.taxId || '—'}</dd></div>
          <div className="wide"><dt>ที่อยู่จัดส่ง</dt><dd>{customer.address || '—'}</dd></div>
          <div className="wide"><dt>ที่อยู่ออกใบกำกับภาษี</dt><dd>{customer.billingAddress || '—'}</dd></div>
          <div className="wide"><dt>หมายเหตุ</dt><dd>{customer.note || '—'}</dd></div>
        </dl>
      </ContentCard>

      <ContentCard title="ออเดอร์ล่าสุด" description="10 ใบล่าสุด เรียงตามวันที่ส่ง" padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table">
            <thead>
              <tr><th>เลขออเดอร์</th><th>วันที่ส่ง</th><th>ระดับราคา</th><th className="num">ยอดสุทธิ</th><th>สถานะ</th></tr>
            </thead>
            <tbody>
              {myOrders.map((o) => (
                <tr key={o.id}>
                  <td data-label="เลขออเดอร์"><Link className="ops-doc-link" to={`/orders/${o.id}`}>{o.orderNo}</Link></td>
                  <td data-label="วันที่ส่ง">{d(o.deliveryDate)}</td>
                  <td data-label="ระดับราคา">{o.priceTier ? priceTierLabel(o.priceTier) : 'ไม่ได้ระบุ'}</td>
                  <td className="num" data-label="ยอดสุทธิ"><b>{money(o.totalAmount)}</b></td>
                  <td data-label="สถานะ"><span className={`badge ${orderBadgeClass(o.status)}`}>{orderStatusLabel(o.status)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {myOrders.length === 0 && (
          <EmptyState icon={ClipboardCheck} title="ลูกค้ารายนี้ยังไม่มีออเดอร์"
            description="สร้างออเดอร์แรกให้ลูกค้ารายนี้ได้เลย"
            action={canCreateOrder ? <Link className="btn primary" to={`/orders/new?customer=${customer.id}`}><Plus aria-hidden />สร้างออเดอร์</Link> : undefined} />
        )}
      </ContentCard>

      {/* แก้ไขข้อมูลลูกค้า — ใช้ modal กลางเดิม ไม่ทำ pattern ใหม่ */}
      <MasterModal
        open={editOpen}
        title="แก้ไขข้อมูลลูกค้า"
        description="แก้ได้เฉพาะข้อมูลทะเบียน — ออเดอร์เดิมทั้งหมดไม่เปลี่ยนแปลง"
        error={formError}
        busy={save.isPending}
        confirmLabel="บันทึกการแก้ไข"
        confirmIcon={<Pencil aria-hidden width={16} />}
        onClose={() => setEditOpen(false)}
        onConfirm={() => { if (!draft.name?.trim()) { setFormError('กรอกชื่อลูกค้า'); return; } save.mutate(); }}
        width={640}
      >
        <div className="md-fields">
          <label className="full">ชื่อลูกค้า *
            <input autoFocus value={draft.name ?? ''} onChange={(e) => patch({ name: e.target.value })} />
          </label>
          <label>รหัสลูกค้า
            <input value={draft.code ?? ''} onChange={(e) => patch({ code: e.target.value })} />
          </label>
          <label>ประเภทลูกค้า
            <input value={draft.customerType ?? ''} onChange={(e) => patch({ customerType: e.target.value })} />
          </label>
          <label>ผู้ติดต่อ
            <input value={draft.contactName ?? ''} onChange={(e) => patch({ contactName: e.target.value })} />
          </label>
          <label>เบอร์โทร
            <input value={draft.phone ?? ''} onChange={(e) => patch({ phone: e.target.value })} />
          </label>
          <label>อีเมล
            <input type="email" value={draft.email ?? ''} onChange={(e) => patch({ email: e.target.value })} />
          </label>
          <label>เลขผู้เสียภาษี
            <input value={draft.taxId ?? ''} onChange={(e) => patch({ taxId: e.target.value })} />
          </label>
          <label>LINE ID
            <input value={draft.lineId ?? ''} onChange={(e) => patch({ lineId: e.target.value })} />
          </label>
          <label>สาขา / แผนก
            <input value={draft.branch ?? ''} onChange={(e) => patch({ branch: e.target.value })} />
          </label>
          <label className="full">ที่อยู่จัดส่ง
            <textarea value={draft.address ?? ''} onChange={(e) => patch({ address: e.target.value })} />
          </label>
          <label className="full">ที่อยู่ออกใบกำกับภาษี
            <textarea value={draft.billingAddress ?? ''} onChange={(e) => patch({ billingAddress: e.target.value })} />
          </label>
          <label className="full">หมายเหตุ
            <textarea value={draft.note ?? ''} onChange={(e) => patch({ note: e.target.value })} />
          </label>
        </div>
      </MasterModal>
    </PageContainer>
  );
}
