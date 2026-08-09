import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sprout, UtensilsCrossed, Calculator, Tags, TrendingUp, ArrowRight, LogIn,
  PlayCircle, Package, ChartPie, Boxes, PackageOpen, ChartColumnBig, ShieldCheck,
  Target, Gauge, Sparkles, Lightbulb, ScrollText, Coins, Layers, CheckCircle2,
  Crown, Flame, ArrowDownWideNarrow, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import './home.css';

/** ค่าเริ่มต้นในหน้า public — เป็น "ตัวอย่างเชิงแนวคิด" เพื่อสื่อว่าระบบแสดงอะไร ไม่ใช่ข้อมูลธุรกิจจริง */
const FLOW = [
  { icon: Sprout, title: 'วัตถุดิบ', desc: 'ราคาซื้อ · หน่วย · ต้นทุนต่อหน่วยฐาน' },
  { icon: UtensilsCrossed, title: 'สูตรอาหาร', desc: 'รวมวัตถุดิบและบรรจุภัณฑ์เป็นเมนู' },
  { icon: Calculator, title: 'ต้นทุน', desc: 'คำนวณต้นทุนจริงต่อจาน/ต่อกล่อง' },
  { icon: Tags, title: 'ราคาขาย', desc: 'ตั้งราคาแบบ markup หรือ margin' },
  { icon: TrendingUp, title: 'กำไร', desc: 'เห็นกำไรและ margin ทุกเมนู' },
];

const FEATURES: { icon: LucideIcon; tone: string; title: string; desc: string }[] = [
  { icon: Sprout, tone: '', title: 'จัดการวัตถุดิบ', desc: 'บันทึกราคาซื้อ หน่วยซื้อ และหน่วยใช้ในสูตร ระบบแปลงเป็นต้นทุนต่อหน่วยฐานให้อัตโนมัติ' },
  { icon: Package, tone: 'gold', title: 'จัดการบรรจุภัณฑ์', desc: 'กล่องข้าว ถุง ช้อนส้อม ฝา ถ้วยน้ำจิ้ม คิดต้นทุนต่อชิ้นจากจำนวนต่อแพ็คได้ทันที' },
  { icon: UtensilsCrossed, tone: 'green', title: 'สร้างสูตรอาหาร', desc: 'ประกอบเมนูจากวัตถุดิบและบรรจุภัณฑ์ พร้อมปริมาณและหน่วยของแต่ละบรรทัด' },
  { icon: Calculator, tone: '', title: 'คำนวณต้นทุนต่อเมนู', desc: 'รวมต้นทุนวัตถุดิบ บรรจุภัณฑ์ ค่าแรงและ overhead ออกมาเป็นต้นทุนต่อจานจริง' },
  { icon: Tags, tone: 'gold', title: 'ตั้งราคาขายและวิเคราะห์กำไร', desc: 'ตั้งราคาแบบ markup หรือ margin เทียบหลายราคา หน้าร้าน/ดิลิเวอรี/ขายส่ง' },
  { icon: Gauge, tone: 'green', title: 'ดู KPI เมนูอาหาร', desc: 'เมนูต้นทุนสูง เมนู margin ดี สัดส่วนต้นทุนวัตถุดิบเทียบบรรจุภัณฑ์ ในที่เดียว' },
  { icon: ChartColumnBig, tone: '', title: 'สรุปการขาย', desc: 'จัดอันดับเมนูขายดี/ขายไม่ดี รายได้และกำไรต่อเมนู เพื่อช่วยตัดสินใจ' },
];

const STEPS: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: Sprout, title: 'เพิ่มวัตถุดิบ', desc: 'ใส่ราคาและหน่วยที่ซื้อ' },
  { icon: Package, title: 'เพิ่มบรรจุภัณฑ์', desc: 'กล่อง ถุง ช้อน ฝา' },
  { icon: Layers, title: 'กำหนดหน่วย', desc: 'แปลงเป็นหน่วยใช้ในสูตร' },
  { icon: UtensilsCrossed, title: 'สร้างสูตร', desc: 'ประกอบเป็นเมนู' },
  { icon: Calculator, title: 'รวมต้นทุนจริง', desc: 'คิดต่อจาน/ต่อกล่อง' },
  { icon: Tags, title: 'ตั้งราคาขาย', desc: 'markup หรือ margin' },
  { icon: TrendingUp, title: 'ดูกำไร & KPI', desc: 'ยอดขายและ margin' },
];

const WHY: { icon: LucideIcon; title: string; desc: string }[] = [
  { icon: ShieldCheck, title: 'ลดการคำนวณผิด', desc: 'ไม่ต้องกดเครื่องคิดเลขซ้ำ ๆ ระบบคิดต้นทุนและกำไรให้อัตโนมัติทุกครั้งที่ราคาเปลี่ยน' },
  { icon: Target, title: 'เห็นต้นทุนจริงต่อเมนู', desc: 'รู้ว่าแต่ละเมนูมีต้นทุนเท่าไร รวมค่าบรรจุภัณฑ์และค่าแรง ไม่ใช่แค่เดา' },
  { icon: PackageOpen, title: 'เห็นต้นทุนบรรจุภัณฑ์ชัดเจน', desc: 'กล่อง ถุง ช้อนส้อม รวมเป็นต้นทุนที่มองข้ามบ่อย ระบบแยกให้เห็นชัด' },
  { icon: Coins, title: 'ตั้งราคาขายได้แม่นยำ', desc: 'ตั้งราคาจากต้นทุนจริงและเป้ากำไรที่ต้องการ ไม่ขาดทุนโดยไม่รู้ตัว' },
  { icon: ChartPie, title: 'วิเคราะห์เมนูขายดี/ขายไม่ดี', desc: 'จัดอันดับเมนูที่ทำกำไรและเมนูที่ควรปรับ เพื่อวางแผนได้ถูกจุด' },
  { icon: Sparkles, title: 'ใช้งานง่ายแม้ไม่เก่งระบบ', desc: 'ออกแบบให้คนหน้างานอ่านเข้าใจทันที ทุกหน้าบอกชัดว่าใช้ทำอะไร' },
];

const KPI_PREVIEW = [
  { ic: 'b', icon: Boxes, label: 'วัตถุดิบทั้งหมด', value: '128', sub: 'รายการ', trend: '+6', up: true },
  { ic: 'o', icon: Package, label: 'บรรจุภัณฑ์', value: '34', sub: 'รายการ', trend: '+3', up: true },
  { ic: 'g', icon: UtensilsCrossed, label: 'เมนูอาหาร', value: '52', sub: 'เมนู', trend: '+8', up: true },
  { ic: 'p', icon: TrendingUp, label: 'กำไรเฉลี่ย/เมนู', value: '61%', sub: 'margin', trend: '+4', up: true },
];

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

const WATERFALL = [
  { cls: 'ing', label: 'วัตถุดิบ', sub: '฿22', h: 55, v: '22' },
  { cls: 'pkg', label: 'บรรจุภัณฑ์', sub: '฿8', h: 24, v: '8' },
  { cls: 'lab', label: 'ค่าแรง/โสหุ้ย', sub: '฿5', h: 16, v: '5' },
  { cls: 'cost', label: 'ต้นทุนรวม', sub: '฿35', h: 82, v: '35' },
  { cls: 'profit', label: 'ราคาขาย ฿59', sub: 'กำไร ฿24', h: 100, v: '59' },
];

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
  { id: 'about', label: 'เกี่ยวกับระบบ' },
  { id: 'features', label: 'ฟีเจอร์' },
  { id: 'process', label: 'วิธีการทำงาน' },
  { id: 'kpi', label: 'ภาพรวมระบบ' },
];

export default function HomePage() {
  const { user } = useAuth();
  const rootRef = useReveal();
  const [scrolled, setScrolled] = useState(false);
  const [activeId, setActiveId] = useState('');

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
  const loginLabel = loggedIn ? 'ไปที่แดชบอร์ด' : 'เข้าสู่ระบบ';

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
              <a key={n.id} href={`#${n.id}`} className={activeId === n.id ? 'active' : ''}>{n.label}</a>
            ))}
          </nav>
          <Link to={loginTo} className="hp-login-btn"><LogIn aria-hidden />{loginLabel}</Link>
        </div>
      </header>

      {/* ============ HERO ============ */}
      <section className="hp-hero" id="top">
        <div className="hp-orb a" /><div className="hp-orb b" />
        <div className="hp-container hp-hero-grid">
          <div>
            <div className="hp-hero-badge">
              <b><i />LIVE</b> ระบบคิดต้นทุน &amp; สูตรเมนูอาหาร
            </div>
            <h1 className="hp-h1">ระบบคิดคำนวณต้นทุนและคิดคำนวณสูตรเมนูอาหาร</h1>
            <div className="hp-brand-line">
              <span className="l2">S2 Accounting Consultant</span>
              <span className="l3">PRODUCTION &amp; INVENTORY</span>
            </div>
            <p className="hp-hero-sub">
              ระบบสำหรับจัดการต้นทุนอาหาร สูตรเมนู วัตถุดิบ บรรจุภัณฑ์ ราคาขาย และกำไร —
              ครบในที่เดียว อ่านง่าย ใช้ได้จริงหน้างาน
            </p>
            <div className="hp-cta-row">
              <Link to={loginTo} className="hp-cta primary"><LogIn aria-hidden />{loginLabel}<ArrowRight aria-hidden /></Link>
              <a href="#process" className="hp-cta ghost"><PlayCircle aria-hidden />ดูการทำงานของระบบ</a>
            </div>
            <div className="hp-hero-stats">
              <div><b className="hp-num">7</b><span>โมดูลหลักครบวงจร</span></div>
              <div className="sep" />
              <div><b className="hp-num">5</b><span>ขั้นตอน วัตถุดิบ → กำไร</span></div>
              <div className="sep" />
              <div><b className="hp-num">100%</b><span>ต้นทุนต่อเมนูจริง</span></div>
            </div>
          </div>

          {/* Flow visual */}
          <div className="hp-flow-panel hp-reveal">
            <div className="hp-flow-panel-head">
              <span>Cost Flow</span>
              <i><b />คำนวณอัตโนมัติ</i>
            </div>
            <div className="hp-flow">
              {FLOW.map(({ icon: Icon, title, desc }, i) => (
                <div key={title}>
                  <div className="hp-flow-node">
                    <span className="hp-flow-ic"><Icon aria-hidden /></span>
                    <span className="hp-flow-body"><strong>{title}</strong><span>{desc}</span></span>
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
            <span className="hp-eyebrow"><Layers aria-hidden />ฟีเจอร์ของระบบ</span>
            <h2>ทุกอย่างที่ร้านอาหารต้องใช้ ในระบบเดียว</h2>
            <p>ตั้งแต่วัตถุดิบและบรรจุภัณฑ์ ไปจนถึงต้นทุน ราคาขาย และการวิเคราะห์ยอดขาย</p>
          </div>
          <div className="hp-feature-grid">
            {FEATURES.map(({ icon: Icon, tone, title, desc }, i) => (
              <div className={`hp-feature-card hp-reveal ${tone}`} key={title} style={{ transitionDelay: `${(i % 3) * 70}ms` }}>
                <span className="hp-feature-tag hp-num">0{i + 1}</span>
                <span className="hp-feature-ic"><Icon aria-hidden /></span>
                <h3>{title}</h3>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ PROCESS ============ */}
      <section className="hp-section hp-process" id="process">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><ScrollText aria-hidden />การทำงานของระบบ</span>
            <h2>เริ่มใช้งานได้ใน 7 ขั้นตอน</h2>
            <p>ไล่จากการเพิ่มข้อมูลพื้นฐาน ไปจนถึงการดูกำไรและ KPI ของแต่ละเมนู</p>
          </div>
          <div className="hp-steps hp-reveal">
            {STEPS.map(({ icon: Icon, title, desc }, i) => (
              <div className="hp-step" key={title}>
                <div className="hp-step-dot"><Icon aria-hidden /><b className="hp-num">{i + 1}</b></div>
                <h4>{title}</h4>
                <p>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============ WHY ============ */}
      <section className="hp-section" id="about">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><Lightbulb aria-hidden />ทำไมต้องใช้ระบบนี้</span>
            <h2>เปลี่ยนการเดาต้นทุน ให้เป็นตัวเลขที่เชื่อถือได้</h2>
            <p>ระบบช่วยให้เจ้าของร้านและทีมครัวตัดสินใจเรื่องราคาและกำไรได้อย่างมั่นใจ</p>
          </div>
          <div className="hp-why-grid">
            <div className="hp-why-visual hp-reveal">
              <h3>โครงสร้างต้นทุน 1 เมนู</h3>
              <p>ตัวอย่างสัดส่วนต้นทุนของเมนูข้าวกล่อง — ระบบแยกให้เห็นทุกส่วน</p>
              <div className="hp-cost-bar">
                <div className="lbl"><span>ต้นทุนวัตถุดิบ</span><b className="hp-num">฿22 · 63%</b></div>
                <div className="hp-cost-track ing"><i style={{ width: '63%' }} /></div>
              </div>
              <div className="hp-cost-bar">
                <div className="lbl"><span>ต้นทุนบรรจุภัณฑ์</span><b className="hp-num">฿8 · 23%</b></div>
                <div className="hp-cost-track pkg"><i style={{ width: '23%' }} /></div>
              </div>
              <div className="hp-cost-bar">
                <div className="lbl"><span>ค่าแรง / โสหุ้ย</span><b className="hp-num">฿5 · 14%</b></div>
                <div className="hp-cost-track lab" style={{ display: 'none' }}><i /></div>
                <div className="hp-cost-track ing" style={{ opacity: .55 }}><i style={{ width: '14%' }} /></div>
              </div>
              <div className="hp-why-price">
                <b className="hp-num">฿24</b>
                <span>กำไรต่อกล่อง เมื่อขาย ฿59 · margin 41%</span>
              </div>
            </div>
            <div className="hp-why-list">
              {WHY.map(({ icon: Icon, title, desc }, i) => (
                <div className="hp-why-item hp-reveal" key={title} style={{ transitionDelay: `${(i % 3) * 60}ms` }}>
                  <span className="hp-why-ic"><Icon aria-hidden /></span>
                  <div><h4>{title}</h4><p>{desc}</p></div>
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
            <span className="hp-eyebrow"><Gauge aria-hidden />ภาพรวม KPI</span>
            <h2>แดชบอร์ดที่บอกทุกอย่างในหน้าเดียว</h2>
            <p>เห็นจำนวนเมนู วัตถุดิบ ต้นทุนเฉลี่ย เมนูขายดี และเมนูกำไรสูงสุดได้ทันที</p>
          </div>
          <div className="hp-kpi-frame hp-reveal">
            <div className="hp-kpi-bar">
              <span className="dot r" /><span className="dot y" /><span className="dot g" />
              <span>ภาพรวมระบบ — S2A</span>
              <em>ตัวอย่างหน้าจอ</em>
            </div>
            <div className="hp-kpi-body">
              {KPI_PREVIEW.map(({ ic, icon: Icon, label, value, sub, trend, up }) => (
                <div className="hp-kpi-card" key={label}>
                  <div className="top">
                    <span className={`ic ${ic}`}><Icon aria-hidden /></span>
                    <span className={`trend ${up ? 'up' : 'down'} hp-num`}>▲ {trend}</span>
                  </div>
                  <h4>{label}</h4>
                  <b className="hp-num">{value}</b>
                  <small>{sub}</small>
                </div>
              ))}
            </div>
            <div className="hp-kpi-lists">
              <div className="hp-kpi-panel">
                <h5><Crown aria-hidden />เมนูขายดี 5 อันดับ</h5>
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
                <h5><Flame aria-hidden />เมนู margin สูงสุด</h5>
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
          <p className="hp-kpi-note">* ตัวเลขด้านบนเป็นตัวอย่างเพื่อสื่อการทำงาน เมื่อเข้าสู่ระบบจะแสดงข้อมูลจริงจากร้านของคุณ</p>
        </div>
      </section>

      {/* ============ PRICING / COST INSIGHT ============ */}
      <section className="hp-section hp-price-sec">
        <div className="hp-container">
          <div className="hp-section-head hp-reveal">
            <span className="hp-eyebrow"><ArrowDownWideNarrow aria-hidden />ต้นทุนสู่กำไร</span>
            <h2>จากต้นทุนทุกบาท สู่ราคาขายที่ทำกำไร</h2>
            <p>ระบบรวมต้นทุนวัตถุดิบ บรรจุภัณฑ์ และค่าแรง แล้วคำนวณกำไรจากราคาขายให้เห็นชัด</p>
          </div>
          <div className="hp-waterfall hp-reveal">
            {WATERFALL.map(({ cls, label, sub, h, v }) => (
              <div className={`hp-wf ${cls}`} key={label}>
                <div className="hp-wf-bar" style={{ height: `${h * 2.1}px` }}><b className="hp-num">฿{v}</b></div>
                <div className="hp-wf-lbl">{label}<span>{sub}</span></div>
              </div>
            ))}
          </div>
          <div className="hp-price-legend hp-reveal">
            <span><i style={{ background: '#1677c8' }} />ต้นทุนวัตถุดิบ</span>
            <span><i style={{ background: '#c6a15b' }} />ต้นทุนบรรจุภัณฑ์</span>
            <span><i style={{ background: '#7fb3dd' }} />ค่าแรง / overhead</span>
            <span><i style={{ background: '#64748b' }} />ต้นทุนรวม</span>
            <span><i style={{ background: '#35d69f' }} />ราคาขาย &amp; กำไร</span>
          </div>
        </div>
      </section>

      {/* ============ FINAL CTA ============ */}
      <section className="hp-final">
        <div className="hp-container hp-final-inner">
          <span className="hp-eyebrow on-dark" style={{ justifyContent: 'center' }}><CheckCircle2 aria-hidden />พร้อมเริ่มใช้งาน</span>
          <h2>ระบบบริหารต้นทุนและสูตรอาหารที่ช่วยคุณตัดสินใจ</h2>
          <p>ชัดเจน ใช้งานง่าย และช่วยให้ทุกเมนูทำกำไรได้จริง — เข้าสู่ระบบเพื่อเริ่มจัดการต้นทุน สูตร และวัตถุดิบของคุณ</p>
          <div className="hp-cta-row">
            <Link to={loginTo} className="hp-cta primary"><LogIn aria-hidden />{loginLabel}<ArrowRight aria-hidden /></Link>
            <a href="#features" className="hp-cta ghost"><Layers aria-hidden />ดูฟีเจอร์ทั้งหมด</a>
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
              <p>ระบบคิดคำนวณต้นทุนและสูตรเมนูอาหาร สำหรับจัดการวัตถุดิบ บรรจุภัณฑ์ ราคาขาย และกำไร อ่านง่ายและใช้ได้จริงหน้างาน</p>
            </div>
            <div className="hp-footer-col">
              <h5>ระบบ</h5>
              <a href="#about">เกี่ยวกับระบบ</a>
              <a href="#features">ฟีเจอร์</a>
              <a href="#process">การทำงาน</a>
              <a href="#kpi">ภาพรวม KPI</a>
            </div>
            <div className="hp-footer-col">
              <h5>เริ่มต้น</h5>
              <Link to={loginTo}>{loginLabel}</Link>
              <span>จัดการต้นทุนอาหาร</span>
              <span>สร้างสูตรเมนู</span>
              <span>วิเคราะห์กำไร</span>
            </div>
          </div>
          <div className="hp-footer-bottom">
            <small>© {new Date().getFullYear()} S2 Accounting Consultant · ระบบคิดคำนวณต้นทุนและสูตรเมนูอาหาร</small>
            <span className="tag">PRODUCTION &amp; INVENTORY</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
