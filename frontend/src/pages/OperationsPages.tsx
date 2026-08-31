import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, Check, CheckCircle2, ClipboardCheck, FileDown, PackageCheck, Plus, Search, ShoppingCart, Trash2, Truck, Warehouse } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/i18n';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard, StickySummary } from '@/components/layout/page';
import { STATUS_BADGE, statusInfo, statusLabel } from '@/lib/operations-vocab';
import { conversionPreview, receiptTotals } from '@/lib/receiving-preview';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import CreatableCombobox from '@/components/ui/CreatableCombobox';
import MasterModal from '@/components/ui/MasterModal';
import { masterConflictMessage } from '@/lib/master-validation';
import { addIssueLine, afterIssue, buildIssuePayload, issuableItems, searchIssuable, summarize, validateLine, type IssuableItem, type IssueLine } from '@/lib/issue-stock';
import { useMasterDataRefresh } from '@/hooks/useMasterDataRefresh';

type UnitOption = { id: string; code: string; name: string; isActive: boolean };
type CreateState = { kind: 'warehouse' | 'supplier' | 'item'; prefill: string; lineKey?: string };

/** Modal สร้าง master data ใหม่จากหน้ารับของ (คลัง/ซัพพลายเออร์/สินค้า) — persist + auto-select */
function MasterCreateModal({ state, units, onClose, onCreated }: {
  state: CreateState; units: UnitOption[];
  onClose: () => void;
  onCreated: (kind: CreateState['kind'], created: { id: string; code: string; name: string }, lineKey?: string) => void;
}) {
  const { messages } = useI18n(); const t = messages.receiving; const { toast } = useToast();
  const [name, setName] = useState(state.prefill);
  const [code, setCode] = useState('');
  const [phone, setPhone] = useState(''); const [taxId, setTaxId] = useState('');
  const [type, setType] = useState<'RAW_MATERIAL' | 'PACKAGING'>('RAW_MATERIAL');
  const [baseUnitId, setBaseUnitId] = useState(units[0]?.id ?? '');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const titleMap = { warehouse: t.addWarehouse, supplier: t.addSupplier, item: t.addItem };

  const save = async () => {
    if (!name.trim()) { setError(t.nameRequired); return; }
    setSaving(true); setError('');
    try {
      let created: { id: string; code: string; name: string };
      if (state.kind === 'warehouse') {
        created = await apiClient.post('/business/warehouses', { name: name.trim(), code: code.trim() || undefined });
        toast({ title: t.warehouseCreated, variant: 'success' });
      } else if (state.kind === 'supplier') {
        created = await apiClient.post('/business/suppliers', { name: name.trim(), code: code.trim() || undefined, phone: phone || undefined, taxId: taxId || undefined });
        toast({ title: t.supplierCreated, variant: 'success' });
      } else {
        created = await apiClient.post('/business/receiving-items', { name: name.trim(), code: code.trim() || undefined, type, baseUnitId });
        toast({ title: t.itemCreated, variant: 'success' });
      }
      onCreated(state.kind, created, state.lineKey);
    } catch (e) { setError(masterConflictMessage(e, state.kind === 'item' ? 'item' : state.kind)); setSaving(false); }
  };

  return (
    <MasterModal
      open
      title={titleMap[state.kind]}
      description={state.kind === 'item'
        ? 'สร้างรายการขั้นต่ำเพื่อรับของต่อได้ทันที — ราคาและอัตราแปลงหน่วยตั้งเพิ่มได้ที่หน้าวัตถุดิบ'
        : 'เพิ่มแล้วระบบจะเลือกกลับเข้าเอกสารที่กำลังทำอยู่ให้ทันที'}
      error={error}
      busy={saving}
      confirmLabel={saving ? t.saving : messages.common.save}
      confirmIcon={<Plus aria-hidden width={16} />}
      cancelLabel={messages.common.cancel}
      confirmDisabled={state.kind === 'item' && !baseUnitId}
      onClose={onClose}
      onConfirm={() => void save()}
    >
      <div className="md-fields">
        <label className="full">{t.name} *
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && state.kind !== 'item') { e.preventDefault(); void save(); } }} />
        </label>
        <label className="full">{t.code}
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="(เว้นว่างให้ระบบออกให้)" />
        </label>
        {state.kind === 'supplier' && <>
          <label>{t.phone}<input value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
          <label>{t.taxId}<input value={taxId} onChange={(e) => setTaxId(e.target.value)} /></label>
        </>}
        {state.kind === 'item' && <>
          <label>{t.type}
            <select value={type} onChange={(e) => setType(e.target.value as 'RAW_MATERIAL' | 'PACKAGING')}>
              <option value="RAW_MATERIAL">{t.ingredient}</option>
              <option value="PACKAGING">{t.packaging}</option>
            </select>
          </label>
          <label>{t.baseUnit} *
            <select value={baseUnitId} onChange={(e) => setBaseUnitId(e.target.value)}>
              {units.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
            </select>
          </label>
          <p className="md-hint full">หน่วยฐานคือหน่วยที่ระบบใช้คิดต้นทุนและตัดสต็อกของรายการนี้</p>
        </>}
      </div>
    </MasterModal>
  );
}

type WarehouseOption = { id: string; code: string; name: string };
type Supplier = { id: string; code: string; name: string };
type Stock = { warehouseId: string; onHand: string; reserved: string };
type Item = { id: string; code: string; name: string; type: string; imageUrl?: string; lastCost: string; purchaseToBaseFactor: string; isLotTracked?:boolean; isExpiryTracked?:boolean; baseUnit: { code: string; name: string }; purchaseUnit?: { code: string; name: string }; stockBalances: Stock[] };
type Order = { id: string; orderNo: string; deliveryDate: string; deliveryTime?: string; status: string; customer: { name: string }; items: { menuNameSnapshot: string; quantity: string }[] };
type Lookups = { warehouses: WarehouseOption[]; suppliers: Supplier[]; items: Item[]; orders: Order[] };
type Receipt = { id: string; receiptNo: string; receiptDate: string; status: string; createdById?: string; supplier?: { name: string }; warehouse: { name: string }; items: { id: string; quantity: string; unitPrice: string; totalCost: string; lotNo?: string; expiryDate?: string; item: { name: string; code: string } }[] };
type Issue = { id: string; issueNo: string; issueDate: string; issuedAt?: string; status: string; order?: { orderNo: string; customer: { name: string } }; createdBy: { fullName: string }; items: { id: string; issuedQty: string; unit: string }[] };
type ReceiptLine = { key: string; itemId: string; purchaseOrderItemId?: string; quantity: number; unitPrice: number; lotNo: string; manufactureDate: string; expiryDate: string; orderedQty?: number; previouslyReceivedQty?: number; remainingQty?: number; purchaseUnitCode?: string };

const qtyText = (v: number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
const costText = (v: number) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 4 });
const money = (value: number | string) => `฿${Number(value).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const freshReceiptLine = (): ReceiptLine => ({ key: crypto.randomUUID(), itemId: '', quantity: 1, unitPrice: 0, lotNo: '', manufactureDate: '', expiryDate: '' });
const openDocument = async (path:string) => { const blob=await apiClient.blob(path, 'pdf'); const url=URL.createObjectURL(blob); window.open(url,'_blank','noopener,noreferrer'); window.setTimeout(()=>URL.revokeObjectURL(url),60000); };

export function ReceivingPage() {
  const {toast}=useToast();
  const { user } = useAuth(); const { messages } = useI18n(); const rt = messages.receiving;
  const canCreate = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('RECEIVING_CREATE'));
  const navigate = useNavigate(); const { pathname, search } = useLocation();
  const requestedPurchaseOrderId = new URLSearchParams(search).get('purchaseOrderId') ?? '';
  const editingId = /\/receiving\/([^/]+)\/edit$/.exec(pathname)?.[1] ?? '';
  const creating = pathname.endsWith('/new') || Boolean(editingId);
  const [receipts, setReceipts] = useState<Receipt[]>([]); const [lookups, setLookups] = useState<Lookups>(); const [units, setUnits] = useState<UnitOption[]>([]); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState(''); const [toDate, setToDate] = useState('');
  const [supplierFilter, setSupplierFilter] = useState(''); const [warehouseFilter, setWarehouseFilter] = useState(''); const [statusFilter, setStatusFilter] = useState('');
  const canCreateReceipt = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('RECEIVING_CREATE'));
  const canConfirmReceipt = Boolean(user?.roles.includes('SUPER_ADMIN') || ['RECEIVING_CONFIRM', 'RECEIVING_CREATE'].some((pm) => user?.permissions.includes(pm)));

  /** filter ปัจจุบัน → query string ใช้ทั้งการโหลดรายการและการส่งออก Excel (ผลลัพธ์ตรงกันเสมอ) */
  const filterQuery = () => {
    const p = new URLSearchParams();
    if (fromDate) p.set('from', fromDate);
    if (toDate) p.set('to', toDate);
    if (supplierFilter) p.set('supplierId', supplierFilter);
    if (warehouseFilter) p.set('warehouseId', warehouseFilter);
    if (statusFilter) p.set('status', statusFilter);
    if (query.trim()) p.set('keyword', query.trim());
    return p.toString();
  };

  /**
   * ส่งออกทั้งผลลัพธ์ตาม filter (ไม่ใช่เฉพาะหน้าที่เห็น) — backend สร้าง .xlsx
   * ใช้ apiClient.download เพื่อให้ยิงผ่าน BASE_URL เดียวกับ API อื่น
   * และตรวจ content-type ก่อนบันทึก (เดิมบันทึก index.html เป็น .xlsx ได้)
   */
  const exportExcel = async () => {
    try {
      const file = await apiClient.download(`/business/receiving/export.xlsx?${filterQuery()}`,
        { expect: 'xlsx', fallbackName: 'receiving.xlsx' });
      toast({ title: 'ส่งออก Excel แล้ว', description: `${file.name} · รวมทุกผลลัพธ์ตามตัวกรองที่เลือก`, variant: 'success' });
    } catch (reason) { toast({ title: 'ส่งออก Excel ไม่สำเร็จ', description: reason instanceof Error ? reason.message : '', variant: 'error' }); }
  };
  const [lines, setLines] = useState<ReceiptLine[]>([freshReceiptLine()]);
  const [warehouseId, setWarehouseId] = useState(''); const [supplierId, setSupplierId] = useState('');
  const [purchaseOrderId, setPurchaseOrderId] = useState(''); const [purchaseOrderNo, setPurchaseOrderNo] = useState('');
  const [create, setCreate] = useState<CreateState | null>(null);
  const load = async () => { try { const [history, options, unitList] = await Promise.all([apiClient.get<Receipt[]>(`/business/receiving?${filterQuery()}`), apiClient.get<Lookups>('/business/operations/lookups'), apiClient.get<UnitOption[]>('/units')]); setReceipts(history); setLookups(options); setUnits(unitList.filter((u) => u.isActive)); } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลงานรับของไม่สำเร็จ'); } };
  // โหลดใหม่เมื่อ filter เปลี่ยน (debounce คำค้นเล็กน้อยเพื่อไม่ยิงทุกตัวอักษร)
  useEffect(() => {
    const timer = setTimeout(() => { void load(); }, query ? 300 : 0);
    return () => clearTimeout(timer);
  }, [fromDate, toDate, supplierFilter, warehouseFilter, statusFilter, query]); // eslint-disable-line react-hooks/exhaustive-deps
  // ผู้จำหน่าย/คลังถูกแก้หรือปิดใช้งานจากหน้า master → โหลด lookups ใหม่
  useMasterDataRefresh(load);

  useEffect(() => {
    if (!requestedPurchaseOrderId || editingId) return;
    void apiClient.get<{purchaseOrderId:string;poNo:string;supplierId:string;warehouseId:string;items:{itemId:string;purchaseOrderItemId:string;quantity:number;unitPrice:number;purchaseUnitCode:string;orderedQty:number;previouslyReceivedQty:number;remainingQty:number}[]}>(`/business/purchase-orders/${requestedPurchaseOrderId}/receiving-prefill`).then((prefill) => {
      setPurchaseOrderId(prefill.purchaseOrderId); setPurchaseOrderNo(prefill.poNo); setSupplierId(prefill.supplierId); setWarehouseId(prefill.warehouseId);
      setLines(prefill.items.map((line) => ({ key: crypto.randomUUID(), ...line, lotNo:'', manufactureDate:'', expiryDate:'' })));
    }).catch((reason:Error)=>setError(reason.message));
  }, [requestedPurchaseOrderId, editingId]);

  // โหมดแก้ไขร่าง: โหลดเอกสารเดิมมาใส่ฟอร์ม (เลข GR เดิมคงอยู่ ไม่สร้างใบใหม่)
  const [editDoc, setEditDoc] = useState<{ receiptNo: string; status: string; supplierDocNo?: string | null; note?: string | null } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  useEffect(() => {
    if (!editingId) { setEditDoc(null); return; }
    const run = async () => {
      try {
        const d = await apiClient.get<{ receiptNo: string; status: string; warehouseId: string; supplierId?: string | null; purchaseOrderId?:string|null;purchaseOrder?:{poNo:string}|null;supplierDocNo?: string | null; note?: string | null; items: { itemId: string; purchaseOrderItemId?:string|null;quantity: string; unitPrice: string; lotNo?: string | null; manufactureDate?: string | null; expiryDate?: string | null }[] }>(`/business/receiving/${editingId}`);
        setEditDoc({ receiptNo: d.receiptNo, status: d.status, supplierDocNo: d.supplierDocNo, note: d.note });
        if (d.status !== 'DRAFT') { setError('เอกสารนี้ยืนยันแล้ว จึงแก้ไขไม่ได้'); return; }
        setWarehouseId(d.warehouseId); setSupplierId(d.supplierId ?? ''); setPurchaseOrderId(d.purchaseOrderId??''); setPurchaseOrderNo(d.purchaseOrder?.poNo??'');
        setLines(d.items.map((l) => ({ key: crypto.randomUUID(), itemId: l.itemId, purchaseOrderItemId:l.purchaseOrderItemId??undefined,quantity: Number(l.quantity), unitPrice: Number(l.unitPrice), lotNo: l.lotNo ?? '', manufactureDate: l.manufactureDate ? String(l.manufactureDate).slice(0, 10) : '', expiryDate: l.expiryDate ? String(l.expiryDate).slice(0, 10) : '' })));
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดร่างไม่สำเร็จ'); }
    };
    void run();
  }, [editingId]);  
  const filtered = receipts;
  const updateLine = (key: string, field: keyof ReceiptLine, value: string | number) => setLines((current) => current.map((line) => line.key === key ? { ...line, [field]: value } : line));
  // สร้าง master data ใหม่แล้ว refetch + auto-select ทันที
  const onCreated = async (kind: CreateState['kind'], created: { id: string; code: string; name: string }, lineKey?: string) => {
    await load();
    if (kind === 'warehouse') setWarehouseId(created.id);
    else if (kind === 'supplier') setSupplierId(created.id);
    else if (kind === 'item' && lineKey) setLines((cur) => cur.map((l) => l.key === lineKey ? { ...l, itemId: created.id } : l));
    setCreate(null);
  };
  const formRef = useRef<HTMLFormElement>(null);
  const submitReceipt = async (confirm: boolean) => {
    if (busy) return;
    if (!warehouseId) { setError('กรุณาเลือกคลัง'); return; }
    if (!lines.length || !lines.every((l) => l.itemId && l.quantity > 0)) { setError('กรอกรายการและจำนวนให้ครบก่อน'); return; }
    setBusy(true); setError('');
    const data = new FormData(formRef.current!);
    const hasOverReceive = lines.some((line) => line.remainingQty != null && line.quantity > line.remainingQty);
    try {
      const created = editingId
        ? await apiClient.patch<{ receiptNo: string }>(`/business/receiving/${editingId}`, {
          warehouseId, supplierId: supplierId || undefined, purchaseOrderId: purchaseOrderId || undefined,
          supplierDocNo: (data.get('supplierDocNo') as string) || undefined,
          receiptDate: data.get('receiptDate'), note: data.get('note') || undefined,
          items: lines.map(({ itemId, purchaseOrderItemId, quantity, unitPrice, lotNo, manufactureDate, expiryDate }) => ({ itemId, purchaseOrderItemId, quantity, unitPrice, lotNo: lotNo || undefined, manufactureDate: manufactureDate || undefined, expiryDate: expiryDate || undefined })),
        })
        : await apiClient.post<{ receiptNo: string }>('/business/receiving', {
        warehouseId, supplierId: supplierId || undefined, purchaseOrderId: purchaseOrderId || undefined,
        supplierDocNo: (data.get('supplierDocNo') as string) || undefined,
        receiptDate: data.get('receiptDate'), note: data.get('note') || undefined,
        confirm,
        overReceiveAcknowledged: confirm && hasOverReceive,
        items: lines.map(({ itemId, purchaseOrderItemId, quantity, unitPrice, lotNo, manufactureDate, expiryDate }) => ({ itemId, purchaseOrderItemId, quantity, unitPrice, lotNo: lotNo || undefined, manufactureDate: manufactureDate || undefined, expiryDate: expiryDate || undefined })),
      });
      if (editingId && confirm) await apiClient.post(`/business/receiving/${editingId}/confirm`, { overReceiveAcknowledged: hasOverReceive });
      await load();
      toast({
        title: confirm ? `ยืนยันรับของ ${created.receiptNo} แล้ว` : `บันทึกร่าง ${created.receiptNo} แล้ว`,
        description: confirm ? 'เพิ่มสต็อกและอัปเดตต้นทุนต่อหน่วยฐานเรียบร้อย' : 'ยังไม่เพิ่มสต็อกและยังไม่อัปเดตต้นทุน',
        variant: 'success',
      });
      navigate('/receiving');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'บันทึกใบรับของไม่สำเร็จ';
      setError(message);
      toast({ title: confirm ? 'ยืนยันรับของไม่สำเร็จ' : 'บันทึกร่างไม่สำเร็จ', description: message, variant: 'error' });
    } finally { setBusy(false); }
  };
  if (creating) {
    const t = receiptTotals(lines);
    const warehouseName = lookups?.warehouses.find((w) => w.id === warehouseId)?.name ?? '—';
    const supplierName = lookups?.suppliers.find((x) => x.id === supplierId)?.name ?? 'ไม่ระบุ';
    const readyToSave = Boolean(warehouseId && lines.some((l) => l.itemId));
    const readyToConfirm = Boolean(warehouseId && lines.length > 0 && lines.every((l) => l.itemId));

    return <PageContainer size="wide" className="ops-page receiving-workspace">
      <PageHeader
        breadcrumb="ออเดอร์และปฏิบัติการ"
        title={editDoc ? `แก้ไขใบรับสินค้า ${editDoc.receiptNo}` : 'รับสินค้าเข้า'}
        description="บันทึกการรับ เพิ่มสต็อก และเก็บประวัติราคาซื้อในธุรกรรมเดียว"
        badge={editDoc ? <span className={`badge ${STATUS_BADGE[statusInfo('receiving', editDoc.status).tone]}`}>{statusLabel('receiving', editDoc.status)}</span>
                       : <span className="badge muted">{statusLabel('receiving', 'DRAFT')}</span>}
        actions={<Link className="btn" to="/receiving">กลับหน้ารายการ</Link>}
      />
      {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}
      {purchaseOrderId && <div className="rb-callout info"><ShoppingCart aria-hidden /><div><strong>รับจากใบสั่งซื้อ {purchaseOrderNo}</strong><p>จำนวนและราคาด้านล่างเป็นค่าเริ่มต้นจาก PO แก้ไขตามของที่มาถึงจริงได้ ระบบจะแสดงผลต่างโดยไม่แก้ราคา PO</p></div></div>}

      <form className="ops-workspace" ref={formRef} onSubmit={(e) => e.preventDefault()}>
        <div className="ops-workspace-main">
          <ContentCard title="ข้อมูลการรับสินค้า" description="ระบุเอกสาร คลัง และคู่ค้าของรายการรับครั้งนี้">
            <div className="ops-field-grid">
              <label>เลขที่รับของ
                <input value={editDoc?.receiptNo ?? 'ระบบจะออกเลข GR ให้อัตโนมัติ'} readOnly disabled />
              </label>
              <label>วันที่รับ
                <input name="receiptDate" type="date" defaultValue={today()} required />
              </label>
              <label>คลังปลายทาง
                <CreatableCombobox value={warehouseId} onChange={setWarehouseId}
                  options={(lookups?.warehouses ?? []).map((w) => ({ value: w.id, label: w.name, sublabel: w.code }))}
                  placeholder={rt.selectWarehouse} searchPlaceholder={rt.searchWarehouse} emptyText={rt.noWarehouse}
                  createLabel={canCreate ? rt.addWarehouse : undefined}
                  onCreate={canCreate ? ((q) => setCreate({ kind: 'warehouse', prefill: q })) : undefined} ariaLabel={rt.selectWarehouse} />
              </label>
              <label>Supplier
                <CreatableCombobox value={supplierId} onChange={setSupplierId}
                  options={(lookups?.suppliers ?? []).map((x) => ({ value: x.id, label: x.name, sublabel: x.code }))}
                  placeholder={rt.selectSupplier} searchPlaceholder={rt.searchSupplier} emptyText={rt.noSupplier}
                  createLabel={canCreate ? rt.addSupplier : undefined}
                  onCreate={canCreate ? ((q) => setCreate({ kind: 'supplier', prefill: q })) : undefined} ariaLabel={rt.selectSupplier} />
              </label>
              <label>เลขที่เอกสาร Supplier
                <input name="supplierDocNo" placeholder="เช่น INV-2026-001" defaultValue={editDoc?.supplierDocNo ?? ''} />
              </label>
              <label>ผู้รับของ<input value={user?.fullName ?? ''} readOnly disabled /></label>
            </div>
          </ContentCard>

          <ContentCard title="รายการสินค้า"
            description="ตรวจการแปลงหน่วยซื้อเป็นหน่วยฐานให้ตรงก่อนยืนยัน"
            actions={<button type="button" className="btn" onClick={() => setLines((v) => [...v, freshReceiptLine()])}><Plus aria-hidden width={15} />เพิ่มรายการ</button>}>
            <div className="recv-cols" aria-hidden>
              <span>สินค้า</span><span>จำนวน</span><span>ราคาซื้อ/หน่วย</span>
              <span>การแปลงหน่วย</span><span className="num">ยอดรวม</span><span />
            </div>
            <div className="recv-rows">
              {lines.map((line) => {
                const item = lookups?.items.find((entry) => entry.id === line.itemId);
                const cv = conversionPreview({
                  quantity: line.quantity, unitPrice: line.unitPrice,
                  purchaseToBaseFactor: item?.purchaseToBaseFactor,
                  purchaseUnitCode: item?.purchaseUnit?.code, baseUnitCode: item?.baseUnit.code,
                });
                return <article className="recv-row" key={line.key}>
                  <div className="rr-item">
                    <CreatableCombobox value={line.itemId}
                      onChange={(val) => {
                        updateLine(line.key, 'itemId', val);
                        const selected = lookups?.items.find((i) => i.id === val);
                        if (selected && !line.unitPrice) updateLine(line.key, 'unitPrice', Number(selected.lastCost));
                      }}
                      options={(lookups?.items ?? []).map((i) => ({ value: i.id, label: i.name, sublabel: `${i.code} · ซื้อเป็น ${i.purchaseUnit?.code ?? i.baseUnit.code} · ฐาน ${i.baseUnit.code}` }))}
                      placeholder={rt.selectItem} searchPlaceholder={rt.searchItem} emptyText={rt.noItem}
                      createLabel={canCreate ? rt.addItem : undefined}
                      onCreate={canCreate ? ((q) => setCreate({ kind: 'item', prefill: q, lineKey: line.key })) : undefined} ariaLabel={rt.selectItem} />
                    {item && <small className="rr-sub">{item.code} · หน่วยฐาน {item.baseUnit.code}</small>}
                    {line.purchaseOrderItemId && <small className="rr-sub">สั่ง {qtyText(line.orderedQty??0)} · รับก่อนหน้า {qtyText(line.previouslyReceivedQty??0)} · คงเหลือ {qtyText(line.remainingQty??0)} {line.purchaseUnitCode}</small>}
                  </div>

                  <label className="rr-qty">จำนวน
                    <span className="rr-input-unit">
                      <input type="number" min="0.0001" step="0.0001" value={line.quantity}
                        onChange={(e) => updateLine(line.key, 'quantity', Number(e.target.value))} />
                      <b>{cv.purchaseUnit || 'หน่วย'}</b>
                    </span>
                  </label>

                  <label className="rr-price">ราคาซื้อ/หน่วย
                    <span className="rr-input-unit">
                      <input type="number" min="0" step="0.01" value={line.unitPrice}
                        onChange={(e) => updateLine(line.key, 'unitPrice', Number(e.target.value))} />
                      <b>/ {cv.purchaseUnit || 'หน่วย'}</b>
                    </span>
                  </label>

                  {/* จุดที่เคยพลาด: ฿47 ต่อ 1 L ไม่ใช่ ฿47 ต่อ 1 ML — แสดงให้เห็นตรงนี้เลย */}
                  <div className="rr-conv">
                    {!item ? <span className="subtle">—</span>
                      : cv.factor == null ? <span className="rr-conv-unknown"><AlertTriangle aria-hidden width={13} />ยังไม่ได้ตั้งอัตราแปลงหน่วย</span>
                      : cv.sameUnit ? <span className="rr-conv-same">ใช้หน่วยเดียวกัน</span>
                      : <>
                          <span className="rr-eq">{cv.equation}</span>
                          <span className="rr-base num">{qtyText(cv.baseQuantity ?? 0)} {cv.baseUnit}</span>
                          <span className="rr-basecost num">฿{costText(cv.baseUnitCost ?? 0)} / {cv.baseUnit}</span>
                        </>}
                  </div>

                  <div className="rr-total num">{money(cv.lineTotal)}</div>

                  <div className="rr-actions">
                    <button type="button" className="icon-btn" aria-label="ลบรายการ" disabled={lines.length === 1}
                      onClick={() => setLines((v) => v.filter((x) => x.key !== line.key))}><Trash2 aria-hidden /></button>
                  </div>

                  <div className="rr-lot">
                    <label>Lot<input placeholder="Lot" value={line.lotNo} onChange={(e) => updateLine(line.key, 'lotNo', e.target.value)} /></label>
                    <label>วันผลิต<input type="date" value={line.manufactureDate} onChange={(e) => updateLine(line.key, 'manufactureDate', e.target.value)} /></label>
                    <label>วันหมดอายุ<input type="date" value={line.expiryDate} onChange={(e) => updateLine(line.key, 'expiryDate', e.target.value)} /></label>
                  </div>
                </article>;
              })}
            </div>
          </ContentCard>

          <ContentCard title="หมายเหตุ">
            <label className="ops-note-field">รายละเอียดการรับหรือเอกสารอ้างอิง
              <textarea name="note" defaultValue={editDoc?.note ?? ''} placeholder="เช่น รับของไม่ครบ รอส่งเพิ่มวันจันทร์" />
            </label>
          </ContentCard>
        </div>

        <StickySummary className="ops-summary-panel">
          <div className="ops-sum">
            <h2><PackageCheck aria-hidden />สรุปการรับ</h2>
            <dl>
              <div><dt>เลขที่</dt><dd>{editDoc?.receiptNo ?? 'ระบบออกให้อัตโนมัติ'}</dd></div>
              <div><dt>Supplier</dt><dd>{supplierName}</dd></div>
              <div><dt>คลัง</dt><dd>{warehouseName}</dd></div>
              <div><dt>จำนวนรายการ</dt><dd className="num">{lines.filter((l) => l.itemId).length}</dd></div>
              <div><dt>จำนวนรวม</dt><dd className="num">{qtyText(t.totalQuantity)}</dd></div>
              <div><dt>สถานะ</dt><dd>{statusLabel('receiving', editDoc?.status ?? 'DRAFT')}</dd></div>
            </dl>
            <div className="ops-sum-total"><span>มูลค่ารับรวม</span><strong className="num">{money(t.totalValue)}</strong></div>
            <p className="ops-sum-note"><CheckCircle2 aria-hidden width={15} />“บันทึกร่าง” ยังไม่เพิ่มสต็อก · “ยืนยัน” จะเพิ่มสต็อกและอัปเดตต้นทุนต่อหน่วยฐาน</p>
            <div className="ops-sum-actions">
              {canCreateReceipt && <button type="button" className="btn" disabled={busy || !readyToSave} onClick={() => void submitReceipt(false)}>บันทึกร่าง</button>}
              {canConfirmReceipt && <button type="button" className="btn primary" disabled={busy || !readyToConfirm} onClick={() => setConfirmOpen(true)}>
                <PackageCheck aria-hidden />{busy ? 'กำลังบันทึก…' : 'ยืนยันรับเข้าสต็อก'}</button>}
            </div>
          </div>
        </StickySummary>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันรับเข้าสต็อก"
        confirmLabel="ยืนยันรับเข้า"
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void submitReceipt(true)}
        description={<div className="op-confirm">
          <dl>
            <div><dt>เอกสาร</dt><dd>{editDoc?.receiptNo ?? 'ระบบออกเลข GR ให้อัตโนมัติ'}</dd></div>
            <div><dt>คลังปลายทาง</dt><dd>{warehouseName}</dd></div>
            <div><dt>จำนวนรายการ</dt><dd>{t.lineCount} รายการ</dd></div>
            <div><dt>มูลค่ารวม</dt><dd>{money(t.totalValue)}</dd></div>
          </dl>
          <p className="op-confirm-impact"><ArrowDownToLine aria-hidden width={15} />เมื่อยืนยัน ระบบจะ<b>เพิ่มสต็อกจริง</b> และเอกสารนี้จะไม่สามารถแก้ไขรายการโดยตรงได้</p>
          {lines.some((line)=>line.remainingQty!=null&&line.quantity>line.remainingQty!)&&<p className="op-confirm-impact danger"><AlertTriangle aria-hidden width={15}/>มีรายการรับเกิน PO การกดยืนยันคือการยอมรับปริมาณส่วนเกินอย่างชัดเจน</p>}
        </div>}
      />
      {create && <MasterCreateModal state={create} units={units} onClose={() => setCreate(null)} onCreated={onCreated} />}
    </PageContainer>;
  }
  const receivedToday = receipts.filter((r) => r.receiptDate.slice(0,10) === today()); const valueToday = receivedToday.flatMap((r) => r.items).reduce((s,i) => s + Number(i.totalCost), 0);
  const clearFilters = () => { setQuery(''); setFromDate(''); setToDate(''); setSupplierFilter(''); setWarehouseFilter(''); setStatusFilter(''); };
  const hasFilter = Boolean(query || fromDate || toDate || supplierFilter || warehouseFilter || statusFilter);

  return <PageContainer size="wide" className="ops-page">
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title="รับของเข้า"
      description="ติดตามวัตถุดิบและบรรจุภัณฑ์ที่เพิ่มเข้าคลัง พร้อมประวัติราคาและ Lot"
      actions={<>
        <button type="button" className="btn" onClick={()=>void exportExcel()}><FileDown aria-hidden width={16}/>ส่งออก Excel</button>
        <Link className="btn primary" to="/receiving/new"><Plus aria-hidden width={16}/>รับสินค้า</Link>
      </>}
    />

    <KPIGrid columns={4}>
      <KPICard label="รับวันนี้" value={receivedToday.length} icon={<Truck/>} hint="ใบรับของที่ลงวันที่วันนี้"/>
      <KPICard label="จำนวนรายการวันนี้" value={receivedToday.flatMap((r)=>r.items).length} icon={<Boxes/>} hint="บรรทัดสินค้าในใบวันนี้"/>
      <KPICard label="มูลค่ารับวันนี้" value={money(valueToday)} icon={<PackageCheck/>} hint="รวมทุกใบของวันนี้"/>
      <KPICard label="เอกสารทั้งหมด" value={receipts.length} icon={<ClipboardCheck/>} hint="ใบรับของในระบบ"/>
    </KPIGrid>

    <FilterBar actions={hasFilter ? <button type="button" className="btn" onClick={clearFilters}>ล้างตัวกรอง</button> : undefined}>
      <input className="s2-search" value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="ค้นหาเลขที่รับ / Supplier / สินค้า" aria-label="ค้นหาใบรับของ"/>
      <input type="date" value={fromDate} onChange={(e)=>setFromDate(e.target.value)} aria-label="ตั้งแต่วันที่"/>
      <input type="date" value={toDate} onChange={(e)=>setToDate(e.target.value)} aria-label="ถึงวันที่"/>
      <select value={supplierFilter} onChange={(e)=>setSupplierFilter(e.target.value)} aria-label="Supplier"><option value="">ทุก Supplier</option>{lookups?.suppliers.map((sp)=><option key={sp.id} value={sp.id}>{sp.name}</option>)}</select>
      <select value={warehouseFilter} onChange={(e)=>setWarehouseFilter(e.target.value)} aria-label="คลัง"><option value="">ทุกคลัง</option>{lookups?.warehouses.map((w)=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <select value={statusFilter} onChange={(e)=>setStatusFilter(e.target.value)} aria-label="สถานะ">
        <option value="">ทุกสถานะ</option>
        <option value="DRAFT">{statusLabel('receiving','DRAFT')}</option>
        <option value="CONFIRMED">{statusLabel('receiving','CONFIRMED')}</option>
        <option value="REVERSED">{statusLabel('receiving','REVERSED')}</option>
      </select>
    </FilterBar>

    {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden/><div><strong>{error}</strong></div></div>}

    <ContentCard title="รายการใบรับของ" description={`${filtered.length} จาก ${receipts.length} ใบ`} padded={false}>
      {!filtered.length
        ? <EmptyState icon={Truck} title="ยังไม่มีรายการรับสินค้า"
            description={hasFilter ? 'ไม่พบใบรับของตามตัวกรองที่เลือก' : 'เริ่มรับของเพื่อเพิ่มสต็อกและบันทึกราคาซื้อจริง'}
            action={hasFilter ? <button type="button" className="btn" onClick={clearFilters}>ล้างตัวกรอง</button> : <Link to="/receiving/new" className="btn primary">รับสินค้า</Link>}/>
        : <div className="table-wrap"><table className="data-table ops-table">
            <thead><tr>
              <th>เลขที่รับของ</th><th>วันที่</th><th>Supplier / คลัง</th>
              <th className="num">รายการ</th><th className="num">มูลค่ารวม</th><th>สถานะ</th><th>เอกสาร</th>
            </tr></thead>
            <tbody>
              {filtered.map((receipt)=>{
                const st = statusInfo('receiving', receipt.status);
                return <tr key={receipt.id}>
                  <td data-label="เลขที่รับของ"><Link to={`/receiving/${receipt.id}`} className="ops-doc-link">{receipt.receiptNo}</Link></td>
                  <td data-label="วันที่">{new Date(receipt.receiptDate).toLocaleDateString('th-TH')}</td>
                  <td data-label="Supplier / คลัง"><span className="ops-two-line"><b>{receipt.supplier?.name ?? 'ไม่ระบุ'}</b><small>{receipt.warehouse.name}</small></span></td>
                  <td className="num" data-label="รายการ">{receipt.items.length}</td>
                  <td className="num" data-label="มูลค่ารวม">{money(receipt.items.reduce((s,i)=>s+Number(i.totalCost),0))}</td>
                  <td data-label="สถานะ"><span className={`badge ${STATUS_BADGE[st.tone]}`}>{st.label}</span></td>
                  <td data-label="เอกสาร"><button type="button" className="btn" onClick={()=>void openDocument(`/business/documents/GOODS_RECEIPT_SLIP/${receipt.id}.pdf`)}><FileDown aria-hidden width={15}/>PDF</button></td>
                </tr>;
              })}
            </tbody>
          </table></div>}
    </ContentCard>
  </PageContainer>;
}

export function StockIssuePage() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const issueEditingId = /\/stock-issues\/([^/]+)\/edit$/.exec(pathname)?.[1] ?? '';
  const creating = pathname.endsWith('/new') || Boolean(issueEditingId);
  const { user } = useAuth();
  const canCreateIssue = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('STOCK_ISSUE_CREATE'));
  const canConfirmIssue = Boolean(user?.roles.includes('SUPER_ADMIN') || ['STOCK_ISSUE_CONFIRM', 'STOCK_ISSUE_CREATE'].some((p) => user?.permissions.includes(p)));

  const [lookups, setLookups] = useState<Lookups>();
  const [issues, setIssues] = useState<Issue[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<IssueLine[]>([]);
  const [pickerTerm, setPickerTerm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [issueConfirmOpen, setIssueConfirmOpen] = useState(false);
  const [savedIssueNo, setSavedIssueNo] = useState('');
  const [focusKey, setFocusKey] = useState('');

  const load = async () => {
    try {
      const [options, history] = await Promise.all([
        apiClient.get<Lookups>('/business/operations/lookups'),
        apiClient.get<Issue[]>('/business/stock-issues'),
      ]);
      setLookups(options); setIssues(history);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลงานเบิกไม่สำเร็จ'); }
  };
  useEffect(() => { void load(); }, []);
  // ผู้จำหน่าย/คลังถูกแก้หรือปิดใช้งานจากหน้า master → โหลด lookups ใหม่
  useMasterDataRefresh(load);

  // โหมดแก้ไขร่างใบเบิก — เลข RI เดิมคงอยู่
  const [issueEditDoc, setIssueEditDoc] = useState<{ issueNo: string; status: string } | null>(null);
  useEffect(() => {
    if (!issueEditingId) { setIssueEditDoc(null); return; }
    const run = async () => {
      try {
        const d = await apiClient.get<{ issueNo: string; status: string; warehouseId: string; note?: string | null; items: { itemId: string; issuedQty: string; requiredQty: string; unit: string; item?: { code: string; name: string } | null; lotAllocations?:{lotId:string;quantity:string;lot?:{lotNo:string;expiryDate?:string|null}}[] }[] }>(`/business/stock-issues/${issueEditingId}`);
        setIssueEditDoc({ issueNo: d.issueNo, status: d.status });
        if (d.status !== 'DRAFT') { setError('ใบเบิกนี้ยืนยันแล้ว จึงแก้ไขไม่ได้'); return; }
        setWarehouseId(d.warehouseId); setNote(d.note ?? '');
        setLines(d.items.map((l) => ({ key: crypto.randomUUID(), itemId: l.itemId, name: l.item?.name ?? '', code: l.item?.code ?? '', unit: l.unit, requiredQty: Number(l.requiredQty), issuedQty: Number(l.issuedQty), isLotTracked:(lookups?.items.find(i=>i.id===l.itemId)?.isLotTracked??false), allocations:l.lotAllocations?.map(a=>({lotId:a.lotId,quantity:Number(a.quantity),lotNo:a.lot?.lotNo,expiryDate:a.lot?.expiryDate}))??[] })));
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดร่างไม่สำเร็จ'); }
    };
    void run();
  }, [issueEditingId, lookups?.items]);  

  // สินค้าพร้อมเบิกของคลังที่เลือก — มาจาก stock จริงของคลังนั้น
  const issuable = useMemo(() => issuableItems(lookups?.items ?? [], warehouseId), [lookups?.items, warehouseId]);
  const pickerResults = useMemo(() => searchIssuable(issuable, pickerTerm).slice(0, 40), [issuable, pickerTerm]);
  const availableOf = (itemId: string) => issuable.find((x) => x.id === itemId)?.available ?? 0;
  const stockOf = (itemId: string) => issuable.find((x) => x.id === itemId);
  const summary = useMemo(() => summarize(lines, availableOf), [lines, issuable]); // eslint-disable-line react-hooks/exhaustive-deps

  // เปลี่ยนคลัง = ล้างรายการ เพื่อไม่ให้ยอดคงเหลือของคลังเดิมค้างมา
  const changeWarehouse = (id: string) => { setWarehouseId(id); setLines([]); setError(''); };

  const addItem = (item: IssuableItem) => {
    const result = addIssueLine(lines, item, () => crypto.randomUUID());
    if (!result.ok) { setFocusKey(result.existingKey); toast({ title: 'มีรายการนี้อยู่แล้ว', description: `${item.name} อยู่ในใบเบิกนี้แล้ว`, variant: 'warning' }); return; }
    setLines(result.lines); setPickerTerm('');
  };
  const patchLine = (key: string, qty: number) => setLines((v) => v.map((l) => (l.key === key ? { ...l, issuedQty: qty, ...(l.isLotTracked?{allocations:[]}: {}) } : l)));
  const suggestLots = async (key:string) => {
    const line=lines.find(row=>row.key===key);if(!line||!warehouseId||line.issuedQty<=0)return;
    try{const [suggestion,lots]=await Promise.all([
      apiClient.post<{allocations:{lotId:string;quantity:number}[];shortageQty:number}>('/business/inventory/lots/suggest',{warehouseId,itemId:line.itemId,quantity:line.issuedQty}),
      apiClient.get<{rows:{lotId:string;lotNo:string;expiryDate:string|null;available:number}[]}>(`/business/inventory/lots?warehouseId=${warehouseId}&itemId=${line.itemId}`),
    ]);const lotOf=new Map(lots.rows.map(row=>[row.lotId,row]));setLines(v=>v.map(row=>row.key===key?{...row,allocations:suggestion.allocations.map(a=>({...a,...lotOf.get(a.lotId)}))}:row));if(suggestion.shortageQty>0)setError(`Lot ที่ใช้ได้ไม่พอ ${suggestion.shortageQty} ${line.unit}`)}catch(reason){setError(reason instanceof Error?reason.message:'แนะนำ FEFO ไม่สำเร็จ')}
  };
  const removeLine = (key: string) => setLines((v) => v.filter((l) => l.key !== key));

  /** helper (ไม่บังคับ): เติมรายการที่ต้องใช้จากออเดอร์ แล้วผู้ใช้ยังแก้ได้ก่อนยืนยัน */
  const loadDemand = async (id: string) => {
    setOrderId(id);
    if (!id) return;
    try {
      const demand = await apiClient.get<{ items: { itemId: string; name: string; unit: string; quantity: string }[]; warnings: string[] }>(`/business/orders/${id}/demand`);
      setLines(demand.items.map((item) => ({
        key: crypto.randomUUID(), itemId: item.itemId, name: item.name,
        code: stockOf(item.itemId)?.code ?? '', unit: item.unit,
        requiredQty: Number(item.quantity), issuedQty: Number(item.quantity),
      })));
      setError(demand.warnings.join(' · '));
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'คำนวณความต้องการไม่สำเร็จ'); }
  };

  const submit = async (confirm: boolean) => {
    if (busy || !warehouseId || !summary.canSubmit) return;
    setBusy(true); setError('');
    try {
      const payload = buildIssuePayload({ warehouseId, orderId: orderId || undefined, note: note || undefined, idempotencyKey: crypto.randomUUID(), confirm, lines });
      const created = issueEditingId
        ? await apiClient.patch<{ id: string; issueNo: string; status: string }>(`/business/stock-issues/${issueEditingId}`, payload)
        : await apiClient.post<{ id: string; issueNo: string; status: string }>('/business/stock-issues', payload);
      if (issueEditingId && confirm) await apiClient.post(`/business/stock-issues/${issueEditingId}/confirm`, {});
      setSavedIssueNo(created.issueNo);
      await load();
      toast({
        title: confirm ? `ยืนยันใบเบิก ${created.issueNo} แล้ว` : `บันทึกร่าง ${created.issueNo} แล้ว`,
        description: confirm ? 'ระบบตัดสต็อกและบันทึกบัญชีการเคลื่อนไหวเรียบร้อย' : 'ยังไม่ตัดสต็อก แก้ไขได้ก่อนยืนยัน',
        variant: 'success',
      });
      navigate('/stock-issues');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'บันทึกใบเบิกไม่สำเร็จ';
      setError(message);
      toast({ title: confirm ? 'ยืนยันการเบิกไม่สำเร็จ' : 'บันทึกร่างไม่สำเร็จ', description: message, variant: 'error' });
    } finally { setBusy(false); }
  };

  if (creating) return <PageContainer size="wide" className="ops-page issue-create issue-workspace">
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title={issueEditDoc ? `แก้ไขใบเบิก ${issueEditDoc.issueNo}` : 'สร้างใบเบิกให้ครัวกลาง'}
      description="เลือกคลังต้นทาง แล้วเบิกจากสินค้าที่มีอยู่จริงในคลังนั้น"
      badge={<span className={`badge ${STATUS_BADGE[statusInfo('issue', issueEditDoc?.status ?? 'DRAFT').tone]}`}>{statusLabel('issue', issueEditDoc?.status ?? 'DRAFT')}</span>}
      actions={<Link className="btn" to="/stock-issues">กลับหน้ารายการ</Link>}
    />
    {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

    <div className="ops-workspace">
      <div className="ops-workspace-main">
        <ContentCard title="ข้อมูลใบเบิก" description="เลขที่ใบเบิกออกโดยระบบเมื่อบันทึก">
          <div className="ops-field-grid">
            <label>เลขที่ใบเบิก
              <input value={issueEditDoc?.issueNo || savedIssueNo || 'ระบบออกเลขให้อัตโนมัติ (RI-…)'} readOnly disabled />
            </label>
            <label>วันที่<input type="date" defaultValue={today()} readOnly /></label>
            <label>คลังต้นทาง *
              <select value={warehouseId} onChange={(e) => changeWarehouse(e.target.value)} required>
                <option value="">เลือกคลัง</option>
                {lookups?.warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <label>ปลายทาง<input value="ครัวกลาง" readOnly disabled /></label>
            <label>ผู้ขอเบิก<input value={user?.fullName ?? ''} readOnly disabled /></label>
            <label className="wide">หมายเหตุ<textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เหตุผลการเบิกหรือเอกสารอ้างอิง" /></label>
            <label className="wide">โหลดจากออเดอร์ <small>(ไม่บังคับ)</small>
              <select value={orderId} onChange={(e) => void loadDemand(e.target.value)} disabled={!warehouseId}>
                <option value="">ไม่ใช้ออเดอร์ — เบิกจากสต็อกโดยตรง</option>
                {lookups?.orders.map((o) => <option key={o.id} value={o.id}>{o.orderNo} · {o.customer.name}</option>)}
              </select>
            </label>
          </div>
        </ContentCard>

        <ContentCard title="เลือกสินค้าที่จะเบิก" description="แสดงเฉพาะสินค้าที่มีของพร้อมเบิกในคลังที่เลือก">

          {!warehouseId && <div className="issue-hint"><AlertTriangle /><span>เลือกคลังต้นทางก่อน เพื่อโหลดสินค้าที่มีของจริง</span></div>}

          {warehouseId && issuable.length === 0 && <div className="business-empty">
            <Boxes /><h2>คลังนี้ยังไม่มีสินค้าพร้อมเบิก</h2>
            <p>ต้องรับของเข้าคลังนี้ก่อน จึงจะเบิกให้ครัวกลางได้</p>
            <Link to="/receiving/new">+ ไปหน้ารับของเข้า</Link>
          </div>}

          {warehouseId && issuable.length > 0 && <>
            <div className="issue-picker">
              <div className="issue-picker-search">
                <Search />
                <input value={pickerTerm} onChange={(e) => setPickerTerm(e.target.value)} placeholder="ค้นหาด้วยรหัสหรือชื่อสินค้า" aria-label="ค้นหาสินค้า" />
              </div>
              <div className="issue-picker-list">
                {pickerResults.map((item) => {
                  const added = lines.some((l) => l.itemId === item.id);
                  return <button type="button" key={item.id} className={`issue-pick${added ? ' is-added' : ''}`}
                    aria-pressed={added} onClick={() => addItem(item)}>
                    <span className="ip-main">
                      <strong>{item.code} · {item.name}</strong>
                      <small>{item.type === 'PACKAGING' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}</small>
                    </span>
                    {/* พร้อมใช้ คือเลขที่ใช้ตัดสินใจ จึงเด่นที่สุด อีกสองตัวเป็นที่มา */}
                    <span className="ip-stock">
                      <b className="ip-avail">{item.available.toLocaleString()} {item.unit}</b>
                      <small>พร้อมใช้ · คงเหลือ {item.onHand.toLocaleString()} · จองแล้ว {item.reserved.toLocaleString()}</small>
                    </span>
                    <span className="ip-add">{added ? <><Check aria-hidden width={15} />เพิ่มแล้ว</> : <><Plus aria-hidden width={15} />เพิ่มรายการ</>}</span>
                  </button>;
                })}
                {pickerResults.length === 0 && <p className="issue-none">
                  {pickerTerm ? `ไม่พบสินค้าที่ตรงกับ “${pickerTerm}” ในคลังนี้` : 'ไม่พบสินค้าที่ค้นหาในคลังนี้'}
                </p>}
              </div>
            </div>

            <div className="issue-grid v2">
              <div className="issue-head">
                <span>สินค้า</span><span>คงเหลือ</span><span>จองแล้ว</span><span>พร้อมใช้</span><span>จำนวนเบิก</span><span>หน่วย</span><span>หลังเบิก</span><span aria-label="ลบ" />
              </div>
              {lines.map((line) => {
                const s = stockOf(line.itemId);
                const avail = s?.available ?? 0;
                const after = afterIssue(avail, line.issuedQty);
                const issue = validateLine(line.issuedQty, avail);
                return <div className={`issue-row${issue === 'OVER_AVAILABLE' ? ' short' : ''}${focusKey === line.key ? ' focus' : ''}`} key={line.key}>
                  <strong data-label="สินค้า">{line.name}<small>{line.code}</small></strong>
                  <span data-label="คงเหลือ">{(s?.onHand ?? 0).toLocaleString()}</span>
                  <span data-label="จองแล้ว">{(s?.reserved ?? 0).toLocaleString()}</span>
                  <span data-label="พร้อมใช้">{avail.toLocaleString()}</span>
                  <input data-label="จำนวนเบิก" type="number" min="0" step="0.0001" value={line.issuedQty}
                    aria-label={`จำนวนเบิก ${line.name}`}
                    onChange={(e) => patchLine(line.key, Number(e.target.value))} />
                  <span data-label="หน่วย">{line.unit}</span>
                  <span data-label="หลังเบิก" className={after < 0 ? 'danger' : ''}>{after.toLocaleString()}</span>
                  <button type="button" className="icon-btn" onClick={() => removeLine(line.key)} aria-label={`ลบ ${line.name}`}><Trash2 /></button>
                  {/* สมการอ่านเป็นประโยค: พร้อมใช้ − เบิก = หลังเบิก */}
                  <p className="issue-eq" data-label="สรุป">
                    <span className="num">{avail.toLocaleString()} {line.unit}</span> พร้อมใช้
                    <b aria-hidden> − </b><span className="sr-sep">ลบ</span>
                    <span className="num">{Number(line.issuedQty || 0).toLocaleString()} {line.unit}</span> เบิก
                    <b aria-hidden> = </b><span className="sr-sep">เท่ากับ</span>
                    <strong className={`num ${after < 0 ? 'is-short' : ''}`}>{after.toLocaleString()} {line.unit}</strong> หลังเบิก
                  </p>
                  {issue === 'OVER_AVAILABLE' && <p className="issue-row-error" role="alert">
                    <AlertTriangle aria-hidden width={14} />จำนวนเบิกเกินจำนวนที่พร้อมใช้ {(Number(line.issuedQty || 0) - avail).toLocaleString()} {line.unit}
                  </p>}
                  {line.isLotTracked&&<div className="rr-lot"><button type="button" className="btn" onClick={()=>void suggestLots(line.key)}>FEFO Suggested</button>{line.allocations?.map(a=><label key={a.lotId}>Lot {a.lotNo??a.lotId}<small>{a.expiryDate?`หมดอายุ ${String(a.expiryDate).slice(0,10)}`:'ไม่มีวันหมดอายุ'} · พร้อมใช้ {a.available??'—'}</small><input type="number" min="0" step="0.0001" value={a.quantity} onChange={e=>setLines(v=>v.map(row=>row.key===line.key?{...row,allocations:row.allocations?.map(x=>x.lotId===a.lotId?{...x,quantity:Number(e.target.value)}:x)}:row))}/></label>)}</div>}
                </div>;
              })}
              {lines.length === 0 && <p className="issue-none">ยังไม่มีรายการ — ค้นหาแล้วกด “เพิ่มรายการ” ด้านบน</p>}
            </div>
          </>}
        </ContentCard>
      </div>

      <StickySummary className="ops-summary-panel">
        <div className="ops-sum">
        <h2><ClipboardCheck aria-hidden />สรุปใบเบิก</h2>
        <dl>
          <div><dt>สถานะ</dt><dd>{statusLabel('issue', issueEditDoc?.status ?? 'DRAFT')}</dd></div>
          <div><dt>ปลายทาง</dt><dd>ครัวกลาง</dd></div>
          <div><dt>เลขที่</dt><dd>{savedIssueNo || 'ออกให้เมื่อบันทึก'}</dd></div>
          <div><dt>คลังต้นทาง</dt><dd>{lookups?.warehouses.find((w) => w.id === warehouseId)?.name ?? '—'}</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{summary.lineCount}</dd></div>
          <div><dt>ของไม่พอ</dt><dd className={summary.insufficientCount ? 'danger' : ''}>{summary.insufficientCount}</dd></div>
          <div className="total"><dt>จำนวนรวมที่เบิก</dt><dd>{summary.totalQty.toLocaleString()}</dd></div>
        </dl>
        {summary.insufficientCount > 0 && <p className="ops-sum-warn"><AlertTriangle aria-hidden width={15} />มีรายการเบิกเกินของที่พร้อมใช้ — แก้ไขก่อนยืนยัน</p>}
        {summary.emptyQtyCount > 0 && <p className="ops-sum-warn"><AlertTriangle aria-hidden width={15} />มี {summary.emptyQtyCount} รายการที่ยังไม่ได้ใส่จำนวน</p>}
        <p className="ops-sum-note"><CheckCircle2 aria-hidden width={15} />“บันทึกร่าง” ยังไม่ตัดสต็อก · “ยืนยัน” จะตัดสต็อกทันทีและบันทึกบัญชีการเคลื่อนไหว</p>
        <div className="ops-sum-actions">
          {canCreateIssue && <button type="button" className="btn" disabled={busy || !summary.canSubmit} onClick={() => void submit(false)}>บันทึกร่าง</button>}
          {canConfirmIssue && <button type="button" className="btn primary" disabled={busy || !summary.canSubmit} onClick={() => setIssueConfirmOpen(true)}>
            <PackageCheck aria-hidden />{busy ? 'กำลังบันทึก…' : 'ยืนยันและตัดสต็อก'}
          </button>}
        </div>
        </div>
      </StickySummary>
    </div>

    <ConfirmDialog
      open={issueConfirmOpen}
      title="ยืนยันตัดสต็อกตามใบเบิกนี้"
      confirmLabel="ยืนยันและตัดสต็อก"
      onClose={() => setIssueConfirmOpen(false)}
      onConfirm={() => void submit(true)}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>{issueEditDoc?.issueNo || savedIssueNo || 'ระบบออกเลข RI ให้อัตโนมัติ'}</dd></div>
          <div><dt>คลังต้นทาง</dt><dd>{lookups?.warehouses.find((w) => w.id === warehouseId)?.name ?? '—'}</dd></div>
          <div><dt>ปลายทาง</dt><dd>ครัวกลาง</dd></div>
          <div><dt>จำนวนรายการ</dt><dd>{summary.lineCount} รายการ</dd></div>
          <div><dt>จำนวนรวม</dt><dd>{summary.totalQty.toLocaleString()}</dd></div>
        </dl>
        <p className="op-confirm-impact"><ArrowUpFromLine aria-hidden width={15} />เมื่อยืนยัน ระบบจะ<b>ตัดสต็อกจริง</b>ตามรายการด้านซ้าย และแก้ไขเอกสารโดยตรงไม่ได้อีก</p>
      </div>}
    />
  </PageContainer>;

  return <PageContainer size="wide" className="ops-page">
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title="เบิกให้ครัวกลาง"
      description="ประวัติการตัดสต็อกและงานเตรียมของครัวกลาง"
      actions={<Link className="btn primary" to="/stock-issues/new"><Plus aria-hidden width={16}/>สร้างใบเบิก</Link>}
    />

    <KPIGrid columns={4}>
      <KPICard label="ใบเบิกทั้งหมด" value={issues.length} icon={<ClipboardCheck/>} hint="เอกสารในระบบ"/>
      <KPICard label="เบิกวันนี้" value={issues.filter((i)=>(i.issuedAt??i.issueDate).slice(0,10)===today()).length} icon={<PackageCheck/>} hint="ใบที่ลงวันที่วันนี้"/>
      <KPICard label="รายการที่ตัดแล้ว" value={issues.flatMap((i)=>i.items).length} icon={<Boxes/>} hint="บรรทัดสินค้าทั้งหมด"/>
      <KPICard label="ร่างรอยืนยัน" value={issues.filter((i)=>i.status==='DRAFT').length} icon={<AlertTriangle/>}
        tone={issues.some((i)=>i.status==='DRAFT') ? 'warning' : 'default'} hint="ยังไม่ตัดสต็อก"/>
    </KPIGrid>

    <ContentCard title="รายการใบเบิก" description={`${issues.length} ใบ`} padded={false}>
      {!issues.length
        ? <EmptyState icon={Warehouse} title="ยังไม่มีใบเบิก"
            description="สร้างใบเบิกเพื่อตัดสต็อกให้ครัวกลาง"
            action={<Link to="/stock-issues/new" className="btn primary">สร้างใบเบิก</Link>}/>
        : <div className="table-wrap"><table className="data-table ops-table">
            <thead><tr>
              <th>เลขที่เบิก</th><th>วันที่</th><th>ออเดอร์ / ลูกค้า</th>
              <th className="num">รายการ</th><th>สถานะ</th><th>ผู้ขอเบิก</th><th>เอกสาร</th>
            </tr></thead>
            <tbody>
              {issues.map((issue)=>{
                const st = statusInfo('issue', issue.status);
                return <tr key={issue.id}>
                  <td data-label="เลขที่เบิก"><Link to={`/stock-issues/${issue.id}`} className="ops-doc-link">{issue.issueNo}</Link></td>
                  <td data-label="วันที่">{new Date(issue.issuedAt??issue.issueDate).toLocaleDateString('th-TH')}</td>
                  <td data-label="ออเดอร์ / ลูกค้า">{issue.order ? <span className="ops-two-line"><b>{issue.order.orderNo}</b><small>{issue.order.customer.name}</small></span> : <span className="subtle">เบิกใช้ภายใน</span>}</td>
                  <td className="num" data-label="รายการ">{issue.items.length}</td>
                  <td data-label="สถานะ"><span className={`badge ${STATUS_BADGE[st.tone]}`}>{st.label}</span></td>
                  <td data-label="ผู้ขอเบิก">{issue.createdBy.fullName}</td>
                  <td data-label="เอกสาร"><button type="button" className="btn" onClick={()=>void openDocument(`/business/documents/STOCK_ISSUE_SLIP/${issue.id}.pdf`)}><FileDown aria-hidden width={15}/>PDF</button></td>
                </tr>;
              })}
            </tbody>
          </table></div>}
    </ContentCard>
  </PageContainer>;
}
