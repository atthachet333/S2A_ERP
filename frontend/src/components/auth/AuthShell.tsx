import { useId, useState, type ReactNode } from 'react';
import { Eye, EyeOff, type LucideIcon } from 'lucide-react';

/**
 * PHASE 37 — ชุดคอมโพเนนต์กลางของหน้ากลุ่ม "เข้าสู่ระบบ / บัญชีผู้ใช้"
 *
 * เดิมแต่ละหน้าประกอบร่างเอง (gateway / password-shell / recovery-shell)
 * ทำให้หน้าตาไม่เป็นครอบครัวเดียวกัน และบางหน้าดูโล่งกว่าหน้าอื่นชัดเจน
 * ไฟล์นี้ทำให้ทุกหน้าใช้โครงเดียวกัน: แผงแบรนด์ซ้าย + การ์ดฟอร์มขวา
 *
 * ขอบเขต: การนำเสนอล้วน — ไม่แตะ AuthContext, payload, กติกา validation
 * หรือเส้นทางการนำทางใด ๆ ทั้งสิ้น
 */

/* ---------- โครงหน้า: แผงแบรนด์ + แผงฟอร์ม ---------- */
export function AuthShell({ brand, children }: { brand?: ReactNode; children: ReactNode }) {
  return (
    <main className="auth2">
      {brand ?? <AuthBrandPanel />}
      <section className="auth2-panel">
        <div className="auth2-panel-inner">{children}</div>
      </section>
    </main>
  );
}

/* ---------- แผงแบรนด์ ----------
   จงใจให้เนื้อหาน้อย: โลโก้ ชื่อระบบ ประโยคคุณค่าเดียว และจุดเด่นสั้น ๆ
   ของเดิมมีทั้งไดอะแกรมเคลื่อนไหว ป้ายลอย และ footer ซ้อนกันหลายชั้น
   ซึ่งแย่งความสนใจไปจากฟอร์มที่เป็นงานจริงของหน้านี้ */
export function AuthBrandPanel({ eyebrow, title, lead, points, tiles, tags, caption }: {
  eyebrow?: string;
  title?: ReactNode;
  lead?: string;
  points?: { icon: LucideIcon; label: string }[];
  /** การ์ดความสามารถแบบ 2x2 — อ่านง่ายกว่ารายการยาวแนวตั้ง */
  tiles?: { icon: LucideIcon; title: string; description: string }[];
  /** ป้ายโมดูลสั้น ๆ เป็นภาษาอังกฤษรอง ไม่ให้แย่งความสำคัญไปจากข้อความไทย */
  tags?: string[];
  caption?: string;
}) {
  return (
    <aside className="auth2-brand" aria-hidden="true">
      <div className="auth2-brand-top">
        <span className="auth2-mark"><img src="/s2a-logo.png" alt="" /></span>
        <div className="auth2-wordmark">
          <strong>S2 ACCOUNTING CONSULTANT</strong>
          <span>PRODUCTION &amp; INVENTORY</span>
        </div>
      </div>

      <div className="auth2-brand-body">
        {eyebrow && <p className="auth2-eyebrow">{eyebrow}</p>}
        {title && <h2 className="auth2-brand-title">{title}</h2>}
        {lead && <p className="auth2-brand-lead">{lead}</p>}
        {tiles && tiles.length > 0 && (
          <ul className="auth2-tiles">
            {tiles.map(({ icon: Icon, title: tileTitle, description }) => (
              <li key={tileTitle}>
                <span className="auth2-tile-ic" aria-hidden><Icon /></span>
                <strong>{tileTitle}</strong>
                <span className="auth2-tile-desc">{description}</span>
              </li>
            ))}
          </ul>
        )}
        {points && points.length > 0 && (
          <ul className="auth2-points">
            {points.map(({ icon: Icon, label }) => (
              <li key={label}><Icon aria-hidden />{label}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="auth2-brand-tail">
        {tags && tags.length > 0 && (
          <ul className="auth2-tags">{tags.map((tag) => <li key={tag}>{tag}</li>)}</ul>
        )}
        {caption && <p className="auth2-caption">{caption}</p>}
        <div className="auth2-brand-foot" />
      </div>
    </aside>
  );
}

/* ---------- การ์ดฟอร์ม ---------- */
export function AuthCard({ title, subtitle, kicker, toolbar, children, footer }: {
  title: ReactNode;
  subtitle?: ReactNode;
  kicker?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="auth2-card">
      {toolbar && <div className="auth2-toolbar">{toolbar}</div>}
      {/* โลโก้สำหรับจอแคบ ที่แผงแบรนด์ถูกซ่อน จะได้ยังรู้ว่าอยู่ระบบไหน */}
      <div className="auth2-card-mark"><img src="/s2a-logo.png" alt="S2A ERP" /></div>
      <header className="auth2-card-head">
        {kicker && <p className="auth2-kicker">{kicker}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="auth2-sub">{subtitle}</p>}
      </header>
      {children}
      {footer && <div className="auth2-card-foot">{footer}</div>}
    </div>
  );
}

/* ---------- กลุ่มฟิลด์ในฟอร์มยาว (ใช้กับหน้าลงทะเบียน) ---------- */
export function AuthSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="auth2-section">
      <legend>{title}</legend>
      <div className="auth2-section-body">{children}</div>
    </fieldset>
  );
}

/* ---------- ข้อความแจ้งเตือน ---------- */
export function AuthAlert({ tone = 'error', children }: { tone?: 'error' | 'success' | 'info'; children: ReactNode }) {
  return (
    <div className={`auth2-alert auth2-alert--${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}

/* ---------- ช่องกรอกมาตรฐาน ---------- */
export function AuthField({ label, icon: Icon, error, hint, children }: {
  label: ReactNode;
  icon?: LucideIcon;
  error?: ReactNode;
  hint?: ReactNode;
  children: (props: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`auth2-field${error ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="auth2-control">
        {Icon && <Icon className="auth2-control-icon" aria-hidden />}
        {children({ id, describedBy, invalid: Boolean(error) })}
      </div>
      {hint && <small className="auth2-hint" id={hintId}>{hint}</small>}
      {error && <small className="auth2-error" id={errorId} role="alert">{error}</small>}
    </div>
  );
}

/* ---------- ช่องรหัสผ่านพร้อมปุ่มแสดง/ซ่อน ---------- */
export function PasswordField({ label, value, onChange, autoComplete, showLabel, hideLabel, icon, error, hint, placeholder, required = true, minLength, autoFocus }: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  showLabel: string;
  hideLabel: string;
  icon?: LucideIcon;
  error?: ReactNode;
  hint?: ReactNode;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
  autoFocus?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  const Icon = icon;
  return (
    <div className={`auth2-field${error ? ' is-invalid' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <div className="auth2-control">
        {Icon && <Icon className="auth2-control-icon" aria-hidden />}
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required={required}
          minLength={minLength}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
        <button type="button" className="auth2-reveal" onClick={() => setVisible((v) => !v)} aria-label={visible ? hideLabel : showLabel}>
          {visible ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
        </button>
      </div>
      {hint && <small className="auth2-hint" id={hintId}>{hint}</small>}
      {error && <small className="auth2-error" id={errorId} role="alert">{error}</small>}
    </div>
  );
}

