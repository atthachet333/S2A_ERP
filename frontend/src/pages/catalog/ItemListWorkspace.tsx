import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Plus, Search, CheckCircle2, AlertTriangle, Clock, Pencil, Power, ImageOff,
  LayoutGrid, List, type LucideIcon,
} from 'lucide-react';
import { catalogApi, type Item, type ItemType } from '@/lib/catalog';
import { formatMoney, formatThaiDate } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

export interface ItemListVariant {
  kind: 'ingredient' | 'packaging';
  type: ItemType;
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  newPath: string;
  itemPath: (id: string) => string;
  addLabel: string;
  totalLabel: string;
  emptyTitle: string;
  emptyDesc: string;
  searchPlaceholder: string;
  costLabel: string;
}
const PAGE_SIZE = 12;

export default function ItemListWorkspace({ variant }: { variant: ItemListVariant }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'table' | 'cards'>('table');
  const Icon = variant.icon;

  const list = useQuery({
    queryKey: ['items', variant.type, { search, status, page }],
    queryFn: () => catalogApi.items({ type: variant.type, search, status, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  const toggle = useMutation({
    mutationFn: (item: Item) => (item.isActive ? catalogApi.deactivateItem(item.id) : catalogApi.activateItem(item.id)),
    onSuccess: (_d, item) => { toast(item.isActive ? 'ปิดการใช้งานแล้ว' : 'เปิดการใช้งานแล้ว'); void qc.invalidateQueries({ queryKey: ['items'] }); },
    onError: (e) => toast(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ', 'error'),
  });

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const active = rows.filter((r) => r.isActive).length;
  const noPrice = rows.filter((r) => r.lastCost <= 0).length;
  const resetPage = () => setPage(1);

  return (
    <div className="item-list-workspace">
      <div className="fcx-hero">
        <div className="fcx-hero-row">
          <div>
            <p className="eyebrow">{variant.eyebrow}</p>
            <h1>{variant.title}</h1>
            <p>{variant.subtitle}</p>
          </div>
          <div className="fcx-hero-actions">
            <Link to={variant.newPath} className="qa-btn gold"><Plus aria-hidden />{variant.addLabel}</Link>
          </div>
        </div>
      </div>

      <div className="fcx-tiles">
        <Tile icon={Icon} tone="info" label={variant.totalLabel} value={String(total)} />
        <Tile icon={CheckCircle2} tone="green" label="ใช้งานอยู่" value={String(active)} sub="ในหน้านี้" />
        <Tile icon={AlertTriangle} tone="amber" label="ยังไม่มีราคาซื้อ" value={String(noPrice)} sub="ในหน้านี้" />
        <Tile icon={Clock} tone="slate" label="อัปเดตล่าสุด" value={rows[0] ? formatThaiDate(rows[0].updatedAt) : '—'} small />
      </div>

      <div className="toolbar" style={{ marginTop: 20 }}>
        <div className="search-box">
          <Search aria-hidden />
          <input placeholder={variant.searchPlaceholder} value={search} onChange={(e) => { setSearch(e.target.value); resetPage(); }} aria-label="ค้นหา" />
        </div>
        <select value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </select>
        <span className="count-pill">{total} รายการ</span>
        <div className="spacer" />
        <div className="view-toggle" aria-label="รูปแบบการแสดงผล">
          <button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} aria-label="มุมมองตาราง"><List /></button>
          <button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} aria-label="มุมมองการ์ด"><LayoutGrid /></button>
        </div>
        <Link to={variant.newPath} className="btn primary"><Plus aria-hidden />{variant.addLabel}</Link>
      </div>

      <section className={`card items-surface ${view}`}>
        {view === 'cards' && !list.isLoading && (
          <div className="item-card-grid">
            {rows.map((item) => (
              <article className="item-visual-card" key={item.id}>
                <Thumb url={item.imageUrl} />
                <div>
                  <div className="item-card-head">
                    <span className="unit-tag">{item.baseUnit?.code ?? '—'}</span>
                    {item.isActive ? <Badge variant="success" dot>ใช้งาน</Badge> : <Badge variant="muted">ปิดใช้งาน</Badge>}
                  </div>
                  <small>{item.code}</small>
                  <h3>{item.name}</h3>
                  <p>{item.category?.name ?? variant.title}</p>
                  <strong className="item-price">{item.lastCost > 0 ? `${formatMoney(item.lastCost, 4)} / ${item.baseUnit?.code}` : 'ยังไม่มีราคาซื้อ'}</strong>
                  <Link className="btn" to={variant.itemPath(item.id)}>ดูรายละเอียด</Link>
                </div>
              </article>
            ))}
          </div>
        )}
        {view === 'table' && (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>รูป</th><th>รหัส</th><th className="item-name-col">ชื่อ{variant.kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}</th><th>หมวดหมู่</th>
                  <th>หน่วยซื้อ</th><th>หน่วยใช้งาน{variant.kind === 'ingredient' ? 'ในสูตร' : ''}</th><th className="num">{variant.costLabel}</th><th className="num">ราคาซื้อล่าสุด</th><th>สถานะ</th><th>อัปเดตล่าสุด</th><th>จัดการ</th>
                </tr>
              </thead>
              {list.isLoading ? <SkeletonRows rows={8} cols={11} /> : (
                <tbody>
                  {rows.map((item) => (
                    <tr key={item.id}>
                      <td><Thumb url={item.imageUrl} /></td>
                      <td><span className="num">{item.code}</span></td>
                      <td><strong>{item.name}</strong>{item.barcode && <span style={{ display: 'block', fontSize: 12, color: 'var(--text-subtle)' }}>{item.barcode}</span>}</td>
                      <td>{item.category?.name ?? '—'}</td>
                      <td>{item.purchaseUnit?.code ?? item.baseUnit?.code ?? '—'}</td>
                      <td>{item.baseUnit?.code ?? '—'}</td>
                      <td className="num">{item.lastCost > 0 ? formatMoney(item.lastCost, 4) : <span style={{ color: 'var(--text-subtle)' }}>ยังไม่มีราคา</span>}</td>
                      <td className="num">—</td>
                      <td>{item.isActive ? <Badge variant="success" dot>ใช้งาน</Badge> : <Badge variant="muted" dot>ปิดใช้งาน</Badge>}</td>
                      <td>{formatThaiDate(item.updatedAt)}</td>
                      <td>
                        <div className="row-actions">
                          <Link className="icon-btn" to={variant.itemPath(item.id)} title="แก้ไข / อัปเดตราคา"><Pencil aria-hidden width={16} /></Link>
                          <button className="icon-btn" title={item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} onClick={() => toggle.mutate(item)} disabled={toggle.isPending}><Power aria-hidden width={16} /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}

        {list.isError && !list.isLoading && (
          <EmptyState variant="error" icon={AlertTriangle} title="โหลดข้อมูลไม่สำเร็จ" description={list.error instanceof Error ? list.error.message : 'ลองใหม่อีกครั้ง'} />
        )}
        {!list.isLoading && !list.isError && rows.length === 0 && (
          <EmptyState icon={Icon} title={variant.emptyTitle} description={variant.emptyDesc}
            action={<Link to={variant.newPath} className="btn primary"><Plus aria-hidden />{variant.addLabel}</Link>} />
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
    </div>
  );
}

function Tile({ icon: Icon, label, value, tone, small, sub }: { icon: LucideIcon; label: string; value: string; tone: string; small?: boolean; sub?: string }) {
  return (
    <article className="card fcx-tile lift">
      <div className="top">
        <span className="lbl">{label}</span>
        <span className={`icon-chip ${tone}`} style={{ width: 34, height: 34 }}><Icon aria-hidden style={{ width: 17, height: 17 }} /></span>
      </div>
      <span className="val" style={small ? { fontSize: 16 } : undefined}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </article>
  );
}

function Thumb({ url }: { url: string | null }) {
  if (!url) return <span className="item-thumb empty"><ImageOff aria-hidden width={16} /></span>;
  return <img className="item-thumb" src={url} alt="" loading="lazy" />;
}
