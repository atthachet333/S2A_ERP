import { useRef, useState, type CSSProperties, type FormEvent, type PointerEvent } from 'react';
import { ArrowLeft, ArrowRight, Calculator, ChefHat, CircleDollarSign, Eye, EyeOff, LoaderCircle, LockKeyhole, PackageOpen, Tags, TrendingUp, UserRound } from 'lucide-react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '@/auth/AuthContext';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/i18n';

const nodes = [
  { key: 'ingredient', icon: PackageOpen, title: 'วัตถุดิบ', detail: 'ราคา • หน่วย • ปริมาณ' },
  { key: 'recipe', icon: ChefHat, title: 'สูตรอาหาร', detail: 'วัตถุดิบ • Yield • Portion' },
  { key: 'cost', icon: Calculator, title: 'ต้นทุน', detail: 'Batch • Unit Cost', anchor: true },
  { key: 'price', icon: Tags, title: 'ราคาขาย', detail: 'Markup • Margin' },
  { key: 'profit', icon: TrendingUp, title: 'กำไร', detail: 'Profit Intelligence' },
];

export default function LoginExperience() {
  const { messages } = useI18n(); const auth = messages.auth; const flow = messages.home.flow;
  const { user, login } = useAuth(); const navigate = useNavigate(); const canvasRef = useRef<HTMLElement>(null);
  const [username, setUsername] = useState(() => localStorage.getItem('s2a_remembered_username') ?? ''); const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(Boolean(localStorage.getItem('s2a_remembered_username'))); const [show, setShow] = useState(false); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : user.activeCompany ? user.defaultLandingPage : '/select-company'} replace />;
  const submit = async (event: FormEvent) => { event.preventDefault(); setError(''); setBusy(true); try { const loggedIn = await login(username, password); if (remember) localStorage.setItem('s2a_remembered_username', username); else localStorage.removeItem('s2a_remembered_username'); navigate(loggedIn.mustChangePassword ? '/change-password' : '/select-company', { replace: true }); } catch { setError(auth.invalid); } finally { setBusy(false); } };
  const parallax = (event: PointerEvent<HTMLElement>) => { if (event.pointerType !== 'mouse' || matchMedia('(prefers-reduced-motion: reduce)').matches) return; const box = event.currentTarget.getBoundingClientRect(); const x = ((event.clientX - box.left) / box.width - .5) * 8; const y = ((event.clientY - box.top) / box.height - .5) * 8; canvasRef.current?.style.setProperty('--px', `${x}px`); canvasRef.current?.style.setProperty('--py', `${y}px`); };
  return <main className="gateway-shell">
    <section ref={canvasRef} className="gateway-canvas" onPointerMove={parallax} onPointerLeave={() => { canvasRef.current?.style.setProperty('--px','0px'); canvasRef.current?.style.setProperty('--py','0px'); }}>
      <div className="gateway-blueprint" /><div className="gateway-haze" /><div className="gateway-arc" />
      <header className="gateway-brand"><span className="gateway-logo"><img src="/s2a-logo.png" alt="S2 Accounting Consultant" /></span><div><strong>S2 ACCOUNTING CONSULTANT</strong><small>FOOD COST INTELLIGENCE SYSTEM</small></div><i /></header>
      <div className="gateway-story"><p>{messages.home.support}</p><h1>{auth.gatewayLead} <strong>{auth.gatewayCost}</strong><br />{auth.gatewayBefore} <em>{auth.gatewayPrice}</em></h1><h2>{messages.home.hero}</h2></div>
      <div className="cost-network" aria-label="กระบวนการวิเคราะห์ต้นทุนอาหาร"><svg className="network-path" viewBox="0 0 660 280" preserveAspectRatio="none" aria-hidden><path d="M82 54 C155 54 178 82 224 102 S306 124 340 150"/><path d="M340 150 C390 166 412 206 472 220"/><path d="M340 150 C420 142 474 126 568 112"/><path className="network-pulse" d="M82 54 C155 54 178 82 224 102 S306 124 340 150 C390 166 412 206 472 220 C510 207 538 160 568 112"/></svg><div className="network-label label-yield">YIELD</div><div className="network-label label-version">RECIPE VERSION</div><div className="network-label label-unit">UNIT COST</div><div className="network-label label-markup">MARKUP</div><div className="network-label label-margin">MARGIN</div>{nodes.map(({key,icon:Icon,title,detail,anchor},index)=><article key={key} className={`s2-node node-${key}${anchor?' anchor':''}`} style={{'--step':index} as CSSProperties}><span><Icon /></span><div><strong>{title}</strong><small>{detail}</small></div>{anchor&&<b><CircleDollarSign /> INTELLIGENCE CORE</b>}</article>)}<span className="network-output">INTELLIGENCE SIGNAL</span></div>
      <footer className="gateway-foot"><span><i /> CALCULATION FLOW ACTIVE</span><small>Ingredient → Recipe → Cost → Selling Price → Profit</small></footer>
    </section>
    <section className="access-panel"><div className="access-bridge"><span>WORKSPACE ACCESS</span></div><form className="access-console" onSubmit={(event) => void submit(event)}>
      <div className="console-rule" /><div className="console-toolbar"><Link to="/" className="console-back"><ArrowLeft /> {messages.common.backHome}</Link><LanguageSwitcher compact /></div><div className="console-mobile-brand"><img src="/s2a-logo.png" alt="S2A" /><span>S2A COST INTELLIGENCE</span></div>
      <header><div className="console-kicker"><small>SYSTEM ACCESS</small><span><i /> SECURE WORKSPACE</span></div><h2>{auth.signIn}</h2><p>{auth.subtitle}</p></header>
      {error && <div className="auth-alert console-alert" role="alert">{error}</div>}
      <label>{auth.username}<div className="console-input"><UserRound /><input autoFocus autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} placeholder={auth.usernamePlaceholder} required /></div></label>
      <label>{auth.password}<div className="console-input"><LockKeyhole /><input type={show?'text':'password'} autoComplete="current-password" value={password} onChange={(event)=>setPassword(event.target.value)} placeholder={auth.passwordPlaceholder} required /><button type="button" onClick={()=>setShow((value)=>!value)} aria-label={show?'Hide password':'Show password'}>{show?<EyeOff/>:<Eye/>}</button></div></label>
      <div className="console-options"><label><input type="checkbox" checked={remember} onChange={(event)=>setRemember(event.target.checked)} />{auth.remember}</label><Link to="/forgot-password">{auth.forgot}</Link></div>
      <button className={`gateway-submit${username&&password?' ready':''}`} disabled={busy}>{busy?<><LoaderCircle className="spin"/>{auth.signingIn}</>:<><span>{auth.signIn}<small>ENTER WORKSPACE</small></span><ArrowRight/></>}</button>
      <p className="console-register">{auth.noAccount} <Link to="/register">{auth.register}</Link></p>
      <div className="console-mini-flow" aria-hidden="true"><span>{flow[0]}</span><i />{flow[1]}<i />{flow[2]}<i />{auth.workspace}</div>
      <footer><span><i/>SYSTEM READY</span><b>SECURE ACCESS • S2A ERP</b></footer>
    </form></section>
  </main>;
}
