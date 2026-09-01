import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Plus, Search, Package, CheckCircle2, AlertTriangle, Clock, Pencil, Power, ImageOff, LayoutGrid, List, Boxes, CookingPot, ShoppingBag, PackagePlus } from 'lucide-react';
import { catalogApi, type Item } from '@/lib/catalog';
import { useAuth } from '@/auth/AuthContext';
import { canReceiveStock, receivingAccess } from '@/lib/stock-receiving';
import StockReceivingDialog, { type StockReceivingResult } from '@/components/inventory/StockReceivingDialog';
import ReceivingSuccessCard from '@/components/inventory/ReceivingSuccessCard';
import { formatMoney, formatThaiDate } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

const TYPE_LABEL: Record<string, string> = {
  RAW_MATERIAL: 'วัตถุดิบ', PACKAGING: 'บรรจุภัณฑ์', SEMI_FINISHED: 'กึ่งสำเร็จรูป',
  FINISHED_GOOD: 'สินค้าสำเร็จรูป', CONSUMABLE: 'วัสดุสิ้นเปลือง', WASTE: 'ของเสีย',
};
const PAGE_SIZE = 12;

export default function ItemsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [status, setStatus] = useState('');
  const [hasImage, setHasImage] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'table' | 'cards'>('table');
  /* PHASE 35 — ทะเบียนรวมเดิมก็ต้องเริ่มงานรับเข้าสต็อกได้เหมือนหน้าวัตถุดิบใหม่ */
  const { user } = useAuth();
  const canReceive = canReceiveStock(receivingAccess(user?.roles, user?.permissions));
  const [receivingItem, setReceivingItem] = useState<Item | null>(null);
  const [receivingPicker, setReceivingPicker] = useState(false);
  const [receivedResult, setReceivedResult] = useState<StockReceivingResult | null>(null);

  const summary = useQuery({ queryKey: ['item-summary'], queryFn: () => catalogApi.itemSummary() });
  const list = useQuery({
    queryKey: ['items', { search, type, status, hasImage, page }],
    queryFn: () => catalogApi.items({ search, type, status, hasImage, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (item: Item) => (item.isActive ? catalogApi.deactivateItem(item.id) : catalogApi.activateItem(item.id)),
    onSuccess: (_d, item) => { toast(item.isActive ? 'ปิดการใช้งานแล้ว' : 'เปิดการใช้งานแล้ว'); void qc.invalidateQueries({ queryKey: ['items'] }); void qc.invalidateQueries({ queryKey: ['item-summary'] }); },
    onError: (e) => toast(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ', 'error'),
  });

  const rows = list.data?.items ?? [];
  const totalPages = list.data?.totalPages ?? 1;
  const resetPage = () => setPage(1);
  const s = summary.data;

  return (
    <>
      <div className="page-title-block">
        <p className="eyebrow">ข้อมูลอาหาร</p>
        <h1>วัตถุดิบทั้งหมด</h1>
        <p>จัดการวัตถุดิบ ราคา หน่วย และข้อมูลสำหรับคำนวณสูตร</p>
      </div>

      <div className="stat-grid" style={{ marginTop: 18 }}>
        <StatTile icon={Package} label="วัตถุดิบทั้งหมด" value={s ? String(s.total) : '—'} tone="info" />
        <StatTile icon={CheckCircle2} label="ใช้งานอยู่" value={s ? String(s.active) : '—'} tone="green" />
        <StatTile icon={AlertTriangle} label="ยังไม่มีราคาซื้อ" value={s ? String(s.noPrice) : '—'} tone="amber" />
        <StatTile icon={Clock} label="อัปเดตราคาล่าสุด" value={s?.latestPriceUpdate ? formatThaiDate(s.latestPriceUpdate) : '—'} tone="slate" small />
      </div>

      <div className="toolbar" style={{ marginTop: 20 }}>
        <div className="search-box">
          <Search aria-hidden />
          <input placeholder="ค้นหารหัส ชื่อ หรือบาร์โค้ด" value={search} onChange={(e) => { setSearch(e.target.value); resetPage(); }} aria-label="ค้นหาวัตถุดิบ" />
        </div>
        <select value={type} onChange={(e) => { setType(e.target.value); resetPage(); }} aria-label="ประเภท">
          <option value="">ทุกประเภท</option>
          {Object.entries(TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </select>
        <select value={hasImage} onChange={(e) => { setHasImage(e.target.value); resetPage(); }} aria-label="รูปภาพ">
          <option value="">รูป: ทั้งหมด</option>
          <option value="yes">มีรูป</option>
          <option value="no">ไม่มีรูป</option>
        </select>
        <span className="count-pill">{list.data?.total ?? 0} รายการ</span>
        <div className="spacer" />
        <div className="view-toggle" aria-label="รูปแบบการแสดงผล"><button className={view==='table'?'active':''} onClick={()=>setView('table')} aria-label="มุมมองตาราง"><List /></button><button className={view==='cards'?'active':''} onClick={()=>setView('cards')} aria-label="มุมมองการ์ด"><LayoutGrid /></button></div>
        {canReceive && (
          <button type="button" className="btn" onClick={() => { setReceivedResult(null); setReceivingPicker(true); }}>
            <PackagePlus aria-hidden />นำเข้าสต็อก
          </button>
        )}
        <Link to="/items/new" className="btn primary"><Plus aria-hidden />เพิ่มวัตถุดิบ</Link>
      </div>

      {receivedResult && (
        <ReceivingSuccessCard result={receivedResult} onDismiss={() => setReceivedResult(null)} />
      )}

      <div className="item-type-chips" aria-label="กรองตามประเภทรายการ">
        {[
          { value: '', label: 'ทั้งหมด', icon: Boxes },
          { value: 'RAW_MATERIAL', label: 'วัตถุดิบ', icon: CookingPot },
          { value: 'PACKAGING', label: 'บรรจุภัณฑ์', icon: Package },
          { value: 'FINISHED_GOOD', label: 'สินค้าสำเร็จรูป', icon: ShoppingBag },
        ].map(({ value, label, icon: Icon }) => (
          <button key={value || 'all'} type="button" className={type === value ? 'active' : ''}
            onClick={() => { setType(value); resetPage(); }} aria-pressed={type === value}>
            <Icon aria-hidden />{label}
          </button>
        ))}
      </div>

      <section className={`card items-surface ${view}`}>
        {view === 'cards' && !list.isLoading && <div className="item-card-grid">{rows.map(item=><article className="item-visual-card" key={item.id}><Thumb url={item.imageUrl}/><div><div className="item-card-head"><span className="unit-tag">{item.baseUnit?.code??'—'}</span>{item.isActive?<Badge variant="success" dot>ใช้งาน</Badge>:<Badge variant="muted">ปิดใช้งาน</Badge>}</div><small>{item.code}</small><h3>{item.name}</h3><p>{item.category?.name??TYPE_LABEL[item.type]}</p><strong className="item-price">{item.lastCost>0?`${formatMoney(item.lastCost,4)} / ${item.baseUnit?.code}`:'ยังไม่มีราคาซื้อ'}</strong><Link className="btn" to={`/items/${item.id}`}>ดูรายละเอียด</Link></div></article>)}</div>}
        {view === 'table' && <>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>รูป</th><th>รหัส</th><th>ชื่อวัตถุดิบ</th><th>ประเภท</th><th>หมวดหมู่</th>
                <th>หน่วยฐาน</th><th className="num">ต้นทุน/หน่วยฐาน</th><th>สถานะ</th><th>จัดการ</th>
              </tr>
            </thead>
            {list.isLoading ? <SkeletonRows rows={8} cols={9} /> : (
              <tbody>
                {rows.map((item) => (
                  <tr key={item.id}>
                    <td><Thumb url={item.imageUrl} /></td>
                    <td><span className="num">{item.code}</span></td>
                    <td><strong>{item.name}</strong>{item.barcode && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-subtle)' }}>{item.barcode}</span>}</td>
                    <td><Badge variant="muted">{TYPE_LABEL[item.type] ?? item.type}</Badge></td>
                    <td>{item.category?.name ?? '—'}</td>
                    <td>{item.baseUnit?.code ?? '—'}</td>
                    <td className="num">{item.lastCost > 0 ? formatMoney(item.lastCost, 4) : <span style={{ color: 'var(--text-subtle)' }}>ยังไม่มีราคา</span>}</td>
                    <td>{item.isActive ? <Badge variant="success" dot>ใช้งาน</Badge> : <Badge variant="muted" dot>ปิดใช้งาน</Badge>}</td>
                    <td>
                      <div className="row-actions">
                        <Link className="icon-btn" to={`/items/${item.id}`} title="แก้ไข / อัปเดตราคา"><Pencil aria-hidden width={16} /></Link>
                        {canReceive && (
                          <button className="icon-btn" title="นำเข้าสต็อก" aria-label={`นำเข้าสต็อก ${item.name}`}
                            onClick={() => { setReceivedResult(null); setReceivingItem(item); }}><PackagePlus aria-hidden width={16} /></button>
                        )}
                        <button className="icon-btn" title={item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} onClick={() => toggle.mutate(item)} disabled={toggle.isPending}><Power aria-hidden width={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        </>}

        {list.isError && !list.isLoading && (
          <EmptyState variant="error" icon={AlertTriangle} title="โหลดข้อมูลไม่สำเร็จ" description={list.error instanceof Error ? list.error.message : 'ลองใหม่อีกครั้ง'} />
        )}
        {!list.isLoading && !list.isError && rows.length === 0 && (
          <EmptyState icon={Package} title="ยังไม่มีข้อมูลวัตถุดิบ" description="เริ่มต้นด้วยการเพิ่มวัตถุดิบรายการแรกของคุณ"
            action={<Link to="/items/new" className="btn primary"><Plus aria-hidden />เพิ่มรายการแรก</Link>} />
        )}
        {!list.isLoading && rows.length > 0 && totalPages > 1 && (
          <div className="pagination">
            <span className="pg-info">หน้า {page} จาก {totalPages}</span>
            <div className="pg-controls">
              <button className="pg-btn" onClick={() => setPage(page - 1)} disabled={page <= 1}>ก่อนหน้า</button>
              <button className="pg-btn" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>ถัดไป</button>
            </div>
          </div>
        )}
      </section>

      <StockReceivingDialog
        open={receivingItem !== null || receivingPicker}
        item={receivingItem}
        allowPick
        onClose={() => { setReceivingItem(null); setReceivingPicker(false); }}
        onReceived={(result) => { setReceivedResult(result); setReceivingItem(null); setReceivingPicker(false); }}
      />
    </>
  );
}

function StatTile({ icon: Icon, label, value, tone, small }: { icon: typeof Package; label: string; value: string; tone: string; small?: boolean }) {
  return (
    <article className="card stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className={`icon-chip ${tone}`} style={{ width: 34, height: 34 }}><Icon aria-hidden style={{ width: 17, height: 17 }} /></span>
      </div>
      <span className="stat-value" style={small ? { fontSize: 15 } : undefined}>{value}</span>
    </article>
  );
}

function Thumb({ url }: { url: string | null }) {
  if (!url) return <span className="item-thumb empty"><ImageOff aria-hidden width={16} /></span>;
  return <img className="item-thumb" src={url} alt="" loading="lazy" />;
}
