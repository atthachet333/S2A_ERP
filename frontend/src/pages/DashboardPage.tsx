import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Boxes, CalendarDays, CheckCircle2, CircleDashed, Clock,
  Database, Factory, KeyRound, Plus, Server, ShieldCheck, Truck, UserRound, UtensilsCrossed,
  BarChart3, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useHealth } from '@/hooks/useHealth';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { useActivity } from '@/hooks/useActivity';
import { MODULES, STATUS_BADGE, STATUS_LABEL } from '@/components/layout/nav-config';
import Badge, { type BadgeVariant } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { formatThaiDate, formatThaiDateTime, greeting, timeAgo } from '@/lib/utils';

const QUICK_ACTIONS = [
  { to: '/items', label: 'เพิ่มวัตถุดิบ', icon: Plus, gold: true },
  { to: '/recipes', label: 'สร้างสูตร', icon: UtensilsCrossed },
  { to: '/receiving', label: 'รับสินค้าเข้าคลัง', icon: Truck },
  { to: '/production', label: 'สร้างใบผลิต', icon: Factory },
];

const MODULE_STATUS_KEYS = ['/items', '/recipes', '/inventory', '/production', '/reports'] as const;

const BENTO = [
  { to: '/items', chip: 'blue', icon: Boxes, label: 'วัตถุดิบและสินค้า', desc: 'จัดการทะเบียนวัตถุดิบและสินค้า' },
  { to: '/recipes', chip: 'gold', icon: UtensilsCrossed, label: 'สูตรอาหาร', desc: 'สร้างและจัดการสูตรการผลิต' },
  { to: '/costing', chip: 'green', icon: BarChart3, label: 'คำนวณต้นทุน', desc: 'ต้นทุนต่อหน่วยจากสูตรจริง' },
  { to: '/receiving', chip: 'slate', icon: Truck, label: 'รับสินค้า', desc: 'บันทึกรับเข้าคลังพร้อมล็อต' },
  { to: '/production', chip: 'amber', icon: Factory, label: 'การผลิต', desc: 'ใบสั่งผลิตและผลผลิต' },
  { to: '/reports', chip: 'blue', icon: BarChart3, label: 'รายงาน', desc: 'ต้นทุน สต๊อก และกำไร' },
] as const;

export default function DashboardPage() {
  const { user } = useAuth();
  const health = useHealth();
  const summary = useDashboardSummary();
  const isAdmin = Boolean(user?.roles.includes('SUPER_ADMIN'));
  const activity = useActivity(1, 6, isAdmin);

  const backendUp = !health.isError && !health.isLoading;
  const dbUp = health.data?.db === 'up';

  return (
    <>
      {/* Section 1 — Welcome */}
      <section className="welcome-hero">
        <div className="hero-grid">
          <div>
            <p className="greeting">{greeting()}</p>
            <h1>{user?.fullName}</h1>
            <div className="hero-meta">
              <span><ShieldCheck aria-hidden />{user?.roles.join(', ')}</span>
              <span><CalendarDays aria-hidden />{formatThaiDate(new Date())}</span>
            </div>
            <p style={{ color: '#c7d6ec', marginTop: 10, fontSize: 14, maxWidth: 520 }}>
              ยินดีต้อนรับสู่ระบบบริหารต้นทุนการผลิตและคลังสินค้า เลือกทางลัดด้านล่างเพื่อเริ่มทำงาน
            </p>
          </div>
          <div className="quick-actions">
            {QUICK_ACTIONS.map(({ to, label, icon: Icon, gold }) => (
              <Link key={to} to={to} className={`qa-btn${gold ? ' gold' : ''}`}>
                <Icon aria-hidden />{label}
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Section 2 — System Overview (real data) */}
      <section className="section">
        <div className="section-head">
          <div><h2>ภาพรวมระบบ</h2><p>สถานะและข้อมูลบัญชีจากระบบจริง</p></div>
        </div>
        <div className="module-grid">
          <OverviewCard icon={Server} chip="green" label="เซิร์ฟเวอร์"
            value={health.isLoading ? '—' : backendUp ? 'พร้อมใช้งาน' : 'ขัดข้อง'}
            badge={{ variant: backendUp ? 'success' : 'danger', text: backendUp ? 'ออนไลน์' : 'ออฟไลน์' }}
            sub={health.data ? `เวอร์ชัน ${health.data.version}` : 'กำลังตรวจสอบ'} loading={health.isLoading} />
          <OverviewCard icon={Database} chip="blue" label="ฐานข้อมูล"
            value={health.isLoading ? '—' : dbUp ? 'เชื่อมต่อแล้ว' : 'ไม่เชื่อมต่อ'}
            badge={{ variant: dbUp ? 'success' : 'danger', text: dbUp ? 'เชื่อมต่อ' : 'ขาดการเชื่อมต่อ' }}
            sub="PostgreSQL" loading={health.isLoading} />
          <OverviewCard icon={BadgeCheck} chip="gold" label="บทบาทของคุณ"
            value={user?.roles.join(', ') ?? '—'} sub={`${user?.roles.length ?? 0} บทบาท`} />
          <OverviewCard icon={KeyRound} chip="slate" label="สิทธิ์การใช้งาน"
            value={`${user?.permissions.length ?? 0} รายการ`} sub="ตามบทบาทที่ได้รับ" />
          <OverviewCard icon={Clock} chip="blue" label="เข้าสู่ระบบล่าสุด"
            value={user?.lastLoginAt ? timeAgo(user.lastLoginAt) : 'ครั้งแรก'}
            sub={user?.lastLoginAt ? formatThaiDateTime(user.lastLoginAt) : '—'} />
        </div>
      </section>

      {/* Section 3 — ERP Module Status (development status, not business data) */}
      <section className="section">
        <div className="section-head">
          <div><h2>สถานะโมดูล ERP</h2><p>ความคืบหน้าการพัฒนาระบบ</p></div>
          <span className="section-note"><CircleDashed aria-hidden width={14} />สถานะการพัฒนาระบบ ไม่ใช่ข้อมูลธุรกิจจริง</span>
        </div>
        <div className="module-grid">
          {MODULE_STATUS_KEYS.map((key) => {
            const m = MODULES[key];
            return (
              <div className="card module-card lift" key={key}>
                <div className="mc-head">
                  <span className="icon-chip"><m.icon aria-hidden /></span>
                  <div><h3>{m.label}</h3></div>
                </div>
                <p>{m.description}</p>
                <Badge variant={STATUS_BADGE[m.status] as BadgeVariant} dot>{STATUS_LABEL[m.status]}</Badge>
              </div>
            );
          })}
        </div>
      </section>

      {/* Section 4 — Quick Navigation (bento) */}
      <section className="section">
        <div className="section-head"><div><h2>ทางลัดการทำงาน</h2><p>เข้าถึงเมนูหลักได้อย่างรวดเร็ว</p></div></div>
        <div className="bento-grid">
          {BENTO.map(({ to, chip, icon: Icon, label, desc }) => (
            <Link to={to} className="card bento-card lift" key={to}>
              <div className="bc-head">
                <span className={`icon-chip ${chip}`}><Icon aria-hidden /></span>
                <ArrowRight className="bc-arrow" aria-hidden />
              </div>
              <h3>{label}</h3>
              <p>{desc}</p>
            </Link>
          ))}
        </div>
      </section>

      <div className="section" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1fr)', gap: 20, alignItems: 'start' }}>
        {/* Section 5 — Recent Activity */}
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
                    <div className="ai-main">
                      <strong>{actionLabel(a.action)}</strong>
                      <span>{a.actor ?? 'ระบบ'}{a.entity ? ` · ${a.entity}` : ''}</span>
                    </div>
                    <time dateTime={a.createdAt}>{timeAgo(a.createdAt)}</time>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="ยังไม่มีกิจกรรม" description="เมื่อมีการใช้งานระบบ ประวัติจะปรากฏที่นี่" />
            )}
          </div>
        </div>

        {/* Section 6 — Setup Progress (real data) */}
        <div>
          <div className="section-head"><div><h2>ความคืบหน้าการตั้งค่า</h2><p>ขั้นตอนเริ่มต้นใช้งานระบบ</p></div></div>
          <div className="card card-pad">
            <SetupProgress dbUp={dbUp} summary={summary.data} loading={summary.isLoading} />
          </div>
        </div>
      </div>
    </>
  );
}

function OverviewCard({ icon: Icon, chip, label, value, sub, badge, loading }: {
  icon: LucideIcon; chip: string; label: string; value: string; sub?: string;
  badge?: { variant: BadgeVariant; text: string }; loading?: boolean;
}) {
  return (
    <div className="card stat-card lift">
      <div className="stat-top">
        <span className={`icon-chip ${chip}`}><Icon aria-hidden /></span>
        {badge && <Badge variant={badge.variant} dot>{badge.text}</Badge>}
      </div>
      <div>
        <div className="stat-label">{label}</div>
        {loading ? <Skeleton style={{ height: 22, width: 90, display: 'block', marginTop: 4 }} />
          : <div className="stat-value" style={{ fontSize: 18 }}>{value}</div>}
      </div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  );
}

function SetupProgress({ dbUp, summary, loading }: {
  dbUp: boolean; summary?: { users: number; units: number; warehouses: number; items: number; recipes: number }; loading?: boolean;
}) {
  const steps = [
    { label: 'เชื่อมต่อฐานข้อมูล', hint: 'PostgreSQL', done: dbUp },
    { label: 'สร้างบัญชีผู้ใช้งาน', hint: `${summary?.users ?? 0} บัญชี`, done: (summary?.users ?? 0) > 0 },
    { label: 'เพิ่มหน่วยนับ', hint: `${summary?.units ?? 0} หน่วย`, done: (summary?.units ?? 0) > 0 },
    { label: 'เพิ่มคลังสินค้า', hint: `${summary?.warehouses ?? 0} คลัง`, done: (summary?.warehouses ?? 0) > 0 },
    { label: 'เพิ่มวัตถุดิบ', hint: `${summary?.items ?? 0} รายการ`, done: (summary?.items ?? 0) > 0 },
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
        {steps.map((s) => (
          <div className={`setup-item${s.done ? ' done' : ''}`} key={s.label}>
            <span className="setup-check">{s.done ? <CheckCircle2 aria-hidden /> : <CircleDashed aria-hidden />}</span>
            <div className="si-main"><strong>{s.label}</strong><span>{loading ? 'กำลังตรวจสอบ…' : s.hint}</span></div>
            <Badge variant={s.done ? 'success' : 'muted'}>{s.done ? 'เสร็จ' : 'รอดำเนินการ'}</Badge>
          </div>
        ))}
      </div>
    </>
  );
}

function actionLabel(action: string): string {
  const map: Record<string, string> = {
    LOGIN_SUCCESS: 'เข้าสู่ระบบสำเร็จ',
    LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ',
    CHANGE_PASSWORD: 'เปลี่ยนรหัสผ่าน',
    CREATE: 'สร้างข้อมูล',
    UPDATE: 'แก้ไขข้อมูล',
    DELETE: 'ลบข้อมูล',
  };
  return map[action] ?? action;
}
