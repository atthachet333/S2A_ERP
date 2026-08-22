import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  AlertTriangle, ArrowDownToLine, ArrowUpFromLine, Boxes, ClipboardCheck, FileDown, History,
  PackageCheck, PackageX, Pencil, Printer, RotateCcw, SlidersHorizontal, Warehouse as WarehouseIcon, X,
} from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/auth/AuthContext';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';
import { STATUS_BADGE, movementInfo, refTypeLink, statusInfo } from '@/lib/operations-vocab';
import { adjustmentPreview } from '@/lib/adjustment-preview';
import { isOverReserved, stockEquation } from '@/lib/inventory-inspector';
import { historySummary, toPrintPayload, type AdjustmentHistoryRow, type PrintPayload } from '@/lib/adjustment-history';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { StickySummary } from '@/components/layout/page';
import { useToast } from '@/components/ui/Toast';
import EmptyState from '@/components/ui/EmptyState';
import { AdjustmentPrintNote } from './OperationDetailPages';

type StockStatus = 'IN_STOCK' | 'LOW' | 'OUT' | 'NEGATIVE';
interface InventoryRow {
  itemId: string; code: string; name: string; type: string;
  warehouseId: string; warehouseCode: string; warehouseName: string;
  onHand: number; reserved: number; available: number;
  unit: string; lastCost: number; stockValue: number;
  threshold: number; status: StockStatus; lastMovementAt: string | null;
}
interface InventoryKpi {
  itemCount: number; totalValue: number; lowCount: number; outCount: number;
  negativeCount: number; movementsToday: number; thresholdMissing: boolean;
}
interface Movement {
  id: string; createdAt: string; movementType: string;
  refType: string | null; refId: string | null; refNo: string | null;
  itemCode: string; itemName: string; warehouseCode: string; warehouseName: string;
  beforeQty: number | null; qtyIn: number; qtyOut: number; balanceAfter: number;
  unit: string | null; reason: string | null; note: string | null;
}
type WarehouseOption = { id: string; code: string; name: string };

const money = (v: number) => `฿${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 4 });

const STATUS_TH: Record<StockStatus, string> = { IN_STOCK: 'มีสต็อก', LOW: 'ใกล้หมด', OUT: 'หมด', NEGATIVE: 'ติดลบ' };
/** คลาส badge ของสถานะสต็อก — คู่กับ STATUS_TH ชุดเดียวกัน ไม่ map ซ้ำที่อื่น */
const STOCK_BADGE: Record<StockStatus, string> = { IN_STOCK: 'success', LOW: 'warning', OUT: 'danger', NEGATIVE: 'danger' };
const REASONS = [
  { value: 'COUNT', label: 'นับสต็อกจริง' }, { value: 'DAMAGED', label: 'ชำรุด' },
  { value: 'EXPIRED', label: 'ของเสีย/หมดอายุ' }, { value: 'LOST', label: 'สูญหาย' },
  { value: 'OPENING', label: 'ยอดยกมา' }, { value: 'DOC_FIX', label: 'แก้ไขเอกสารผิด' },
  { value: 'OTHER', label: 'อื่น ๆ' },
];

/** ลิงก์กลับไปเอกสารต้นทางของ movement — ใช้ตารางกลางใน operations-vocab */
const sourceLink = (m: Movement) => refTypeLink(m.refType);

/** มุมมองสต็อกจริง — อ่านอย่างเดียว แก้จำนวนได้ทางหน้าปรับปรุงสต็อกเท่านั้น */
export function InventoryPage() {
  const { user } = useAuth();
  const canAdjust = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('INVENTORY_ADJUST'));
  // มาจากปุ่ม "ดูสต็อกในคลัง" ในหน้าคลัง — ตั้งตัวกรองคลังให้ตั้งแต่เปิดหน้า
  const { search: locationSearch } = useLocation();
  const warehouseParam = new URLSearchParams(locationSearch).get('warehouse') ?? '';

  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [kpi, setKpi] = useState<InventoryKpi>();
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [keyword, setKeyword] = useState('');
  const [warehouseId, setWarehouseId] = useState(warehouseParam);
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<InventoryRow | null>(null);
  const [history, setHistory] = useState<Movement[]>([]);

  const query = () => {
    const p = new URLSearchParams();
    if (keyword.trim()) p.set('keyword', keyword.trim());
    if (warehouseId) p.set('warehouseId', warehouseId);
    if (type) p.set('type', type);
    if (status) p.set('status', status);
    return p.toString();
  };

  const load = async () => {
    try {
      const [data, lookups] = await Promise.all([
        apiClient.get<{ rows: InventoryRow[]; kpi: InventoryKpi }>(`/business/inventory?${query()}`),
        apiClient.get<{ warehouses: WarehouseOption[] }>('/business/operations/lookups'),
      ]);
      setRows(data.rows); setKpi(data.kpi); setWarehouses(lookups.warehouses);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลสต็อกไม่สำเร็จ'); }
  };
  useEffect(() => {
    const t = setTimeout(() => { void load(); }, keyword ? 300 : 0);
    return () => clearTimeout(t);
  }, [keyword, warehouseId, type, status]); // eslint-disable-line react-hooks/exhaustive-deps

  // เปลี่ยน ?warehouse= (เช่นกดจากหน้าคลังคนละแห่ง) ให้ตัวกรองตามไปด้วย
  useEffect(() => { if (warehouseParam) setWarehouseId(warehouseParam); }, [warehouseParam]);

  const openDetail = async (row: InventoryRow) => {
    setSelected(row); setHistory([]);
    try {
      const list = await apiClient.get<Movement[]>(`/business/stock-movements?itemId=${row.itemId}&warehouseId=${row.warehouseId}&take=100`);
      setHistory(list);
    } catch { /* รายการว่างไว้ ถ้าโหลดไม่ได้ */ }
  };

  return <PageContainer size="wide" className="ops-page inventory-page">
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title="คลังสินค้า"
      description="มุมมองสต็อกจริงจากบัญชีการเคลื่อนไหว — แก้จำนวนได้ที่หน้าปรับปรุงสต็อกเท่านั้น"
      actions={<>
        <Link to="/inventory/movements" className="btn"><History aria-hidden width={16} />ประวัติสต็อก</Link>
        {canAdjust && <Link to="/inventory/adjustments" className="btn primary"><SlidersHorizontal aria-hidden width={16} />ปรับปรุงสต็อก</Link>}
      </>}
    />

    {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

    {kpi && <KPIGrid columns={5}>
      <KPICard label="รายการสินค้า" value={kpi.itemCount} icon={<Boxes />} hint="ทุกสถานะ"
        onClick={() => setStatus('')} active={!status} />
      <KPICard label="มูลค่าสต็อกรวม" value={money(kpi.totalValue)} icon={<WarehouseIcon />} hint="คงเหลือ × ต้นทุนล่าสุด" />
      <KPICard label="ใกล้หมด" value={kpi.lowCount} icon={<AlertTriangle />} tone={kpi.lowCount ? 'warning' : 'default'}
        hint="ถึงจุดสั่งซื้อที่ตั้งไว้" onClick={() => setStatus('LOW')} active={status === 'LOW'} />
      <KPICard label="หมด" value={kpi.outCount} icon={<PackageX />} tone={kpi.outCount ? 'danger' : 'default'}
        hint="คงเหลือเป็นศูนย์" onClick={() => setStatus('OUT')} active={status === 'OUT'} />
      {kpi.negativeCount > 0
        ? <KPICard label="ติดลบ" value={kpi.negativeCount} icon={<AlertTriangle />} tone="danger"
            hint="ต้องตรวจย้อนหลัง" onClick={() => setStatus('NEGATIVE')} active={status === 'NEGATIVE'} />
        : <KPICard label="เคลื่อนไหววันนี้" value={kpi.movementsToday} icon={<History />} hint="รายการเดินสต็อกวันนี้" />}
    </KPIGrid>}

    {kpi?.thresholdMissing && <p className="inv-note"><AlertTriangle aria-hidden width={15} />บางรายการยังไม่ได้ตั้งจุดสั่งซื้อ/ยอดต่ำสุด ระบบจึงไม่นับว่า “ใกล้หมด” ให้ (ตั้งค่าได้ที่หน้าวัตถุดิบ)</p>}

    <FilterBar actions={(keyword || warehouseId || type || status)
      ? <button type="button" className="btn" onClick={() => { setKeyword(''); setWarehouseId(''); setType(''); setStatus(''); }}>ล้างตัวกรอง</button>
      : undefined}>
      <input className="s2-search" value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="ค้นหารหัสหรือชื่อสินค้า" aria-label="ค้นหาสินค้า" />
      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="คลัง">
        <option value="">ทุกคลัง</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
      <select value={type} onChange={(e) => setType(e.target.value)} aria-label="ประเภท">
        <option value="">ทุกประเภท</option><option value="RAW_MATERIAL">วัตถุดิบ</option><option value="PACKAGING">บรรจุภัณฑ์</option>
      </select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะสต็อก">
        <option value="">ทุกสถานะ</option>
        {(Object.keys(STATUS_TH) as StockStatus[]).map((s) => <option key={s} value={s}>{STATUS_TH[s]}</option>)}
      </select>
    </FilterBar>

    <table className="unit-table inv-table">
      <thead><tr>
        <th>รหัส</th><th>สินค้า</th><th>ประเภท</th><th>คลัง</th><th>คงเหลือ</th><th>จองแล้ว</th><th>พร้อมใช้</th>
        <th>หน่วย</th><th>ต้นทุนล่าสุด</th><th>มูลค่าสต็อก</th><th>เคลื่อนไหวล่าสุด</th><th>สถานะ</th><th />
      </tr></thead>
      <tbody>
        {rows.map((r) => <tr key={`${r.itemId}-${r.warehouseId}`} className="inv-row" onClick={() => void openDetail(r)}>
          <td data-label="รหัส"><span className="unit-code">{r.code}</span></td>
          <td data-label="สินค้า">{r.name}</td>
          <td data-label="ประเภท">{r.type === 'PACKAGING' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}</td>
          <td data-label="คลัง">{r.warehouseName}</td>
          <td data-label="คงเหลือ">{qty(r.onHand)}</td>
          <td data-label="จองแล้ว">{qty(r.reserved)}</td>
          <td data-label="พร้อมใช้"><b>{qty(r.available)}</b></td>
          <td data-label="หน่วย">{r.unit}</td>
          <td data-label="ต้นทุนล่าสุด">{r.lastCost.toLocaleString('en-US', { maximumFractionDigits: 4 })}</td>
          <td data-label="มูลค่าสต็อก">{money(r.stockValue)}</td>
          <td data-label="เคลื่อนไหวล่าสุด">{r.lastMovementAt ? new Date(r.lastMovementAt).toLocaleDateString('th-TH') : '—'}</td>
          <td data-label="สถานะ"><span className={`stock-pill ${r.status.toLowerCase()}`}>{STATUS_TH[r.status]}</span></td>
          {/* ปุ่มจริงเพื่อให้เปิดด้วยคีย์บอร์ดได้ ไม่ใช่ onClick บน tr อย่างเดียว */}
          <td data-label=""><button type="button" className="inv-open"
            onClick={(e) => { e.stopPropagation(); void openDetail(r); }}
            aria-label={`ดูรายละเอียด ${r.name}`}>ดูรายละเอียด</button></td>
        </tr>)}
      </tbody>
    </table>
    {rows.length === 0 && <div className="business-empty"><Boxes aria-hidden /><h2>ยังไม่มีสต็อกตามเงื่อนไขนี้</h2><p>รับของเข้าคลังเพื่อเริ่มมีสต็อก</p><Link to="/receiving/new">+ รับของเข้า</Link></div>}

    {selected && <InventoryInspector row={selected} history={history} canAdjust={canAdjust} onClose={() => setSelected(null)} />}
  </PageContainer>;
}

/**
 * แผงรายละเอียดสินค้า — เดสก์ท็อปเป็นแผงด้านขวา มือถือเป็น bottom sheet
 * ลำดับข้อมูล: พร้อมใช้ (ตัวเลขที่ใช้ตัดสินใจจริง) → สมการที่มา → ตัวเลขประกอบ → การจัดการ → ประวัติ
 */
function InventoryInspector({ row, history, canAdjust, onClose }: {
  row: InventoryRow; history: Movement[]; canAdjust: boolean; onClose: () => void;
}) {
  const panelRef = useRef<HTMLElement>(null);

  // ESC ปิด, ล็อกการเลื่อนพื้นหลัง, และคืนโฟกัสให้แถวที่กดมาเมื่อปิด
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    panelRef.current?.focus();
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      opener?.focus?.();
    };
  }, [onClose]);

  const eq = stockEquation(row.onHand, row.reserved, row.available, row.unit);
  const recent = history.slice(0, 8);
  const typeLabel = row.type === 'PACKAGING' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ';

  return <div className="inv-inspector-scrim" role="presentation" onMouseDown={onClose}>
    <section
      ref={panelRef} tabIndex={-1} className="inv-inspector"
      role="dialog" aria-modal="true" aria-labelledby="inv-inspector-title"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <header className="inv-inspector-head">
        <div>
          <p className="inv-inspector-code">{row.code}</p>
          <h2 id="inv-inspector-title">{row.name}</h2>
          <p className="inv-inspector-facts">
            <span>{typeLabel}</span><span className="dot">·</span>
            <span>{row.warehouseName}</span><span className="dot">·</span>
            <span className={`badge ${STOCK_BADGE[row.status]}`}>{STATUS_TH[row.status]}</span>
          </p>
        </div>
        <button type="button" className="btn icon-btn inv-inspector-close" onClick={onClose} aria-label="ปิดแผงรายละเอียด">
          <X aria-hidden width={17} />
        </button>
      </header>

      <div className="inv-inspector-body">
        <section>
          <div className="inv-metric-lead">
            <span>พร้อมใช้</span>
            <strong>{qty(row.available)} {row.unit}</strong>
            {eq.equation
              ? <p className="inv-equation">{eq.equation}</p>
              : <p className="inv-equation">{eq.allAvailable ? 'พร้อมใช้ทั้งหมด' : 'ยอดพร้อมใช้มาจากระบบ'}</p>}
            <p className="inv-equation inv-equation-note">{eq.note}</p>
          </div>

          <div className="inv-metric-grid">
            <div><span>คงเหลือ</span><b>{qty(row.onHand)} {row.unit}</b></div>
            <div><span>จองแล้ว</span><b>{qty(row.reserved)} {row.unit}</b></div>
            <div><span>ต้นทุนล่าสุด</span><b>{row.lastCost.toLocaleString('en-US', { maximumFractionDigits: 4 })}/{row.unit}</b></div>
            <div><span>มูลค่าสต็อก</span><b>{money(row.stockValue)}</b></div>
            <div><span>จุดสั่งซื้อ</span><b>{row.threshold > 0 ? `${qty(row.threshold)} ${row.unit}` : '—'}</b></div>
            <div><span>เคลื่อนไหวล่าสุด</span><b>{row.lastMovementAt ? new Date(row.lastMovementAt).toLocaleDateString('th-TH') : '—'}</b></div>
          </div>

          {isOverReserved(row.onHand, row.reserved) && <div className="rb-callout warn" role="note">
            <AlertTriangle aria-hidden /><div><strong>ของที่จองไว้มากกว่าของที่มีอยู่จริง</strong> ควรตรวจออเดอร์ที่ค้างอยู่</div>
          </div>}
        </section>

        <section>
          <h3>การจัดการ</h3>
          <div className="inv-inspector-actions">
            <Link className="btn" to={row.type === 'PACKAGING' ? `/packaging/${row.itemId}` : `/ingredients/${row.itemId}`}>
              <Pencil aria-hidden width={15} />แก้ไขข้อมูลสินค้า
            </Link>
            <Link className="btn" to={`/inventory/movements?ref=${encodeURIComponent(row.code)}`}>
              <History aria-hidden width={15} />ดูประวัติทั้งหมด
            </Link>
            {canAdjust && <Link className="btn primary" to="/inventory/adjustments">
              <SlidersHorizontal aria-hidden width={15} />ปรับปรุงสต็อก
            </Link>}
          </div>
          <p className="inv-inspector-hint">จำนวนสต็อกแก้ตรงนี้ไม่ได้ ต้องทำผ่านการปรับปรุงสต็อกเพื่อให้มีบัญชีการเคลื่อนไหวกำกับทุกครั้ง</p>
        </section>

        <section className="inv-inspector-movements">
          <h3>การเคลื่อนไหวล่าสุด</h3>
          <MovementTable rows={recent} compact />
          {history.length > recent.length && <p>
            <Link className="inline-link inv-inspector-more" to={`/inventory/movements?ref=${encodeURIComponent(row.code)}`}>
              ดูทั้งหมด {history.length} รายการ
            </Link>
          </p>}
        </section>
      </div>
    </section>
  </div>;
}

/** ตารางบัญชีการเคลื่อนไหว ใช้ทั้งใน drawer และหน้าประวัติสต็อก */
function MovementTable({ rows, compact }: { rows: Movement[]; compact?: boolean }) {
  if (rows.length === 0) return <p className="issue-none">ยังไม่มีการเคลื่อนไหว</p>;
  return <table className="unit-table mv-table">
    <thead><tr>
      <th>วันที่</th><th>เอกสาร</th><th>ประเภท</th><th>เข้า</th><th>ออก</th>
      {!compact && <th>ก่อนรายการ</th>}<th>คงเหลือ</th>{!compact && <th>หมายเหตุ</th>}
    </tr></thead>
    <tbody>
      {rows.map((m) => {
        const link = sourceLink(m);
        return <tr key={m.id}>
          <td data-label="วันที่">{new Date(m.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td data-label="เอกสาร">{link ? <Link to={link} className="inline-link">{m.refNo ?? '—'}</Link> : (m.refNo ?? '—')}</td>
          {/* ไอคอน + ข้อความชุดเดียว: เดิมมีไอคอนของกรอบสถานะและของประเภทซ้อนกันสองอัน */}
          <td data-label="ประเภท">{(() => {
            const mi = movementInfo(m.movementType, m.reason);
            return <span className={`mv-type mv-${mi.tone}`}>
              {mi.tone === 'in' ? <ArrowDownToLine aria-hidden width={13} />
                : mi.tone === 'out' ? <ArrowUpFromLine aria-hidden width={13} />
                : <RotateCcw aria-hidden width={13} />}
              {mi.label}
            </span>;
          })()}</td>
          <td data-label="เข้า">{m.qtyIn > 0 ? qty(m.qtyIn) : '—'}</td>
          <td data-label="ออก">{m.qtyOut > 0 ? qty(m.qtyOut) : '—'}</td>
          {!compact && <td data-label="ก่อนรายการ">{m.beforeQty != null ? qty(m.beforeQty) : '—'}</td>}
          <td data-label="คงเหลือ"><b>{qty(m.balanceAfter)}</b></td>
          {!compact && <td data-label="หมายเหตุ">{m.note ?? m.reason ?? '—'}</td>}
        </tr>;
      })}
    </tbody>
  </table>;
}

/** หน้าประวัติสต็อกรวมทุกคลัง/สินค้า */
export function MovementHistoryPage() {
  const { search } = useLocation();
  // อ่านเลขเอกสารจาก query string เช่น /inventory/movements?ref=RI-... แล้วกรองให้ทันที
  const refParam = new URLSearchParams(search).get('ref') ?? '';
  const [rows, setRows] = useState<Movement[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [docNo, setDocNo] = useState(refParam);
  const [error, setError] = useState('');

  // ถ้า ?ref= เปลี่ยน (เช่นกดลิงก์จากเอกสารอื่น) ให้เติมคำค้นใหม่
  useEffect(() => { setDocNo(refParam); }, [refParam]);

  useEffect(() => {
    const run = async () => {
      try {
        const [list, lookups] = await Promise.all([
          apiClient.get<Movement[]>(`/business/stock-movements?take=300${warehouseId ? `&warehouseId=${warehouseId}` : ''}`),
          apiClient.get<{ warehouses: WarehouseOption[] }>('/business/operations/lookups'),
        ]);
        setRows(list); setWarehouses(lookups.warehouses);
      } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดประวัติสต็อกไม่สำเร็จ'); }
    };
    void run();
  }, [warehouseId]);

  const visible = useMemo(() => {
    const q = docNo.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((m) => `${m.refNo ?? ''} ${m.itemCode} ${m.itemName}`.toLowerCase().includes(q));
  }, [rows, docNo]);

  return <PageContainer size="wide" className="ops-page inventory-page">
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title="ประวัติการเคลื่อนไหวสต็อก"
      description="ทุกการเปลี่ยนแปลงสต็อกมีเอกสารกำกับและตรวจย้อนหลังได้"
      actions={<Link to="/inventory" className="btn"><WarehouseIcon aria-hidden width={16} />กลับหน้าคลังสินค้า</Link>}
    />
    {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}
    <FilterBar actions={(docNo || warehouseId)
      ? <button type="button" className="btn" onClick={() => { setDocNo(''); setWarehouseId(''); }}>ล้างตัวกรอง</button>
      : undefined}>
      <input className="s2-search" value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder="ค้นหาเลขเอกสาร / สินค้า" aria-label="ค้นหาการเคลื่อนไหว" />
      <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} aria-label="คลัง">
        <option value="">ทุกคลัง</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
      </select>
    </FilterBar>
    <ContentCard title="รายการเคลื่อนไหว" description={`${visible.length} รายการ`} padded={false}>
      {visible.length === 0
        ? <EmptyState icon={History} title="ไม่พบการเคลื่อนไหวตามตัวกรอง" description="ลองล้างตัวกรองหรือเปลี่ยนคำค้น" />
        : <MovementTable rows={visible} />}
    </ContentCard>
  </PageContainer>;
}

/** ปรับปรุงสต็อก — ทางเดียวที่แก้จำนวนได้ ทุกครั้งมี ledger กำกับ */
export function StockAdjustmentPage() {
  const { toast } = useToast();
  const { pathname } = useLocation();
  const { user } = useAuth();
  const canAdjust = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('INVENTORY_ADJUST'));

  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [stock, setStock] = useState<InventoryRow[]>([]);
  // backend คืน StockAdjustmentItem ครบทุกคอลัมน์อยู่แล้ว (systemQty = ก่อน, countedQty = หลัง, diffQty = เปลี่ยน)
  // เดิมประกาศ type ไว้แค่ diffQty เลยพิมพ์ย้อนหลังไม่ได้ ทั้งที่ข้อมูลมีอยู่
  const [history, setHistory] = useState<AdjustmentHistoryRow[]>([]);
  /** เอกสารที่ผู้ใช้เลือกพิมพ์จากประวัติ — แยกจาก printDoc (ใบที่เพิ่งบันทึก) เด็ดขาด
   *  ไม่งั้นกดพิมพ์แถวเก่าแล้วจะได้ใบล่าสุดแทน */
  const [selectedPrintAdjustment, setSelectedPrintAdjustment] = useState<PrintPayload | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState('');
  const [itemId, setItemId] = useState('');
  const [mode, setMode] = useState<'INCREASE' | 'DECREASE' | 'SET'>('SET');
  const [amount, setAmount] = useState(0);
  const [reason, setReason] = useState('COUNT');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** เอกสารล่าสุดที่บันทึก เก็บไว้เพื่อพิมพ์ใบปรับปรุงสต็อก A4 */
  const [printDoc, setPrintDoc] = useState<{ adjustmentNo: string; warehouse: string; reason: string; note?: string | null; rows: { name: string; code: string; before: number; change: number; after: number; unit: string }[] } | null>(null);

  const load = async () => {
    try {
      const [lookups, list] = await Promise.all([
        apiClient.get<{ warehouses: WarehouseOption[] }>('/business/operations/lookups'),
        apiClient.get<typeof history>('/business/inventory/adjustments'),
      ]);
      setWarehouses(lookups.warehouses); setHistory(list);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลดข้อมูลไม่สำเร็จ'); }
  };
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!warehouseId) { setStock([]); return; }
    const run = async () => {
      try {
        const data = await apiClient.get<{ rows: InventoryRow[] }>(`/business/inventory?warehouseId=${warehouseId}`);
        setStock(data.rows);
      } catch { setStock([]); }
    };
    void run();
  }, [warehouseId]);

  /** สร้าง payload สำหรับพิมพ์จาก "แถวประวัติที่เลือก" เท่านั้น */
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  /**
   * ดาวน์โหลดใบปรับปรุงสต็อกเป็น PDF ของ "แถวที่กด" เท่านั้น
   * ใช้ row.id ตรง ๆ ไม่แตะ printDoc/historyDoc เพื่อไม่ให้ได้ใบล่าสุดมาแทน
   */
  const downloadAdjustmentPdf = async (row: AdjustmentHistoryRow) => {
    setPdfBusy(row.id);
    try {
      await apiClient.download(`/business/documents/STOCK_ADJUSTMENT_SLIP/${row.id}.pdf`,
        { expect: 'pdf', fallbackName: `AJ-${row.adjustmentNo}.pdf` });
      toast({ title: `ดาวน์โหลด ${row.adjustmentNo} แล้ว`, variant: 'success' });
    } catch (reason) {
      toast({ title: 'ดาวน์โหลด PDF ไม่สำเร็จ', description: reason instanceof Error ? reason.message : '', variant: 'error' });
    } finally { setPdfBusy(null); }
  };

  const printHistoryRow = (row: AdjustmentHistoryRow) => {
    setPrintDoc(null);                       // กันไม่ให้ใบที่เพิ่งบันทึกถูกพิมพ์ปนมา
    setSelectedPrintAdjustment(toPrintPayload(row, stock));
    window.setTimeout(() => window.print(), 60);
  };

  const current = stock.find((s) => s.itemId === itemId);
  const onHand = current?.onHand ?? 0;
  const change = mode === 'SET' ? amount - onHand : mode === 'INCREASE' ? amount : -amount;
  const after = onHand + change;
  const invalid = !warehouseId ? 'เลือกคลัง' : !itemId ? 'เลือกสินค้า' : change === 0 ? 'จำนวนไม่เปลี่ยนแปลง' : after < 0 ? 'ปรับแล้วสต็อกจะติดลบ — ไม่อนุญาต' : '';

  const submit = async () => {
    if (busy || invalid) return;
    setBusy(true); setError('');
    try {
      const created = await apiClient.post<{ adjustmentNo: string }>('/business/inventory/adjustments', {
        warehouseId, reason, note: note || undefined,
        items: [{ itemId, mode, quantity: amount }],
      });
      setPrintDoc({
        adjustmentNo: created.adjustmentNo,
        warehouse: warehouses.find((w) => w.id === warehouseId)?.name ?? '',
        reason: REASONS.find((r) => r.value === reason)?.label ?? reason,
        note,
        rows: [{ name: current?.name ?? '', code: current?.code ?? '', before: onHand, change, after, unit: current?.unit ?? '' }],
      });
      toast({ title: `ปรับปรุงสต็อก ${created.adjustmentNo} แล้ว`, description: 'บันทึกบัญชีการเคลื่อนไหวเรียบร้อย · พิมพ์ใบปรับปรุงได้จากปุ่มด้านบน', variant: 'success' });
      setItemId(''); setAmount(0); setNote('');
      await load();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'ปรับปรุงสต็อกไม่สำเร็จ';
      setError(message);
      toast({ title: 'ปรับปรุงสต็อกไม่สำเร็จ', description: message, variant: 'error' });
    } finally { setBusy(false); }
  };

  if (!canAdjust) return <PageContainer size="wide" className="ops-page inventory-page">
    <PageHeader breadcrumb="ออเดอร์และปฏิบัติการ" title="ปรับปรุงสต็อก" />
    <ContentCard>
      <EmptyState icon={AlertTriangle} title="ไม่มีสิทธิ์ปรับปรุงสต็อก"
        description="ต้องมีสิทธิ์ INVENTORY_ADJUST จึงจะแก้ไขจำนวนสต็อกได้"
        action={<Link to="/inventory" className="btn primary">กลับหน้าคลังสินค้า</Link>} />
    </ContentCard>
  </PageContainer>;

  const preview = adjustmentPreview(mode, amount, onHand, current?.unit ?? '');
  const reasonLabel = REASONS.find((r) => r.value === reason)?.label ?? reason;
  const warehouseName = warehouses.find((w) => w.id === warehouseId)?.name ?? '—';

  return <PageContainer size="wide" className="ops-page inventory-page adjustment-workspace" data-page={pathname}>
    <PageHeader
      breadcrumb="ออเดอร์และปฏิบัติการ"
      title="ปรับปรุงสต็อก"
      description="ใช้เมื่อจำนวนในระบบไม่ตรงกับของจริง หรือมีของเสีย ชำรุด สูญหาย หรือจำเป็นต้องแก้ไขยอด"
      actions={<Link to="/inventory" className="btn"><WarehouseIcon aria-hidden width={16} />กลับหน้าคลังสินค้า</Link>}
    />

    {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

    <div className="rb-callout warn adj-notice" role="note">
      <ClipboardCheck aria-hidden />
      <div><strong>ทุกการปรับปรุงจะถูกบันทึกในประวัติสต็อก และไม่ลบ movement เดิม</strong></div>
    </div>

    {printDoc && <p className="inv-note no-print"><ClipboardCheck aria-hidden width={15} />บันทึก {printDoc.adjustmentNo} แล้ว — กด “พิมพ์ใบปรับปรุง” เพื่อออกเอกสาร A4</p>}
    {/* พิมพ์ได้ทีละใบเท่านั้น: ใบที่เพิ่งบันทึก หรือใบที่เลือกจากประวัติ */}
    {selectedPrintAdjustment ? <AdjustmentPrintNote {...selectedPrintAdjustment} />
      : printDoc ? <AdjustmentPrintNote {...printDoc} /> : null}

    <div className="ops-workspace">
      <div className="ops-workspace-main">
        <ContentCard title="เลือกคลังและสินค้า" description="เลือกคลังก่อน ระบบจะโหลดสินค้าที่มีอยู่จริงในคลังนั้น">
          <div className="ops-field-grid">
            <label>คลัง *
              <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setItemId(''); }}>
                <option value="">เลือกคลัง</option>{warehouses.map((w) => <option key={w.id} value={w.id}>{w.code} · {w.name}</option>)}
              </select>
            </label>
            <label>สินค้า *
              <select value={itemId} onChange={(e) => setItemId(e.target.value)} disabled={!warehouseId}>
                <option value="">{warehouseId ? 'เลือกสินค้า' : 'เลือกคลังก่อน'}</option>
                {stock.map((x) => <option key={x.itemId} value={x.itemId}>{x.code} · {x.name} (คงเหลือ {qty(x.onHand)} {x.unit})</option>)}
              </select>
            </label>
            <label>ผู้ทำรายการ<input value={user?.fullName ?? ''} readOnly disabled /></label>
          </div>
        </ContentCard>

        {current && <ContentCard title="จำนวนปัจจุบัน" description="ยอดจากบัญชีการเคลื่อนไหวล่าสุด">
          <div className="adj-current">
            <div><span>คงเหลือ</span><b className="num">{qty(current.onHand)} {current.unit}</b></div>
            <div><span>จองแล้ว</span><b className="num">{qty(current.reserved)} {current.unit}</b></div>
            <div><span>พร้อมใช้</span><b className="num">{qty(current.available)} {current.unit}</b></div>
            <div><span>สถานะ</span><b><span className={`badge ${STOCK_BADGE[current.status]}`}>{STATUS_TH[current.status]}</span></b></div>
          </div>
        </ContentCard>}

        <ContentCard title="วิธีปรับปรุง" description="เลือกว่าจะเพิ่ม ลด หรือตั้งยอดตามที่นับได้จริง">
          <div className="adj-modes rb2-tabs" role="radiogroup" aria-label="วิธีปรับปรุง">
            {([['INCREASE', 'เพิ่ม'], ['DECREASE', 'ลด'], ['SET', 'ตั้งยอดตามที่นับจริง']] as const).map(([m, label]) => (
              <button type="button" key={m} role="radio" aria-checked={mode === m}
                className={mode === m ? 'active' : ''} onClick={() => setMode(m)}>{label}</button>
            ))}
          </div>

          <label className="adj-amount">{mode === 'SET' ? 'จำนวนที่นับได้จริง' : mode === 'INCREASE' ? 'จำนวนที่ต้องการเพิ่ม' : 'จำนวนที่ต้องการลด'}
            <span><input type="number" min="0" step="0.0001" value={amount}
              onChange={(e) => setAmount(Number(e.target.value))} aria-label="จำนวน" /><b>{current?.unit ?? ''}</b></span>
          </label>

          {/* จุดเด่นของหน้า: ก่อน → เปลี่ยน → หลัง */}
          {current && <div className="adj-preview" role="status">
            {mode === 'SET' && <div className="adj-set-note">
              <span>ยอดในระบบ <b className="num">{qty(preview.before)} {current.unit}</b></span>
              <span>นับจริง <b className="num">{qty(preview.entered)} {current.unit}</b></span>
              <span>ระบบจะปรับ <b className={`num ${preview.change < 0 ? 'is-down' : preview.change > 0 ? 'is-up' : ''}`}>{preview.change > 0 ? '+' : ''}{qty(preview.change)} {current.unit}</b></span>
            </div>}
            <div className="adj-steps">
              <div><span>ก่อนปรับ</span><strong className="num">{qty(preview.before)} {current.unit}</strong></div>
              <div className="adj-arrow" aria-hidden>→</div>
              <div><span>เปลี่ยน</span><strong className={`num ${preview.change < 0 ? 'is-down' : preview.change > 0 ? 'is-up' : ''}`}>{preview.change > 0 ? '+' : ''}{qty(preview.change)} {current.unit}</strong></div>
              <div className="adj-arrow" aria-hidden>→</div>
              <div><span>หลังปรับ</span><strong className={`num ${preview.wouldGoNegative ? 'is-down' : ''}`}>{qty(preview.after)} {current.unit}</strong></div>
            </div>
            <p className="adj-equation num">{preview.equation}</p>
            {preview.noChange && <p className="adj-neutral"><ClipboardCheck aria-hidden width={15} />จำนวนที่นับได้ตรงกับยอดในระบบ ไม่มีการเปลี่ยนแปลง</p>}
            {preview.wouldGoNegative && <div className="rb-callout warn" role="alert">
              <AlertTriangle aria-hidden />
              <div><strong>ยอดหลังปรับจะติดลบ</strong>
                <span>คงเหลือ {qty(preview.before)} {current.unit} · ลด {qty(Math.abs(preview.change))} {current.unit} · หลังปรับ {qty(preview.after)} {current.unit}</span>
              </div>
            </div>}
          </div>}
        </ContentCard>

        <ContentCard title="เหตุผล" description="ต้องระบุเหตุผลทุกครั้งเพื่อให้ตรวจย้อนหลังได้">
          <div className="adj-reasons" role="radiogroup" aria-label="เหตุผล">
            {REASONS.map((r) => (
              <button type="button" key={r.value} role="radio" aria-checked={reason === r.value}
                className={`adj-reason${reason === r.value ? ' active' : ''}`} onClick={() => setReason(r.value)}>{r.label}</button>
            ))}
          </div>
          <label className="ops-note-field">หมายเหตุ (ไม่บังคับ)
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="รายละเอียดเพิ่มเติม เช่น รอบการนับ หรือเลขเอกสารอ้างอิง" />
          </label>
        </ContentCard>
      </div>

      <StickySummary className="ops-summary-panel">
        <div className="ops-sum">
          <h2><SlidersHorizontal aria-hidden />ตรวจก่อนบันทึก</h2>
          <dl>
            <div><dt>เลขที่</dt><dd>ระบบออกเลข AJ ให้อัตโนมัติ</dd></div>
            <div><dt>คลัง</dt><dd>{warehouseName}</dd></div>
            <div><dt>สินค้า</dt><dd>{current ? current.name : '—'}</dd></div>
            <div><dt>ก่อนปรับ</dt><dd className="num">{qty(preview.before)} {current?.unit ?? ''}</dd></div>
            <div><dt>เปลี่ยน</dt><dd className={`num ${preview.change < 0 ? 'is-down' : ''}`}>{preview.change > 0 ? '+' : ''}{qty(preview.change)}</dd></div>
            <div><dt>เหตุผล</dt><dd>{reasonLabel}</dd></div>
          </dl>
          <div className="ops-sum-total"><span>หลังปรับ</span><strong className="num">{qty(preview.after)} {current?.unit ?? ''}</strong></div>
          {invalid && <p className="ops-sum-warn"><AlertTriangle aria-hidden width={15} />{invalid}</p>}
          <p className="ops-sum-note"><ClipboardCheck aria-hidden width={15} />ระบบจะออกเลข AJ-… และบันทึกบัญชีการเคลื่อนไหวให้อัตโนมัติ</p>
          <div className="ops-sum-actions">
            <button type="button" className="btn primary" disabled={busy || Boolean(invalid)} onClick={() => setConfirmOpen(true)}>
              <PackageCheck aria-hidden />{busy ? 'กำลังบันทึก…' : 'ยืนยันปรับปรุงสต็อก'}
            </button>
          </div>
        </div>
      </StickySummary>
    </div>

    <ConfirmDialog
      open={confirmOpen}
      title="ยืนยันปรับปรุงสต็อก"
      confirmLabel="ยืนยันปรับปรุง"
      onClose={() => setConfirmOpen(false)}
      onConfirm={() => void submit()}
      description={<div className="op-confirm">
        <dl>
          <div><dt>เอกสาร</dt><dd>ระบบออกเลข AJ ให้อัตโนมัติ</dd></div>
          <div><dt>คลัง</dt><dd>{warehouseName}</dd></div>
          <div><dt>สินค้า</dt><dd>{current?.name ?? '—'}</dd></div>
          <div><dt>ก่อนปรับ</dt><dd>{qty(preview.before)} {current?.unit ?? ''}</dd></div>
          <div><dt>เปลี่ยน</dt><dd>{preview.change > 0 ? '+' : ''}{qty(preview.change)} {current?.unit ?? ''}</dd></div>
          <div><dt>หลังปรับ</dt><dd>{qty(preview.after)} {current?.unit ?? ''}</dd></div>
          <div><dt>เหตุผล</dt><dd>{reasonLabel}</dd></div>
        </dl>
        <p className="op-confirm-impact"><ClipboardCheck aria-hidden width={15} />การยืนยันจะ<b>สร้างรายการเดินสต็อก</b> และเก็บประวัติรายการนี้ไว้<b>ถาวร</b></p>
      </div>}
    />

    <ContentCard className="no-print" title="ประวัติการปรับปรุง" description={`${history.length} รายการล่าสุด`} padded={false}>
      {history.length === 0
        ? <EmptyState icon={ClipboardCheck} title="ยังไม่มีประวัติการปรับปรุง" description="เมื่อปรับปรุงสต็อกแล้ว รายการจะแสดงที่นี่" />
        : <div className="table-wrap"><table className="data-table ops-table">
            <thead><tr>
              <th>เลขที่</th><th>วันที่</th><th>คลัง</th><th>สินค้า</th>
              <th className="num">ก่อน</th><th className="num">เปลี่ยน</th><th className="num">หลัง</th>
              <th>เหตุผล</th><th>สถานะ</th><th>จัดการ</th>
            </tr></thead>
            <tbody>
              {history.map((h) => {
                const sum = historySummary(h);
                const st = statusInfo('adjustment', h.status);
                return <tr key={h.id}>
                  <td data-label="เลขที่"><b className="ops-doc-link">{h.adjustmentNo}</b></td>
                  <td data-label="วันที่">{new Date(h.adjustmentDate).toLocaleDateString('th-TH')}</td>
                  <td data-label="คลัง">{h.warehouse.name}</td>
                  <td data-label="สินค้า"><span className="ops-two-line"><b>{sum.itemName}</b><small>{sum.itemCode}</small></span></td>
                  <td className="num" data-label="ก่อน">{qty(sum.before)}</td>
                  <td className={`num ${sum.change < 0 ? 'is-down' : 'is-up'}`} data-label="เปลี่ยน">{sum.change > 0 ? '+' : ''}{qty(sum.change)}</td>
                  <td className="num" data-label="หลัง">{qty(sum.after)}</td>
                  <td data-label="เหตุผล">{REASONS.find((r) => r.value === h.reason)?.label ?? h.reason ?? '—'}</td>
                  <td data-label="สถานะ"><span className={`badge ${STATUS_BADGE[st.tone]}`}>{st.label}</span></td>
                  <td data-label="จัดการ"><span className="adj-row-actions">
                    <Link to={`/inventory/movements?ref=${h.adjustmentNo}`} className="btn" aria-label={`ดูการเคลื่อนไหวของ ${h.adjustmentNo}`}><History aria-hidden width={15} />Movement</Link>
                    <button type="button" className="btn" aria-label={`พิมพ์ใบปรับปรุง ${h.adjustmentNo}`} onClick={() => printHistoryRow(h)}><Printer aria-hidden width={15} />พิมพ์</button>
                    <button type="button" className="btn" aria-label={`ดาวน์โหลด PDF ${h.adjustmentNo}`} disabled={pdfBusy === h.id} onClick={() => void downloadAdjustmentPdf(h)}><FileDown aria-hidden width={15} />PDF</button>
                  </span></td>
                </tr>;
              })}
            </tbody>
          </table></div>}
    </ContentCard>
  </PageContainer>;
}
