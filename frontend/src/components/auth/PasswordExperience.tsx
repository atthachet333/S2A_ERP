import { useMemo, useState, type FormEvent } from 'react';
import { Check, Eye, EyeOff, KeyRound, LoaderCircle, LockKeyhole, LogOut, ShieldCheck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';

export default function PasswordExperience() {
  const { user, changePassword, logout } = useAuth(); const navigate = useNavigate();
  const [currentPassword, setCurrent] = useState(''); const [newPassword, setNew] = useState(''); const [confirm, setConfirm] = useState('');
  const [visible, setVisible] = useState({ current: false, next: false, confirm: false }); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [loggingOut, setLoggingOut] = useState(false); const [success, setSuccess] = useState(false);
  const rules = useMemo(() => [{ label: 'อย่างน้อย 10 ตัวอักษร', ok: newPassword.length >= 10 }, { label: 'มีตัวพิมพ์ใหญ่ A–Z', ok: /[A-Z]/.test(newPassword) }, { label: 'มีตัวพิมพ์เล็ก a–z', ok: /[a-z]/.test(newPassword) }, { label: 'มีตัวเลข 0–9', ok: /\d/.test(newPassword) }, { label: 'มีอักขระพิเศษ', ok: /[^A-Za-z0-9]/.test(newPassword) }], [newPassword]);
  const valid = rules.every((rule) => rule.ok) && newPassword === confirm && Boolean(currentPassword); const strength = rules.filter((rule) => rule.ok).length;
  const toggle = (key: keyof typeof visible) => setVisible((value) => ({ ...value, [key]: !value[key] }));
  const switchAccount = async () => { setLoggingOut(true); setError(''); try { await logout(); } catch { /* logout clears local session in finally; navigation must continue */ } finally { navigate('/login', { replace: true }); } };
  const submit = async (event: FormEvent) => { event.preventDefault(); if (newPassword !== confirm) { setError('รหัสผ่านใหม่และการยืนยันไม่ตรงกัน'); return; } if (!rules.every((rule) => rule.ok)) { setError('รหัสผ่านใหม่ยังไม่ผ่านข้อกำหนดทั้งหมด'); return; } setBusy(true); setError(''); try { await changePassword(currentPassword, newPassword); setSuccess(true); window.setTimeout(() => navigate('/select-company', { replace: true }), 700); } catch (reason) { setError(reason instanceof Error ? reason.message : 'เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองอีกครั้ง'); } finally { setBusy(false); } };

  return <main className="password-shell"><div className="password-glow" /><section className="password-card">
    <aside><div className="round-logo"><img src="/s2a-logo.png" alt="S2A ERP" /></div><p className="eyebrow light">ACCOUNT SECURITY</p><h1>เริ่มต้นอย่างปลอดภัย</h1><p>เพื่อปกป้องข้อมูลองค์กร กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนเข้าใช้งานครั้งแรก</p>
      <div className="account-pill"><ShieldCheck /><span>กำลังตั้งค่าบัญชี<br /><strong>{user?.fullName}</strong> · @{user?.username}</span></div>
      <div className="switch-account"><span>ไม่ใช่บัญชีของคุณ?</span><button type="button" onClick={() => void switchAccount()} disabled={loggingOut || busy}><LogOut aria-hidden />{loggingOut ? 'กำลังออกจากระบบ...' : 'ใช้บัญชีอื่น'}</button></div>
    </aside>
    <form onSubmit={(event) => void submit(event)}><header><span className="key-badge"><KeyRound /></span><div><h2>ตั้งรหัสผ่านใหม่</h2><p>รหัสผ่านปัจจุบันคือรหัสชั่วคราวที่ใช้เข้าสู่ระบบ</p></div></header>
      {error && <div className="auth-alert" role="alert">{error}</div>}{success && <div className="auth-success" role="status"><Check />เปลี่ยนรหัสผ่านสำเร็จ กำลังพาไป Dashboard…</div>}
      <PasswordField label="รหัสผ่านปัจจุบัน" value={currentPassword} setValue={setCurrent} show={visible.current} toggle={() => toggle('current')} autoComplete="current-password" />
      <PasswordField label="รหัสผ่านใหม่" value={newPassword} setValue={setNew} show={visible.next} toggle={() => toggle('next')} autoComplete="new-password" />
      <div className="strength"><div><span>ความแข็งแรงของรหัสผ่าน</span><strong>{strength < 3 ? 'ควรปรับปรุง' : strength < 5 ? 'ดี' : 'แข็งแรง'}</strong></div><div className={`strength-bar s${strength}`}><i /><i /><i /><i /><i /></div></div>
      <div className="rule-grid">{rules.map((rule) => <span className={rule.ok ? 'met' : ''} key={rule.label}><Check />{rule.label}</span>)}</div>
      <PasswordField label="ยืนยันรหัสผ่านใหม่" value={confirm} setValue={setConfirm} show={visible.confirm} toggle={() => toggle('confirm')} autoComplete="new-password" />
      <button className="auth-submit" disabled={busy || loggingOut || !valid || success}>{busy ? <><LoaderCircle className="spin" />กำลังบันทึก…</> : 'บันทึกและเข้าสู่ Dashboard'}</button>
    </form>
  </section></main>;
}

function PasswordField({ label, value, setValue, show, toggle, autoComplete }: { label: string; value: string; setValue: (value: string) => void; show: boolean; toggle: () => void; autoComplete: string }) {
  return <label>{label}<div className="auth-input"><LockKeyhole /><input type={show ? 'text' : 'password'} value={value} onChange={(event) => setValue(event.target.value)} autoComplete={autoComplete} required /><button type="button" onClick={toggle} aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>{show ? <EyeOff /> : <Eye />}</button></div></label>;
}
