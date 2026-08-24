import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, ClipboardCheck, History, Info,
  PackageCheck, Pencil, Printer, RotateCcw, Truck, Warehouse as WarehouseIcon, FileDown, Paperclip,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';

/** เปิด PDF ผ่าน blob เสมอ — ลิงก์ตรงจะโดน SPA fallback คืน index.html (บทเรียน PHASE 13) */
const openDocument = async (path: string) => {
  const blob = await apiClient.blob(path, 'pdf');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PageContainer, PageHeader, ContentCard } from '@/components/layout/page';
import { STATUS_BADGE, statusInfo } from '@/lib/operations-vocab';
import { OriginalDocumentSection } from '@/components/receiving/OriginalDocument';
import { canEditAttachments, documentActions, type ReceiptAttachment } from '@/lib/receipt-attachment';

const qty = (v: number) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const money = (v: number) => `฿${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dt = (v?: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : null);
const d = (v?: string | null) => (v ? new Date(v).toLocaleDateString('th-TH') : '—');

interface Movement {
  id: string; createdAt: string; movementType: string; refNo: string | null;
  itemCode: string; itemName: string; beforeQty: number | null;
  qtyIn: number; qtyOut: number; balanceAfter: number; unit: string | null; reason: string | null;
}
interface ReceiptDetail {
  id: string; receiptNo: string; status: string; receiptDate: string; note?: string | null;
  supplierDocNo?: string | null; confirmedAt?: string | null; reversedAt?: string | null; createdAt: string;
  supplier?: { name: string } | null; warehouse: { name: string; code: string };
  items: { id: string; quantity: string; unitPrice: string; totalCost: string; item: { code: string; name: string; type: string; baseUnit?: { code: string } | null } }[];
}
interface IssueDetail {
  id: string; issueNo: string; status: string; issueDate: string; issuedAt?: string | null; destination: string; note?: string | null; createdAt: string;
  createdBy: { fullName: string }; warehouse?: { name: string; code: string } | null;
  items: { id: string; issuedQty: string; unit: string; item?: { code: string; name: string } | null }[];
}

/** แถบสถานะเอกสาร — ต้องระบุชนิดเอกสารด้วย เพราะ CONFIRMED/ISSUED มีความหมายต่างกันตามชนิด */
function StatusBadge({ kind, status }: { kind: 'receiving' | 'issue'; status: string }) {
  const st = statusInfo(kind, status);
  return <span className={`badge ${STATUS_BADGE[st.tone]}`}>{st.label}</span>;
}

/**
 * PHASE 6D — แถบปุ่มของหน้ารายละเอียดเอกสาร (ใช้ร่วมกันทั้งใบรับของและใบเบิก)
 * ลำดับคงที่: กลับ → ดูการเคลื่อนไหว → แก้ไข → พิมพ์/PDF → ยืนยัน (หลัก) → กลับรายการ (อันตราย)
 * ปุ่มที่ไม่มีสิทธิ์จะไม่แสดง และบอกเหตุผลแทน เพื่อไม่ให้ผู้ใช้กดแล้วเจอ 403
 */
function DocActionBar({ backTo, movementsRef, editTo, canEdit, canPrint, confirmAction, reverseAction, canAct, busy }: {
  backTo: string;
  movementsRef: string;
  editTo?: string;
  canEdit: boolean;
  canPrint: boolean;
  confirmAction?: { label: string; onClick: () => void };
  reverseAction?: { onClick: () => void };
  /** ผู้ใช้มีสิทธิ์ยืนยัน/กลับรายการหรือไม่ */
  canAct: boolean;
  busy: boolean;
}) {
  return <>
    <Link to={backTo} className="btn">กลับหน้ารายการ</Link>
    <Link to={`/inventory/movements?ref=${encodeURIComponent(movementsRef)}`} className="btn">
      <History aria-hidden width={16} />ดูการเคลื่อนไหว
    </Link>
    {canEdit && editTo && <Link to={editTo} className="btn"><Pencil aria-hidden width={16} />แก้ไข</Link>}
    {canPrint && <button type="button" className="btn" onClick={() => window.print()} title="เปิดหน้าต่างพิมพ์ เลือกเครื่องพิมพ์หรือบันทึกเป็น PDF ได้"><Printer aria-hidden width={16} />พิมพ์ / บันทึก PDF</button>}
    {confirmAction && (canAct
      ? <button type="button" className="btn primary" disabled={busy} onClick={confirmAction.onClick}>
          <PackageCheck aria-hidden width={16} />{confirmAction.label}
        </button>
      : <span className="perm-hint"><Info aria-hidden width={14} />รายการนี้ต้องให้ผู้มีสิทธิ์ยืนยัน</span>)}
    {reverseAction && canAct && <button type="button" className="btn danger-btn" disabled={busy} onClick={reverseAction.onClick}>
      <RotateCcw aria-hidden width={16} />กลับรายการ
    </button>}
  </>;
}

/** ไทม์ไลน์เอกสาร — แสดงเฉพาะขั้นที่เกิดขึ้นจริง และใช้เวลาจริงจาก backend เท่านั้น */
function Timeline({ steps }: { steps: { label: string; at?: string | null; done: boolean; tone?: 'ok' | 'warn' }[] }) {
  return <ol className="doc-timeline">
    {steps.map((s) => <li key={s.label} className={`${s.done ? 'done' : 'pending'} ${s.tone ?? ''}`}>
      <span className="tl-dot" aria-hidden />
      <div>
        <strong>{s.label}</strong>
        {/* ไม่มีเวลาในฐานข้อมูล ก็บอกตรง ๆ ว่าไม่มี ไม่เดาจากเวลาอื่น */}
        {s.done ? <small>{dt(s.at) ?? 'ไม่มีเวลาบันทึกไว้'}</small> : <small className="tl-pending">ยังไม่เกิดขึ้น</small>}
      </div>
    </li>)}
  </ol>;
}

/** พื้นที่ลงนามสำหรับงานพิมพ์ A4 */
function SignatureArea() {
  return <div className="print-signatures">
    {['ผู้จัดทำ', 'ผู้ตรวจสอบ', 'ผู้อนุมัติ'].map((role) => (
      <div key={role}><span className="sig-line" />{role}<small>วันที่ ........../........../..........</small></div>
    ))}
  </div>;
}

function useMovements(refId?: string) {
  const [rows, setRows] = useState<Movement[]>([]);
  useEffect(() => {
    if (!refId) return;
    void apiClient.get<Movement[]>(`/business/stock-movements?refId=${refId}&take=200`).then(setRows).catch(() => setRows([]));
  }, [refId]);
  return rows;
}

/** ผลกระทบสต็อกของแต่ละบรรทัด (ก่อน / เข้า-ออก / หลัง) จาก ledger จริง */
function impactOf(movements: Movement[], itemCode: string) {
  const m = movements.find((x) => x.itemCode === itemCode && x.reason !== 'REVERSAL');
  if (!m) return null;
  return { before: m.beforeQty, change: m.qtyIn > 0 ? m.qtyIn : -m.qtyOut, after: m.balanceAfter };
}

/**
 * คำอธิบายใต้ตารางว่าทำไมช่องก่อน/หลังเป็น "—"
 * ห้ามเอาสต็อกปัจจุบันมาย้อนสร้างยอดก่อน/หลังของเอกสารเก่า — ไม่มีข้อมูลก็แสดง — ตามเดิม
 */
function LedgerNote({ status, draftText, hasLedger, missingBefore }: {
  status: string; draftText: string; hasLedger: boolean; missingBefore?: boolean;
}) {
  if (status === 'DRAFT') {
    return <p className="doc-note no-print"><AlertTriangle aria-hidden width={14} />{draftText}</p>;
  }
  if (!hasLedger) {
    return <p className="doc-note no-print"><Info aria-hidden width={14} />เอกสารนี้ไม่มีบัญชีเดินสต็อกเก็บไว้ ระบบจึงแสดง “—” แทนยอดก่อน/หลัง และไม่คำนวณย้อนหลังจากสต็อกปัจจุบัน</p>;
  }
  /* PHASE 12 — เอกสารเก่าที่บันทึกก่อนระบบจะเก็บ beforeQty มี ledger ครบ
     แต่ช่อง "ก่อน" ว่าง ผู้ใช้จึงเห็น “—” โดยไม่มีคำอธิบาย */
  if (missingBefore) {
    return <p className="doc-note no-print"><Info aria-hidden width={14} />เอกสารนี้บันทึกไว้ก่อนระบบจะเก็บยอดคงเหลือก่อนทำรายการ จึงแสดง “—” ในช่องยอดก่อน — ยอดที่เปลี่ยนและยอดหลังยังอ้างอิงบัญชีเดินสต็อกจริง</p>;
  }
  return null;
}

// ===================== RECEIVING DETAIL =====================
export function ReceivingDetailPage() {
  const { id } = useParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const canConfirm = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('RECEIVING_CONFIRM'));

  const [doc, setDoc] = useState<ReceiptDetail>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const movements = useMovements(doc?.id);
  const [attachments, setAttachments] = useState<ReceiptAttachment[]>([]);

  const load = async () => {
    try { setDoc(await apiClient.get<ReceiptDetail>(`/business/receiving/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'โหลดเอกสารไม่สำเร็จ'); }
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  // ไฟล์ต้นฉบับเป็นข้อมูลเสริม โหลดแยกและล้มเหลวเงียบ ๆ ได้โดยไม่กระทบหน้าเอกสาร
  useEffect(() => {
    if (!id) return;
    void apiClient.get<ReceiptAttachment[]>(`/business/receiving/${id}/attachments`).then(setAttachments).catch(() => setAttachments([]));
  }, [id, doc?.status]);

  // ทุกการกระทำที่แตะสต็อกจริงต้องผ่านกล่องยืนยันที่บอกผลกระทบก่อน (แทน window.confirm เดิม)
  const [pending, setPending] = useState<'confirm' | 'reverse' | null>(null);
  const act = async (action: 'confirm' | 'reverse') => {
    if (busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/business/receiving/${id}/${action}`, {});
      toast({ title: action === 'confirm' ? 'ยืนยันรับของแล้ว' : 'กลับรายการแล้ว', variant: 'success' });
      await load();
    } catch (e) { toast({ title: 'ทำรายการไม่สำเร็จ', description: e instanceof Error ? e.message : '', variant: 'error' }); }
    finally { setBusy(false); }
  };

  const totals = useMemo(() => {
    const items = doc?.items ?? [];
    return {
      lines: items.length,
      qty: items.reduce((s, i) => s + Number(i.quantity), 0),
      value: items.reduce((s, i) => s + Number(i.totalCost), 0),
    };
  }, [doc]);

  if (error) return <PageContainer className="ops-page"><div className="auth-alert">{error}</div><Link to="/receiving" className="btn">กลับหน้ารายการ</Link></PageContainer>;
  if (!doc) return <PageContainer className="ops-page"><p className="issue-none">กำลังโหลดเอกสาร…</p></PageContainer>;

  const hasLedger = doc.items.some((l) => impactOf(movements, l.item.code) !== null);
  const missingBefore = hasLedger && doc.items.some((l) => { const im = impactOf(movements, l.item.code); return im !== null && im.before == null; });

  /* PHASE 22 — เอกสารสองใบที่แยกกันเด็ดขาด
     ใบของ S2A ระบบสร้างเอง · ไฟล์ต้นฉบับมาจากผู้ขาย ไม่มีทางทับกัน */
  const docs = documentActions({ receiptId: doc.id, status: doc.status, attachments });

  return <PageContainer className="ops-page doc-detail">
    <PageHeader
      className="no-print"
      breadcrumb={<><Link to="/receiving">ใบรับของ</Link><span> · </span><span>รายละเอียด</span></>}
      title={doc.receiptNo}
      badge={<StatusBadge kind="receiving" status={doc.status} />}
      description={`รับของเข้าคลัง ${doc.warehouse.name}`}
      meta={<>
        <span>วันที่รับ {d(doc.receiptDate)}</span>
        <span>{doc.supplier?.name ?? 'ไม่ระบุผู้ขาย'}</span>
        <span>{doc.items.length} รายการ</span>
      </>}
      actions={<><DocActionBar
        backTo="/receiving"
        movementsRef={doc.receiptNo}
        editTo={`/receiving/${doc.id}/edit`}
        canEdit={doc.status === 'DRAFT'}
        canPrint={doc.status !== 'DRAFT'}
        canAct={canConfirm}
        busy={busy}
        confirmAction={doc.status === 'DRAFT' ? { label: 'ยืนยันรับเข้า', onClick: () => setPending('confirm') } : undefined}
        reverseAction={doc.status === 'CONFIRMED' ? { onClick: () => setPending('reverse') } : undefined}
      />
      {/* PHASE 22 — เอกสารสองใบแยกกันชัดเจน ไม่ทับกัน
          ไม่มีไฟล์ต้นฉบับ = ปุ่มถูกปิดและบอกตรง ๆ ไม่ใช่กดแล้วไม่เกิดอะไร */}
      {docs.s2a.available && (
        <button type="button" className="btn" onClick={() => void openDocument(docs.s2a.url!)}>
          <FileDown aria-hidden width={16} />ดูใบรับเข้าของ S2A
        </button>
      )}
      <a className={`btn${docs.original.available ? '' : ' is-disabled'}`}
        href={docs.original.url ?? undefined}
        target="_blank" rel="noopener noreferrer"
        aria-disabled={!docs.original.available}
        onClick={(e) => { if (!docs.original.available) e.preventDefault(); }}>
        <Paperclip aria-hidden width={16} />{docs.original.label}
      </a>
      </>}
    />

    {/* บอกให้ครบว่าเอกสารไหน คลังไหน กี่รายการ และสต็อกจะเปลี่ยนอย่างไร ก่อนลงมือ */}
    <ConfirmDialog
      open={pending === 'confirm'}
      title="ยืนยันรับเข้าสต็อก"
      confirmLabel="ยืนยันรับเข้า"
      onClose={() => setPending(null)}
      onConfirm={() => void act('confirm')}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{doc.receiptNo}</dd></div>
          <div><dt>คลังปลายทาง</dt><dd>{doc.warehouse?.name ?? '—'}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{doc.items.length} รายการ</dd></div>
        </dl>
        <p className="op-confirm-impact"><ArrowDownToLine aria-hidden width={15} />เมื่อยืนยัน ระบบจะ<b>เพิ่มสต็อกจริง</b>ตามรายการนี้ และแก้ไขเอกสารโดยตรงไม่ได้อีก</p>
      </div>}
    />
    <ConfirmDialog
      open={pending === 'reverse'}
      title="กลับรายการใบรับของ"
      confirmLabel="กลับรายการ"
      tone="danger"
      onClose={() => setPending(null)}
      onConfirm={() => void act('reverse')}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{doc.receiptNo}</dd></div>
          <div><dt>คลัง</dt><dd>{doc.warehouse?.name ?? '—'}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{doc.items.length} รายการ</dd></div>
        </dl>
        <p className="op-confirm-impact"><RotateCcw aria-hidden width={15} />ระบบจะสร้าง<b>รายการกลับสต็อก</b> (ลดสต็อกคืนตามที่เคยรับเข้า) โดย<b>ไม่ลบประวัติเดิม</b></p>
      </div>}
    />

    <div className="doc-sheet">
      <div className="print-only print-head">
        <div><strong>{user?.activeCompany?.nameTh ?? 'S2A'}</strong><span>ใบรับสินค้า / GOODS RECEIPT</span></div>
        <table className="print-meta"><tbody>
          <tr><th>เลขที่</th><td>{doc.receiptNo}</td><th>วันที่</th><td>{d(doc.receiptDate)}</td></tr>
          <tr><th>คลัง</th><td>{doc.warehouse.name}</td><th>Supplier</th><td>{doc.supplier?.name ?? '—'}</td></tr>
        </tbody></table>
      </div>

      <ContentCard className="doc-card no-print" title={<><Truck aria-hidden width={17} />ข้อมูลเอกสาร</>}>
        <dl className="doc-grid">
          <div><dt>วันที่รับ</dt><dd>{d(doc.receiptDate)}</dd></div>
          <div><dt>Supplier</dt><dd>{doc.supplier?.name ?? '—'}</dd></div>
          <div><dt>คลัง</dt><dd>{doc.warehouse.name}</dd></div>
          <div><dt>เลขที่เอกสาร Supplier</dt><dd>{doc.supplierDocNo || '—'}</dd></div>
          <div><dt>สถานะ</dt><dd><StatusBadge kind="receiving" status={doc.status} /></dd></div>
          <div className="wide"><dt>หมายเหตุ</dt><dd>{doc.note || '—'}</dd></div>
        </dl>
      </ContentCard>

      <ContentCard className="doc-card" title={<span className="no-print"><ClipboardCheck aria-hidden width={17} />รายการที่รับ</span>} padded={false}>
        <div className="table-wrap">
          <table className="unit-table doc-lines">
            <thead><tr>
              <th>สินค้า</th><th>จำนวน</th><th>หน่วย</th><th>ราคาต่อหน่วย</th><th>ยอดรวม</th>
              <th>ก่อนรับ</th><th>รับเข้า</th><th>หลังรับ</th>
            </tr></thead>
            <tbody>
              {doc.items.map((l) => {
                const im = impactOf(movements, l.item.code);
                return <tr key={l.id}>
                  <td data-label="สินค้า"><b>{l.item.name}</b><small>{l.item.code}</small></td>
                  <td data-label="จำนวน">{qty(Number(l.quantity))}</td>
                  <td data-label="หน่วย">{l.item.baseUnit?.code ?? ''}</td>
                  <td data-label="ราคาต่อหน่วย">{Number(l.unitPrice).toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
                  <td data-label="ยอดรวม">{money(Number(l.totalCost))}</td>
                  <td data-label="ก่อนรับ">{im && im.before != null ? qty(im.before) : '—'}</td>
                  <td data-label="รับเข้า">{im ? `+${qty(im.change)}` : '—'}</td>
                  <td data-label="หลังรับ">{im ? <b>{qty(im.after)}</b> : '—'}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="doc-totals">
          <span>จำนวนรายการ <b>{totals.lines}</b></span>
          <span>จำนวนรวม <b>{qty(totals.qty)}</b></span>
          <span>มูลค่ารวม <b>{money(totals.value)}</b></span>
        </div>
        <LedgerNote status={doc.status} hasLedger={hasLedger} missingBefore={missingBefore}
          draftText="เอกสารยังเป็นร่าง จึงยังไม่มีผลต่อสต็อก — ยอดก่อนรับ/หลังรับจะเกิดขึ้นเมื่อยืนยันรับเข้า" />
      </ContentCard>

      <div className="no-print">
        <OriginalDocumentSection receiptId={doc.id} canEdit={canEditAttachments(doc.status)} />
      </div>

      <ContentCard className="doc-card no-print" title={<><History aria-hidden width={17} />ไทม์ไลน์</>}>
        <Timeline steps={[
          { label: 'สร้างร่าง', at: doc.createdAt, done: true },
          { label: 'ยืนยันรับเข้า', at: doc.confirmedAt, done: doc.status === 'CONFIRMED' || doc.status === 'REVERSED' },
          ...(doc.status === 'REVERSED' ? [{ label: 'กลับรายการ', at: doc.reversedAt, done: true, tone: 'warn' as const }] : []),
        ]} />
      </ContentCard>

      <div className="print-only"><SignatureArea /></div>
    </div>
  </PageContainer>;
}

// ===================== STOCK ISSUE DETAIL =====================
export function StockIssueDetailPage() {
  const { id } = useParams();
  const { toast } = useToast();
  const { user } = useAuth();
  const canConfirm = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('STOCK_ISSUE_CONFIRM'));

  const [doc, setDoc] = useState<IssueDetail>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const movements = useMovements(doc?.id);

  const load = async () => {
    try { setDoc(await apiClient.get<IssueDetail>(`/business/stock-issues/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'โหลดเอกสารไม่สำเร็จ'); }
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const [pending, setPending] = useState<'confirm' | 'reverse' | null>(null);
  const act = async (action: 'confirm' | 'reverse') => {
    if (busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/business/stock-issues/${id}/${action}`, {});
      toast({ title: action === 'confirm' ? 'ยืนยันและตัดสต็อกแล้ว' : 'กลับรายการแล้ว', variant: 'success' });
      await load();
    } catch (e) { toast({ title: 'ทำรายการไม่สำเร็จ', description: e instanceof Error ? e.message : '', variant: 'error' }); }
    finally { setBusy(false); }
  };

  if (error) return <PageContainer className="ops-page"><div className="auth-alert">{error}</div><Link to="/stock-issues" className="btn">กลับหน้ารายการ</Link></PageContainer>;
  if (!doc) return <PageContainer className="ops-page"><p className="issue-none">กำลังโหลดเอกสาร…</p></PageContainer>;

  const totalQty = doc.items.reduce((s, i) => s + Number(i.issuedQty), 0);
  const hasLedger = doc.items.some((l) => (l.item ? impactOf(movements, l.item.code) : null) !== null);
  const missingBefore = hasLedger && doc.items.some((l) => { const im = l.item ? impactOf(movements, l.item.code) : null; return im !== null && im.before == null; });

  return <PageContainer className="ops-page doc-detail">
    <PageHeader
      className="no-print"
      breadcrumb={<><Link to="/stock-issues">ใบเบิก</Link><span> · </span><span>รายละเอียด</span></>}
      title={doc.issueNo}
      badge={<StatusBadge kind="issue" status={doc.status} />}
      description={`เบิกจาก ${doc.warehouse?.name ?? '—'} ไปครัวกลาง`}
      meta={<>
        <span>วันที่ {d(doc.issueDate)}</span>
        <span>ผู้ขอเบิก {doc.createdBy.fullName}</span>
        <span>{doc.items.length} รายการ</span>
      </>}
      actions={<DocActionBar
        backTo="/stock-issues"
        movementsRef={doc.issueNo}
        editTo={`/stock-issues/${doc.id}/edit`}
        canEdit={doc.status === 'DRAFT'}
        canPrint={doc.status !== 'DRAFT'}
        canAct={canConfirm}
        busy={busy}
        confirmAction={doc.status === 'DRAFT' ? { label: 'ยืนยันและตัดสต็อก', onClick: () => setPending('confirm') } : undefined}
        reverseAction={doc.status === 'ISSUED' ? { onClick: () => setPending('reverse') } : undefined}
      />}
    />

    {/* ใบเบิกตัดสต็อกจริง จึงต้องสรุปให้เห็นก่อนกด */}
    <ConfirmDialog
      open={pending === 'confirm'}
      title="ยืนยันตัดสต็อกตามใบเบิกนี้"
      confirmLabel="ยืนยันและตัดสต็อก"
      onClose={() => setPending(null)}
      onConfirm={() => void act('confirm')}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{doc.issueNo}</dd></div>
          <div><dt>คลังต้นทาง</dt><dd>{doc.warehouse?.name ?? '—'}</dd></div>
          <div><dt>ปลายทาง</dt><dd>{doc.destination}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{doc.items.length} รายการ</dd></div>
        </dl>
        <p className="op-confirm-impact"><ArrowUpFromLine aria-hidden width={15} />เมื่อยืนยัน ระบบจะ<b>ตัดสต็อกจริง</b>ออกจากคลังต้นทาง และแก้ไขเอกสารโดยตรงไม่ได้อีก</p>
      </div>}
    />
    <ConfirmDialog
      open={pending === 'reverse'}
      title="กลับรายการใบเบิก"
      confirmLabel="กลับรายการ"
      tone="danger"
      onClose={() => setPending(null)}
      onConfirm={() => void act('reverse')}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{doc.issueNo}</dd></div>
          <div><dt>คลัง</dt><dd>{doc.warehouse?.name ?? '—'}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{doc.items.length} รายการ</dd></div>
        </dl>
        <p className="op-confirm-impact"><RotateCcw aria-hidden width={15} />ระบบจะสร้าง<b>รายการคืนสต็อก</b>ตามที่เคยตัด โดย<b>ไม่ลบประวัติเดิม</b></p>
      </div>}
    />

    <div className="doc-sheet">
      <div className="print-only print-head">
        <div><strong>{user?.activeCompany?.nameTh ?? 'S2A'}</strong><span>ใบเบิกสินค้า / STOCK ISSUE</span></div>
        <table className="print-meta"><tbody>
          <tr><th>เลขที่</th><td>{doc.issueNo}</td><th>วันที่</th><td>{d(doc.issueDate)}</td></tr>
          <tr><th>คลังต้นทาง</th><td>{doc.warehouse?.name ?? '—'}</td><th>ปลายทาง</th><td>ครัวกลาง</td></tr>
        </tbody></table>
      </div>

      <ContentCard className="doc-card no-print" title={<><WarehouseIcon aria-hidden width={17} />ข้อมูลเอกสาร</>}>
        <dl className="doc-grid">
          <div><dt>วันที่</dt><dd>{d(doc.issueDate)}</dd></div>
          <div><dt>คลังต้นทาง</dt><dd>{doc.warehouse?.name ?? '—'}</dd></div>
          <div><dt>ปลายทาง</dt><dd>ครัวกลาง</dd></div>
          <div><dt>ผู้ขอเบิก</dt><dd>{doc.createdBy.fullName}</dd></div>
          <div><dt>สถานะ</dt><dd><StatusBadge kind="issue" status={doc.status} /></dd></div>
          <div className="wide"><dt>หมายเหตุ</dt><dd>{doc.note || '—'}</dd></div>
        </dl>
      </ContentCard>

      <ContentCard className="doc-card" title={<span className="no-print"><ClipboardCheck aria-hidden width={17} />รายการที่เบิก</span>} padded={false}>
        <div className="table-wrap">
          <table className="unit-table doc-lines">
            <thead><tr><th>สินค้า</th><th>ก่อนเบิก</th><th>จำนวนเบิก</th><th>หลังเบิก</th><th>หน่วย</th></tr></thead>
            <tbody>
              {doc.items.map((l) => {
                const im = l.item ? impactOf(movements, l.item.code) : null;
                return <tr key={l.id}>
                  <td data-label="สินค้า"><b>{l.item?.name ?? l.id}</b><small>{l.item?.code ?? ''}</small></td>
                  <td data-label="ก่อนเบิก">{im && im.before != null ? qty(im.before) : '—'}</td>
                  <td data-label="จำนวนเบิก">{qty(Number(l.issuedQty))}</td>
                  <td data-label="หลังเบิก">{im ? <b>{qty(im.after)}</b> : '—'}</td>
                  <td data-label="หน่วย">{l.unit}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="doc-totals">
          <span>จำนวนรายการ <b>{doc.items.length}</b></span>
          <span>จำนวนรวม <b>{qty(totalQty)}</b></span>
        </div>
        <LedgerNote status={doc.status} hasLedger={hasLedger} missingBefore={missingBefore}
          draftText="เอกสารยังเป็นร่าง จึงยังไม่มีผลต่อสต็อก — ยอดก่อนเบิก/หลังเบิกจะเกิดขึ้นเมื่อยืนยันตัดสต็อก" />
      </ContentCard>

      <ContentCard className="doc-card no-print" title={<><History aria-hidden width={17} />ไทม์ไลน์</>}>
        <Timeline steps={[
          { label: 'สร้างร่าง', at: doc.createdAt, done: true },
          { label: 'ยืนยันและตัดสต็อก', at: doc.issuedAt, done: doc.status === 'ISSUED' || doc.status === 'REVERSED' },
          ...(doc.status === 'REVERSED' ? [{ label: 'กลับรายการ', at: null, done: true, tone: 'warn' as const }] : []),
        ]} />
      </ContentCard>

      <div className="print-only"><SignatureArea /></div>
    </div>
  </PageContainer>;
}

/** ใบปรับปรุงสต็อก AJ — พิมพ์ A4 */
export function AdjustmentPrintNote({ adjustmentNo, warehouse, rows, note }: {
  adjustmentNo: string; warehouse: string; note?: string | null;
  rows: { name: string; code: string; before: number; change: number; after: number; unit: string }[];
}) {
  return <div className="doc-sheet print-only">
    <div className="print-head"><div><strong>S2A</strong><span>ใบปรับปรุงสต็อก / STOCK ADJUSTMENT</span></div>
      <table className="print-meta"><tbody><tr><th>เลขที่</th><td>{adjustmentNo}</td><th>คลัง</th><td>{warehouse}</td></tr></tbody></table>
    </div>
    <table className="unit-table doc-lines"><thead><tr><th>สินค้า</th><th>ก่อน</th><th>เปลี่ยน</th><th>หลัง</th><th>หน่วย</th></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.code}><td><b>{r.name}</b><small>{r.code}</small></td><td>{qty(r.before)}</td><td>{r.change > 0 ? '+' : ''}{qty(r.change)}</td><td><b>{qty(r.after)}</b></td><td>{r.unit}</td></tr>)}</tbody>
    </table>
    {note && <p>หมายเหตุ: {note}</p>}
    <SignatureArea />
  </div>;
}
