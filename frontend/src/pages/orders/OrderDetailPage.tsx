import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, ClipboardCheck, FileDown, History, Info, Pencil, UserRound, Wallet, XCircle,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { orderApi, orderErrorMessage, type Order } from '@/lib/order-api';
import {
  NEXT_ACTION_LABEL, ORDER_FLOW, canTransition, nextStatus, orderBadgeClass, orderStatusLabel,
  priceTierLabel, type OrderStatus,
} from '@/lib/order-vocab';
import { PageContainer, PageHeader, ContentCard } from '@/components/layout/page';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { CardSkeleton } from '@/components/layout/page';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';

/**
 * PHASE 8 — รายละเอียดออเดอร์
 *
 * PHASE 8B — ดึงด้วย GET /business/orders/:id โดยตรง
 *
 * ราคาที่แสดงเป็น snapshot ของตอนสร้างออเดอร์ (SalesOrderItem.unitPrice / lineTotal)
 * ไม่ได้อ่านจากตารางราคาขายปัจจุบัน จึงไม่เปลี่ยนย้อนหลัง
 */

const money = (v: number | string) => `฿${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (v: number | string) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const dt = (v?: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : null);
const d = (v?: string | null) => (v ? new Date(v).toLocaleDateString('th-TH') : '—');

const openDocument = async (path: string) => {
  const blob = await apiClient.blob(path, 'pdf');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};

/**
 * เวลาของแต่ละขั้นที่ schema มีจริง
 * PICKING ไม่มีคอลัมน์ timestamp — จึงแสดงว่า "ไม่มีเวลาบันทึกไว้" ไม่เดาเวลาให้
 */
const STAGE_TIME: Record<OrderStatus, keyof Order | null> = {
  DRAFT: 'createdAt',
  CONFIRMED: 'confirmedAt',
  SENT_TO_PREP: 'sentToOperationsAt',
  PICKING: null,
  ISSUED: 'issuedAt',
  READY: 'readyAt',
  DELIVERED: 'deliveredAt',
  CANCELLED: 'cancelledAt',
};

export default function OrderDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();

  const canAct = Boolean(user?.roles.includes('SUPER_ADMIN')
    || ['ORDER_CONFIRM', 'ORDER_SEND', 'ORDER_COMPLETE', 'ORDER_CANCEL'].some((p) => user?.permissions.includes(p)));
  const canEdit = Boolean(user?.roles.includes('SUPER_ADMIN')
    || ['ORDER_CREATE', 'ORDER_EDIT'].some((p) => user?.permissions.includes(p)));

  // PHASE 8B — ดึงใบเดียวตรง ๆ ไม่โหลดออเดอร์ทั้งระบบมาค้นหาอีกต่อไป
  const list = useQuery({ queryKey: ['order', id], queryFn: () => orderApi.order(id as string), enabled: Boolean(id), retry: false });
  const order = list.data ?? null;

  const [pending, setPending] = useState<'next' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');

  const move = useMutation({
    mutationFn: ({ status, why }: { status: OrderStatus; why?: string }) =>
      orderApi.transition(id as string, status, why),
    onSuccess: async (_d, vars) => {
      toast({ title: `เปลี่ยนสถานะเป็น “${orderStatusLabel(vars.status)}” แล้ว`, variant: 'success' });
      setPending(null); setReason('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['order', id] }),
        qc.invalidateQueries({ queryKey: ['orders'] }),
      ]);
    },
    onError: (e) => toast({ title: orderErrorMessage(e, 'เปลี่ยนสถานะไม่สำเร็จ'), variant: 'error' }),
  });

  if (list.isLoading) {
    return <PageContainer className="order-page"><CardSkeleton lines={6} /></PageContainer>;
  }
  if (list.isError) {
    return <PageContainer className="order-page">
      <EmptyState variant="error" icon={AlertTriangle} title="โหลดออเดอร์ไม่สำเร็จ"
        description={list.error instanceof Error ? list.error.message : 'ลองใหม่อีกครั้ง'}
        action={<button type="button" className="btn" onClick={() => void list.refetch()}>ลองใหม่</button>} />
    </PageContainer>;
  }
  if (!order) {
    return <PageContainer className="order-page">
      <EmptyState icon={ClipboardCheck} title="ไม่พบออเดอร์นี้" description="อาจถูกลบไปแล้ว หรือไม่ได้อยู่ในบริษัทปัจจุบัน"
        action={<Link className="btn" to="/orders">กลับหน้ารายการ</Link>} />
    </PageContainer>;
  }

  const next = nextStatus(order.status);
  const cancellable = canTransition(order.status, 'CANCELLED');
  const lines = order.items ?? [];

  return (
    <PageContainer className="order-page order-detail-page">
      <PageHeader
        className="no-print"
        breadcrumb={<><Link to="/orders">คำสั่งซื้อ</Link><span> · </span><span>รายละเอียด</span></>}
        title={order.orderNo}
        badge={<span className={`badge ${orderBadgeClass(order.status)}`}>{orderStatusLabel(order.status)}</span>}
        description={<>ลูกค้า <Link className="inline-link" to={`/customers/${order.customerId}`}>{order.customer?.name ?? '—'}</Link></>}
        meta={<>
          <span>ส่ง {d(order.deliveryDate)}{order.deliveryTime ? ` ${order.deliveryTime}` : ''}</span>
          <span>{lines.length} รายการ</span>
          <span>{money(order.totalAmount)}</span>
        </>}
        actions={<>
          <Link to="/orders" className="btn"><ArrowLeft aria-hidden width={16} />กลับหน้ารายการ</Link>
          {/* แก้ไขได้เฉพาะร่าง — สถานะอื่นไม่แสดงปุ่มเลย */}
          {order.status === 'DRAFT' && canEdit && (
            <Link to={`/orders/${order.id}/edit`} className="btn"><Pencil aria-hidden width={16} />แก้ไขร่าง</Link>
          )}
          <button type="button" className="btn" onClick={() => void openDocument(`/business/documents/ORDER_SLIP/${order.id}.pdf`)}>
            <FileDown aria-hidden width={16} />ใบสั่งซื้อ PDF
          </button>
          {next && (canAct
            ? <button type="button" className="btn primary" disabled={move.isPending} onClick={() => setPending('next')}>
                <ClipboardCheck aria-hidden width={16} />{NEXT_ACTION_LABEL[order.status as OrderStatus] ?? orderStatusLabel(next)}
              </button>
            : <span className="perm-hint"><Info aria-hidden width={14} />ต้องให้ผู้มีสิทธิ์ดำเนินการต่อ</span>)}
          {cancellable && canAct && (
            <button type="button" className="btn danger-btn" disabled={move.isPending} onClick={() => setPending('cancel')}>
              <XCircle aria-hidden width={16} />ยกเลิกออเดอร์
            </button>
          )}
        </>}
      />

      <div className="doc-sheet">
        {/* A — ลูกค้า */}
        <ContentCard className="doc-card no-print" title={<><UserRound aria-hidden width={17} />ลูกค้าและการจัดส่ง</>}>
          <dl className="doc-grid">
            <div><dt>ลูกค้า</dt><dd><Link className="inline-link" to={`/customers/${order.customerId}`}>{order.customer?.name ?? '—'}</Link></dd></div>
            <div><dt>รหัสลูกค้า</dt><dd>{order.customer?.code ?? '—'}</dd></div>
            <div><dt>ผู้ติดต่อ</dt><dd>{order.contactName || order.customer?.contactName || '—'}</dd></div>
            <div><dt>เบอร์โทร</dt><dd>{order.phone || order.customer?.phone || '—'}</dd></div>
            <div><dt>วันที่ส่ง</dt><dd>{d(order.deliveryDate)}{order.deliveryTime ? ` ${order.deliveryTime}` : ''}</dd></div>
            <div className="wide"><dt>ที่อยู่จัดส่ง</dt><dd>{order.deliveryAddress || order.customer?.address || '—'}</dd></div>
          </dl>
        </ContentCard>

        {/* B + C — รายการและราคา */}
        <ContentCard className="doc-card" padded={false}
          title={<span className="no-print"><ClipboardCheck aria-hidden width={17} />รายการในออเดอร์</span>}>
          <div className="table-wrap">
            <table className="unit-table doc-lines ord-detail-lines">
              <thead>
                <tr>
                  <th>รายการ</th><th className="num">จำนวน</th><th>หน่วยขาย</th>
                  <th className="num">ราคาต่อหน่วย</th><th className="num">ยอดรวม</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id}>
                    {/* ชื่อที่แสดงคือ snapshot ตอนสร้าง ไม่ใช่ชื่อเมนูปัจจุบัน */}
                    <td data-label="รายการ"><b>{l.menuNameSnapshot}</b></td>
                    <td className="num" data-label="จำนวน">{qtyText(l.quantity)}</td>
                    <td data-label="หน่วยขาย">{l.unit}</td>
                    <td className="num" data-label="ราคาต่อหน่วย">{money(l.unitPrice)}</td>
                    <td className="num" data-label="ยอดรวม"><b>{money(l.lineTotal)}</b></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* C — ระดับราคาที่บันทึกไว้ (metadata ไม่ใช่ตัวเลขการเงิน) */}
          <p className="ord-tier-note">
            <Wallet aria-hidden width={15} />
            ระดับราคาที่บันทึก: <b>{order.priceTier ? priceTierLabel(order.priceTier) : 'ไม่ได้ระบุระดับราคา'}</b>
          </p>

          {/* D — ยอดรวม */}
          <div className="ord-totals">
            <div><span>ยอดรวม</span><b className="num">{money(order.subtotal)}</b></div>
            {Number(order.discount) > 0 && <div><span>ส่วนลด</span><b className="num">− {money(order.discount)}</b></div>}
            {Number(order.tax) > 0 && <div><span>ภาษี</span><b className="num">{money(order.tax)}</b></div>}
            <div className="ord-total-net"><span>ยอดสุทธิ</span><b className="num">{money(order.totalAmount)}</b></div>
          </div>

          <p className="doc-note no-print">
            <Info aria-hidden width={14} />
            ราคาที่แสดงคือราคาที่ใช้จริงตอนสร้างออเดอร์ ระบบเก็บไว้กับเอกสารใบนี้ การแก้ราคาขายภายหลังไม่เปลี่ยนออเดอร์เก่า
          </p>
        </ContentCard>

        {/* E — ไทม์ไลน์ */}
        <ContentCard className="doc-card no-print" title={<><History aria-hidden width={17} />ไทม์ไลน์</>}
          description="แสดงเฉพาะขั้นที่ระบบบันทึกเวลาไว้จริง">
          <OrderTimeline order={order} />
        </ContentCard>

        {/* F — หมายเหตุ */}
        {(order.note || order.cancellationReason) && (
          <ContentCard className="doc-card no-print" title="หมายเหตุ">
            {order.note && <p>{order.note}</p>}
            {order.cancellationReason && <p className="md-error"><AlertTriangle aria-hidden />เหตุผลการยกเลิก: {order.cancellationReason}</p>}
          </ContentCard>
        )}
      </div>

      <ConfirmDialog
        open={pending === 'next'}
        title={next ? `${NEXT_ACTION_LABEL[order.status as OrderStatus] ?? orderStatusLabel(next)}` : ''}
        confirmLabel={next ? (NEXT_ACTION_LABEL[order.status as OrderStatus] ?? 'ยืนยัน') : 'ยืนยัน'}
        onClose={() => setPending(null)}
        onConfirm={next ? () => move.mutate({ status: next }) : undefined}
        description={<div className="op-confirm">
          <dl>
            <div><dt>เอกสาร</dt><dd>{order.orderNo}</dd></div>
            <div><dt>ลูกค้า</dt><dd>{order.customer?.name ?? '—'}</dd></div>
            <div><dt>จำนวนรายการ</dt><dd>{lines.length} รายการ</dd></div>
            <div><dt>ยอดสุทธิ</dt><dd>{money(order.totalAmount)}</dd></div>
          </dl>
          <p className="op-confirm-impact">
            <ClipboardCheck aria-hidden width={15} />
            สถานะจะเปลี่ยนจาก <b>{orderStatusLabel(order.status)}</b> เป็น <b>{next ? orderStatusLabel(next) : '—'}</b>
            {next === 'SENT_TO_PREP' && ' และระบบจะแจ้งเตือนฝ่ายปฏิบัติการให้เตรียมของ'}
          </p>
        </div>}
      />

      <ConfirmDialog
        open={pending === 'cancel'}
        title="ยกเลิกออเดอร์"
        tone="danger"
        confirmLabel="ยกเลิกออเดอร์"
        onClose={() => { setPending(null); setReason(''); }}
        onConfirm={reason.trim() ? () => move.mutate({ status: 'CANCELLED', why: reason.trim() }) : undefined}
        description={<div className="op-confirm">
          <dl>
            <div><dt>เอกสาร</dt><dd>{order.orderNo}</dd></div>
            <div><dt>ลูกค้า</dt><dd>{order.customer?.name ?? '—'}</dd></div>
            <div><dt>ยอดสุทธิ</dt><dd>{money(order.totalAmount)}</dd></div>
          </dl>
          <p className="op-confirm-impact">
            <XCircle aria-hidden width={15} />
            ออเดอร์จะถูกทำเครื่องหมายว่ายกเลิก และ<b>เปลี่ยนสถานะต่อไม่ได้อีก</b> — ข้อมูลเดิมยังเก็บไว้ทั้งหมด
          </p>
          <label className="md-field">
            <span>เหตุผลการยกเลิก *</span>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าแจ้งยกเลิก" />
            {!reason.trim() && <span className="md-error"><AlertTriangle aria-hidden />ต้องระบุเหตุผลก่อนจึงจะยกเลิกได้</span>}
          </label>
        </div>}
      />
    </PageContainer>
  );
}

/** ไทม์ไลน์จาก timestamp จริงเท่านั้น — ขั้นที่ schema ไม่มีคอลัมน์เวลา จะบอกตรง ๆ */
function OrderTimeline({ order }: { order: Order }) {
  const cancelled = order.status === 'CANCELLED';
  const reachedIndex = ORDER_FLOW.indexOf(order.status as OrderStatus);

  const steps = ORDER_FLOW.map((stage, i) => {
    const field = STAGE_TIME[stage];
    const at = field ? (order[field] as string | null | undefined) : null;
    // ถือว่าผ่านขั้นนี้แล้วถ้ามีเวลาบันทึกไว้ หรือสถานะปัจจุบันเลยขั้นนี้มาแล้ว
    const done = Boolean(at) || (reachedIndex >= 0 && i <= reachedIndex);
    return { stage, at, done, noTimestamp: field === null };
  });

  return <ol className="doc-timeline">
    {steps.map((s) => (
      <li key={s.stage} className={s.done ? 'done' : 'pending'}>
        <span className="tl-dot" aria-hidden />
        <div>
          <strong>{orderStatusLabel(s.stage)}</strong>
          {s.done
            ? <small>{dt(s.at) ?? (s.noTimestamp ? 'ระบบไม่ได้บันทึกเวลาของขั้นนี้' : 'ไม่มีเวลาบันทึกไว้')}</small>
            : <small className="tl-pending">ยังไม่เกิดขึ้น</small>}
        </div>
      </li>
    ))}
    {cancelled && (
      <li className="done warn">
        <span className="tl-dot" aria-hidden />
        <div>
          <strong>{orderStatusLabel('CANCELLED')}</strong>
          <small>{dt(order.cancelledAt) ?? 'ไม่มีเวลาบันทึกไว้'}</small>
        </div>
      </li>
    )}
  </ol>;
}
