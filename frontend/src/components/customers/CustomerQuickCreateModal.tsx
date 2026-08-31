import { useEffect, useRef, useState } from 'react';
import { UserPlus, X, Plus, Loader2, User, Phone, Mail, Receipt, MapPin, MessageCircle, Building2, StickyNote } from 'lucide-react';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/i18n';

/** ลูกค้าที่ถูกสร้าง (ใช้ auto-select เข้าออเดอร์) */
export interface QuickCreatedCustomer { id: string; code: string; name: string }

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-()\s]{6,20}$/;
const TAXID_RE = /^\d{10,13}$/;

type Fields = { name: string; contactName: string; phone: string; email: string; taxId: string; address: string; billingAddress: string; lineId: string; branch: string; note: string };
const EMPTY: Fields = { name: '', contactName: '', phone: '', email: '', taxId: '', address: '', billingAddress: '', lineId: '', branch: '', note: '' };

/**
 * Modal เพิ่มลูกค้าอย่างรวดเร็ว — ใช้ซ้ำทั้งหน้าออเดอร์ (สร้างแล้วเลือกเข้าออเดอร์) และหน้าลูกค้า
 * เดียวเท่านั้น: validation + business logic ไม่ซ้ำซ้อน
 */
export default function CustomerQuickCreateModal({ prefillName, onClose, onCreated }: {
  prefillName?: string;
  onClose: () => void;
  onCreated: (customer: QuickCreatedCustomer) => void;
}) {
  const { messages } = useI18n(); const cf = messages.customerForm; const biz = messages.business; const { toast } = useToast();
  const [form, setForm] = useState<Fields>({ ...EMPTY, name: prefillName ?? '' });
  const [errors, setErrors] = useState<Partial<Record<keyof Fields, string>>>({});
  const [saving, setSaving] = useState(false);
  const [serverError, setServerError] = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<Element | null>(null);
  const set = (patch: Partial<Fields>) => setForm((f) => ({ ...f, ...patch }));

  // a11y: จำ element ที่โฟกัสก่อนเปิด → คืนโฟกัสตอนปิด, โฟกัสช่องแรก, และ trap โฟกัสใน modal
  useEffect(() => {
    triggerRef.current = document.activeElement;
    firstFieldRef.current?.focus();
    return () => { (triggerRef.current as HTMLElement | null)?.focus?.(); };
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const list = Array.from(focusable).filter((el) => !el.hasAttribute('disabled'));
      if (list.length === 0) return;
      const first = list[0]; const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const validate = (): boolean => {
    const next: Partial<Record<keyof Fields, string>> = {};
    if (!form.name.trim()) next.name = cf.nameRequired;
    if (form.email.trim() && !EMAIL_RE.test(form.email.trim())) next.email = cf.invalidEmail;
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) next.phone = cf.invalidPhone;
    if (form.taxId.trim() && !TAXID_RE.test(form.taxId.trim())) next.taxId = cf.invalidTaxId;
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async () => {
    if (!validate()) return;
    setSaving(true); setServerError('');
    try {
      const clean = (v: string) => (v.trim() ? v.trim() : undefined);
      const created = await apiClient.post<QuickCreatedCustomer>('/business/customers', {
        name: form.name.trim(),
        contactName: clean(form.contactName), phone: clean(form.phone), email: clean(form.email),
        taxId: clean(form.taxId), address: clean(form.address), billingAddress: clean(form.billingAddress),
        lineId: clean(form.lineId), branch: clean(form.branch), note: clean(form.note),
      });
      toast({ title: biz.customerAdded, variant: 'success' });
      onCreated(created);
    } catch (e) { setServerError(e instanceof Error ? e.message : 'error'); setSaving(false); }
  };

  const field = (key: keyof Fields, label: string, placeholder: string, Icon?: typeof User, opts: { required?: boolean; type?: string; textarea?: boolean; full?: boolean } = {}) => (
    <div className={`cust-field${opts.full ? ' full' : ''}`}>
      <label htmlFor={`cf-${key}`}>{label}{opts.required ? <span className="req" aria-hidden>*</span> : <span className="opt">{cf.optional}</span>}</label>
      <div className={`input-wrap${Icon && !opts.textarea ? ' has-icon' : ''}`}>
        {Icon && !opts.textarea && <Icon aria-hidden />}
        {opts.textarea
          ? <textarea id={`cf-${key}`} value={form[key]} placeholder={placeholder} onChange={(e) => set({ [key]: e.target.value } as Partial<Fields>)} />
          : <input ref={key === 'name' ? firstFieldRef : undefined} id={`cf-${key}`} type={opts.type ?? 'text'} value={form[key]} placeholder={placeholder}
              aria-required={opts.required || undefined} aria-invalid={errors[key] ? true : undefined}
              onChange={(e) => { set({ [key]: e.target.value } as Partial<Fields>); if (errors[key]) setErrors((x) => ({ ...x, [key]: undefined })); }} />}
      </div>
      {errors[key] && <span className="err">{errors[key]}</span>}
    </div>
  );

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div ref={dialogRef} className="dialog cust-modal" role="dialog" aria-modal="true" aria-labelledby="cust-modal-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cust-modal-head">
          <span className="cm-icon" aria-hidden><UserPlus width={22} /></span>
          <div className="cm-title">
            <h3 id="cust-modal-title">{biz.quickAddCustomer}</h3>
            <p>{cf.subtitle}</p>
          </div>
          <button type="button" className="icon-btn cm-close" onClick={onClose} aria-label={messages.common.close}><X aria-hidden width={16} /></button>
        </div>
        {/* เนื้อหาเลื่อนได้เฉพาะส่วนนี้ หัวและแถบปุ่มอยู่กับที่เสมอ */}
        <div className="cust-modal-body">
          {serverError && <div className="alert cust-server-error">{serverError}</div>}

          <section className="cust-section">
            <h4>{cf.sectionMain}</h4>
            <div className="cust-grid">
              {field('name', cf.nameLabel, cf.phName, User, { required: true, full: true })}
              {field('contactName', cf.contact, cf.phContact, User)}
              {field('phone', cf.phone, cf.phPhone, Phone, { type: 'tel' })}
              {field('email', cf.email, cf.phEmail, Mail, { type: 'email' })}
              {field('taxId', cf.taxId, cf.phTaxId, Receipt)}
            </div>
          </section>

          <section className="cust-section">
            <h4>{cf.sectionAddress}</h4>
            {/* ที่อยู่สองช่องวางคู่กันบนจอกว้าง เดิมเป็นเต็มบรรทัดทั้งคู่ ทำให้ modal ยืดยาวเกินจำเป็น */}
            <div className="cust-grid">
              {field('address', cf.shipping, cf.phShipping, MapPin, { textarea: true })}
              {field('billingAddress', cf.billing, cf.phBilling, MapPin, { textarea: true })}
            </div>
          </section>

          <section className="cust-section">
            <h4>{cf.sectionExtra}</h4>
            <div className="cust-grid">
              {field('lineId', cf.lineId, cf.phLine, MessageCircle)}
              {field('branch', cf.branch, cf.phBranch, Building2)}
              {field('note', cf.note, cf.phNote, StickyNote, { full: true, textarea: true })}
            </div>
          </section>
        </div>
        <div className="cust-modal-foot">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>{messages.common.cancel}</button>
          <button type="button" className="btn cust-save" onClick={() => void save()} disabled={saving}>
            {saving ? <Loader2 className="spin" aria-hidden /> : <Plus className="save-gold" aria-hidden />}{cf.save}
          </button>
        </div>
      </div>
    </div>
  );
}
