import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ChartColumnBig, Crown, TrendingDown, Coins, Percent, UtensilsCrossed,
  AlertTriangle, Info, ArrowUpRight, ArrowDownRight,
} from 'lucide-react';
import { catalogApi, type MenuRow } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';

export default function SalesInsightPage() {
  const menus = useQuery({ queryKey: ['menus'], queryFn: () => catalogApi.menus() });
  const rows = useMemo(() => menus.data ?? [], [menus.data]);

  const priced = useMemo(() => rows.filter((m) => m.sellingPrice != null && m.margin != null), [rows]);
  const byMargin = useMemo(() => [...priced].sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0)), [priced]);
  const topMargin = byMargin.slice(0, 5);
  const lowMargin = [...byMargin].reverse().slice(0, 5);
  const avgMargin = priced.length ? priced.reduce((s, m) => s + (m.margin ?? 0), 0) / priced.length : null;
  const avgPrice = priced.length ? priced.reduce((s, m) => s + (m.sellingPrice ?? 0), 0) / priced.length : null;
  const needFix = priced.filter((m) => (m.margin ?? 100) < 20);

  const maxMargin = topMargin[0]?.margin ?? 1;

  return (
    <>
      <div className="fcx-hero">
        <div className="fcx-hero-row">
          <div>
            <p className="eyebrow">ข้อมูลและยอดขาย</p>
            <h1>สรุปการขาย / KPI เมนู</h1>
            <p>จัดอันดับเมนูตามกำไร ดูเมนูที่ควรปรับราคา และภาพรวม margin ของร้านในที่เดียว</p>
          </div>
          <div className="icon-chip green" style={{ width: 54, height: 54 }}><ChartColumnBig aria-hidden style={{ width: 26, height: 26 }} /></div>
        </div>
      </div>

      <div className="fcx-tiles">
        <Kpi icon={UtensilsCrossed} tone="info" label="เมนูทั้งหมด" value={menus.isLoading ? null : String(rows.length)} sub={`ตั้งราคาแล้ว ${priced.length}`} />
        <Kpi icon={Percent} tone="green" label="margin เฉลี่ย" value={menus.isLoading ? null : avgMargin != null ? `${avgMargin.toFixed(1)}%` : '—'} sub="จากเมนูที่ตั้งราคา" />
        <Kpi icon={Coins} tone="gold" label="ราคาขายเฉลี่ย" value={menus.isLoading ? null : avgPrice != null ? formatMoney(avgPrice, 0) : '—'} sub="ต่อเมนู" />
        <Kpi icon={AlertTriangle} tone="amber" label="ควรปรับราคา" value={menus.isLoading ? null : String(needFix.length)} sub="margin ต่ำกว่า 20%" />
      </div>

      <div className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16, marginTop: 22 }}>
        <RankPanel title="เมนูกำไรสูงสุด" icon={Crown} tone="good"
          rows={topMargin} maxMargin={maxMargin} loading={menus.isLoading}
          emptyText="ยังไม่มีเมนูที่ตั้งราคา" />
        <RankPanel title="เมนู margin ต่ำสุด — ควรพิจารณาปรับราคา" icon={TrendingDown} tone="bad"
          rows={lowMargin} maxMargin={maxMargin} loading={menus.isLoading}
          emptyText="ยังไม่มีข้อมูลเพียงพอ" />
      </div>

      {/* เมนูที่ควรปรับราคา — insight */}
      {needFix.length > 0 && (
        <div className="section">
          <div className="section-head"><div><h2>เมนูที่ควรปรับราคา</h2><p>margin ต่ำกว่า 20% — กำไรบางเกินไป</p></div></div>
          <div className="fcx-insights">
            {needFix.slice(0, 4).map((m) => (
              <div className="fcx-insight warn" key={m.id}>
                <span className="ic"><AlertTriangle aria-hidden /></span>
                <div style={{ flex: 1 }}>
                  <strong>{m.name}</strong>
                  <span>ต้นทุน {m.totalCost != null ? formatMoney(m.totalCost, 2) : '—'} · ราคาขาย {m.sellingPrice != null ? formatMoney(m.sellingPrice, 2) : '—'} · margin {m.margin?.toFixed(1)}%</span>
                </div>
                <Link to="/pricing" className="btn" style={{ height: 34 }}>ปรับราคา</Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* สรุปยอดขายจริง (ต้องมีข้อมูลการขาย) — empty state ที่ฉลาด */}
      <div className="section">
        <div className="section-head"><div><h2>ยอดขายและเมนูขายดี</h2><p>อันดับตามจำนวนที่ขายจริง</p></div></div>
        <div className="card card-pad">
          <div className="fcx-missing" style={{ marginBottom: 4 }}>
            <Info aria-hidden />
            <span>
              ส่วนนี้จะแสดงเมนูขายดี/ขายไม่ดีตามยอดขายจริงเมื่อเชื่อมข้อมูลการขาย (POS/บันทึกการขาย) —
              ระหว่างนี้ใช้อันดับ “กำไรต่อเมนู” ด้านบนเพื่อวางแผนราคาได้เลย
            </span>
          </div>
          {!menus.isLoading && rows.length === 0 && (
            <EmptyState icon={ChartColumnBig} title="ยังไม่มีเมนู"
              description="สร้างเมนูและกำหนดราคาขายเพื่อเริ่มวิเคราะห์กำไรและยอดขาย"
              action={<Link to="/recipes" className="btn primary">สร้างเมนู</Link>} />
          )}
        </div>
      </div>
    </>
  );
}

function Kpi({ icon: Icon, label, value, sub, tone }: { icon: typeof Coins; label: string; value: string | null; sub: string; tone: string }) {
  return (
    <article className="card fcx-tile lift">
      <div className="top">
        <span className="lbl">{label}</span>
        <span className={`icon-chip ${tone}`} style={{ width: 34, height: 34 }}><Icon aria-hidden style={{ width: 17, height: 17 }} /></span>
      </div>
      {value == null ? <Skeleton style={{ height: 24, width: 80, display: 'block' }} /> : <span className="val">{value}</span>}
      <span className="sub">{sub}</span>
    </article>
  );
}

function RankPanel({ title, icon: Icon, tone, rows, maxMargin, loading, emptyText }: {
  title: string; icon: typeof Crown; tone: 'good' | 'bad'; rows: MenuRow[]; maxMargin: number; loading: boolean; emptyText: string;
}) {
  return (
    <div className="card card-pad">
      <div className="section-head" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className={`icon-chip ${tone === 'good' ? 'green' : 'amber'}`} style={{ width: 34, height: 34 }}><Icon aria-hidden style={{ width: 17, height: 17 }} /></span>
          <h2 style={{ fontSize: 15 }}>{title}</h2>
        </div>
      </div>
      {loading ? (
        <div>{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} style={{ height: 40, display: 'block', marginBottom: 8, borderRadius: 10 }} />)}</div>
      ) : rows.length === 0 ? (
        <p className="subtle" style={{ fontSize: 13, padding: '12px 0' }}>{emptyText}</p>
      ) : (
        <div>
          {rows.map((m, i) => (
            <div className="fcx-rank" key={m.id}>
              <span className="n">{i + 1}</span>
              <div className="nm">
                <strong>{m.name}</strong>
                <span>ต้นทุน {m.totalCost != null ? formatMoney(m.totalCost, 2) : '—'} · ขาย {m.sellingPrice != null ? formatMoney(m.sellingPrice, 2) : '—'}</span>
              </div>
              <span className="track"><i style={{ width: `${Math.max(6, ((m.margin ?? 0) / (maxMargin || 1)) * 100)}%` }} /></span>
              <span className="v" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end' }}>
                {tone === 'good' ? <ArrowUpRight width={14} aria-hidden /> : <ArrowDownRight width={14} aria-hidden />}{m.margin?.toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
