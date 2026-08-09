import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight, CalendarDays, CheckCircle2, CircleDashed, Sprout, Package,
  UtensilsCrossed, Calculator, CircleDollarSign, ChartColumnBig, ShieldCheck,
  Crown, AlertTriangle, Percent, Plus, UserRound, BadgeCheck, TrendingDown, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { useActivity } from '@/hooks/useActivity';
import { catalogApi } from '@/lib/catalog';
import Badge, { type BadgeVariant } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatMoney, formatThaiDate, greeting, timeAgo } from '@/lib/utils';

const QUICK_ACTIONS = [
  { to: '/ingredients/new', label: 'เพิ่มวัตถุดิบ', icon: Plus, gold: true },
  { to: '/packaging/new', label: 'เพิ่มบรรจุภัณฑ์', icon: Package },
  { to: '/recipes/new', label: 'สร้างสูตร', icon: UtensilsCrossed },
  { to: '/costing', label: 'คำนวณต้นทุน', icon: Calculator },
  { to: '/pricing', label: 'ตั้งราคาขาย', icon: CircleDollarSign },
];

const BENTO = [
  { to: '/ingredients', chip: 'green', icon: Sprout, label: 'วัตถุดิบ', desc: 'ราคาซื้อ หน่วย และต้นทุนต่อหน่วยฐาน' },
  { to: '/packaging', chip: 'gold', icon: Package, label: 'บรรจุภัณฑ์', desc: 'กล่อง ถุง ช้อนส้อม และต้นทุนต่อชิ้น' },
  { to: '/recipes', chip: 'blue', icon: UtensilsCrossed, label: 'สูตรเมนูอาหาร', desc: 'ประกอบเมนูจากวัตถุดิบและบรรจุภัณฑ์' },
  { to: '/costing', chip: 'green', icon: Calculator, label: 'คำนวณต้นทุน', desc: 'ต้นทุนต่อจานจากสูตรจริง' },
  { to: '/pricing', chip: 'gold', icon: CircleDollarSign, label: 'ราคาขายและกำไร', desc: 'ตั้งราคาและวิเคราะห์ margin' },
  { to: '/sales', chip: 'blue', icon: ChartColumnBig, label: 'สรุปการขาย', desc: 'เมนูกำไรสูงและเมนูที่ควรปรับ' },
] as const;

export default function DashboardPage() {
  const { user } = useAuth();
  const summary = useDashboardSummary();
  const isAdmin = Boolean(user?.roles.includes('SUPER_ADMIN'));
  const activity = useActivity(1, 6, isAdmin);

  const packaging = useQuery({ queryKey: ['items', 'PACKAGING', 'count'], queryFn: () => catalogApi.items({ type: 'PACKAGING', pageSize: 1 }) });
  const menus = useQuery({ queryKey: ['menus'], queryFn: () => catalogApi.menus() });

  const priced = useMemo(() => (menus.data ?? []).filter((m) => m.margin != null && m.sellingPrice != null), [menus.data]);
  const byMargin = useMemo(() => [...priced].sort((a, b) => (b.margin ?? 0) - (a.margin ?? 0)), [priced]);
  const topMargin = byMargin.slice(0, 5);
  const needFix = priced.filter((m) => (m.margin ?? 100) < 20).slice(0, 5);
  const avgMargin = priced.length ? priced.reduce((s, m) => s + (m.margin ?? 0), 0) / priced.length : null;
  const avgPrice = priced.length ? priced.reduce((s, m) => s + (m.sellingPrice ?? 0), 0) / priced.length : null;
  const maxMargin = topMargin[0]?.margin ?? 1;
  const s = summary.data;

  return (
    <>
      {/* Welcome */}
      <section className="welcome-hero">
        <div className="hero-grid">
          <div>
            <p className="greeting">{greeting()}</p>
            <h1>{user?.fullName}</h1>
            <div className="hero-meta">
              <span><ShieldCheck aria-hidden />{user?.roles.join(', ')}</span>
              <span><CalendarDays aria-hidden />{formatThaiDate(new Date())}</span>
            </div>
            <p style={{ color: '#c7d6ec', marginTop: 10, fontSize: 14, maxWidth: 540 }}>
              ระบบคิดต้นทุนและสูตรเมนูอาหาร — เลือกทางลัดด้านล่างเพื่อจัดการวัตถุดิบ บรรจุภัณฑ์ สูตร และราคาขาย
            </p>
          </div>
          <div className="quick-actions">
            {QUICK_ACTIONS.map(({ to, label, icon: Icon, gold }) => (
              <Link key={to} to={to} className={`qa-btn${gold ? ' gold' : ''}`}><Icon aria-hidden />{label}</Link>
            ))}
          </div>
        </div>
      </section>

      {/* KPI */}
      <section className="section">
        <div className="section-head"><div><h2>ภาพรวมต้นทุนและเมนู</h2><p>ตัวเลขจริงจากฐานข้อมูล</p></div></div>
        <div className="stat-grid">
          <Kpi icon={Sprout} chip="green" label="วัตถุดิบ" value={s ? String(s.rawMaterials) : null} sub="รายการ" to="/ingredients" />
          <Kpi icon={Package} chip="gold" label="บรรจุภัณฑ์" value={packaging.data ? String(packaging.data.total) : null} sub="รายการ" to="/packaging" />
          <Kpi icon={UtensilsCrossed} chip="blue" label="เมนูอาหาร" value={s ? String(s.menus) : null} sub="เมนู" to="/catalog" />
          <Kpi icon={CheckCircle2} chip="green" label="สูตรใช้งาน" value={s ? String(s.activeRecipes) : null} sub={`จาก ${s?.recipes ?? 0} สูตร`} to="/recipes" />
        </div>
        <div className="stat-grid" style={{ marginTop: 16 }}>
          <Kpi icon={Percent} chip="green" label="margin เฉลี่ย" value={menus.isLoading ? null : avgMargin != null ? `${avgMargin.toFixed(1)}%` : '—'} sub="ต่อเมนูที่ตั้งราคา" to="/sales" />
          <Kpi icon={CircleDollarSign} chip="gold" label="ราคาขายเฉลี่ย" value={menus.isLoading ? null : avgPrice != null ? formatMoney(avgPrice, 0) : '—'} sub="ต่อเมนู" to="/pricing" />
          <Kpi icon={AlertTriangle} chip="amber" label="ควรปรับราคา" value={menus.isLoading ? null : String(needFix.length)} sub="margin ต่ำกว่า 20%" to="/sales" />
          <Kpi icon={CircleDashed} chip="slate" label="ไม่มีราคาซื้อ" value={s ? String(s.itemsWithoutPrice) : null} sub="วัตถุดิบ/บรรจุภัณฑ์" to="/ingredients" />
        </div>
      </section>

      {/* Rankings */}
      <div className="section" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
        <RankCard title="เมนูกำไรสูงสุด" icon={Crown} tone="green" rows={topMargin} maxMargin={maxMargin} loading={menus.isLoading}
          empty="ยังไม่มีเมนูที่ตั้งราคา" emptyAction={<Link to="/pricing" className="btn primary">ตั้งราคาขาย</Link>} link="/sales" />
        <RankCard title="เมนูที่ควรปรับราคา" icon={TrendingDown} tone="amber" rows={needFix} maxMargin={maxMargin} loading={menus.isLoading}
          empty="เยี่ยม! ยังไม่มีเมนู margin ต่ำ" link="/sales" />
      </div>

      {/* Quick nav */}
      <section className="section">
        <div className="section-head"><div><h2>ทางลัดการทำงาน</h2><p>เข้าถึงเมนูหลักของระบบ</p></div></div>
        <div className="bento-grid">
          {BENTO.map(({ to, chip, icon: Icon, label, desc }) => (
            <Link to={to} className="card bento-card lift" key={to}>
              <div className="bc-head"><span className={`icon-chip ${chip}`}><Icon aria-hidden /></span><ArrowRight className="bc-arrow" aria-hidden /></div>
              <h3>{label}</h3><p>{desc}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Activity + Setup */}
      <div className="section" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        <div>
          <div className="section-head"><div><h2>กิจกรรมล่าสุด</h2><p>ประวัติการใช้งานจากระบบ</p></div>
            {isAdmin && <Link to="/activity" className="section-note">ดูทั้งหมด <ArrowRight aria-hidden width={13} /></Link>}
          </div>
          <div className="card card-pad">
            {!isAdmin ? (
              <EmptyState icon={ShieldCheck} title="เฉพาะผู้ดูแลระบบ" description="ประวัติการใช้งานทั้งหมดจะแสดงสำหรับผู้ดูแลระบบเท่านั้น" />
            ) : activity.isLoading ? (
              <div className="activity-list">{Array.from({ length: 4 }).map((_, i) => (
                <div className="activity-item" key={i}><Skeleton style={{ width: 38, height: 38, borderRadius: 11 }} /><div className="ai-main"><Skeleton style={{ height: 14, width: '40%', display: 'block', marginBottom: 6 }} /><Skeleton style={{ height: 11, width: '25%', display: 'block' }} /></div></div>
              ))}</div>
            ) : activity.isError ? (
              <EmptyState variant="error" title="โหลดกิจกรรมไม่สำเร็จ" description="ไม่สามารถดึงประวัติการใช้งานได้ในขณะนี้" />
            ) : activity.data && activity.data.items.length > 0 ? (
              <div className="activity-list">
                {activity.data.items.map((a) => (
                  <div className="activity-item" key={a.id}>
                    <span className={`icon-chip ${a.success ? 'green' : 'amber'}`} style={{ width: 38, height: 38 }}>
                      {a.type === 'LOGIN' ? <UserRound aria-hidden /> : <BadgeCheck aria-hidden />}
                    </span>
                    <div className="ai-main"><strong>{actionLabel(a.action)}</strong><span>{a.actor ?? 'ระบบ'}{a.entity ? ` · ${a.entity}` : ''}</span></div>
                    <time dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="ยังไม่มีกิจกรรม" description="เมื่อมีการใช้งานระบบ ประวัติจะปรากฏที่นี่" />
            )}
          </div>
        </div>

        <div>
          <div className="section-head"><div><h2>ความคืบหน้าการตั้งค่า</h2><p>ขั้นตอนเริ่มต้นใช้งานระบบ</p></div></div>
          <div className="card card-pad">
            <SetupProgress summary={summary.data} loading={summary.isLoading} pkgCount={packaging.data?.total ?? 0} />
          </div>
        </div>
      </div>
    </>
  );
}

function Kpi({ icon: Icon, chip, label, value, sub, to }: { icon: LucideIcon; chip: string; label: string; value: string | null; sub?: string; to: string }) {
  return (
    <Link className="card stat-card lift" to={to} style={{ textDecoration: 'none', color: 'inherit' }}>
      <div className="stat-top">
        <span className={`icon-chip ${chip}`}><Icon aria-hidden /></span>
        <ArrowRight className="bc-arrow" aria-hidden width={16} style={{ color: 'var(--text-subtle)' }} />
      </div>
      <div>
        <div className="stat-label">{label}</div>
        {value == null ? <Skeleton style={{ height: 24, width: 70, display: 'block', marginTop: 4 }} /> : <div className="stat-value">{value}</div>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Link>
  );
}

function RankCard({ title, icon: Icon, tone, rows, maxMargin, loading, empty, emptyAction, link }: {
  title: string; icon: LucideIcon; tone: string; rows: { id: string; name: string; totalCost: number | null; sellingPrice: number | null; margin: number | null }[];
  maxMargin: number; loading: boolean; empty: string; emptyAction?: React.ReactNode; link: string;
}) {
  return (
    <div className="card card-pad">
      <div className="section-head" style={{ marginBottom: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span className={`icon-chip ${tone === 'green' ? 'green' : 'amber'}`} style={{ width: 34, height: 34 }}><Icon aria-hidden style={{ width: 17, height: 17 }} /></span>
          <h2 style={{ fontSize: 15 }}>{title}</h2>
        </div>
        <Link to={link} className="section-note">ดูทั้งหมด <ArrowRight aria-hidden width={13} /></Link>
      </div>
      {loading ? (
        <div>{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} style={{ height: 40, display: 'block', marginBottom: 8, borderRadius: 10 }} />)}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state" style={{ padding: '22px 10px' }}><p style={{ margin: 0 }}>{empty}</p>{emptyAction && <div style={{ marginTop: 10 }}>{emptyAction}</div>}</div>
      ) : (
        <div>
          {rows.map((m, i) => (
            <div className="fcx-rank" key={m.id}>
              <span className="n">{i + 1}</span>
              <div className="nm"><strong>{m.name}</strong><span>ต้นทุน {m.totalCost != null ? formatMoney(m.totalCost, 2) : '—'} · ขาย {m.sellingPrice != null ? formatMoney(m.sellingPrice, 2) : '—'}</span></div>
              <span className="track"><i style={{ width: `${Math.max(6, ((m.margin ?? 0) / (maxMargin || 1)) * 100)}%` }} /></span>
              <span className="v">{m.margin?.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SetupProgress({ summary, loading, pkgCount }: {
  summary?: { users: number; units: number; rawMaterials: number; recipes: number; menus: number }; loading?: boolean; pkgCount: number;
}) {
  const steps = [
    { label: 'เพิ่มหน่วยนับ', hint: `${summary?.units ?? 0} หน่วย`, done: (summary?.units ?? 0) > 0 },
    { label: 'เพิ่มวัตถุดิบ', hint: `${summary?.rawMaterials ?? 0} รายการ`, done: (summary?.rawMaterials ?? 0) > 0 },
    { label: 'เพิ่มบรรจุภัณฑ์', hint: `${pkgCount} รายการ`, done: pkgCount > 0 },
    { label: 'สร้างเมนู', hint: `${summary?.menus ?? 0} เมนู`, done: (summary?.menus ?? 0) > 0 },
    { label: 'สร้างสูตรแรก', hint: `${summary?.recipes ?? 0} สูตร`, done: (summary?.recipes ?? 0) > 0 },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const percent = Math.round((doneCount / steps.length) * 100);

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>เสร็จแล้ว {doneCount}/{steps.length} ขั้นตอน</span>
        <strong style={{ color: 'var(--navy)' }}>{percent}%</strong>
      </div>
      <div className="progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
      <div className="setup-list" style={{ marginTop: 12 }}>
        {steps.map((st) => (
          <div className={`setup-item${st.done ? ' done' : ''}`} key={st.label}>
            <span className="setup-check">{st.done ? <CheckCircle2 aria-hidden /> : <CircleDashed aria-hidden />}</span>
            <div className="si-main"><strong>{st.label}</strong><span>{loading ? 'กำลังตรวจสอบ…' : st.hint}</span></div>
            <Badge variant={(st.done ? 'success' : 'muted') as BadgeVariant}>{st.done ? 'เสร็จ' : 'รอ'}</Badge>
          </div>
        ))}
      </div>
    </>
  );
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    LOGIN_SUCCESS: 'เข้าสู่ระบบสำเร็จ', LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ', CHANGE_PASSWORD: 'เปลี่ยนรหัสผ่าน',
    CREATE: 'สร้างข้อมูล', UPDATE: 'แก้ไขข้อมูล', DELETE: 'ลบข้อมูล',
  };
  return map[action] ?? action;
}
