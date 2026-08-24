import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle, ArrowLeftRight, ArrowRight, Boxes, Check, CheckCircle2, FileDown,
  History, Pencil, Plus, Printer, RotateCcw, Search, Trash2, Warehouse as WarehouseIcon,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PageContainer, PageHeader, ContentCard, StickySummary, KPIGrid, KPICard } from '@/components/layout/page';
import EmptyState from '@/components/ui/EmptyState';
import { STATUS_BADGE, statusInfo, statusLabel } from '@/lib/operations-vocab';
import {
  addTransferLine, buildTransferPayload, destAfter, searchTransferable, sourceAfter,
  summarizeTransfer, transferableItems, transferImpact, validateTransferLine,
  type TransferLine, type TransferMovement,
} from '@/lib/stock-transfer';
import type { StockItem } from '@/lib/issue-stock';

/**
 * PHASE 18 — โอนย้ายระหว่างคลัง
 *
 * ใบเดียว สองการเคลื่อนไหว ทั้งหมดหรือไม่เลย
 * หน้าจอจึงแสดงผลของ "ทั้งสองฝั่ง" คู่กันเสมอ ทั้งตอนกรอกและตอนดูย้อนหลัง
 *
 * ตัวเลขก่อน/หลังของเอกสารที่ยืนยันแล้วอ่านจากบัญชีเดินสต็อกเท่านั้น
 * ห้ามย้อนคำนวณจากสต็อกปัจจุบัน เพราะสต็อกเดินต่อไปหลังจากนั้นแล้ว
 */

const qty = (v: number) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const d = (v?: string | null) => (v ? new Date(v).toLocaleDateString('th-TH') : '—');
const dt = (v?: string | null) => (v ? new Date(v).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' }) : null);
const today = () => new Date().toISOString().slice(0, 10);

/** เปิด PDF ผ่าน blob เสมอ — ลิงก์ตรงจะโดน SPA fallback คืน index.html (บทเรียน PHASE 13) */
const openDocument = async (path: string) => {
  const blob = await apiClient.blob(path, 'pdf');
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener,noreferrer');
  window.setTimeout(() => URL.revokeObjectURL(url), 60000);
};

interface WarehouseOption { id: string; code: string; name: string }
interface Lookups { warehouses: WarehouseOption[]; items: StockItem[] }

interface TransferItemRow {
  id: string; itemId: string; quantity: string; lotNo: string | null;
  item?: { id: string; code: string; name: string; baseUnit?: { code: string } | null } | null;
}
interface Transfer {
  id: string; transferNo: string; status: string; transferDate: string; createdAt: string; note: string | null;
  fromWarehouseId: string; toWarehouseId: string;
  fromWarehouse?: WarehouseOption | null;
  toWarehouse?: WarehouseOption | null;
  items: TransferItemRow[];
}

function useTransferPermissions() {
  const { user } = useAuth();
  const has = (code: string) => Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes(code));
  return {
    canCreate: has('STOCK_TRANSFER_CREATE'),
    canConfirm: has('STOCK_TRANSFER_CONFIRM'),
    canReverse: has('STOCK_TRANSFER_REVERSE') || has('STOCK_TRANSFER_CONFIRM'),
  };
}

// ===================== LIST + CREATE / EDIT =====================

export function StockTransferPage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const editingId = /\/stock-transfers\/([^/]+)\/edit$/.exec(pathname)?.[1] ?? '';
  const creating = pathname.endsWith('/new') || Boolean(editingId);
  const { canCreate, canConfirm } = useTransferPermissions();

  const [lookups, setLookups] = useState<Lookups>();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<TransferLine[]>([]);
  const [pickerTerm, setPickerTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [editDoc, setEditDoc] = useState<{ transferNo: string; status: string } | null>(null);
  const [focusKey, setFocusKey] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    try {
      const [options, list] = await Promise.all([
        apiClient.get<Lookups>('/business/operations/lookups'),
        apiClient.get<{ rows: Transfer[] }>('/business/transfers'),
      ]);
      setLookups(options); setTransfers(list.rows);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลการโอนย้ายไม่สำเร็จ'); }
  };
  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (!editingId) { setEditDoc(null); return; }
    const run = async () => {
      try {
        const doc = await apiClient.get<Transfer>(`/business/transfers/${editingId}`);
        setEditDoc({ transferNo: doc.transferNo, status: doc.status });
        if (doc.status !== 'DRAFT') { setError('ใบโอนย้ายนี้ยืนยันแล้ว จึงแก้ไขไม่ได้'); return; }
        setFromWarehouseId(doc.fromWarehouseId); setToWarehouseId(doc.toWarehouseId); setNote(doc.note ?? '');
        setLines(doc.items.map((l) => ({
          key: crypto.randomUUID(), itemId: l.itemId,
          code: l.item?.code ?? '', name: l.item?.name ?? '',
          unit: l.item?.baseUnit?.code ?? '-', quantity: Number(l.quantity),
        })));
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดร่างไม่สำเร็จ'); }
    };
    void run();
  }, [editingId]);

  const transferable = useMemo(
    () => transferableItems(lookups?.items ?? [], fromWarehouseId, toWarehouseId),
    [lookups?.items, fromWarehouseId, toWarehouseId],
  );
  const pickerResults = useMemo(() => searchTransferable(transferable, pickerTerm).slice(0, 40), [transferable, pickerTerm]);
  const stockOf = (itemId: string) => transferable.find((x) => x.id === itemId);
  const availableOf = (itemId: string) => stockOf(itemId)?.sourceAvailable ?? 0;
  const summary = useMemo(() => summarizeTransfer(lines, availableOf), [lines, transferable]); // eslint-disable-line react-hooks/exhaustive-deps
  const sameWarehouse = Boolean(fromWarehouseId && fromWarehouseId === toWarehouseId);
  const warehouseName = (id: string) => lookups?.warehouses.find((w) => w.id === id)?.name ?? '—';

  // เปลี่ยนคลังฝั่งใดก็ตาม = ล้างรายการ เพื่อไม่ให้ยอดของคลังเดิมค้างมา
  const changeFrom = (id: string) => { setFromWarehouseId(id); setLines([]); setError(''); };
  const changeTo = (id: string) => { setToWarehouseId(id); setLines([]); setError(''); };

  const addItem = (itemId: string) => {
    const item = transferable.find((x) => x.id === itemId);
    if (!item) return;
    const result = addTransferLine(lines, item, () => crypto.randomUUID());
    if (!result.ok) {
      setFocusKey(result.existingKey);
      toast({ title: 'มีรายการนี้อยู่แล้ว', description: `${item.name} อยู่ในใบโอนย้ายนี้แล้ว`, variant: 'warning' });
      return;
    }
    setLines(result.lines); setPickerTerm('');
  };
  const patchLine = (key: string, quantity: number) => setLines((v) => v.map((l) => (l.key === key ? { ...l, quantity } : l)));
  const removeLine = (key: string) => setLines((v) => v.filter((l) => l.key !== key));

  const submit = async (confirm: boolean) => {
    if (busy || sameWarehouse || !fromWarehouseId || !toWarehouseId || !summary.canSubmit) return;
    setBusy(true); setError('');
    try {
      const payload = buildTransferPayload({ fromWarehouseId, toWarehouseId, note: note || undefined, confirm, lines });
      const saved = editingId
        ? await apiClient.patch<Transfer>(`/business/transfers/${editingId}`, payload)
        : await apiClient.post<Transfer>('/business/transfers', payload);
      if (editingId && confirm) await apiClient.post(`/business/transfers/${editingId}/confirm`, {});
      toast({
        title: confirm ? `ยืนยันใบโอนย้าย ${saved.transferNo} แล้ว` : `บันทึกร่าง ${saved.transferNo} แล้ว`,
        description: confirm ? 'ระบบย้ายของออกจากคลังต้นทางเข้าคลังปลายทางแล้ว' : 'ยังไม่ย้ายของ แก้ไขได้ก่อนยืนยัน',
        variant: 'success',
      });
      navigate('/stock-transfers');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'บันทึกใบโอนย้ายไม่สำเร็จ';
      setError(message);
      toast({ title: confirm ? 'ยืนยันการโอนย้ายไม่สำเร็จ' : 'บันทึกร่างไม่สำเร็จ', description: message, variant: 'error' });
    } finally { setBusy(false); }
  };

  if (creating) return <PageContainer size="wide" className="ops-page issue-create issue-workspace transfer-workspace">
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title={editDoc ? `แก้ไขใบโอนย้าย ${editDoc.transferNo}` : 'สร้างใบโอนย้ายระหว่างคลัง'}
      description="ย้ายของจากคลังหนึ่งไปอีกคลังหนึ่ง — ใบเดียวกันจะตัดต้นทางและเพิ่มปลายทางพร้อมกัน"
      badge={<span className={`badge ${STATUS_BADGE[statusInfo('transfer', editDoc?.status ?? 'DRAFT').tone]}`}>{statusLabel('transfer', editDoc?.status ?? 'DRAFT')}</span>}
      actions={<Link className="btn" to="/stock-transfers">กลับหน้ารายการ</Link>}
    />
    {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

    <div className="ops-workspace">
      <div className="ops-workspace-main">
        <ContentCard title="ข้อมูลใบโอนย้าย" description="เลขที่ใบโอนย้ายออกโดยระบบเมื่อบันทึก">
          <div className="ops-field-grid">
            <label>เลขที่ใบโอนย้าย
              <input value={editDoc?.transferNo || 'ระบบออกเลขให้อัตโนมัติ (TR-…)'} readOnly disabled />
            </label>
            <label>วันที่<input type="date" defaultValue={today()} readOnly /></label>
            <label>คลังต้นทาง *
              <select value={fromWarehouseId} onChange={(e) => changeFrom(e.target.value)} required>
                <option value="">เลือกคลังต้นทาง</option>
                {lookups?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <label>คลังปลายทาง *
              <select value={toWarehouseId} onChange={(e) => changeTo(e.target.value)} required>
                <option value="">เลือกคลังปลายทาง</option>
                {lookups?.warehouses.filter((w) => w.id !== fromWarehouseId).map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <label className="wide">หมายเหตุ<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เหตุผลการโอนย้ายหรือเอกสารอ้างอิง" /></label>
          </div>
          {sameWarehouse && <p className="issue-row-error" role="alert">
            <AlertTriangle aria-hidden width={14} />คลังต้นทางและคลังปลายทางต้องไม่ใช่คลังเดียวกัน
          </p>}
        </ContentCard>

        <ContentCard title="เลือกสินค้าที่จะโอนย้าย" description="แสดงเฉพาะสินค้าที่มีของพร้อมใช้ในคลังต้นทาง">
          {(!fromWarehouseId || !toWarehouseId) && <div className="issue-hint">
            <AlertTriangle /><span>เลือกคลังต้นทางและคลังปลายทางก่อน เพื่อโหลดสินค้าที่ย้ายได้จริง</span>
          </div>}

          {fromWarehouseId && toWarehouseId && !sameWarehouse && transferable.length === 0 && <div className="business-empty">
            <Boxes /><h2>คลังต้นทางยังไม่มีสินค้าพร้อมโอนย้าย</h2>
            <p>ต้องมีของในคลังต้นทางก่อน จึงจะย้ายไปคลังอื่นได้</p>
            <Link to="/receiving/new">+ ไปหน้ารับของเข้า</Link>
          </div>}

          {fromWarehouseId && toWarehouseId && !sameWarehouse && transferable.length > 0 && <>
            <div className="issue-picker">
              <div className="issue-picker-search">
                <Search />
                <input value={pickerTerm} onChange={(e) => setPickerTerm(e.target.value)} placeholder="ค้นหาด้วยรหัสหรือชื่อสินค้า" aria-label="ค้นหาสินค้า" />
              </div>
              <div className="issue-picker-list">
                {pickerResults.map((item) => {
                  const added = lines.some((l) => l.itemId === item.id);
                  return <button type="button" key={item.id} className={`issue-pick${added ? ' is-added' : ''}`}
                    aria-pressed={added} onClick={() => addItem(item.id)}>
                    <span className="ip-main">
                      <strong>{item.code} · {item.name}</strong>
                      <small>{item.type === 'PACKAGING' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}</small>
                    </span>
                    <span className="ip-stock">
                      <b className="ip-avail">{qty(item.sourceAvailable)} {item.unit}</b>
                      <small>พร้อมใช้ที่ต้นทาง · ปลายทางมีอยู่ {qty(item.destOnHand)}</small>
                    </span>
                    <span className="ip-add">{added ? <><Check aria-hidden width={15} />เพิ่มแล้ว</> : <><Plus aria-hidden width={15} />เพิ่มรายการ</>}</span>
                  </button>;
                })}
                {pickerResults.length === 0 && <p className="issue-none">
                  {pickerTerm ? `ไม่พบสินค้าที่ตรงกับ “${pickerTerm}” ในคลังต้นทาง` : 'ไม่พบสินค้าที่ค้นหาในคลังต้นทาง'}
                </p>}
              </div>
            </div>

            <div className="issue-grid transfer-grid">
              <div className="issue-head">
                <span>สินค้า</span><span>ต้นทางพร้อมใช้</span><span>ปลายทางคงเหลือ</span><span>จำนวนที่โอน</span><span>หน่วย</span><span aria-label="ลบ" />
              </div>
              {lines.map((line) => {
                const s = stockOf(line.itemId);
                const avail = s?.sourceAvailable ?? 0;
                const destOnHand = s?.destOnHand ?? 0;
                const outAfter = sourceAfter(avail, line.quantity);
                const inAfter = destAfter(destOnHand, line.quantity);
                const issue = validateTransferLine(line.quantity, avail);
                return <div className={`issue-row${issue === 'OVER_AVAILABLE' ? ' short' : ''}${focusKey === line.key ? ' focus' : ''}`} key={line.key}>
                  <strong data-label="สินค้า">{line.name}<small>{line.code}</small></strong>
                  <span data-label="ต้นทางพร้อมใช้">{qty(avail)}</span>
                  <span data-label="ปลายทางคงเหลือ">{qty(destOnHand)}</span>
                  <input data-label="จำนวนที่โอน" type="number" min="0" step="0.0001" value={line.quantity}
                    aria-label={`จำนวนที่โอน ${line.name}`}
                    onChange={(e) => patchLine(line.key, Number(e.target.value))} />
                  <span data-label="หน่วย">{line.unit}</span>
                  <button type="button" className="icon-btn" onClick={() => removeLine(line.key)} aria-label={`ลบ ${line.name}`}><Trash2 /></button>

                  {/* สมการสองฝั่ง อ่านเป็นประโยค — ต้นทางลดเท่าไร ปลายทางเพิ่มเท่านั้นพอดี */}
                  <p className="issue-eq transfer-eq" data-label="ต้นทาง">
                    <span className="eq-side">ต้นทาง</span>
                    <span className="num">{qty(avail)} {line.unit}</span>
                    <b aria-hidden> − </b><span className="sr-sep">ลบ</span>
                    <span className="num">{qty(line.quantity)} {line.unit}</span>
                    <b aria-hidden> = </b><span className="sr-sep">เท่ากับ</span>
                    <strong className={`num ${outAfter < 0 ? 'is-short' : ''}`}>{qty(outAfter)} {line.unit}</strong>
                  </p>
                  <p className="issue-eq transfer-eq" data-label="ปลายทาง">
                    <span className="eq-side">ปลายทาง</span>
                    <span className="num">{qty(destOnHand)} {line.unit}</span>
                    <b aria-hidden> + </b><span className="sr-sep">บวก</span>
                    <span className="num">{qty(line.quantity)} {line.unit}</span>
                    <b aria-hidden> = </b><span className="sr-sep">เท่ากับ</span>
                    <strong className="num">{qty(inAfter)} {line.unit}</strong>
                  </p>

                  {issue === 'OVER_AVAILABLE' && <p className="issue-row-error" role="alert">
                    <AlertTriangle aria-hidden width={14} />จำนวนที่โอนเกินของที่พร้อมใช้ในคลังต้นทาง {qty(Number(line.quantity || 0) - avail)} {line.unit}
                  </p>}
                </div>;
              })}
              {lines.length === 0 && <p className="issue-none">ยังไม่มีรายการ — ค้นหาแล้วกด “เพิ่มรายการ” ด้านบน</p>}
            </div>
          </>}
        </ContentCard>
      </div>

      <StickySummary className="ops-summary-panel">
        <div className="ops-sum">
          <h2><ArrowLeftRight aria-hidden />สรุปใบโอนย้าย</h2>
          <dl>
            <div><dt>สถานะ</dt><dd>{statusLabel('transfer', editDoc?.status ?? 'DRAFT')}</dd></div>
            <div><dt>เลขที่</dt><dd>{editDoc?.transferNo || 'ออกให้เมื่อบันทึก'}</dd></div>
            <div><dt>จาก</dt><dd>{fromWarehouseId ? warehouseName(fromWarehouseId) : '—'}</dd></div>
            <div><dt>ไปยัง</dt><dd>{toWarehouseId ? warehouseName(toWarehouseId) : '—'}</dd></div>
            <div><dt>จำนวนรายการ</dt><dd>{summary.lineCount}</dd></div>
            <div><dt>ของไม่พอ</dt><dd className={summary.insufficientCount ? 'danger' : ''}>{summary.insufficientCount}</dd></div>
            <div className="total"><dt>จำนวนรวมที่โอน</dt><dd>{qty(summary.totalQty)}</dd></div>
          </dl>
          {summary.insufficientCount > 0 && <p className="ops-sum-warn"><AlertTriangle aria-hidden width={15} />มีรายการที่โอนเกินของที่พร้อมใช้ — แก้ไขก่อนยืนยัน</p>}
          {summary.emptyQtyCount > 0 && <p className="ops-sum-warn"><AlertTriangle aria-hidden width={15} />มี {summary.emptyQtyCount} รายการที่ยังไม่ได้ใส่จำนวน</p>}
          <p className="ops-sum-note"><CheckCircle2 aria-hidden width={15} />“บันทึกร่าง” ยังไม่ย้ายของ · “ยืนยัน” จะตัดต้นทางและเพิ่มปลายทางพร้อมกันในรายการเดียว</p>
          <div className="ops-sum-actions">
            {canCreate && <button type="button" className="btn" disabled={busy || sameWarehouse || !summary.canSubmit} onClick={() => void submit(false)}>บันทึกร่าง</button>}
            {canConfirm && <button type="button" className="btn primary" disabled={busy || sameWarehouse || !summary.canSubmit} onClick={() => setConfirmOpen(true)}>
              <ArrowRight aria-hidden />{busy ? 'กำลังบันทึก…' : 'ยืนยันและย้ายของ'}
            </button>}
          </div>
        </div>
      </StickySummary>
    </div>

    <ConfirmDialog
      open={confirmOpen}
      title="ยืนยันการโอนย้ายระหว่างคลัง"
      confirmLabel="ยืนยันและย้ายของ"
      onClose={() => setConfirmOpen(false)}
      onConfirm={() => void submit(true)}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{editDoc?.transferNo || 'ระบบออกเลข TR ให้อัตโนมัติ'}</dd></div>
          <div><dt>คลังต้นทาง</dt><dd>{warehouseName(fromWarehouseId)}</dd></div>
          <div><dt>คลังปลายทาง</dt><dd>{warehouseName(toWarehouseId)}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{summary.lineCount} รายการ</dd></div>
          <div><dt>จำนวนรวม</dt><dd>{qty(summary.totalQty)}</dd></div>
        </dl>
        <p className="op-confirm-impact"><ArrowLeftRight aria-hidden width={15} />เมื่อยืนยัน ระบบจะ<b>ตัดของออกจากคลังต้นทางและเพิ่มเข้าคลังปลายทางพร้อมกัน</b> — ไม่มีกรณีที่ทำสำเร็จเพียงฝั่งเดียว</p>
      </div>}
    />
  </PageContainer>;

  const visible = statusFilter ? transfers.filter((t) => t.status === statusFilter) : transfers;

  return <PageContainer size="wide" className="ops-page">
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title="โอนย้ายระหว่างคลัง"
      description="ย้ายของระหว่างคลังของบริษัท พร้อมบันทึกบัญชีเดินสต็อกทั้งสองฝั่ง"
      actions={canCreate ? <Link className="btn primary" to="/stock-transfers/new"><Plus aria-hidden width={16} />สร้างใบโอนย้าย</Link> : undefined}
    />

    <KPIGrid columns={4}>
      <KPICard label="ใบโอนย้ายทั้งหมด" value={transfers.length} icon={<ArrowLeftRight />} hint="เอกสารในระบบ" />
      <KPICard label="โอนย้ายวันนี้" value={transfers.filter((t) => t.transferDate.slice(0, 10) === today()).length} icon={<CheckCircle2 />} hint="ใบที่ลงวันที่วันนี้" />
      <KPICard label="รายการที่ย้ายแล้ว" value={transfers.filter((t) => t.status === 'CONFIRMED').flatMap((t) => t.items).length} icon={<Boxes />} hint="บรรทัดสินค้าที่ย้ายแล้ว" />
      <KPICard label="ร่างรอยืนยัน" value={transfers.filter((t) => t.status === 'DRAFT').length} icon={<AlertTriangle />}
        tone={transfers.some((t) => t.status === 'DRAFT') ? 'warning' : 'default'} hint="ยังไม่ย้ายของ" />
    </KPIGrid>

    <ContentCard
      title="รายการใบโอนย้าย"
      description={`${visible.length} ใบ`}
      padded={false}
      actions={<label className="ops-filter">สถานะ
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="กรองตามสถานะ">
          <option value="">ทั้งหมด</option>
          <option value="DRAFT">ร่าง</option>
          <option value="CONFIRMED">โอนย้ายแล้ว</option>
          <option value="REVERSED">กลับรายการแล้ว</option>
        </select>
      </label>}
    >
      {!visible.length
        ? <EmptyState icon={ArrowLeftRight} title="ยังไม่มีใบโอนย้าย"
            description="สร้างใบโอนย้ายเพื่อย้ายของระหว่างคลัง"
            action={canCreate ? <Link to="/stock-transfers/new" className="btn primary">สร้างใบโอนย้าย</Link> : undefined} />
        : <div className="table-wrap"><table className="data-table ops-table">
            <thead><tr>
              <th>เลขที่</th><th>วันที่</th><th>จาก</th><th>ไปยัง</th>
              <th className="num">รายการ</th><th>สถานะ</th><th>เอกสาร</th>
            </tr></thead>
            <tbody>
              {visible.map((t) => {
                const st = statusInfo('transfer', t.status);
                return <tr key={t.id}>
                  <td data-label="เลขที่"><Link to={`/stock-transfers/${t.id}`} className="ops-doc-link">{t.transferNo}</Link></td>
                  <td data-label="วันที่">{d(t.transferDate)}</td>
                  <td data-label="จาก">{t.fromWarehouse?.name ?? '—'}</td>
                  <td data-label="ไปยัง">{t.toWarehouse?.name ?? '—'}</td>
                  <td className="num" data-label="รายการ">{t.items.length}</td>
                  <td data-label="สถานะ"><span className={`badge ${STATUS_BADGE[st.tone]}`}>{st.label}</span></td>
                  <td data-label="เอกสาร">
                    {t.status === 'DRAFT'
                      ? <span className="subtle">ยังเป็นร่าง</span>
                      : <button type="button" className="btn" onClick={() => void openDocument(`/business/documents/STOCK_TRANSFER_SLIP/${t.id}.pdf`)}><FileDown aria-hidden width={15} />PDF</button>}
                  </td>
                </tr>;
              })}
            </tbody>
          </table></div>}
    </ContentCard>
  </PageContainer>;
}

// ===================== DETAIL =====================

export function StockTransferDetailPage() {
  const { id } = useParams();
  const { toast } = useToast();
  const { canConfirm, canReverse } = useTransferPermissions();

  const [doc, setDoc] = useState<Transfer>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<'confirm' | 'reverse' | null>(null);
  const [movements, setMovements] = useState<TransferMovement[]>([]);

  const load = async () => {
    try { setDoc(await apiClient.get<Transfer>(`/business/transfers/${id}`)); }
    catch (e) { setError(e instanceof Error ? e.message : 'โหลดเอกสารไม่สำเร็จ'); }
  };
  useEffect(() => { void load(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!id) return;
    void apiClient.get<TransferMovement[]>(`/business/stock-movements?refId=${id}&take=200`).then(setMovements).catch(() => setMovements([]));
  }, [id, doc?.status]);

  const act = async (action: 'confirm' | 'reverse') => {
    if (busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/business/transfers/${id}/${action}`, {});
      toast({ title: action === 'confirm' ? 'ยืนยันและย้ายของแล้ว' : 'กลับรายการแล้ว', variant: 'success' });
      setPending(null);
      await load();
    } catch (e) { toast({ title: 'ทำรายการไม่สำเร็จ', description: e instanceof Error ? e.message : '', variant: 'error' }); }
    finally { setBusy(false); }
  };

  if (error) return <PageContainer className="ops-page"><div className="auth-alert">{error}</div><Link to="/stock-transfers" className="btn">กลับหน้ารายการ</Link></PageContainer>;
  if (!doc) return <PageContainer className="ops-page"><p className="issue-none">กำลังโหลดเอกสาร…</p></PageContainer>;

  const st = statusInfo('transfer', doc.status);
  const totalQty = doc.items.reduce((s, i) => s + Number(i.quantity), 0);
  const fromCode = doc.fromWarehouse?.code ?? '';
  const toCode = doc.toWarehouse?.code ?? '';
  const hasLedger = movements.length > 0;

  return <PageContainer className="ops-page doc-detail">
    <PageHeader
      className="no-print"
      breadcrumb={<><Link to="/stock-transfers">ใบโอนย้าย</Link><span> · </span><span>รายละเอียด</span></>}
      title={doc.transferNo}
      badge={<span className={`badge ${STATUS_BADGE[st.tone]}`}>{st.label}</span>}
      description={`ย้ายจาก ${doc.fromWarehouse?.name ?? '—'} ไป ${doc.toWarehouse?.name ?? '—'}`}
      meta={<>
        <span>วันที่ {d(doc.transferDate)}</span>
        <span>{doc.items.length} รายการ</span>
        <span>รวม {qty(totalQty)}</span>
      </>}
      actions={<>
        <Link to="/stock-transfers" className="btn">กลับหน้ารายการ</Link>
        <Link to={`/inventory/movements?ref=${encodeURIComponent(doc.transferNo)}`} className="btn"><History aria-hidden width={16} />ดูการเคลื่อนไหว</Link>
        {doc.status === 'DRAFT' && <Link to={`/stock-transfers/${doc.id}/edit`} className="btn"><Pencil aria-hidden width={16} />แก้ไข</Link>}
        {doc.status !== 'DRAFT' && <>
          <button type="button" className="btn" onClick={() => window.print()}><Printer aria-hidden width={16} />พิมพ์</button>
          <button type="button" className="btn" onClick={() => void openDocument(`/business/documents/STOCK_TRANSFER_SLIP/${doc.id}.pdf`)}><FileDown aria-hidden width={16} />PDF</button>
        </>}
        {doc.status === 'DRAFT' && (canConfirm
          ? <button type="button" className="btn primary" disabled={busy} onClick={() => setPending('confirm')}><ArrowRight aria-hidden width={16} />ยืนยันและย้ายของ</button>
          : <span className="perm-hint"><AlertTriangle aria-hidden width={14} />รายการนี้ต้องให้ผู้มีสิทธิ์ยืนยัน</span>)}
        {doc.status === 'CONFIRMED' && canReverse && <button type="button" className="btn danger-btn" disabled={busy} onClick={() => setPending('reverse')}><RotateCcw aria-hidden width={16} />กลับรายการ</button>}
      </>}
    />

    <ConfirmDialog
      open={pending === 'confirm'}
      title="ยืนยันการโอนย้ายระหว่างคลัง"
      confirmLabel="ยืนยันและย้ายของ"
      onClose={() => setPending(null)}
      onConfirm={() => void act('confirm')}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{doc.transferNo}</dd></div>
          <div><dt>คลังต้นทาง</dt><dd>{doc.fromWarehouse?.name ?? '—'}</dd></div>
          <div><dt>คลังปลายทาง</dt><dd>{doc.toWarehouse?.name ?? '—'}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{doc.items.length} รายการ</dd></div>
        </dl>
        <p className="op-confirm-impact"><ArrowLeftRight aria-hidden width={15} />ระบบจะ<b>ตัดต้นทางและเพิ่มปลายทางพร้อมกัน</b> และแก้ไขเอกสารโดยตรงไม่ได้อีก</p>
      </div>}
    />
    <ConfirmDialog
      open={pending === 'reverse'}
      title="กลับรายการใบโอนย้าย"
      confirmLabel="กลับรายการ"
      tone="danger"
      onClose={() => setPending(null)}
      onConfirm={() => void act('reverse')}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{doc.transferNo}</dd></div>
          <div><dt>คืนกลับไปที่</dt><dd>{doc.fromWarehouse?.name ?? '—'}</dd></div>
          <div><dt>หักออกจาก</dt><dd>{doc.toWarehouse?.name ?? '—'}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{doc.items.length} รายการ</dd></div>
        </dl>
        <p className="op-confirm-impact"><RotateCcw aria-hidden width={15} />ระบบจะสร้าง<b>รายการตรงข้ามทั้งสองฝั่ง</b> โดย<b>ไม่ลบประวัติเดิม</b> — ถ้าปลายทางมีของไม่พอจะคืน ระบบจะปฏิเสธและไม่ทำให้ยอดติดลบ</p>
      </div>}
    />

    <div className="doc-sheet">
      <div className="print-only print-head">
        <div><strong>ใบโอนย้ายระหว่างคลัง / STOCK TRANSFER</strong></div>
        <table className="print-meta"><tbody>
          <tr><th>เลขที่</th><td>{doc.transferNo}</td><th>วันที่</th><td>{d(doc.transferDate)}</td></tr>
          <tr><th>คลังต้นทาง</th><td>{doc.fromWarehouse?.name ?? '—'}</td><th>คลังปลายทาง</th><td>{doc.toWarehouse?.name ?? '—'}</td></tr>
        </tbody></table>
      </div>

      <ContentCard className="doc-card no-print" title={<><WarehouseIcon aria-hidden width={17} />ข้อมูลเอกสาร</>}>
        <dl className="doc-grid">
          <div><dt>วันที่</dt><dd>{d(doc.transferDate)}</dd></div>
          <div><dt>คลังต้นทาง</dt><dd>{doc.fromWarehouse?.name ?? '—'}</dd></div>
          <div><dt>คลังปลายทาง</dt><dd>{doc.toWarehouse?.name ?? '—'}</dd></div>
          <div><dt>สถานะ</dt><dd><span className={`badge ${STATUS_BADGE[st.tone]}`}>{st.label}</span></dd></div>
          <div className="wide"><dt>หมายเหตุ</dt><dd>{doc.note || '—'}</dd></div>
        </dl>
      </ContentCard>

      <ContentCard className="doc-card" title={<span className="no-print"><ArrowLeftRight aria-hidden width={17} />รายการที่โอนย้าย</span>} padded={false}>
        <div className="table-wrap">
          <table className="unit-table doc-lines transfer-lines">
            <thead><tr>
              <th>สินค้า</th><th>จำนวน</th><th>หน่วย</th>
              <th>ต้นทาง ก่อน → หลัง</th><th>ปลายทาง ก่อน → หลัง</th>
            </tr></thead>
            <tbody>
              {doc.items.map((l) => {
                const code = l.item?.code ?? '';
                const out = transferImpact(movements, code, fromCode);
                const into = transferImpact(movements, code, toCode);
                return <tr key={l.id}>
                  <td data-label="สินค้า"><b>{l.item?.name ?? l.itemId}</b><small>{code}</small></td>
                  <td data-label="จำนวน">{qty(Number(l.quantity))}</td>
                  <td data-label="หน่วย">{l.item?.baseUnit?.code ?? '—'}</td>
                  <td data-label="ต้นทาง ก่อน → หลัง">
                    {out ? <>{out.before != null ? qty(out.before) : '—'} <b aria-hidden>→</b> <b>{qty(out.after)}</b></> : '—'}
                  </td>
                  <td data-label="ปลายทาง ก่อน → หลัง">
                    {into ? <>{into.before != null ? qty(into.before) : '—'} <b aria-hidden>→</b> <b>{qty(into.after)}</b></> : '—'}
                  </td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        <div className="doc-totals">
          <span>จำนวนรายการ <b>{doc.items.length}</b></span>
          <span>จำนวนรวม <b>{qty(totalQty)}</b></span>
        </div>
        {/* ยอดก่อน/หลังมาจากบัญชีเดินสต็อกเท่านั้น ไม่ย้อนคำนวณจากสต็อกปัจจุบัน */}
        {doc.status === 'DRAFT' && <p className="doc-note no-print"><AlertTriangle aria-hidden width={14} />เอกสารยังเป็นร่าง จึงยังไม่มีผลต่อสต็อก — ยอดก่อน/หลังทั้งสองฝั่งจะเกิดขึ้นเมื่อยืนยัน</p>}
        {doc.status !== 'DRAFT' && !hasLedger && <p className="doc-note no-print"><AlertTriangle aria-hidden width={14} />เอกสารนี้ไม่มีบัญชีเดินสต็อกเก็บไว้ ระบบจึงแสดง “—” และไม่คำนวณย้อนหลังจากสต็อกปัจจุบัน</p>}
      </ContentCard>

      <ContentCard className="doc-card no-print" title={<><History aria-hidden width={17} />ไทม์ไลน์</>}>
        <ol className="doc-timeline">
          <li className="done"><span className="tl-dot" aria-hidden /><div><strong>สร้างร่าง</strong><small>{dt(doc.createdAt) ?? 'ไม่มีเวลาบันทึกไว้'}</small></div></li>
          <li className={doc.status === 'CONFIRMED' || doc.status === 'REVERSED' ? 'done' : 'pending'}>
            <span className="tl-dot" aria-hidden />
            <div><strong>ยืนยันและย้ายของ</strong>
              {doc.status === 'CONFIRMED' || doc.status === 'REVERSED'
                ? <small>{dt(movements.find((m) => m.reason !== 'REVERSAL') ? doc.transferDate : null) ?? 'อ้างอิงจากบัญชีเดินสต็อก'}</small>
                : <small className="tl-pending">ยังไม่เกิดขึ้น</small>}
            </div>
          </li>
          {doc.status === 'REVERSED' && <li className="done warn"><span className="tl-dot" aria-hidden /><div><strong>กลับรายการ</strong><small>ไม่มีเวลาบันทึกไว้</small></div></li>}
        </ol>
      </ContentCard>
    </div>
  </PageContainer>;
}
