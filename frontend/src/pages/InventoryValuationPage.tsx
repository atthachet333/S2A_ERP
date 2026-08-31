import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download, PackageSearch, Scale, Warehouse } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { ContentCard, FilterBar, KPICard, KPIGrid, PageContainer, PageHeader } from '@/components/layout/page';
import EmptyState from '@/components/ui/EmptyState';
import { displayEnum } from '@/lib/presentation';

type CostStatus = 'PRICED' | 'ZERO' | 'MISSING';
interface ValuationRow {
  itemId: string; itemCode: string; itemName: string; itemType: string;
  categoryId: string | null; categoryName: string | null;
  warehouseName: string; warehouseId: string;
  onHand: number; reserved: number; available: number; baseUnitCode: string;
  unitCost: number | null; value: number | null; costStatus: CostStatus; costSource: string;
}
interface Breakdown { name: string; knownValue: number; itemCount: number; unknownCostItems: number; negativeStockItems: number }
interface Valuation {
  basis: string; rows: ValuationRow[];
  summary: { knownValue: number; unknownCostStockCount: number; negativeStockCount: number; warehouses: number; completeness: { known: number; total: number; percent: number } };
  byWarehouse: Breakdown[]; byType: Breakdown[];
}
const money = (value: number | null) => value == null ? 'ไม่ทราบ' : `฿${value.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (value: number) => value.toLocaleString('th-TH', { maximumFractionDigits: 4 });

export default function InventoryValuationPage() {
  const [data, setData] = useState<Valuation>();
  const [lookups, setLookups] = useState<{ warehouses: { id: string; name: string }[]; categories: { id: string; name: string }[] }>({ warehouses: [], categories: [] });
  const [warehouseId, setWarehouseId] = useState('');
  const [type, setType] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [costStatus, setCostStatus] = useState('');
  const [stock, setStock] = useState('');
  const [error, setError] = useState('');
  const query = useMemo(() => {
    const q = new URLSearchParams();
    if (warehouseId) q.set('warehouseId', warehouseId);
    if (type) q.set('type', type);
    if (categoryId) q.set('categoryId', categoryId);
    if (costStatus) q.set('costStatus', costStatus);
    if (stock) q.set('stock', stock);
    return q.toString();
  }, [warehouseId, type, categoryId, costStatus, stock]);
  useEffect(() => {
    apiClient.get<Valuation>('/business/inventory/valuation').then((initial) => {
      setLookups({
        warehouses: [...new Map(initial.rows.map((r) => [r.warehouseId, { id: r.warehouseId, name: r.warehouseName }])).values()],
        categories: [...new Map(initial.rows.filter((r) => r.categoryId).map((r) => [r.categoryId!, { id: r.categoryId!, name: r.categoryName ?? r.categoryId! }])).values()],
      });
    }).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(() => {
    apiClient.get<Valuation>(`/business/inventory/valuation${query ? `?${query}` : ''}`).then(setData).catch((e: Error) => setError(e.message));
  }, [query]);
  return <PageContainer size="wide" className="analytics-page valuation-page">
    <PageHeader breadcrumb="คลังสินค้า" title="มูลค่าสินค้าคงคลัง" description={data?.basis ?? 'มูลค่าปัจจุบันจากต้นทุนต่อหน่วยฐาน'}
      actions={<button className="btn" onClick={() => void apiClient.download(`/business/inventory/valuation/export.xlsx${query ? `?${query}` : ''}`, { expect: 'xlsx', fallbackName: 'inventory-valuation.xlsx' })}><Download />Excel</button>} />
    {error && <div className="alert error">{error}</div>}
    <KPIGrid columns={4}>
      <KPICard label="มูลค่าที่ทราบ" value={money(data?.summary.knownValue ?? 0)} icon={<Scale />} />
      <KPICard label="สต็อกที่ไม่ทราบต้นทุน" value={data?.summary.unknownCostStockCount ?? 0} icon={<AlertTriangle />} />
      <KPICard label="สต็อกติดลบ" value={data?.summary.negativeStockCount ?? 0} icon={<PackageSearch />} />
      <KPICard label="ความครบถ้วน" value={data ? `${data.summary.completeness.known}/${data.summary.completeness.total} · ${data.summary.completeness.percent}%` : '—'} icon={<Warehouse />} />
    </KPIGrid>
    <FilterBar>
      <select aria-label="คลัง" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">ทุกคลัง</option>{lookups.warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}</select>
      <select aria-label="ประเภทสินค้า" value={type} onChange={(e) => setType(e.target.value)}><option value="">ทุกประเภท</option>{['RAW_MATERIAL', 'PACKAGING', 'FINISHED_GOOD', 'SEMI_FINISHED', 'CONSUMABLE'].map((value) => <option key={value}>{value}</option>)}</select>
      <select aria-label="หมวดหมู่" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}><option value="">ทุกหมวดหมู่</option>{lookups.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select aria-label="สถานะต้นทุน" value={costStatus} onChange={(e) => setCostStatus(e.target.value)}><option value="">ทุกสถานะต้นทุน</option><option value="PRICED">มีราคา</option><option value="ZERO">ยืนยันศูนย์</option><option value="MISSING">ไม่ทราบต้นทุน</option></select>
      <select aria-label="สถานะยอดสต็อก" value={stock} onChange={(e) => setStock(e.target.value)}><option value="">ทุกยอดสต็อก</option><option value="POSITIVE">บวก</option><option value="ZERO">ศูนย์</option><option value="NEGATIVE">ติดลบ</option></select>
    </FilterBar>
    <div className="analytics-breakdowns">
      <ContentCard title="ตามคลัง">{data?.byWarehouse.map((r) => <div className="breakdown-row" key={r.name}><b>{r.name}</b><span>{money(r.knownValue)}</span><small>ไม่ทราบ {r.unknownCostItems} · ติดลบ {r.negativeStockItems}</small></div>)}</ContentCard>
      <ContentCard title="ตามประเภท">{data?.byType.map((r) => <div className="breakdown-row" key={r.name}><b>{r.name}</b><span>{money(r.knownValue)}</span><small>{r.itemCount} รายการ</small></div>)}</ContentCard>
    </div>
    <ContentCard padded={false}><div className="table-wrap"><table className="data-table"><thead><tr><th>สินค้า</th><th>คลัง</th><th>คงเหลือ / จอง / ใช้ได้</th><th>ต้นทุนต่อหน่วย</th><th>มูลค่า</th><th>หลักฐานต้นทุน</th></tr></thead><tbody>
      {data?.rows.map((r, index) => <tr key={`${r.itemId}-${r.warehouseId}-${index}`} className={r.onHand < 0 ? 'negative-row' : ''}><td><b>{r.itemName}</b><small className="cell-sub">{r.itemCode} · {r.itemType}{r.categoryName ? ` · ${r.categoryName}` : ''}</small></td><td>{r.warehouseName}</td><td>{qty(r.onHand)} / {qty(r.reserved)} / {qty(r.available)} {r.baseUnitCode}</td><td>{r.costStatus === 'MISSING' ? <b className="unknown-cost">VALUE UNKNOWN</b> : money(r.unitCost)}</td><td>{r.value == null ? <b className="unknown-cost">MISSING COST</b> : money(r.value)}</td><td><span className={`cost-pill ${r.costStatus.toLowerCase()}`}>{displayEnum(r.costStatus).label}</span><small className="cell-sub">{r.costSource}</small></td></tr>)}
    </tbody></table></div>{data&&data.rows.length===0&&<EmptyState icon={PackageSearch} title="ไม่มีรายการตามตัวกรองนี้" description="ลองล้างตัวกรอง หรือตรวจสอบว่ามีสต็อกคงเหลือในคลังที่เลือก"/>}</ContentCard>
  </PageContainer>;
}
