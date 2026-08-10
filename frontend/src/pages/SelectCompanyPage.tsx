import { useMemo, useState, type FormEvent } from 'react';
import { ArrowRight, BadgeCheck, Building2, Calculator, LogOut, Plus, Search, Sparkles, UtensilsCrossed, X } from 'lucide-react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth, type AuthCompany } from '@/auth/AuthContext';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import { useI18n } from '@/i18n/i18n';

export default function SelectCompanyPage() {
  const { messages } = useI18n(); const copy = messages.company;
  const { user, selectCompany, logout } = useAuth(); const { toast } = useToast(); const navigate = useNavigate();
  const [search, setSearch] = useState(''); const [busy, setBusy] = useState(''); const [addOpen, setAddOpen] = useState(false); const [localCompanies, setLocalCompanies] = useState<AuthCompany[]>(user?.companies ?? []);
  const companies = useMemo(() => localCompanies.filter((company) => `${company.nameTh} ${company.nameEn ?? ''} ${company.code}`.toLowerCase().includes(search.toLowerCase())), [localCompanies, search]);
  if (!user) return <Navigate to="/login" replace />;
  const choose = async (companyId: string) => { setBusy(companyId); try { const selected = await selectCompany(companyId); navigate(selected.defaultLandingPage, { replace: true }); } finally { setBusy(''); } };
  const create = async (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setBusy('create'); const data = new FormData(event.currentTarget); const nameTh = String(data.get('nameTh') ?? ''); try { const created = await apiClient.post<AuthCompany>('/companies', Object.fromEntries([...data.entries()].map(([key, value]) => [key, String(value)]))); setLocalCompanies((current) => [...current, created]); setAddOpen(false); toast({ title: 'สร้างบริษัทสำเร็จ', description: `“${nameTh}” พร้อมใช้งานแล้ว`, variant: 'success' }); } catch (reason) { toast({ title: 'สร้างบริษัทไม่สำเร็จ', description: reason instanceof Error ? reason.message : 'กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง', variant: 'error' }); } finally { setBusy(''); } };
  return <main className="company-select-shell"><div className="company-grid-pattern"/><div className="company-orb one"/><div className="company-orb two"/>
    <header><span className="selector-brand-logo"><img src="/s2a-logo.png" alt="S2A" /></span><div><span>WORKSPACE ACCESS</span><strong>S2 ACCOUNTING CONSULTANT</strong><h1>{copy.title}</h1><p>{copy.subtitle}</p></div><LanguageSwitcher compact /></header>
    <div className="company-selector-tools">{localCompanies.length > 4 && <label className="company-search"><Search /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search company" /></label>}{user.roles.includes('SUPER_ADMIN') && <button className="add-company-button" onClick={() => setAddOpen(true)}><Plus /> {copy.add}</button>}</div>
    <section className={`company-grid ${companies.length === 1 ? 'single' : ''}`}>{companies.map((company) => <article key={company.id} className="company-card">
      <div className="company-card-top"><span><Sparkles/> S2A WORKSPACE</span>{company.isDefault&&<b><BadgeCheck/> {copy.primary}</b>}</div>
      <CompanyLogo src={company.logoUrl} name={company.nameTh} />
      <div className="company-card-copy"><small>{company.code === 'S2A-PRIMARY' ? 'พื้นที่ทำงานหลัก' : company.code}</small><h2>{company.code==='S2A-PRIMARY'?'ครัวสดดี':company.nameTh}</h2><p><Calculator/> ระบบต้นทุน <i/> <UtensilsCrossed/> สูตรอาหาร • ออเดอร์ • ปฏิบัติการ</p><span>{company.role.replaceAll('_', ' ')}</span></div>
      <button onClick={() => void choose(company.id)} disabled={Boolean(busy)}> {busy === company.id ? copy.entering : <>{copy.enter} <ArrowRight /></>}</button>
    </article>)}</section>
    {companies.length === 0 && <div className="company-empty">{copy.empty}</div>}
    <button className="company-logout" onClick={() => void logout()}><LogOut /> {copy.signOut}</button>
    {addOpen && <div className="company-create-backdrop"><form className="company-create-dialog" role="dialog" aria-modal="true" aria-labelledby="company-create-title" onSubmit={(event) => void create(event)}><header><span><Building2 /></span><div><small>NEW WORKSPACE</small><h2 id="company-create-title">เพิ่มบริษัท</h2><p>สร้างพื้นที่ทำงานใหม่โดยไม่คัดลอกข้อมูลจากบริษัทเดิม</p></div><button type="button" aria-label="ปิด" onClick={() => setAddOpen(false)}><X /></button></header><div className="company-create-fields"><label>ชื่อบริษัท *<input autoFocus name="nameTh" required maxLength={160} /></label><label>ชื่อภาษาอังกฤษ<input name="nameEn" maxLength={160} /></label><label>รหัสบริษัท *<input name="code" required pattern="[A-Za-z0-9-]{2,30}" placeholder="เช่น KSD-001" /></label><label>Logo URL / path<input name="logoUrl" placeholder="https://… หรือ /company-logos/…" /></label><label>เลขประจำตัวผู้เสียภาษี<input name="taxId" inputMode="numeric" pattern="[0-9]{10,13}" /></label><label>โทรศัพท์<input name="phone" /></label><label>อีเมล<input name="email" type="email" /></label><label className="wide">ที่อยู่<textarea name="address" rows={3} /></label></div><footer><button type="button" onClick={() => setAddOpen(false)}>ยกเลิก</button><button className="primary" disabled={busy === 'create'}>{busy === 'create' ? 'กำลังสร้าง…' : 'สร้างบริษัท'}</button></footer></form></div>}
  </main>;
}

function CompanyLogo({src,name}:{src:string|null;name:string}){const [failed,setFailed]=useState(!src);const initials=name.trim().split(/\s+/).map((part)=>part[0]).join('').slice(0,2).toUpperCase()||'S2';return <div className="company-mark">{!failed&&src?<img src={src} alt={`โลโก้ ${name}`} onError={()=>setFailed(true)}/>:<span>{initials}</span>}</div>}
