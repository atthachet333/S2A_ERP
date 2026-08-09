import { useState, type FormEvent } from 'react';
import { ArrowLeft, Calculator, ChartNoAxesCombined, Eye, EyeOff, Leaf, LoaderCircle, LockKeyhole, ShieldCheck, Sparkles, UserRound, UtensilsCrossed } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';

const features = [
  { icon: Calculator, label: 'คำนวณต้นทุน' },
  { icon: UtensilsCrossed, label: 'คิดสูตรอาหาร' },
  { icon: Leaf, label: 'จัดการวัตถุดิบ' },
  { icon: ChartNoAxesCombined, label: 'วิเคราะห์กำไร' },
];

const capabilities = [
  ['คำนวณต้นทุน', 'วิเคราะห์ต้นทุนต่อเมนู'],
  ['สูตรอาหาร', 'สร้างและจัดการเวอร์ชันสูตร'],
  ['วัตถุดิบ', 'ควบคุมราคา หน่วย และบรรจุภัณฑ์'],
  ['กำไร', 'วิเคราะห์ราคาขายและ Margin'],
];

export default function LoginExperience() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState(() => localStorage.getItem('s2a_remembered_username') ?? '');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(localStorage.getItem('s2a_remembered_username')));
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : '/dashboard'} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const loggedIn = await login(username, password);
      if (remember) localStorage.setItem('s2a_remembered_username', username);
      else localStorage.removeItem('s2a_remembered_username');
      navigate(loggedIn.mustChangePassword ? '/change-password' : '/dashboard', { replace: true });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง');
    } finally { setBusy(false); }
  };

  return <main className="login-shell">
    <section className="login-brand">
      <div className="auth-orb orb-one" /><div className="auth-orb orb-two" />
      <div className="brand-top"><div className="round-logo large"><img src="/s2a-logo.png" alt="S2 Accounting Consultant" /></div><span>S2 ACCOUNTING CONSULTANT · PRODUCTION &amp; INVENTORY</span></div>
      <div className="brand-copy">
        <p className="eyebrow light"><Sparkles /> FOOD INTELLIGENCE WORKSPACE</p>
        <h1>ระบบคิดคำนวณต้นทุนและ<br />คิดคำนวณสูตรเมนูอาหาร</h1><h2>S2 Accounting Consultant</h2>
        <p>Food Costing • Recipe • Inventory Intelligence</p>
        <div className="feature-chips">{features.map(({ icon: Icon, label }) => <span key={label}><Icon />{label}</span>)}</div>
        <div className="login-feature-cards">{capabilities.map(([title, detail]) => <span key={title}><small>{title}</small><b>{detail}</b></span>)}</div>
      </div>
      <div className="brand-flow"><span>Ingredient</span><i>→</i><span>Recipe</span><i>→</i><span>Cost</span><i>→</i><span>Selling Price</span><i>→</i><span>Profit</span></div>
    </section>
    <section className="login-panel"><form className="login-card" onSubmit={(event) => void submit(event)}>
      <Link to="/" className="login-back"><ArrowLeft aria-hidden />กลับหน้าหลัก</Link>
      <div className="mobile-brand"><div className="round-logo"><img src="/s2a-logo.png" alt="S2 Accounting Consultant" /></div><strong>S2 ACCOUNTING CONSULTANT</strong></div>
      <header><p className="eyebrow">WELCOME BACK</p><h2>เข้าสู่ระบบ</h2><p>เข้าสู่พื้นที่จัดการต้นทุน สูตรอาหาร วัตถุดิบ และราคาขาย</p></header>
      {error && <div className="auth-alert" role="alert">{error}</div>}
      <label>ชื่อผู้ใช้<div className="auth-input"><UserRound /><input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder="กรอกชื่อผู้ใช้" required /></div></label>
      <label>รหัสผ่าน<div className="auth-input"><LockKeyhole /><input type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="กรอกรหัสผ่าน" required /><button type="button" onClick={() => setShow((value) => !value)} aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>{show ? <EyeOff /> : <Eye />}</button></div></label>
      <div className="login-options"><label className="remember"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} />จำชื่อผู้ใช้</label><span><ShieldCheck /> Secure access</span></div>
      <button className="auth-submit" disabled={busy}>{busy ? <><LoaderCircle className="spin" />กำลังเข้าสู่ระบบ…</> : 'เข้าสู่ระบบ'}</button>
      <footer><span className="system-dot" /> ระบบพร้อมใช้งาน <b>•</b> Production &amp; Inventory</footer>
    </form></section>
  </main>;
}
