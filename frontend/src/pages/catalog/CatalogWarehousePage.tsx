import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import {
  Database, Search, Sprout, Package, UtensilsCrossed, ImageOff, AlertTriangle,
  Boxes, type LucideIcon,
} from 'lucide-react';
import { catalogApi, type ItemType } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';

type Tab = 'ingredients' | 'packaging' | 'menus';

const TABS: { key: Tab; label: string; icon: LucideIcon; type?: ItemType }[] = [
  { key: 'ingredients', label: 'วัตถุดิบ', icon: Sprout, type: 'RAW_MATERIAL' },
  { key: 'packaging', label: 'บรรจุภัณฑ์', icon: Package, type: 'PACKAGING' },
  { key: 'menus', label: 'เมนูอาหาร', icon: UtensilsCrossed },
];

export default function CatalogWarehousePage() {
  const [tab, setTab] = useState<Tab>('ingredients');
  const [search, setSearch] = useState('');
  const current = TABS.find((t) => t.key === tab)!;

  const items = useQuery({
    queryKey: ['items', current.type, 'catalog', search],
    queryFn: () => catalogApi.items({ type: current.type, search, pageSize: 50 }),
    enabled: tab !== 'menus',
    placeholderData: keepPreviousData,
  });
  const menus = useQuery({ queryKey: ['menus'], queryFn: () => catalogApi.menus(), enabled: tab === 'menus' });

  const menuRows = useMemo(() => {
    const all = menus.data ?? [];
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter((m) => m.name.toLowerCase().includes(q) || m.code.toLowerCase().includes(q));
  }, [menus.data, search]);

  const isMenus = tab === 'menus';
  const loading = isMenus ? menus.isLoading : items.isLoading;
  const isError = isMenus ? menus.isError : items.isError;
  const itemRows = items.data?.items ?? [];
  const count = isMenus ? menuRows.length : (items.data?.total ?? 0);

  return (
    <>
      <div className="fcx-hero">
        <div className="fcx-hero-row">
          <div>
            <p className="eyebrow">ข้อมูลและยอดขาย</p>
            <h1>คลังข้อมูล</h1>
            <p>ค้นดูรายชื่อวัตถุดิบ บรรจุภัณฑ์ และเมนูที่ขายทั้งหมดในที่เดียว แยกแท็บชัดเจน</p>
          </div>
          <div className="icon-chip gold" style={{ width: 54, height: 54 }}><Database aria-hidden style={{ width: 26, height: 26 }} /></div>
        </div>
      </div>

      <div className="toolbar" style={{ marginTop: 4 }}>
        <div className="fcx-tabs" role="tablist">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => { setSearch(''); setTab(key); }}>
              <Icon aria-hidden />{label}
            </button>
          ))}
        </div>
        <div className="spacer" />
        <div className="search-box">
          <Search aria-hidden />
          <input placeholder={`ค้นหา${current.label}`} value={search} onChange={(e) => setSearch(e.target.value)} aria-label={`ค้นหา${current.label}`} />
        </div>
        <span className="count-pill">{count} รายการ</span>
      </div>

      <section className="card">
        {isError && !loading && (
          <EmptyState variant="error" icon={AlertTriangle} title="โหลดข้อมูลไม่สำเร็จ" description="ลองใหม่อีกครั้งภายหลัง" />
        )}

        {!isMenus && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>รูป</th><th>รหัส</th><th>ชื่อ</th><th>หมวดหมู่</th><th>หน่วยฐาน</th><th className="num">ต้นทุน/หน่วย</th><th>สถานะ</th></tr></thead>
              {loading ? <SkeletonRows rows={7} cols={7} /> : (
                <tbody>
                  {itemRows.map((it) => (
                    <tr key={it.id}>
                      <td>{it.imageUrl ? <img className="item-thumb" src={it.imageUrl} alt="" loading="lazy" /> : <span className="item-thumb empty"><ImageOff width={16} aria-hidden /></span>}</td>
                      <td><span className="num">{it.code}</span></td>
                      <td><strong>{it.name}</strong></td>
                      <td>{it.category?.name ?? '—'}</td>
                      <td>{it.baseUnit?.code ?? '—'}</td>
                      <td className="num">{it.lastCost > 0 ? formatMoney(it.lastCost, 4) : <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
                      <td>{it.isActive ? <Badge variant="success" dot>ใช้งาน</Badge> : <Badge variant="muted" dot>ปิด</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}

        {isMenus && (
          <div className="table-wrap">
            <table className="data-table">
              <thead><tr><th>รูป</th><th>รหัส</th><th>ชื่อเมนู</th><th>สูตร</th><th className="num">ต้นทุน</th><th className="num">ราคาขาย</th><th className="num">margin</th><th>สถานะ</th></tr></thead>
              {loading ? <SkeletonRows rows={7} cols={8} /> : (
                <tbody>
                  {menuRows.map((m) => (
                    <tr key={m.id}>
                      <td>{m.imageUrl ? <img className="item-thumb" src={m.imageUrl} alt="" loading="lazy" /> : <span className="item-thumb empty"><ImageOff width={16} aria-hidden /></span>}</td>
                      <td><span className="num">{m.code}</span></td>
                      <td><Link to={`/menus/${m.id}`}><strong>{m.name}</strong></Link></td>
                      <td>{m.hasRecipe ? <Badge variant="info">มีสูตร</Badge> : <Badge variant="muted">ยังไม่มีสูตร</Badge>}</td>
                      <td className="num">{m.totalCost != null ? formatMoney(m.totalCost, 2) : '—'}</td>
                      <td className="num">{m.sellingPrice != null ? formatMoney(m.sellingPrice, 2) : '—'}</td>
                      <td className="num">{m.margin != null ? `${m.margin.toFixed(1)}%` : '—'}</td>
                      <td>{m.isActive ? <Badge variant="success" dot>ขายอยู่</Badge> : <Badge variant="muted" dot>ปิด</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
        )}

        {!loading && !isError && count === 0 && (
          <EmptyState icon={isMenus ? UtensilsCrossed : Boxes}
            title={`ยังไม่มี${current.label}`}
            description={isMenus ? 'สร้างเมนูและสูตรเพื่อให้แสดงที่นี่' : `เพิ่ม${current.label}เพื่อให้แสดงในคลังข้อมูล`}
            action={<Link to={isMenus ? '/recipes' : tab === 'packaging' ? '/packaging/new' : '/ingredients/new'} className="btn primary">ไปเพิ่ม{current.label}</Link>} />
        )}
      </section>
    </>
  );
}
