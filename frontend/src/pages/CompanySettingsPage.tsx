import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { BellRing, Building2, CheckCircle2, FileText, Image as ImageIcon, Mail, Save, Upload } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { uploadImage } from '@/lib/catalog';
import { useToast } from '@/components/ui/Toast';

/**
 * PHASE 13B — หน้าตั้งค่าบริษัท
 *
 * เดิมโลโก้ต้องพิมพ์ URL เองใต้ "การตั้งค่าขั้นสูง" (และช่องนั้นใส่ค่า default
 * เป็น path ของบริษัทหนึ่งไว้ตายตัว) รอบนี้เปลี่ยนเป็นอัปโหลดไฟล์ผ่าน API จริง
 * และเพิ่มตัวอย่างหัวเอกสารที่อัปเดตตามฟอร์มทันที โดยไม่ต้องสร้าง PDF ใหม่ทุกครั้ง
 *
 * field ที่ค่าว่าง = ไม่แสดงบนเอกสาร ตัวอย่างจึงต้องซ่อนบรรทัดนั้นด้วย
 */

type Company = {
  id: string; code: string; nameTh: string; nameEn?: string | null; logoUrl?: string | null;
  taxId?: string | null; address?: string | null; phone?: string | null; email?: string | null;
  website?: string | null; lineId?: string | null; authorizedName?: string | null; documentFooter?: string | null;
  providers: { email: boolean; line: boolean };
};

/** เฉพาะ field ที่ PATCH /business/company รับจริง */
type FormState = {
  nameTh: string; nameEn: string; taxId: string; address: string;
  phone: string; email: string; website: string; lineId: string;
  authorizedName: string; documentFooter: string; logoUrl: string;
};

const toForm = (c: Company): FormState => ({
  nameTh: c.nameTh ?? '', nameEn: c.nameEn ?? '', taxId: c.taxId ?? '', address: c.address ?? '',
  phone: c.phone ?? '', email: c.email ?? '', website: c.website ?? '', lineId: c.lineId ?? '',
  authorizedName: c.authorizedName ?? '', documentFooter: c.documentFooter ?? '', logoUrl: c.logoUrl ?? '',
});

/** ค่าว่าง → null เพื่อให้ backend เก็บเป็น null และเอกสารไม่แสดงบรรทัดนั้น */
const orNull = (v: string) => (v.trim() === '' ? null : v.trim());

export default function CompanySettingsPage() {
  const { toast } = useToast();
  const [company, setCompany] = useState<Company>();
  const [form, setForm] = useState<FormState>();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoFailed, setLogoFailed] = useState(false);
  /** พรีวิวรูปที่เพิ่งเลือกจากเครื่อง ก่อนอัปโหลดจริง */
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    apiClient.get<Company>('/business/company')
      .then((c) => { setCompany(c); setForm(toForm(c)); })
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => () => { if (localPreview) URL.revokeObjectURL(localPreview); }, [localPreview]);

  const dirty = useMemo(() => {
    if (!company || !form) return false;
    return JSON.stringify(form) !== JSON.stringify(toForm(company));
  }, [company, form]);

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => {
    setForm((prev) => (prev ? { ...prev, [key]: e.target.value } : prev));
    setSaved(false);
  };

  const pickLogo = (file: File | undefined) => {
    if (!file) return;
    if (localPreview) URL.revokeObjectURL(localPreview);
    setLocalPreview(URL.createObjectURL(file));
    setLogoFailed(false);
  };

  /** อัปโหลดโลโก้ไปที่ API แล้วเก็บ url ที่ได้ลงในฟอร์ม (ยังไม่บันทึกจนกว่าจะกดบันทึก) */
  const uploadLogo = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) { toast({ title: 'ยังไม่ได้เลือกไฟล์', variant: 'error' }); return; }
    setUploading(true);
    try {
      const { url } = await uploadImage('company', file);
      setForm((prev) => (prev ? { ...prev, logoUrl: url } : prev));
      setLogoFailed(false);
      setSaved(false);
      toast({ title: 'อัปโหลดโลโก้แล้ว', description: 'กดบันทึกการตั้งค่าเพื่อใช้กับเอกสาร', variant: 'success' });
    } catch (reason) {
      toast({ title: 'อัปโหลดโลโก้ไม่สำเร็จ', description: reason instanceof Error ? reason.message : '', variant: 'error' });
    } finally { setUploading(false); }
  };

  const removeLogo = () => {
    setForm((prev) => (prev ? { ...prev, logoUrl: '' } : prev));
    if (localPreview) { URL.revokeObjectURL(localPreview); setLocalPreview(null); }
    if (fileRef.current) fileRef.current.value = '';
    setSaved(false);
  };

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form) return;
    setBusy(true); setSaved(false);
    try {
      const updated = await apiClient.patch<Company>('/business/company', {
        nameTh: form.nameTh.trim(),
        nameEn: orNull(form.nameEn), taxId: orNull(form.taxId), address: orNull(form.address),
        phone: orNull(form.phone), email: orNull(form.email), website: orNull(form.website), lineId: orNull(form.lineId),
        authorizedName: orNull(form.authorizedName), documentFooter: orNull(form.documentFooter),
        logoUrl: orNull(form.logoUrl),
      });
      const next = { ...updated, providers: company?.providers ?? { email: false, line: false } };
      setCompany(next); setForm(toForm(next)); setSaved(true);
      if (localPreview) { URL.revokeObjectURL(localPreview); setLocalPreview(null); }
      toast({ title: 'บันทึกการตั้งค่าสำเร็จ', description: `ข้อมูลบริษัท “${updated.nameTh}” จะแสดงบนเอกสารทันที`, variant: 'success' });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : 'กรุณาตรวจสอบข้อมูลและลองอีกครั้ง';
      setError(message);
      toast({ title: 'ไม่สามารถบันทึกการตั้งค่าได้', description: message, variant: 'error' });
    } finally { setBusy(false); }
  };

  if (!company || !form) return <div className="company-empty">{error || 'กำลังโหลดข้อมูลบริษัท…'}</div>;

  const shownLogo = localPreview ?? (form.logoUrl || null);
  /** อักษรย่อสำรองเมื่อไม่มีโลโก้ — มาจากชื่อบริษัทจริง ไม่ hardcode */
  const initials = (form.nameTh || company.nameTh).replace(/^บริษัท\s*/, '').trim().slice(0, 2) || '—';

  return (
    <section className="settings-page">
      <header>
        <div>
          <span>COMPANY CONTROL</span>
          <h1>ตั้งค่าบริษัท</h1>
          <p>ข้อมูลอัตลักษณ์ เอกสาร และช่องทางการแจ้งเตือนของพื้นที่ทำงานนี้</p>
        </div>
        <div className="settings-logo">
          {shownLogo && !logoFailed
            ? <img src={shownLogo} alt="โลโก้บริษัท" onError={() => setLogoFailed(true)} />
            : <strong>{initials}</strong>}
        </div>
      </header>

      {error && <div className="auth-alert">{error}</div>}
      {saved && <div className="settings-success"><CheckCircle2 />บันทึกข้อมูลบริษัทเรียบร้อย</div>}

      <form onSubmit={(e) => void submit(e)}>
        <main>
          <section>
            <div className="settings-title"><Building2 /><div><h2>ข้อมูลบริษัท</h2><p>ใช้ในส่วนหัวเอกสารทุกชนิด</p></div></div>
            <div className="settings-fields">
              <label>ชื่อภาษาไทย<input name="nameTh" value={form.nameTh} onChange={set('nameTh')} required /></label>
              <label>ชื่อภาษาอังกฤษ<input name="nameEn" value={form.nameEn} onChange={set('nameEn')} /></label>
              <label>เลขประจำตัวผู้เสียภาษี<input name="taxId" value={form.taxId} onChange={set('taxId')} /></label>
              <label className="wide">ที่อยู่<textarea name="address" value={form.address} onChange={set('address')} /></label>
            </div>
          </section>

          <section>
            <div className="settings-title"><Mail /><div><h2>ข้อมูลติดต่อ</h2><p>แสดงใต้ชื่อบริษัทและท้ายเอกสาร</p></div></div>
            <div className="settings-fields">
              <label>โทรศัพท์<input name="phone" value={form.phone} onChange={set('phone')} /></label>
              <label>อีเมล<input name="email" type="email" value={form.email} onChange={set('email')} /></label>
              <label>เว็บไซต์<input name="website" value={form.website} onChange={set('website')} /></label>
              <label>LINE<input name="lineId" value={form.lineId} onChange={set('lineId')} placeholder="LINE ID หรือ LINE OA" /></label>
            </div>
          </section>

          <section>
            <div className="settings-title"><FileText /><div><h2>ข้อมูลเอกสาร</h2><p>ผู้มีอำนาจลงนามและข้อความท้ายเอกสาร</p></div></div>
            <div className="settings-fields">
              <label>ผู้มีอำนาจลงนาม<input name="authorizedName" value={form.authorizedName} onChange={set('authorizedName')} /></label>
              <label className="wide">ข้อความท้ายเอกสาร<textarea name="documentFooter" value={form.documentFooter} onChange={set('documentFooter')} /></label>
            </div>
          </section>

          <section>
            <div className="settings-title"><ImageIcon /><div><h2>โลโก้บริษัท</h2><p>ใช้บนหัวเอกสาร PDF ทุกชนิด — รองรับ PNG และ JPG</p></div></div>
            <div className="logo-manager">
              <div className="logo-frame">
                {shownLogo && !logoFailed
                  ? <img src={shownLogo} alt="ตัวอย่างโลโก้" onError={() => setLogoFailed(true)} />
                  : <span className="logo-fallback">{initials}</span>}
              </div>
              <div className="logo-actions">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg" id="logo-file"
                  onChange={(e) => pickLogo(e.target.files?.[0])} />
                <div className="logo-buttons">
                  <button type="button" className="btn" disabled={uploading} onClick={() => void uploadLogo()}>
                    <Upload aria-hidden width={15} />{uploading ? 'กำลังอัปโหลด…' : 'อัปโหลดโลโก้'}
                  </button>
                  {form.logoUrl && <button type="button" className="btn" onClick={removeLogo}>ลบโลโก้</button>}
                </div>
                {localPreview && <p className="logo-hint">เลือกไฟล์แล้ว — กด “อัปโหลดโลโก้” เพื่อส่งขึ้นระบบ</p>}
                {logoFailed && <p className="logo-hint is-warn">เปิดรูปนี้ไม่ได้ เอกสารจะใช้อักษรย่อแทน</p>}
                {!form.logoUrl && !localPreview && <p className="logo-hint">ยังไม่มีโลโก้ — เอกสารจะใช้อักษรย่อของบริษัท</p>}
              </div>
            </div>
          </section>

          {/* ตัวอย่างหัวเอกสาร — คำนวณจากค่าในฟอร์ม ไม่ต้องสร้าง PDF ใหม่ */}
          <section>
            <div className="settings-title"><FileText /><div><h2>ตัวอย่างหัวเอกสาร</h2><p>ช่องที่เว้นว่างจะไม่แสดงบนเอกสารจริง</p></div></div>
            <div className="doc-preview">
              {/* แบรนด์หลักของเอกสารคือ S2A ส่วนบริษัทคือผู้ที่เอกสารออกให้ */}
              <div className="doc-preview-brand">
                <img src="/s2a-logo.png" alt="S2A" />
                <div><b>S2A</b><i>S2 ACCOUNTING CONSULTANT</i></div>
                <div className="doc-preview-title">
                  <b>GOODS RECEIPT</b>
                  <i>ใบรับสินค้า</i>
                </div>
              </div>
              <div className="doc-preview-head">
                <div className="doc-preview-logo">
                  {shownLogo && !logoFailed ? <img src={shownLogo} alt="" /> : <span>{initials}</span>}
                </div>
                <div className="doc-preview-identity">
                  <small className="dp-for">เอกสารสำหรับ</small>
                  <strong>{form.nameTh || '—'}</strong>
                  {form.nameEn && <span className="dp-en">{form.nameEn.toUpperCase()}</span>}
                  {form.address && <span>{form.address.replace(/\s*\n\s*/g, ' ')}</span>}
                  {form.taxId && <span>เลขประจำตัวผู้เสียภาษี {form.taxId}</span>}
                  {form.phone && <span>โทร. {form.phone}</span>}
                  {form.email && <span>{form.email}</span>}
                  {form.lineId && <span>LINE {form.lineId}</span>}
                  {form.website && <span>{form.website}</span>}
                </div>
              </div>
              <div className="doc-preview-foot">
                {form.authorizedName && <span>ผู้มีอำนาจลงนาม: {form.authorizedName}</span>}
                <span>{form.documentFooter || 'ไม่มีข้อความท้ายเอกสาร'}</span>
              </div>
            </div>
          </section>
        </main>

        <aside>
          <small>INTEGRATION STATUS</small>
          <h2>ช่องทางแจ้งเตือน</h2>
          <article><Mail /><div><strong>Email</strong><span>{company.providers.email ? 'พร้อมใช้งาน' : 'ยังไม่ได้ตั้งค่าการส่งอีเมล'}</span></div><i className={company.providers.email ? 'on' : ''} /></article>
          <article><BellRing /><div><strong>LINE</strong><span>{company.providers.line ? 'พร้อมใช้งาน' : 'ยังไม่ได้ตั้งค่า LINE Notification'}</span></div><i className={company.providers.line ? 'on' : ''} /></article>
          <p>ระบบหลักและ Web Notification ยังคงใช้งานได้ แม้ช่องทางภายนอกยังไม่ตั้งค่า</p>
          {dirty && <div className="settings-dirty">ยังไม่ได้บันทึก</div>}
          <button disabled={busy || !dirty}><Save />{busy ? 'กำลังบันทึก...' : dirty ? 'บันทึกการตั้งค่า' : 'บันทึกแล้ว'}</button>
        </aside>
      </form>
    </section>
  );
}
