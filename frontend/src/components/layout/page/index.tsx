import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * PHASE 2+3 — Global Page Pattern
 * โครงหน้ามาตรฐานที่ทุก route ใช้ร่วมกัน เพื่อให้ระยะขอบ/ความกว้าง/หัวข้อ เป็นชุดเดียวทั้งระบบ
 * ทุกระยะมาจาก token ใน styles/tokens.css ห้ามใส่ค่าคงที่ในหน้าเพจอีก
 *
 * ลำดับที่ตั้งใจไว้: PageHeader -> KPIGrid -> FilterBar -> เนื้อหา -> sticky actions
 * ไม่บังคับใช้ครบทุกตัว หน้าไหนไม่เหมาะให้ข้ามได้
 */

/* ---------- PageContainer: คุมความกว้าง + ระยะขอบของทั้งหน้า ---------- */
export function PageContainer({ size = 'default', className, children }: {
  /** wide = ตารางเยอะ, default = ทั่วไป, narrow = ฟอร์ม/ตั้งค่า */
  size?: 'wide' | 'default' | 'narrow';
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('s2-page', `s2-page--${size}`, className)}>{children}</div>;
}

/* ---------- PageHeader: ชื่อหน้า + คำอธิบาย + ปุ่มหลัก/รอง ---------- */
export function PageHeader({ title, description, breadcrumb, badge, meta, actions, className }: {
  title: ReactNode;
  description?: ReactNode;
  breadcrumb?: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('s2-page-header', className)}>
      <div className="s2-page-header-main">
        {breadcrumb && <div className="s2-page-breadcrumb">{breadcrumb}</div>}
        <div className="s2-page-title-row">
          <h1>{title}</h1>
          {badge}
        </div>
        {description && <p className="s2-page-desc">{description}</p>}
        {meta && <div className="s2-page-meta">{meta}</div>}
      </div>
      {actions && <div className="s2-page-actions">{actions}</div>}
    </header>
  );
}

/* ---------- KPIGrid: การ์ดตัวเลขสรุป รองรับ 2–5 ใบ ---------- */
export function KPIGrid({ columns, className, children }: {
  columns?: 2 | 3 | 4 | 5;
  className?: string;
  children: ReactNode;
}) {
  return <div className={cn('s2-kpi-grid', columns && `s2-kpi-grid--${columns}`, className)}>{children}</div>;
}

export function KPICard({ label, value, unit, hint, icon, tone = 'default', breakdown, onClick, active, to }: {
  label: ReactNode;
  value: ReactNode;
  /** หน่วยกำกับตัวเลขหลัก เช่น "เรื่อง" "รายการต้องดู" */
  unit?: ReactNode;
  /** ข้อความประกอบ — ใส่เฉพาะที่มีข้อมูลจริง ห้ามสร้าง trend ปลอม */
  hint?: ReactNode;
  icon?: ReactNode;
  /* PHASE 22 — เพิ่มโทนของงานปฏิบัติการและต้นทุน เพื่อให้หน้าภาพรวมแยกกลุ่มงานได้ด้วยสายตา
     โดยยังใช้การ์ดตัวเดียวกันทั้งระบบ ไม่แตกเป็นการ์ดเฉพาะหน้า */
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'ops';
  /** รายการย่อยที่อธิบายที่มาของตัวเลขหลัก ทุกบรรทัดต้องมาจากข้อมูลจริง */
  breakdown?: { label: string; value: number }[];
  onClick?: () => void;
  active?: boolean;
  /** ลิงก์ไปหน้าที่แก้เรื่องนี้ได้ — ใช้แทน onClick เมื่อเป็นการนำทาง */
  to?: string;
}) {
  const body = (
    <>
      {icon && <span className="s2-kpi-icon" aria-hidden>{icon}</span>}
      <span className="s2-kpi-label">{label}</span>
      <strong className="s2-kpi-value num">{value}{unit && <em className="s2-kpi-unit">{unit}</em>}</strong>
      {breakdown && breakdown.length > 0 && (
        <ul className="s2-kpi-break">
          {breakdown.map((b) => (
            <li key={b.label}><span>{b.label}</span><b className="num">{b.value.toLocaleString()}</b></li>
          ))}
        </ul>
      )}
      {hint && <span className="s2-kpi-hint">{hint}</span>}
    </>
  );
  if (to) return <Link to={to} className={cn('s2-kpi', tone !== 'default' && `s2-kpi--${tone}`, 's2-kpi--link')}>{body}</Link>;
  const cls = cn('s2-kpi', tone !== 'default' && `s2-kpi--${tone}`, active && 'is-active');
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={active}>{body}</button>
    : <div className={cls}>{body}</div>;
}

/* ---------- FilterBar: แถบค้นหา/ตัวกรอง/ปุ่มการกระทำ ---------- */
export function FilterBar({ children, actions, className }: {
  children: ReactNode;
  /** ปุ่มด้านขวา เช่น เพิ่มรายการ / ส่งออก */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('s2-filterbar', className)}>
      <div className="s2-filterbar-fields">{children}</div>
      {actions && <div className="s2-filterbar-actions">{actions}</div>}
    </div>
  );
}

/* ---------- ContentCard: การ์ดมาตรฐาน หัว/เนื้อ/ท้าย ---------- */
export function ContentCard({ title, description, actions, footer, padded = true, className, children }: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  /** ปิด padding เมื่อเนื้อหาเป็นตารางเต็มความกว้าง */
  padded?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('s2-card', className)}>
      {(title || actions) && (
        <header className="s2-card-head">
          <div>
            {title && <h2>{title}</h2>}
            {description && <p>{description}</p>}
          </div>
          {actions && <div className="s2-card-actions">{actions}</div>}
        </header>
      )}
      <div className={cn('s2-card-body', !padded && 'is-flush')}>{children}</div>
      {footer && <footer className="s2-card-foot">{footer}</footer>}
    </section>
  );
}

/* ---------- StickySummary: แผงสรุปด้านข้าง (desktop sticky / mobile ไหลตามปกติ) ---------- */
export function StickySummary({ className, children }: { className?: string; children: ReactNode }) {
  return <aside className={cn('s2-sticky-summary', className)}>{children}</aside>;
}

/** แถบปุ่มยืนยันที่ติดขอบล่างบนจอเล็ก */
export function StickyActions({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('s2-sticky-actions', className)}>{children}</div>;
}

/* ---------- Loading skeletons ---------- */
export function CardSkeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="s2-skeleton-card" aria-hidden>
      <span className="skeleton" style={{ height: 18, width: '38%' }} />
      {Array.from({ length: lines }).map((_, i) => (
        <span key={i} className="skeleton" style={{ height: 12, width: i === lines - 1 ? '60%' : '90%' }} />
      ))}
    </div>
  );
}

export function KPISkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="s2-kpi-grid" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="s2-kpi">
          <span className="skeleton" style={{ height: 12, width: '55%' }} />
          <span className="skeleton" style={{ height: 26, width: '70%', marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

export { default as EmptyState } from '@/components/ui/EmptyState';
export { Skeleton, SkeletonRows } from '@/components/ui/Skeleton';
