import { useMemo, useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/i18n';
import { accountContent } from '@/i18n/account-content';

export default function PasswordExperience() {
  const { user, changePassword, logout } = useAuth(); const navigate = useNavigate();
  const {locale,messages}=useI18n(); const copy=accountContent[locale];
  const [currentPassword, setCurrent] = useState(''); const [newPassword, setNew] = useState(''); const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loggingOut, setLoggingOut] = useState(false); const [success, setSuccess] = useState(false);
  const rules = useMemo(() => [{ label:copy.rules[0], ok:newPassword.length>=10 },{label:copy.rules[1],ok:/[A-Z]/.test(newPassword)},{label:copy.rules[2],ok:/[a-z]/.test(newPassword)},{label:copy.rules[3],ok:/\d/.test(newPassword)},{label:copy.rules[4],ok:/[^A-Za-z0-9]/.test(newPassword)}],[newPassword,copy]);
  const valid = rules.every((rule) => rule.ok) && newPassword === confirm && Boolean(currentPassword); const strength = rules.filter((rule) => rule.ok).length;
  const toggle = (key: keyof typeof visible) => setVisible((value) => ({ ...value, [key]: !value[key] }));
  const switchAccount = async () => { setLoggingOut(true); setError(''); try { await logout(); } catch { /* logout clears local session in finally; navigation must continue */ } finally { navigate('/login', { replace: true }); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); if (newPassword !== confirm) { setError(messages.validation.mismatch); return; } if (!rules.every((rule) => rule.ok)) { setError(copy.ruleError); return; } setBusy(true); setError(''); try { await changePassword(currentPassword, newPassword); setSuccess(true); window.setTimeout(() => navigate('/select-company', { replace: true }), 700); } catch { setError(copy.changeError); } finally { setBusy(false); } };

  return <main className="password-shell"><div className="password-glow" /><section className="password-card">
    <aside><div className="round-logo"><img src="/s2a-logo.png" alt="S2A ERP" /></div><p className="eyebrow light">ACCOUNT SECURITY</p><h1>{copy.start}</h1><p>{copy.intro}</p>
      <div className="account-pill"><ShieldCheck /><span>{copy.setting}<br /><strong>{user?.fullName}</strong> · @{user?.username}</span></div>
      <div className="switch-account"><span>{copy.notYou}</span><button type="button" onClick={() => void switchAccount()} disabled={loggingOut || busy}><LogOut aria-hidden />{loggingOut ? copy.signingOut : copy.other}</button></div>
    </aside>
    <form onSubmit={(event) => void submit(event)}><header><span className="key-badge"><KeyRound /></span><div><h2>{copy.title}</h2><p>{copy.helper}</p></div></header>
      {error && <div className="auth-alert" role="alert">{error}</div>}{success && <div className="auth-success" role="status"><Check />{copy.success}</div>}
      <PasswordField label={copy.current} value={currentPassword} setValue={setCurrent} show={visible.current} toggle={() => toggle('current')} autoComplete="current-password" showLabel={copy.show} hideLabel={copy.hide}/>
      <PasswordField label={copy.next} value={newPassword} setValue={setNew} show={visible.next} toggle={() => toggle('next')} autoComplete="new-password" showLabel={copy.show} hideLabel={copy.hide}/>
      <div className="strength"><div><span>{copy.strength}</span><strong>{strength < 3 ? copy.weak : strength < 5 ? copy.good : copy.strong}</strong></div><div className={`strength-bar s${strength}`}><i /><i /><i /><i /><i /></div></div>
      <div className="rule-grid">{rules.map((rule) => <span className={rule.ok ? 'met' : ''} key={rule.label}><Check />{rule.label}</span>)}</div>
      <PasswordField label={copy.confirm} value={confirm} setValue={setConfirm} show={visible.confirm} toggle={() => toggle('confirm')} autoComplete="new-password" showLabel={copy.show} hideLabel={copy.hide}/>
      <button className="auth-submit" disabled={busy || loggingOut || !valid || success}>{busy ? <><LoaderCircle className="spin" />{copy.saving}</> : copy.submit}</button>
    </form>
  </section></main>;
}

function PasswordField({ label, value, setValue, show, toggle, autoComplete,showLabel,hideLabel }: { label: string; value: string; setValue: (value: string) => void; show: boolean; toggle: () => void; autoComplete: string;showLabel:string;hideLabel:string }) {
  return <label>{label}<div className="auth-input"><LockKeyhole /><input type={show ? 'text' : 'password'} value={value} onChange={(event) => setValue(event.target.value)} autoComplete={autoComplete} required /><button type="button" onClick={toggle} aria-label={show ? hideLabel : showLabel}>{show ? <EyeOff /> : <Eye />}</button></div></label>;
}
