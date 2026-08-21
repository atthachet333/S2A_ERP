import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sprout, UtensilsCrossed, Calculator, Tags, TrendingUp, ArrowRight, LogIn,
  PlayCircle, Package, ChartPie, Boxes, PackageOpen, ChartColumnBig, ShieldCheck,
  Target, Gauge, Sparkles, Lightbulb, ScrollText, Coins, Layers, CheckCircle2,
  Crown, Flame, ArrowDownWideNarrow, Menu, X, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import './home.css';
import CookieConsent from '@/components/CookieConsent';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/i18n';
import { resolveHomeContent } from '@/i18n/home-content';

/** ค่าเริ่มต้นในหน้า public — เป็น "ตัวอย่างเชิงแนวคิด" เพื่อสื่อว่าระบบแสดงอะไร ไม่ใช่ข้อมูลธุรกิจจริง */
const FLOW = [Sprout, UtensilsCrossed, Calculator, Tags, TrendingUp];

const FEATURES: { icon: LucideIcon; tone: string }[] = [{icon:Sprout,tone:''},{icon:Package,tone:'gold'},{icon:UtensilsCrossed,tone:'green'},{icon:Calculator,tone:''},{icon:Tags,tone:'gold'},{icon:Gauge,tone:'green'},{icon:ChartColumnBig,tone:''}];

const STEPS = [Sprout, Package, Layers, UtensilsCrossed, Calculator, Tags, TrendingUp];

const WHY = [ShieldCheck, Target, PackageOpen, Coins, ChartPie, Sparkles];

const KPI_PREVIEW = [{ic:'b',icon:Boxes,value:'128',trend:'+6',up:true},{ic:'o',icon:Package,value:'34',trend:'+3',up:true},{ic:'g',icon:UtensilsCrossed,value:'52',trend:'+8',up:true},{ic:'p',icon:TrendingUp,value:'61%',trend:'+4',up:true}];

const TOP_SELLING = [
  { name: 'ข้าวกะเพราไก่ไข่ดาว', v: '฿24,800', w: 100 },
  { name: 'ข้าวหมูทอดกระเทียม', v: '฿19,300', w: 78 },
  { name: 'ผัดไทยกุ้งสด', v: '฿15,600', w: 63 },
  { name: 'ต้มยำกุ้งน้ำข้น', v: '฿12,100', w: 49 },
];
const TOP_MARGIN = [
  { name: 'ชาไทยเย็น', v: '74%', w: 100 },
  { name: 'ข้าวไข่เจียว', v: '69%', w: 92 },
  { name: 'ข้าวกะเพราไก่', v: '63%', w: 84 },
  { name: 'ผัดซีอิ๊วหมู', v: '58%', w: 77 },
];

const WATERFALL = [{cls:'ing',h:55,v:'22'},{cls:'pkg',h:24,v:'8'},{cls:'lab',h:16,v:'5'},{cls:'cost',h:82,v:'35'},{cls:'profit',h:100,v:'59'}];

function useReveal() {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const els = Array.from(root.querySelectorAll<HTMLElement>('.hp-reveal'));
    if (!('IntersectionObserver' in window)) { els.forEach((el) => el.classList.add('in')); return; }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return ref;
}

const NAV = [
  { id: 'about' },
  { id: 'features' },
  { id: 'process' },
  { id: 'kpi' },
];

export default function HomePage() {
  const { user } = useAuth();
  const { messages, locale } = useI18n(); const page = resolveHomeContent(locale);
  const rootRef = useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  // เมนูมือถือ: ปิดด้วย ESC + ล็อกการเลื่อนพื้นหลังระหว่างเปิด
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [menuOpen]);

  // กลับมาจอใหญ่แล้วต้องไม่ค้างสถานะเมนูมือถือ
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 721px)');
    const onChange = () => { if (mq.matches) setMenuOpen(false); };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Scrollspy — เน้นเมนูของ section ที่กำลังดูอยู่
  useEffect(() => {
    const sections = NAV.map((n) => document.getElementById(n.id)).filter(Boolean) as HTMLElement[];
    if (!sections.length || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver((entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveId(visible.target.id);
    }, { rootMargin: '-45% 0px -50% 0px', threshold: [0, 0.25, 0.5, 1] });
    sections.forEach((s) => io.observe(s));
    return () => io.disconnect();
  }, []);

  const loggedIn = Boolean(user && !user.mustChangePassword);
  const loginTo = loggedIn ? '/dashboard' : '/login';
  const loginLabel = loggedIn ? messages.home.dashboard : messages.home.signIn;
  const navLabels = messages.home.nav;

  return (
    <div className="hp-root" ref={rootRef as React.RefObject<HTMLDivElement>}>
      {/* ============ HEADER ============ */}
      <header className={`hp-header${scrolled ? ' scrolled' : ''}`}>
        <div className="hp-container hp-header-inner">
          <a className="hp-brand" href="#top">
            <span className="hp-brand-logo"><img src="/s2a-logo.png" alt="S2 Accounting Consultant" /></span>
            <span className="hp-brand-text">
              <strong>S2 ACCOUNTING CONSULTANT</strong>
              <span>PRODUCTION &amp; INVENTORY</span>
            </span>
          </a>
          <nav className="hp-nav">
            {NAV.map((n) => (
              <a key={n.id} href={`#${n.id}`} className={activeId === n.id ? 'active' : ''}>{navLabels[NAV.indexOf(n)]}</a>
            ))}
          </nav>
          <LanguageSwitcher compact /><Link to={loginTo} className="hp-login-btn"><LogIn aria-hidden />{loginLabel}</Link>
          <button
            type="button"
            className="hp-burger"
            aria-label={menuOpen ? messages.navigation.closeMenu : messages.navigation.openMenu}
            aria-expanded={menuOpen}
            aria-controls="hp-mobile-nav"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <X aria-hidden /> : <Menu aria-hidden />}
          </button>
        </div>
      </header>

      {/* ============ MOBILE NAV (<=720px) ============ */}
      <div
        className={`hp-mobile-scrim${menuOpen ? ' open' : ''}`}
        onClick={() => setMenuOpen(false)}
        aria-hidden
      />
      <nav
        id="hp-mobile-nav"
        className={`hp-mobile-nav${menuOpen ? ' open' : ''}`}
        aria-label={navLabels[0]}
      >
        {NAV.map((n) => (
          <a
            key={n.id}
            href={`#${n.id}`}
            className={activeId === n.id ? 'active' : ''}
            onClick={() => setMenuOpen(false)}
          >
            {navLabels[NAV.indexOf(n)]}
          </a>
        ))}
        <div className="hp-mobile-lang"><LanguageSwitcher /></div>
      </nav>

      {/* ============ HERO ============ */}
      <section className="hp-hero" id="top">
        <div className="hp-orb a" /><div className="hp-orb b" />
        <div className="hp-container hp-hero-grid">
          <div>
            <div className="hp-hero-badge">
              <b><i />LIVE</b> {page.live}
            </div>
            <h1 className="hp-h1">{messages.home.hero}</h1>
            <div className="hp-brand-line">
              <span className="l2">S2 Accounting Consultant</span>
              <span className="l3">PRODUCTION &amp; INVENTORY</span>
            </div>
            <p className="hp-hero-sub">{messages.home.support}</p>
            <div className="hp-cta-row">
              <Link to={loginTo} className="hp-cta primary"><LogIn aria-hidden />{loginLabel}<ArrowRight aria-hidden /></Link>
              <a href="#process" className="hp-cta ghost"><PlayCircle aria-hidden />{messages.home.process}</a>
            </div>
            <div className="hp-hero-stats">
              <div><b className="hp-num">7</b><span>{page.heroStats[0]}</span></div>
              <div className="sep" />
              <div><b className="hp-num">5</b><span>{page.heroStats[1]}</span></div>
              <div className="sep" />
              <div><b className="hp-num">100%</b><span>{page.heroStats[2]}</span></div>
            </div>
          </div>

          {/* Flow visual */}
          <div className="hp-flow-panel hp-reveal">
            <div className="hp-flow-panel-head">
              <span>Cost Flow</span>
              <i><b />{page.auto}</i>
            </div>
            <div className="hp-flow">
              {FLOW.map((Icon, i) => (
                <div key={messages.home.flow[i]}>
                  <div className="hp-flow-node">
                    <span className="hp-flow-ic"><Icon aria-hidden /></span>
                    <span className="hp-flow-body"><strong>{messages.home.flow[i]}</strong><span>{messages.home.flowDetails[i]}</span></span>
                    <span className="hp-flow-step hp-num">0{i + 1}</span>
                  </div>
                  {i < FLOW.length - 1 && <div className="hp-flow-connector" />}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="hp-hero-wave" aria-hidden>
          <svg viewBox="0 0 1440 90" preserveAspectRatio="none"><path d="M0,64 C240,90 480,20 720,32 C960,44 1200,96 1440,58 L1440,90 L0,90 Z" fill="#f4f8fd" /></svg>
        </div>
      </section>

      {/* ============ FEATURE OVERVIEW ============ */}
      <section className="hp-section hp-features" id="features">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><Layers aria-hidden />{page.featureHead[0]}</span><h2>{page.featureHead[1]}</h2><p>{page.featureHead[2]}</p>
          </div>
          <div className="hp-feature-grid">
            {FEATURES.map(({ icon: Icon, tone }, i) => (
              <div className={`hp-feature-card hp-reveal ${tone}`} data-testid="home-feature" key={page.features[i][0]} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <span className="hp-feature-tag hp-num">0{i + 1}</span>
                <span className="hp-feature-ic"><Icon aria-hidden /></span>
                <h3>{page.features[i][0]}</h3><p>{page.features[i][1]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ PROCESS ============ */}
      <section className="hp-section hp-process" id="process">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><ScrollText aria-hidden />{page.processHead[0]}</span><h2>{page.processHead[1]}</h2><p>{page.processHead[2]}</p>
          </div>
          <div className="hp-steps hp-reveal">
            {STEPS.map((Icon, i) => (
              <div className="hp-step" data-testid="home-workflow-step" key={page.steps[i][0]}>
                <div className="hp-step-dot"><Icon aria-hidden /><b className="hp-num">{i + 1}</b></div>
                <h4>{page.steps[i][0]}</h4><p>{page.steps[i][1]}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHY ============ */}
      <section className="hp-section" id="about">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><Lightbulb aria-hidden />{page.whyHead[0]}</span><h2>{page.whyHead[1]}</h2><p>{page.whyHead[2]}</p>
          </div>
          <div className="hp-why-grid">
            <div className="hp-why-visual hp-reveal">
              <h3>{page.cost[0]}</h3><p>{page.cost[1]}</p>
              <div className="hp-cost-bar">
                <div className="lbl"><span>{page.cost[2]}</span><b className="hp-num">฿22 · 63%</b></div>
                <div className="hp-cost-track ing"><i style={{ width: '63%' }} /></div>
              </div>
              <div className="hp-cost-bar">
                <div className="lbl"><span>{page.cost[3]}</span><b className="hp-num">฿8 · 23%</b></div>
                <div className="hp-cost-track pkg"><i style={{ width: '23%' }} /></div>
              </div>
              <div className="hp-cost-bar">
                <div className="lbl"><span>{page.cost[4]}</span><b className="hp-num">฿5 · 14%</b></div>
                <div className="hp-cost-track lab" style={{ display: 'none' }}><i /></div>
                <div className="hp-cost-track ing" style={{ opacity: .55 }}><i style={{ width: '14%' }} /></div>
              </div>
              <div className="hp-why-price">
                <b className="hp-num">฿24</b>
                <span>{page.cost[5]}</span>
              </div>
            </div>
            <div className="hp-why-list">
              {WHY.map((Icon, i) => (
                <div className="hp-why-item hp-reveal" data-testid="home-benefit" key={page.why[i][0]} style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                  <span className="hp-why-ic"><Icon aria-hidden /></span>
                  <div><h4>{page.why[i][0]}</h4><p>{page.why[i][1]}</p></div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ============ KPI PREVIEW ============ */}
      <section className="hp-section hp-kpi" id="kpi">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><Gauge aria-hidden />{page.kpiHead[0]}</span><h2>{page.kpiHead[1]}</h2><p>{page.kpiHead[2]}</p>
          </div>
          <div className="hp-kpi-frame hp-reveal">
            <div className="hp-kpi-bar">
              <span className="dot r" /><span className="dot y" /><span className="dot g" />
              <span>{page.kpiBar[0]}</span><em>{page.kpiBar[1]}</em>
            </div>
            <div className="hp-kpi-body">
              {KPI_PREVIEW.map(({ ic, icon: Icon, value, trend, up }, i) => (
                <div className="hp-kpi-card" key={page.kpiLabels[i][0]}>
                  <div className="top">
                    <span className={`ic ${ic}`}><Icon aria-hidden /></span>
                    <span className={`trend ${up ? 'up' : 'down'} hp-num`}>▲ {trend}</span>
                  </div>
                  <h4>{page.kpiLabels[i][0]}</h4>
                  <b className="hp-num">{value}</b>
                  <small>{page.kpiLabels[i][1]}</small>
                </div>
              ))}
            </div>
            <div className="hp-kpi-lists">
              <div className="hp-kpi-panel">
                <h5><Crown aria-hidden />{page.rankings[0]}</h5>
                {TOP_SELLING.map((r, i) => (
                  <div className="hp-rank" key={r.name}>
                    <span className="n hp-num">{i + 1}</span>
                    <span className="nm">{r.name}</span>
                    <span className="mini"><i style={{ width: `${r.w}%` }} /></span>
                    <span className="v hp-num">{r.v}</span>
                  </div>
                ))}
              </div>
              <div className="hp-kpi-panel">
                <h5><Flame aria-hidden />{page.rankings[1]}</h5>
                {TOP_MARGIN.map((r, i) => (
                  <div className="hp-rank" key={r.name}>
                    <span className="n hp-num">{i + 1}</span>
                    <span className="nm">{r.name}</span>
                    <span className="mini"><i style={{ width: `${r.w}%` }} /></span>
                    <span className="v hp-num">{r.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="hp-kpi-note">{page.disclaimer}</p>
        </div>
      </section>

      {/* ============ PRICING / COST INSIGHT ============ */}
      <section className="hp-section hp-price-sec">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><ArrowDownWideNarrow aria-hidden />{page.profitHead[0]}</span><h2>{page.profitHead[1]}</h2><p>{page.profitHead[2]}</p>
          </div>
          <div className="hp-waterfall hp-reveal">
            {WATERFALL.map(({ cls, h, v }, i) => (
              <div className={`hp-wf ${cls}`} key={page.waterfall[i][0]}>
                <div className="hp-wf-bar" style={{ height: `${h * 2.1}px` }}><b className="hp-num">฿{v}</b></div>
                <div className="hp-wf-lbl">{page.waterfall[i][0]}<span>{page.waterfall[i][1]}</span></div>
              </div>
            ))}
          </div>
          <div className="hp-price-legend hp-reveal">
            {page.legend.map((label,i)=><span key={label}><i style={{ background: ['#1677c8','#c6a15b','#7fb3dd','#64748b','#35d69f'][i] }} />{label}</span>)}
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="hp-final">
        <div className="hp-container hp-final-inner">
          <span className="hp-eyebrow on-dark" style={{ justifyContent: 'center' }}><CheckCircle2 aria-hidden />{page.cta[0]}</span><h2>{page.cta[1]}</h2><p>{page.cta[2]}</p>
          <div className="hp-cta-row">
            <Link to={loginTo} className="hp-cta primary"><LogIn aria-hidden />{loginLabel}<ArrowRight aria-hidden /></Link>
            <a href="#features" className="hp-cta ghost"><Layers aria-hidden />{page.cta[3]}</a>
          </div>
        </div>
      </section>

      {/* ============ FOOTER ============ */}
      <footer className="hp-footer">
        <div className="hp-container">
          <div className="hp-footer-grid">
            <div className="hp-footer-about">
              <a className="hp-brand" href="#top">
                <span className="hp-brand-logo"><img src="/s2a-logo.png" alt="S2 Accounting Consultant" /></span>
                <span className="hp-brand-text">
                  <strong>S2 ACCOUNTING CONSULTANT</strong>
                  <span>PRODUCTION &amp; INVENTORY</span>
                </span>
              </a>
              <p>{page.footer[0]}</p>
            </div>
            <div className="hp-footer-col">
              <h5>{page.footer[1]}</h5><a href="#about">{page.footer[2]}</a><a href="#features">{page.footer[3]}</a><a href="#process">{page.footer[4]}</a><a href="#kpi">{page.footer[5]}</a>
            </div>
            <div className="hp-footer-col">
              <h5>{page.footer[6]}</h5>
              <Link to={loginTo}>{loginLabel}</Link>
              <span>{page.footer[7]}</span><span>{page.footer[8]}</span><span>{page.footer[9]}</span>
            </div>
          </div>
          <div className="hp-footer-bottom">
            <small>© {new Date().getFullYear()} S2 Accounting Consultant · {page.footer[11]}</small>
            <span className="tag">PRODUCTION &amp; INVENTORY</span>
            <button className="hp-cookie-settings" onClick={() => window.dispatchEvent(new Event('s2a:cookie-settings'))}>{page.footer[10]}</button>
          </div>
        </div>
      </footer>
      <CookieConsent />
    </div>
  );
}
