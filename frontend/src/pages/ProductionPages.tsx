import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, ArrowLeft, CheckCircle2, Factory, FileDown, PackageCheck, Pencil, Plus, RotateCcw, Scale } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { ContentCard, KPIGrid, KPICard, PageContainer, PageHeader, StickySummary } from '@/components/layout/page';
import { productionCostSummary, productionOutputPerformance, productionStatus, productionVariance, WASTE_REASON_LABELS, type ProductionMaterialRow, type ProductionWasteRow } from '@/lib/production';

const qty = (value: number) => Number(value ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const money = (value: number) => Number(value ?? 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Date().toISOString().slice(0, 10);

interface WarehouseOption { id: string; code: string; name: string }
interface RecipeOption { id: string; code: string; name: string; product: { id: string; code: string; name: string; isLotTracked?:boolean; isExpiryTracked?:boolean; baseUnit: { code: string } }; versions: { id: string; versionNo: number; yieldMode: string | null; standardYieldQty: number; yieldPercent: number; yieldUnit: { code: string } | null }[] }
interface Lookups { recipes: RecipeOption[]; warehouses: WarehouseOption[] }
interface LedgerRow { id: string; movementType: string; itemId: string; item: { code: string; name: string }; warehouse: { code: string; name: string }; beforeQty: number; qtyIn: number; qtyOut: number; balanceAfter: number; unit: string | null; createdAt: string }
interface ProductionRecord {
  id: string; orderNo: string; status: string; version: number; recipeId: string | null; recipeVersionId: string | null;
  productId: string; plannedQty: number; producedQty: number; standardCost: number; actualCost: number; actualUnitCost: number;
  materialWarehouseId: string | null; fgWarehouseId: string | null; productionDate: string | null; note: string | null; lotNo?:string|null;manufactureDate?:string|null;expiryDate?:string|null;
  createdAt: string; confirmedAt: string | null; reversedAt: string | null; reversalReason: string | null;
  recipe?: { id: string; code: string; name: string } | null; recipeVersion?: { id: string; versionNo: number; yieldMode: string | null } | null;
  product: { id: string; code: string; name: string; baseUnit: { code: string } };
  materialWarehouse?: WarehouseOption | null; fgWarehouse?: WarehouseOption | null;
  materials: ProductionMaterialRow[]; wastes: ProductionWasteRow[]; ledgers?: LedgerRow[];
  analytics?: { output: { measurable: boolean; variance: number | null; variancePercent: number | null; yieldPercent: number | null }; materialCost: { standard: number; actual: number; variance: number; variancePercent: number | null }; materialPerformance: { itemId: string; quantityVariance: number; quantityVariancePercent: number | null; costVariance: number }[]; contributions: { itemId: string; costVariance: number }[]; waste: { recorded: boolean; knownCost: number; uncostedCount: number } };
}
interface ProductionListRow extends Omit<ProductionRecord, 'materials' | 'product'> { product: { name: string; baseUnit: { code: string } }; materials?: ProductionMaterialRow[] }
interface PreviewPlan { recipeId: string; recipeVersionId: string; recipeVersionNo: number; recipeName: string; productName: string; outputUnitCode: string; yieldMode: string; materials: ProductionMaterialRow[]; standardCost: number }
interface AnalyticsSummary { runs: number; completed: number; averageYieldPercent: number | null; totalCostVariance: number; recordedWaste: { unitCode: string; quantity: number }[]; wasteCost: number; sampleSize: number; lowSample: boolean }

function useProductionPermissions() {
  const { user } = useAuth();
  const has = (code: string) => Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes(code));
  return { canCreate: has('PRODUCTION_CREATE'), canConfirm: has('PRODUCTION_CONFIRM'), canReverse: has('PRODUCTION_REVERSE'), canDownload: has('DOCUMENT_DOWNLOAD') };
}

async function openPdf(id: string) {
  const blob = await apiClient.blob(`/business/production/${id}/document.pdf`, 'pdf');
  const url = URL.createObjectURL(blob); window.open(url, '_blank', 'noopener,noreferrer'); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function ProductionListPage() {
  const [rows, setRows] = useState<ProductionListRow[]>([]); const [loading, setLoading] = useState(true);
  const [lookups, setLookups] = useState<Lookups>(); const [summary, setSummary] = useState<AnalyticsSummary>();
  const [filters, setFilters] = useState({ dateFrom: '', dateTo: '', recipeId: '', productId: '', warehouseId: '', status: '', wasteReason: '' });
  const { canCreate } = useProductionPermissions();
  useEffect(() => { void apiClient.get<Lookups>('/business/production/lookups').then(setLookups); }, []);
  useEffect(() => {
    const query = new URLSearchParams(Object.entries(filters).filter(([, value]) => value)); const suffix = query.size ? `?${query}` : '';
    setLoading(true); void Promise.all([apiClient.get<ProductionListRow[]>(`/business/production${suffix}`), apiClient.get<AnalyticsSummary>(`/business/production/analytics/summary${suffix}`)]).then(([nextRows, nextSummary]) => { setRows(nextRows); setSummary(nextSummary); }).finally(() => setLoading(false));
  }, [filters]);
  const wasteLabel = summary?.recordedWaste.length ? summary.recordedWaste.map((row) => `${qty(row.quantity)} ${row.unitCode}`).join(' · ') : '0';
  return <PageContainer size="wide" className="production-page">
    <PageHeader breadcrumb="ออเดอร์และปฏิบัติการ" title="การผลิต" description="เปลี่ยนวัตถุดิบเป็นผลผลิต พร้อมต้นทุนจริงและบัญชีสต็อกที่ตรวจสอบย้อนหลังได้"
      actions={canCreate ? <Link className="btn primary" to="/production/new"><Plus width={16}/>สร้างใบผลิต</Link> : undefined}/>
    <KPIGrid columns={5}>
      <KPICard label="ใบผลิต" value={summary?.runs ?? 0} icon={<Factory/>} hint="ตามช่วงและตัวกรอง"/>
      <KPICard label="ยืนยันแล้ว" value={summary?.completed ?? 0} icon={<PackageCheck/>} tone="success" hint="ไม่รวมใบกลับรายการ"/>
      <KPICard label="Yield เฉลี่ย" value={summary?.averageYieldPercent == null ? '—' : `${summary.averageYieldPercent.toFixed(1)}%`} icon={<CheckCircle2/>} hint={summary?.lowSample ? 'ข้อมูลยังมีจำนวนน้อย' : 'เฉพาะสูตรที่เทียบหน่วยได้'}/>
      <KPICard label="ของเสียที่บันทึก" value={wasteLabel} icon={<AlertTriangle/>} hint="ไม่ใช่ผลต่างการใช้"/>
      <KPICard label="ผลต่างต้นทุน" value={`฿${money(summary?.totalCostVariance ?? 0)}`} icon={<Scale/>} tone={(summary?.totalCostVariance ?? 0) > 0 ? 'warning' : 'default'} hint="จาก snapshot"/>
    </KPIGrid>
    <ContentCard title="ตัวกรอง" description="สรุปและรายการใช้เงื่อนไขเดียวกัน"><div className="ops-field-grid production-filters">
      <label>จากวันที่<input type="date" value={filters.dateFrom} onChange={(e) => setFilters((v) => ({ ...v, dateFrom: e.target.value }))}/></label><label>ถึงวันที่<input type="date" value={filters.dateTo} onChange={(e) => setFilters((v) => ({ ...v, dateTo: e.target.value }))}/></label>
      <label>สูตร<select value={filters.recipeId} onChange={(e) => setFilters((v) => ({ ...v, recipeId: e.target.value }))}><option value="">ทั้งหมด</option>{lookups?.recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.code} · {recipe.name}</option>)}</select></label>
      <label>สินค้า<select value={filters.productId} onChange={(e) => setFilters((v) => ({ ...v, productId: e.target.value }))}><option value="">ทั้งหมด</option>{[...new Map(lookups?.recipes.map((recipe) => [recipe.product.id, recipe.product]) ?? []).values()].map((product) => <option key={product.id} value={product.id}>{product.code} · {product.name}</option>)}</select></label>
      <label>คลัง<select value={filters.warehouseId} onChange={(e) => setFilters((v) => ({ ...v, warehouseId: e.target.value }))}><option value="">ทั้งหมด</option>{lookups?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
      <label>สถานะ<select value={filters.status} onChange={(e) => setFilters((v) => ({ ...v, status: e.target.value }))}><option value="">ทั้งหมด</option><option value="DRAFT">ร่าง</option><option value="COMPLETED">ยืนยันแล้ว</option><option value="CANCELLED">กลับรายการ</option></select></label>
      <label>เหตุผลของเสีย<select value={filters.wasteReason} onChange={(e) => setFilters((v) => ({ ...v, wasteReason: e.target.value }))}><option value="">ทั้งหมด</option>{Object.entries(WASTE_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    </div></ContentCard>
    <ContentCard title="รายการใบผลิต" description={`${rows.length} ใบ`} padded={false}>
      {!loading && rows.length === 0 ? <EmptyState icon={Factory} title="ยังไม่มีใบผลิต" description="เริ่มจากสูตรที่พร้อมใช้งาน แล้วตรวจวัตถุดิบจริงก่อนยืนยัน" action={canCreate ? <Link className="btn primary" to="/production/new">สร้างใบผลิต</Link> : undefined}/>
      : <div className="table-wrap"><table className="data-table ops-table"><thead><tr><th>เลขที่</th><th>วันที่</th><th>สูตร / ผลผลิต</th><th className="num">แผน</th><th className="num">จริง</th><th className="num">ต้นทุนจริง</th><th>คลัง</th><th>สถานะ</th></tr></thead>
        <tbody>{rows.map((row) => { const status = productionStatus(row.status); return <tr key={row.id}>
          <td><Link className="ops-doc-link" to={`/production/${row.id}`}>{row.orderNo}</Link></td><td>{row.productionDate ? new Date(row.productionDate).toLocaleDateString('th-TH') : '—'}</td>
          <td><span className="ops-two-line"><b>{row.recipe?.name ?? '—'}</b><small>{row.product.name}</small></span></td>
          <td className="num">{qty(row.plannedQty)} {row.recipeVersion?.yieldMode === 'BATCH' ? 'Batch' : row.product.baseUnit.code}</td><td className="num">{qty(row.producedQty)} {row.product.baseUnit.code}</td><td className="num">฿{money(row.actualCost)}</td>
          <td>{row.materialWarehouse?.name ?? '—'}</td><td><span className={`badge ${status.tone}`}>{status.label}</span></td>
        </tr>; })}</tbody></table></div>}
    </ContentCard>
  </PageContainer>;
}

export function ProductionWorkspacePage() {
  const { id } = useParams(); const navigate = useNavigate(); const { toast } = useToast(); const { canCreate, canConfirm } = useProductionPermissions();
  const [lookups, setLookups] = useState<Lookups>(); const [record, setRecord] = useState<ProductionRecord>();
  const [recipeId, setRecipeId] = useState(''); const [warehouseId, setWarehouseId] = useState(''); const [plannedQty, setPlannedQty] = useState(1); const [actualOutput, setActualOutput] = useState(1);
  const [productionDate, setProductionDate] = useState(today()); const [note, setNote] = useState(''); const [plan, setPlan] = useState<PreviewPlan>(); const [materials, setMaterials] = useState<ProductionMaterialRow[]>([]);
  const [outputLotNo,setOutputLotNo]=useState('');const[manufactureDate,setManufactureDate]=useState(today());const[expiryDate,setExpiryDate]=useState('');
  const [wastes, setWastes] = useState<ProductionWasteRow[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    void Promise.all([apiClient.get<Lookups>('/business/production/lookups'), id ? apiClient.get<ProductionRecord>(`/business/production/${id}`) : Promise.resolve(undefined)])
      .then(([options, doc]) => { setLookups(options); if (!doc) { setWarehouseId(options.warehouses[0]?.id ?? ''); return; } setRecord(doc); setRecipeId(doc.recipeId ?? ''); setWarehouseId(doc.materialWarehouseId ?? ''); setPlannedQty(doc.plannedQty); setActualOutput(doc.producedQty); setProductionDate((doc.productionDate ?? doc.createdAt).slice(0, 10)); setNote(doc.note ?? '');setOutputLotNo(doc.lotNo??'');setManufactureDate(doc.manufactureDate?.slice(0,10)??(doc.productionDate??doc.createdAt).slice(0,10));setExpiryDate(doc.expiryDate?.slice(0,10)??''); setMaterials(doc.materials); setWastes(doc.wastes ?? []); })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  useEffect(() => {
    if (!recipeId || plannedQty <= 0) return;
    let active = true;
    const timer = window.setTimeout(() => { void apiClient.post<PreviewPlan>('/business/production/preview', { recipeId, plannedQty }).then((next) => {
      if (!active) return; setPlan(next); setMaterials((current) => next.materials.map((line) => ({ ...line, actualQty: current.find((old) => old.itemId === line.itemId)?.actualQty ?? line.actualQty, lotAllocations:current.find((old)=>old.itemId===line.itemId)?.lotAllocations??[] })));
    }).catch((e: Error) => active && setError(e.message)); }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [recipeId, plannedQty]);

  const selectedRecipe = lookups?.recipes.find((recipe) => recipe.id === recipeId); const selectedWarehouse = lookups?.warehouses.find((warehouse) => warehouse.id === warehouseId);
  const summary = useMemo(() => productionCostSummary(materials, actualOutput), [materials, actualOutput]);
  const canSubmit = Boolean(canCreate && recipeId && warehouseId && plannedQty > 0 && actualOutput > 0 && materials.length && !busy);
  const suggestMaterialLots=async(line:ProductionMaterialRow)=>{try{const[suggestion,lots]=await Promise.all([apiClient.post<{allocations:{lotId:string;quantity:number}[];shortageQty:number}>('/business/inventory/lots/suggest',{warehouseId,itemId:line.itemId,quantity:line.actualQty}),apiClient.get<{rows:{lotId:string;lotNo:string;expiryDate:string|null;available:number}[]}>(`/business/inventory/lots?warehouseId=${warehouseId}&itemId=${line.itemId}`)]);const lotOf=new Map(lots.rows.map(row=>[row.lotId,row]));setMaterials(rows=>rows.map(row=>row.itemId===line.itemId?{...row,lotAllocations:suggestion.allocations.map(a=>({...a,...lotOf.get(a.lotId)}))}:row));if(suggestion.shortageQty>0)setError(`Lot ของ ${line.itemName??line.itemId} ไม่พอ ${suggestion.shortageQty}`)}catch(e){setError(e instanceof Error?e.message:'แนะนำ FEFO ไม่สำเร็จ')}};

  const submit = async (confirm: boolean) => {
    if (!canSubmit) return; setBusy(true); setError('');
    try {
      const payload = { recipeId, recipeVersionId: plan?.recipeVersionId ?? record?.recipeVersionId, warehouseId, plannedQty, actualOutputQty: actualOutput, productionDate, note: note || null, outputLotNo:outputLotNo||null,manufactureDate:manufactureDate||null,expiryDate:expiryDate||null, materials: materials.map((line) => ({ itemId: line.itemId, actualQty: line.actualQty, allocations:line.lotAllocations?.map(a=>({lotId:a.lotId,quantity:a.quantity}))??[] })), wastes: wastes.map((line) => ({ itemId: line.itemId || null, quantity: line.quantity, reason: line.reason, note: line.note || null })) };
      const saved = id ? await apiClient.patch<ProductionRecord>(`/business/production/${id}`, { ...payload, version: record?.version }) : await apiClient.post<ProductionRecord>('/business/production', payload);
      const final = confirm ? await apiClient.post<ProductionRecord>(`/business/production/${saved.id}/confirm`) : saved;
      toast({ title: confirm ? 'ยืนยันการผลิตแล้ว' : 'บันทึกใบผลิตร่างแล้ว', description: confirm ? 'วัตถุดิบถูกตัดและผลผลิตเข้าสต็อกเป็นรายการเดียวกัน' : 'ยังไม่มีการขยับสต็อก', variant: 'success' });
      navigate(`/production/${final.id}`);
    } catch (e) { const message = e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ'; setError(message); toast({ title: 'บันทึกใบผลิตไม่สำเร็จ', description: message, variant: 'error' }); }
    finally { setBusy(false); }
  };

  return <PageContainer size="wide" className="production-page">
    <PageHeader breadcrumb={<Link to="/production">การผลิต</Link>} title={id ? `แก้ไข ${record?.orderNo ?? 'ใบผลิต'}` : 'สร้างใบผลิต'} description="ยอดคาดหมายมาจากสูตร ส่วนยอดใช้จริงต้องตรวจและยืนยันโดยผู้ใช้งาน" actions={<Link className="btn" to={id ? `/production/${id}` : '/production'}><ArrowLeft width={16}/>กลับ</Link>}/>
    {error && <div className="alert error" role="alert"><AlertTriangle/>{error}</div>}
    <div className="ops-workspace production-workspace"><div className="ops-workspace-main">
      <ContentCard title="ข้อมูลการผลิต" description="เลือกสูตร คลัง และจำนวนผลผลิต">
        <div className="ops-field-grid">
          <label>สูตร<select value={recipeId} onChange={(e) => setRecipeId(e.target.value)} disabled={Boolean(id && record?.status !== 'DRAFT')}><option value="">เลือกสูตร</option>{lookups?.recipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.code} · {recipe.name} → {recipe.product.name}</option>)}</select></label>
          <label>คลังผลิต<select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}><option value="">เลือกคลัง</option>{lookups?.warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} · {warehouse.name}</option>)}</select></label>
          <label>{plan?.yieldMode === 'BATCH' ? 'จำนวนรอบผลิตตามแผน' : 'ผลผลิตตามแผน'}<input type="number" min="0.0001" step="0.0001" value={plannedQty} onChange={(e) => setPlannedQty(Number(e.target.value))}/></label>
          <label>ผลผลิตจริง<input type="number" min="0.0001" step="0.0001" value={actualOutput} onChange={(e) => setActualOutput(Number(e.target.value))}/></label>
          <label>วันที่ผลิต<input type="date" value={productionDate} onChange={(e) => setProductionDate(e.target.value)}/></label>
          <label>หน่วยตามแผน<input disabled value={plan?.outputUnitCode ?? selectedRecipe?.product.baseUnit.code ?? '—'}/></label>
          {selectedRecipe?.product.isLotTracked&&<><label>Lot ผลผลิต *<input value={outputLotNo} onChange={e=>setOutputLotNo(e.target.value)}/></label><label>วันผลิต<input type="date" value={manufactureDate} onChange={e=>setManufactureDate(e.target.value)}/></label>{selectedRecipe.product.isExpiryTracked&&<label>วันหมดอายุ *<input type="date" value={expiryDate} onChange={e=>setExpiryDate(e.target.value)}/></label>}</>}
        </div><label className="ops-note-field">หมายเหตุ<textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}/></label>
      </ContentCard>
      <ContentCard title="วัตถุดิบคาดหมายเทียบใช้จริง" description="จำนวนทั้งหมดแสดงในหน่วยฐาน เพื่อให้ตรงกับสต็อกและต้นทุน">
        <div className="production-material-head"><span>วัตถุดิบ</span><span>คาดหมาย</span><span>ใช้จริง</span><span>ผลต่าง</span><span>พร้อมใช้</span><span>ต้นทุน</span></div>
        <div className="production-materials">{materials.map((line) => { const variance = productionVariance(line.plannedQty, line.actualQty); const insufficient = line.availableQty !== undefined && line.actualQty > line.availableQty; const name = line.itemName ?? line.item?.name ?? line.itemId; const code = line.itemCode ?? line.item?.code ?? ''; return <div className={`production-material-row${insufficient ? ' insufficient' : ''}`} key={line.itemId}>
          <strong data-label="วัตถุดิบ">{name}<small>{code}</small></strong><span data-label="คาดหมาย" className="expected">{qty(line.plannedQty)} {line.unitCode}</span>
          <label data-label="ใช้จริง"><input aria-label={`ใช้จริง ${name}`} type="number" min="0" step="0.0001" value={line.actualQty} onChange={(e) => setMaterials((rows) => rows.map((row) => row.itemId === line.itemId ? { ...row, actualQty: Number(e.target.value) } : row))}/><b>{line.unitCode}</b></label>
          <span data-label="ผลต่าง" className={Math.abs(variance.quantity) > 1e-9 ? 'variance' : ''}>{variance.quantity > 0 ? '+' : ''}{qty(variance.quantity)} {line.unitCode}<small>{variance.percent == null ? '—' : `${variance.percent > 0 ? '+' : ''}${variance.percent.toFixed(1)}%`}</small></span>
          <span data-label="พร้อมใช้" className={insufficient ? 'danger' : ''}>{line.availableQty === undefined ? 'ตรวจเมื่อบันทึก' : `${qty(line.availableQty)} ${line.unitCode}`}<small>{insufficient ? 'ไม่เพียงพอ' : 'พร้อมใช้'}</small></span>
          <span data-label="ต้นทุน">฿{money(line.actualQty * line.plannedUnitCost)}<small>฿{money(line.plannedUnitCost)} / {line.unitCode}</small></span>
          {line.isLotTracked&&<div className="rr-lot"><button type="button" className="btn" onClick={()=>void suggestMaterialLots(line)}>FEFO Suggested</button>{line.lotAllocations?.map(a=><label key={a.lotId}>Lot {a.lotNo??a.lotId}<small>{a.expiryDate?String(a.expiryDate).slice(0,10):'ไม่มีวันหมดอายุ'} · พร้อมใช้ {a.available??'—'}</small><input type="number" min="0" step="0.0001" value={a.quantity} onChange={e=>setMaterials(rows=>rows.map(row=>row.itemId===line.itemId?{...row,lotAllocations:row.lotAllocations?.map(x=>x.lotId===a.lotId?{...x,quantity:Number(e.target.value)}:x)}:row))}/></label>)}</div>}
        </div>; })}{materials.length === 0 && <p className="production-empty">เลือกสูตรเพื่อคำนวณวัตถุดิบคาดหมาย</p>}</div>
      </ContentCard>
      <ContentCard title="ของเสียที่สังเกตและบันทึก" description="บันทึกของเสียทางกายภาพแยกจากผลต่างการใช้วัตถุดิบ">
        <div className="production-waste-list">{wastes.map((waste, index) => <div className="production-waste-row" key={`${index}-${waste.itemId}`}>
          <label>รายการ<select value={waste.itemId ?? ''} onChange={(e) => setWastes((rows) => rows.map((row, i) => i === index ? { ...row, itemId: e.target.value || null } : row))}><option value="">ไม่ผูกกับวัตถุดิบ</option>{materials.map((line) => <option key={line.itemId} value={line.itemId}>{line.itemName ?? line.item?.name}</option>)}</select></label>
          <label>จำนวน<input aria-label={`จำนวนของเสีย ${index + 1}`} type="number" min="0.0001" step="0.0001" value={waste.quantity} onChange={(e) => setWastes((rows) => rows.map((row, i) => i === index ? { ...row, quantity: Number(e.target.value) } : row))}/></label>
          <label>เหตุผล<select value={waste.reason} onChange={(e) => setWastes((rows) => rows.map((row, i) => i === index ? { ...row, reason: e.target.value as ProductionWasteRow['reason'] } : row))}>{Object.entries(WASTE_REASON_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>หมายเหตุ<input value={waste.note ?? ''} required={waste.reason === 'OTHER'} onChange={(e) => setWastes((rows) => rows.map((row, i) => i === index ? { ...row, note: e.target.value } : row))}/></label>
          <button className="btn" type="button" onClick={() => setWastes((rows) => rows.filter((_, i) => i !== index))}>ลบ</button>
        </div>)}</div>
        <button className="btn" type="button" onClick={() => setWastes((rows) => [...rows, { itemId: null, quantity: 0.1, reason: 'OTHER', note: '' }])}><Plus/>เพิ่มของเสีย</button>
        <p className="production-empty">ระบบจะไม่ถือว่าผลต่างการใช้หรือผลผลิตต่ำกว่าแผนเป็นของเสียโดยอัตโนมัติ</p>
      </ContentCard>
    </div>
    <StickySummary className="ops-summary-panel"><div className="ops-sum"><h2><Factory/>สรุปใบผลิต</h2><dl>
      <div><dt>เลขที่</dt><dd>{record?.orderNo ?? 'ออกให้เมื่อบันทึก'}</dd></div><div><dt>สูตร</dt><dd>{selectedRecipe?.name ?? '—'}</dd></div><div><dt>คลัง</dt><dd>{selectedWarehouse?.name ?? '—'}</dd></div>
      <div><dt>{plan?.yieldMode === 'BATCH' ? 'รอบผลิตตามแผน' : 'ผลผลิตตามแผน'}</dt><dd>{qty(plannedQty)} {plan?.yieldMode === 'BATCH' ? 'Batch' : selectedRecipe?.product.baseUnit.code}</dd></div><div><dt>ผลผลิตจริง</dt><dd>{qty(actualOutput)} {selectedRecipe?.product.baseUnit.code}</dd></div><div><dt>ต้นทุนมาตรฐาน</dt><dd>฿{money(summary.standardCost)}</dd></div><div><dt>ต้นทุนจริงโดยประมาณ</dt><dd>฿{money(summary.actualCost)}</dd></div><div><dt>ผลต่างต้นทุน</dt><dd className={summary.variance > 0 ? 'warning' : ''}>{summary.variance > 0 ? '+' : ''}฿{money(summary.variance)}</dd></div>
      <div className="total"><dt>ต้นทุนต่อหน่วยจริง</dt><dd>฿{money(summary.actualUnitCost)}</dd></div></dl>
      {summary.insufficientCount > 0 && <p className="ops-sum-warn"><AlertTriangle/>มี {summary.insufficientCount} รายการที่สต็อกไม่พอ</p>}
      <p className="ops-sum-note"><CheckCircle2/>บันทึกร่างไม่ขยับสต็อก การยืนยันจะตัดวัตถุดิบและรับผลผลิตพร้อมกันทั้งหมด</p>
      <div className="ops-sum-actions"><button className="btn" disabled={!canSubmit} onClick={() => void submit(false)}>{busy ? 'กำลังบันทึก…' : 'บันทึกร่าง'}</button>{canConfirm && <button className="btn primary" disabled={!canSubmit || summary.insufficientCount > 0} onClick={() => setConfirmOpen(true)}><PackageCheck/>ยืนยันการผลิต</button>}</div>
    </div></StickySummary></div>
    <ConfirmDialog open={confirmOpen} title="ยืนยันการผลิตและขยับสต็อก" confirmLabel="ยืนยันการผลิต" onClose={() => setConfirmOpen(false)} onConfirm={() => void submit(true)} description={<div className="production-confirm"><p>นี่คือการตรวจครั้งสุดท้ายก่อนลงบัญชีสต็อก</p><dl>{materials.map((line) => <div key={line.itemId}><dt>{line.itemName ?? line.item?.name}</dt><dd>{line.availableQty === undefined ? 'ยอดล่าสุดในระบบ' : qty(line.availableQty)} → {line.availableQty === undefined ? 'ตรวจขณะยืนยัน' : qty(line.availableQty - line.actualQty)} {line.unitCode}</dd></div>)}<div><dt>{selectedRecipe?.product.name ?? 'ผลผลิต'}</dt><dd>+{qty(actualOutput)} {selectedRecipe?.product.baseUnit.code}</dd></div><div><dt>ต้นทุนจริงโดยประมาณ</dt><dd>฿{money(summary.actualCost)}</dd></div></dl></div>}/>
  </PageContainer>;
}

export function ProductionDetailPage() {
  const { id = '' } = useParams(); const { toast } = useToast(); const { canCreate, canReverse, canDownload } = useProductionPermissions();
  const [doc, setDoc] = useState<ProductionRecord>(); const [error, setError] = useState(''); const [reverseOpen, setReverseOpen] = useState(false); const [reason, setReason] = useState('');
  const load = useCallback(() => apiClient.get<ProductionRecord>(`/business/production/${id}`).then(setDoc).catch((e: Error) => setError(e.message)), [id]);
  useEffect(() => { void load(); }, [load]);
  if (!doc) return <PageContainer>{error ? <div className="alert error">{error}</div> : <p>กำลังโหลด…</p>}</PageContainer>;
  const status = productionStatus(doc.status); const costVariance = doc.actualCost - doc.standardCost; const output = doc.analytics?.output ?? productionOutputPerformance(doc.plannedQty, doc.producedQty, doc.recipeVersion?.yieldMode);
  const materialById = new Map(doc.materials.map((line) => [line.itemId, line]));
  const reverse = async () => { try { await apiClient.post(`/business/production/${id}/reverse`, { reason }); toast({ title: 'กลับรายการผลิตแล้ว', variant: 'success' }); setReason(''); await load(); } catch (e) { toast({ title: 'กลับรายการไม่สำเร็จ', description: e instanceof Error ? e.message : '', variant: 'error' }); } };
  return <PageContainer size="wide" className="production-page"><PageHeader breadcrumb={<Link to="/production">การผลิต</Link>} title={doc.orderNo} description={`${doc.recipe?.name ?? '—'} · ${doc.product.name}`} badge={<span className={`badge ${status.tone}`}>{status.label}</span>} actions={<>{doc.status === 'DRAFT' && canCreate && <Link className="btn" to={`/production/${doc.id}/edit`}><Pencil/>แก้ไข</Link>}{canDownload && <button className="btn" onClick={() => void openPdf(doc.id)}><FileDown/>PDF</button>}{doc.status === 'COMPLETED' && canReverse && <button className="btn danger-btn" onClick={() => setReverseOpen(true)}><RotateCcw/>กลับรายการ</button>}</>}/>
    <KPIGrid columns={5}><KPICard label={doc.recipeVersion?.yieldMode === 'BATCH' ? 'รอบผลิตตามแผน' : 'ผลผลิตตามแผน'} value={qty(doc.plannedQty)} unit={doc.recipeVersion?.yieldMode === 'BATCH' ? 'Batch' : doc.product.baseUnit.code} icon={<Factory/>}/><KPICard label="ผลผลิตจริง" value={qty(doc.producedQty)} unit={doc.product.baseUnit.code} icon={<PackageCheck/>} tone="success"/><KPICard label="Yield" value={output.yieldPercent == null ? '—' : `${output.yieldPercent.toFixed(2)}%`} icon={<CheckCircle2/>} hint={output.measurable ? 'จริง ÷ แผน' : 'Batch เทียบหน่วยไม่ได้'}/><KPICard label="ต้นทุนจริง" value={`฿${money(doc.actualCost)}`} icon={<Scale/>}/><KPICard label="ผลต่างต้นทุน" value={`${costVariance > 0 ? '+' : ''}฿${money(costVariance)}`} icon={<AlertTriangle/>} tone={costVariance > 0 ? 'warning' : 'default'}/></KPIGrid>
    <div className="production-detail-grid"><ContentCard title="ข้อมูลใบผลิต"><dl className="detail-dl"><div><dt>สูตร / Version</dt><dd>{doc.recipe?.name} / V{doc.recipeVersion?.versionNo}</dd></div><div><dt>คลังวัตถุดิบ</dt><dd>{doc.materialWarehouse?.name}</dd></div><div><dt>คลังผลผลิต</dt><dd>{doc.fgWarehouse?.name}</dd></div><div><dt>วันที่ผลิต</dt><dd>{doc.productionDate ? new Date(doc.productionDate).toLocaleDateString('th-TH') : '—'}</dd></div><div><dt>ยืนยันเมื่อ</dt><dd>{doc.confirmedAt ? new Date(doc.confirmedAt).toLocaleString('th-TH') : '—'}</dd></div><div><dt>ต้นทุนต่อหน่วยจริง</dt><dd>฿{money(doc.actualUnitCost)} / {doc.product.baseUnit.code}</dd></div></dl>{doc.note && <p className="detail-note">{doc.note}</p>}</ContentCard>
      <ContentCard title="ประสิทธิภาพผลผลิต" description="ผลผลิตต่ำกว่าแผนไม่ถูกจัดเป็นของเสียโดยอัตโนมัติ"><dl className="detail-dl"><div><dt>ตามแผน</dt><dd>{qty(doc.plannedQty)} {doc.recipeVersion?.yieldMode === 'BATCH' ? 'Batch' : doc.product.baseUnit.code}</dd></div><div><dt>จริง</dt><dd>{qty(doc.producedQty)} {doc.product.baseUnit.code}</dd></div><div><dt>ผลต่าง</dt><dd>{output.variance == null ? 'เทียบไม่ได้' : `${output.variance > 0 ? '+' : ''}${qty(output.variance)} ${doc.product.baseUnit.code}`}</dd></div><div><dt>Yield</dt><dd>{output.yieldPercent == null ? 'ไม่รองรับสำหรับสูตร Batch' : `${output.yieldPercent.toFixed(2)}%`}</dd></div></dl></ContentCard>
      <ContentCard title="ประสิทธิภาพวัตถุดิบจาก Snapshot" description="คาดหมาย ใช้จริง และของเสียที่บันทึกเป็นข้อมูลคนละชุด"><div className="table-wrap"><table className="data-table"><thead><tr><th>วัตถุดิบ</th><th className="num">คาดหมาย</th><th className="num">ใช้จริง</th><th className="num">ผลต่างปริมาณ</th><th className="num">ต้นทุนคาดหมาย</th><th className="num">ต้นทุนจริง</th><th className="num">ผลต่างต้นทุน</th></tr></thead><tbody>{doc.materials.map((line) => { const variance = productionVariance(line.plannedQty, line.actualQty); const lineCostVariance = Number(line.totalCost ?? 0) - line.plannedTotalCost; return <tr key={line.itemId}><td>{line.item?.name}<small className="block">{line.item?.code}</small></td><td className="num">{qty(line.plannedQty)} {line.unitCode}</td><td className="num actual">{qty(line.actualQty)} {line.unitCode}</td><td className={`num ${variance.quantity > 0 ? 'variance-over' : variance.quantity < 0 ? 'variance-under' : ''}`}>{variance.quantity > 0 ? '+' : ''}{qty(variance.quantity)} ({variance.percent?.toFixed(1) ?? '—'}%)</td><td className="num">฿{money(line.plannedTotalCost)}</td><td className="num">฿{money(line.totalCost ?? 0)}</td><td className={`num ${lineCostVariance > 0 ? 'variance-over' : lineCostVariance < 0 ? 'variance-under' : ''}`}>{lineCostVariance > 0 ? '+' : ''}฿{money(lineCostVariance)}</td></tr>; })}</tbody></table></div></ContentCard>
      <ContentCard title="วัสดุที่มีส่วนต่อผลต่างต้นทุน" description="เรียงตามขนาดผลต่างจาก snapshot ไม่สรุปสาเหตุแทนผู้ใช้"><div className="production-contributions">{doc.analytics?.contributions.map((line) => <div key={line.itemId}><strong>{materialById.get(line.itemId)?.item?.name}</strong><span className={line.costVariance > 0 ? 'variance-over' : 'variance-under'}>{line.costVariance > 0 ? '+' : ''}฿{money(line.costVariance)}</span></div>)}{!doc.analytics?.contributions.length && <p className="production-empty">ไม่มีผลต่างต้นทุน</p>}</div></ContentCard>
      <ContentCard title="ของเสียที่บันทึก" description="แสดงเฉพาะของเสียทางกายภาพที่ผู้ใช้ระบุ"><div className="production-waste-summary">{doc.wastes?.map((waste) => <div key={waste.id}><strong>{waste.item?.name ?? 'ไม่ผูกกับวัตถุดิบ'}</strong><span>{qty(waste.quantity)} {waste.unitCode ?? 'ไม่ระบุหน่วย'}</span><small>{WASTE_REASON_LABELS[waste.reason]}{waste.note ? ` · ${waste.note}` : ''} · {waste.totalCost == null ? 'ต้นทุนไม่พร้อม' : `฿${money(waste.totalCost)}`}</small></div>)}{!doc.wastes?.length && <p className="production-empty">ไม่มีของเสียที่บันทึก — ผลต่างการใช้ไม่ถูกนับเป็นของเสีย</p>}</div></ContentCard>
      <ContentCard title="การเคลื่อนไหวสต็อก" description="ยอดก่อน → เปลี่ยนแปลง → ยอดหลัง"><div className="production-ledgers">{doc.ledgers?.map((line) => <div key={line.id}><span className={`movement-tag ${line.qtyOut > 0 ? 'out' : 'in'}`}>{line.qtyOut > 0 ? 'ออก' : 'เข้า'}</span><strong>{line.item.name}</strong><span>{qty(line.beforeQty)} → {line.qtyOut > 0 ? `−${qty(line.qtyOut)}` : `+${qty(line.qtyIn)}`} → <b>{qty(line.balanceAfter)}</b> {line.unit}</span><small>{line.warehouse.name} · {line.movementType}</small></div>)}{!doc.ledgers?.length && <p className="production-empty">ใบผลิตร่างยังไม่มีการเคลื่อนไหวสต็อก</p>}</div></ContentCard>
    </div>
    <ConfirmDialog open={reverseOpen} title="กลับรายการผลิต" tone="danger" confirmLabel="กลับรายการ" onClose={() => setReverseOpen(false)} onConfirm={() => void reverse()} description={<div><p>ระบบจะคืนวัตถุดิบและนำผลผลิตออกแบบ atomic หากผลผลิตคงเหลือไม่พอ ระบบจะไม่เปลี่ยนแปลงรายการใด</p><label className="ops-note-field">เหตุผล<textarea value={reason} onChange={(e) => setReason(e.target.value)} required/></label></div>}/>
  </PageContainer>;
}
