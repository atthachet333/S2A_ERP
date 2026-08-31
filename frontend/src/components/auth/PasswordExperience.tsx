import { useMemo, useState, type FormEvent } from 'react';
import { Check, KeyRound, LoaderCircle, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/i18n';
import { accountContent } from '@/i18n/account-content';
import { AuthAlert, AuthBrandPanel, AuthCard, AuthShell, PasswordField } from './AuthShell';

/**
 * PHASE 37 — หน้าเปลี่ยนรหัสผ่าน (ทั้งการบังคับเปลี่ยนครั้งแรกและเปลี่ยนเอง)
 * ย้ายมาใช้โครง AuthShell ชุดเดียวกับหน้าอื่นในกลุ่มบัญชี
 *
 * เงื่อนไขรหัสผ่าน การเรียก changePassword และปลายทางการนำทาง คงเดิมทั้งหมด
 */
export default function PasswordExperience() {
  const { user, changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const { locale, messages } = useI18n();
  const copy = accountContent[locale];

  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [success, setSuccess] = useState(false);

  const rules = useMemo(() => [
    { label: copy.rules[0], ok: newPassword.length >= 10 },
    { label: copy.rules[1], ok: /[A-Z]/.test(newPassword) },
    { label: copy.rules[2], ok: /[a-z]/.test(newPassword) },
    { label: copy.rules[3], ok: /\d/.test(newPassword) },
    { label: copy.rules[4], ok: /[^A-Za-z0-9]/.test(newPassword) },
  ], [newPassword, copy]);

  const valid = rules.every((rule) => rule.ok) && newPassword === confirm && Boolean(currentPassword);
  const strength = rules.filter((rule) => rule.ok).length;
  const mismatch = confirm.length > 0 && newPassword !== confirm;

  const switchAccount = async () => {
    setLoggingOut(true); setError('');
    try { await logout(); } catch { /* logout clears local session in finally; navigation must continue */ }
    finally { navigate('/login', { replace: true }); }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirm) { setError(messages.validation.mismatch); return; }
    if (!rules.every((rule) => rule.ok)) { setError(copy.ruleError); return; }
    setBusy(true); setError('');
    try {
      await changePassword(currentPassword, newPassword);
      setSuccess(true);
      window.setTimeout(() => navigate('/select-company', { replace: true }), 700);
    } catch { setError(copy.changeError); } finally { setBusy(false); }
  };

  const brand = (
    <AuthBrandPanel
      eyebrow="ACCOUNT SECURITY"
      title={copy.start}
      lead={copy.intro}
      points={rules.slice(0, 3).map((rule) => ({ icon: ShieldCheck, label: rule.label }))}
    />
  );

  return (
    <AuthShell brand={brand}>
      <AuthCard kicker="ACCOUNT SECURITY" title={copy.title} subtitle={copy.helper}>
        <div className="auth2-account">
          <KeyRound aria-hidden />
          <span>{copy.setting}<br /><strong>{user?.fullName}</strong> · @{user?.username}</span>
        </div>

        <form className="auth2-form" onSubmit={(event) => void submit(event)}>
          {error && <AuthAlert tone="error"><ShieldCheck aria-hidden width={18} />{error}</AuthAlert>}
          {success && <AuthAlert tone="success"><Check aria-hidden width={18} />{copy.success}</AuthAlert>}

          <PasswordField label={copy.current} icon={LockKeyhole} value={currentPassword} onChange={setCurrent}
            autoComplete="current-password" showLabel={copy.show} hideLabel={copy.hide} />

          <PasswordField label={copy.next} icon={LockKeyhole} value={newPassword} onChange={setNew}
            autoComplete="new-password" showLabel={copy.show} hideLabel={copy.hide} />

          <div className="auth2-strength">
            <div className="auth2-strength-head">
              <span>{copy.strength}</span>
              <strong>{strength < 3 ? copy.weak : strength < 5 ? copy.good : copy.strong}</strong>
            </div>
            <div className={`auth2-strength-bar s${strength}`}><i /><i /><i /><i /><i /></div>
          </div>

          {/* เงื่อนไขรหัสผ่านต้องอ่านออกจริง ไม่ใช่ตัวเล็กจาง ๆ ใต้ช่องกรอก */}
          <div className="auth2-rules">
            {rules.map((rule) => (
              <span className={rule.ok ? 'met' : ''} key={rule.label}><Check aria-hidden />{rule.label}</span>
            ))}
          </div>

          <PasswordField label={copy.confirm} icon={LockKeyhole} value={confirm} onChange={setConfirm}
            autoComplete="new-password" showLabel={copy.show} hideLabel={copy.hide}
            error={mismatch ? messages.validation.mismatch : undefined} />

          <button className="auth2-submit" disabled={busy || loggingOut || !valid || success}>
            {busy ? <><LoaderCircle className="spin" aria-hidden />{copy.saving}</> : copy.submit}
          </button>
        </form>

        <div className="auth2-switch">
          <span>{copy.notYou}</span>
          <button type="button" onClick={() => void switchAccount()} disabled={loggingOut || busy}>
            <LogOut aria-hidden />{loggingOut ? copy.signingOut : copy.other}
          </button>
        </div>
      </AuthCard>
    </AuthShell>
  );
}
