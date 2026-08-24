import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Save, Loader2, Info, Boxes, ShoppingCart, Scale, SlidersHorizontal,
  Calculator, History, Plus, AlertTriangle, StickyNote, Check,
} from 'lucide-react';
import { catalogApi, type ItemType } from '@/lib/catalog';
import { formatMoney, formatThaiDateTime } from '@/lib/utils';
import { unitPricePreview } from '@/lib/item-unit-price';
import { formatFactor, resolveConversion } from '@/lib/standard-conversion';
import { masterConflictMessage } from '@/lib/master-validation';
import ImageUpload from '@/components/ui/ImageUpload';
import Badge from '@/components/ui/Badge';
import MasterModal from '@/components/ui/MasterModal';
import { PageContainer, PageHeader, ContentCard } from '@/components/layout/page';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';
import { useI18n } from '@/i18n/i18n';
import CreatableCombobox from '@/components/ui/CreatableCombobox';

export interface ItemFormVariant {
  kind: 'ingredient' | 'packaging';
  type: ItemType;
  listPath: string;
  newPath: string;
  eyebrow: string;
  nameLabel: string;
  namePlaceholder: string;
  codePlaceholder: string;
  categoryLabel: string;
  baseUnitHint: string;
  factorHint: string;
  purchaseQtyLabel: string;
  costPerBaseLabel: string;
  presets?: { label: string; base?: string }[];
  showLotExpiry: boolean;
}

interface FormState {
  code: string; name: string; barcode: string; categoryId: string;
  baseUnitId: string; purchaseUnitId: string; purchaseToBaseFactor: string;
  reorderPoint: string; imageUrl: string | null;
  purchasePrice: string; purchaseQuantity: string;
  isLotTracked: boolean; isExpiryTracked: boolean;
}
const EMPTY: FormState = {
  code: '', name: '', barcode: '', categoryId: '',
  baseUnitId: '', purchaseUnitId: '', purchaseToBaseFactor: '1', reorderPoint: '0', imageUrl: null,
  purchasePrice: '', purchaseQuantity: '1',
  isLotTracked: false, isExpiryTracked: false,
};

export default function ItemFormWorkspace({ variant }: { variant: ItemFormVariant }) {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const { messages } = useI18n(); const t = messages.quickCreate;

  const units = useQuery({ queryKey: ['units'], queryFn: () => catalogApi.units() });
  /* PHASE 20 — อ่านอัตราแปลงมาตรฐานจากตารางเดียวกับที่ backend ใช้คิดต้นทุน
     ไม่เก็บค่า KG→G / L→ML ซ้ำไว้ในฟอร์ม เพื่อไม่ให้สองที่เพี้ยนจากกัน */
  const conversions = useQuery({ queryKey: ['unit-conversions'], queryFn: () => catalogApi.conversions() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => catalogApi.categories() });
  const detail = useQuery({ queryKey: ['item', id], queryFn: () => catalogApi.item(id as string), enabled: isEdit });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // เพิ่มหน่วยกำหนดเอง — ใช้ได้ทั้งหน่วยซื้อและหน่วยฐาน
  const [unitTarget, setUnitTarget] = useState<'purchase' | 'recipe' | null>(null);
  const [newUnit, setNewUnit] = useState({ name: '', code: '' });
  const [savingUnit, setSavingUnit] = useState(false);
  const [unitError, setUnitError] = useState('');
  const addUnit = async () => {
    if (!newUnit.name.trim() || !newUnit.code.trim()) { setUnitError('กรอกชื่อหน่วยและตัวย่อให้ครบ'); return; }
    setSavingUnit(true); setUnitError('');
    try {
      const created = await catalogApi.createUnit({ code: newUnit.code.trim(), name: newUnit.name.trim() });
      await qc.invalidateQueries({ queryKey: ['units'] });
      set(unitTarget === 'purchase' ? { purchaseUnitId: created.id } : { baseUnitId: created.id });
      toast(`เพิ่มหน่วย “${created.name}” แล้ว`);
      setNewUnit({ name: '', code: '' }); setUnitTarget(null);
    } catch (e) { setUnitError(masterConflictMessage(e, 'unit', newUnit.code.trim())); }
    finally { setSavingUnit(false); }
  };

  // เพิ่มหมวดหมู่แบบด่วน — reuse POST /categories, ออกรหัสอัตโนมัติ, auto-select เข้าฟอร์ม
  const canCreateMaster = Boolean(user?.roles.includes('SUPER_ADMIN') || ['INGREDIENT_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_CREATE', 'PACKAGING_EDIT'].some((p) => user?.permissions.includes(p)));
  const [catOpen, setCatOpen] = useState(false);
  const [newCat, setNewCat] = useState('');
  const [savingCat, setSavingCat] = useState(false);
  const [catError, setCatError] = useState('');
  const addCategory = async () => {
    if (!newCat.trim()) { setCatError('กรอกชื่อหมวดหมู่'); return; }
    setSavingCat(true); setCatError('');
    try {
      const prefix = variant.type === 'PACKAGING' ? 'PKG' : 'RM';
      const created = await catalogApi.createCategory({ name: newCat.trim(), code: `CAT-${prefix}-${Date.now().toString().slice(-6)}`, type: variant.type });
      await qc.invalidateQueries({ queryKey: ['categories'] });
      set({ categoryId: created.id });
      toast({ title: t.categoryAdded, variant: 'success' });
      setNewCat(''); setCatOpen(false);
    } catch (e) {
      // ล้มเหลว → คงค่าที่กรอกไว้และเปิด modal ต่อ (ไม่รีเซ็ตฟอร์มหลัก)
      setCatError(masterConflictMessage(e, 'category', newCat.trim()));
    } finally { setSavingCat(false); }
  };

  useEffect(() => {
    if (detail.data) {
      const d = detail.data;
      setForm({
        code: d.code, name: d.name, barcode: d.barcode ?? '', categoryId: d.categoryId ?? '',
        baseUnitId: d.baseUnitId, purchaseUnitId: d.purchaseUnitId ?? '', purchaseToBaseFactor: String(d.purchaseToBaseFactor),
        reorderPoint: String(d.reorderPoint), imageUrl: d.imageUrl, purchasePrice: '', purchaseQuantity: '1',
        isLotTracked: d.isLotTracked, isExpiryTracked: d.isExpiryTracked,
      });
    }
  }, [detail.data]);

  useEffect(() => {
    if (!isEdit && !form.baseUnitId && units.data && units.data.length > 0) {
      // สำหรับบรรจุภัณฑ์ พยายาม default หน่วยฐานเป็น "ชิ้น" ถ้ามี
      const piece = variant.kind === 'packaging'
        ? units.data.find((u) => ['ชิ้น', 'PCS', 'PC', 'EA'].includes(u.code) || u.name.includes('ชิ้น'))
        : undefined;
      set({ baseUnitId: (piece ?? units.data[0]).id });
    }
  }, [units.data, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseUnitCode = units.data?.find((u) => u.id === form.baseUnitId)?.code ?? 'หน่วยฐาน';
  const purchaseUnitCode = units.data?.find((u) => u.id === form.purchaseUnitId)?.code ?? baseUnitCode;

  /* PHASE 20 — บั๊กที่แก้: ฟอร์มเคยปล่อยให้ผู้ใช้เดาทิศของอัตราแปลงเอง
     ใส่ 0.001 สำหรับ KG→G (ซึ่งเป็นทิศกลับ) แล้วต้นทุนกลายเป็น 350 ÷ 0.001 = 350,000 บาท/G
     ความหมายที่ถูกต้องคือ "หนึ่งหน่วยซื้อมีกี่หน่วยฐาน" → 1 KG = 1,000 G → 350 ÷ 1 ÷ 1000 = 0.35 */
  const conversion = useMemo(() => resolveConversion({
    purchaseUnitId: form.purchaseUnitId || null,
    baseUnitId: form.baseUnitId || null,
    purchaseUnitCode, baseUnitCode,
    edges: conversions.data ?? [],
    manualFactor: form.purchaseToBaseFactor,
  }), [form.purchaseUnitId, form.baseUnitId, form.purchaseToBaseFactor, purchaseUnitCode, baseUnitCode, conversions.data]);

  const isStandard = conversion.source === 'standard';
  const isSameUnit = conversion.source === 'same';
  /* หน่วยมาตรฐานให้ระบบเป็นคนกำหนด ผู้ใช้แก้ไม่ได้
     อัตราเฉพาะวัตถุดิบ (1 กระสอบ = 25 KG) ยังกรอกเองเหมือนเดิม */
  const factor = isStandard || isSameUnit ? (conversion.factor ?? 1) : Number(form.purchaseToBaseFactor);

  // เปลี่ยนหน่วยเมื่อไร อัตรามาตรฐานต้องถูกเติมลงฟอร์มทันที ทั้งหน้าสร้างและหน้าแก้ไข
  useEffect(() => {
    if (!isStandard && !isSameUnit) return;
    const resolved = String(conversion.factor ?? 1);
    if (form.purchaseToBaseFactor !== resolved) set({ purchaseToBaseFactor: resolved });
  }, [isStandard, isSameUnit, conversion.factor]); // eslint-disable-line react-hooks/exhaustive-deps

  // PART 5 — ผู้ใช้ต้องเห็นความหมายของราคา/หน่วย/การแปลงก่อนกดบันทึก
  const preview = useMemo(() => unitPricePreview({
    purchasePrice: form.purchasePrice,
    purchaseQuantity: form.purchaseQuantity,
    purchaseToBaseFactor: form.purchaseToBaseFactor,
    purchaseUnitCode, baseUnitCode,
  }), [form.purchasePrice, form.purchaseQuantity, form.purchaseToBaseFactor, purchaseUnitCode, baseUnitCode]);

  const missingName = touched && !form.name.trim();
  const missingCode = touched && !form.code.trim();
  const badFactor = !Number.isFinite(factor) || factor <= 0;
  const factorLocked = isStandard || isSameUnit;

  const submit = async (addAnother = false) => {
    setError(''); setTouched(true);
    if (!form.code.trim() || !form.name.trim() || !form.baseUnitId) { setError('กรอก ชื่อ รหัส และหน่วยฐานให้ครบ'); return; }
    setSaving(true);
    try {
      const price = Number(form.purchasePrice) || 0;
      const qty = Number(form.purchaseQuantity) || 1;
      const payload = {
        code: form.code.trim(), name: form.name.trim(), type: variant.type,
        barcode: form.barcode.trim() || null, categoryId: form.categoryId || null,
        baseUnitId: form.baseUnitId, purchaseUnitId: form.purchaseUnitId || null,
        purchaseToBaseFactor: badFactor ? 1 : factor, reorderPoint: Number(form.reorderPoint) || 0, imageUrl: form.imageUrl,
        isLotTracked: variant.showLotExpiry ? form.isLotTracked : false,
        isExpiryTracked: variant.showLotExpiry ? form.isExpiryTracked : false,
      };
      if (isEdit) await catalogApi.updateItem(id as string, payload);
      else await catalogApi.createItem({ ...payload, ...(price > 0 ? { purchasePrice: price, purchaseQuantity: qty } : {}) });
      toast('บันทึกสำเร็จ');
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['item-summary'] });
      void qc.invalidateQueries({ queryKey: ['selectable-items'] });
      if (addAnother && !isEdit) { setForm({ ...EMPTY, baseUnitId: form.baseUnitId }); setTouched(false); }
      else navigate(variant.listPath);
    } catch (err) {
      setError(masterConflictMessage(err, variant.kind === 'packaging' ? 'packaging' : 'ingredient', form.code.trim()));
    } finally { setSaving(false); }
  };

  const noun = variant.kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ';

  return (
    <PageContainer className="master-page item-form-workspace">
      <PageHeader
        breadcrumb={<><Link to={variant.listPath}>{noun}</Link><span> · </span><span>{isEdit ? 'แก้ไข' : 'เพิ่มใหม่'}</span></>}
        title={isEdit ? `แก้ไข${noun}` : `เพิ่ม${noun}`}
        description="กรอกทีละหัวข้อ ระบบจะสรุปต้นทุนต่อหน่วยฐานที่จะบันทึกจริงให้เห็นก่อนกดบันทึก"
        actions={<Link to={variant.listPath} className="btn"><ArrowLeft aria-hidden width={16} />กลับหน้ารายการ</Link>}
      />

      {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

      <div className="md-form">
        <div className="md-form-main">
          {/* A — ข้อมูลพื้นฐาน */}
          <ContentCard title={<><span className="md-section-badge">A</span>ข้อมูลพื้นฐาน</>}
            description={`ชื่อและรหัสสำหรับอ้างอิง${noun}นี้ในสูตรและรายงาน`}>
            {variant.presets && (
              <div className="fcx-presets" role="group" aria-label="ประเภทบรรจุภัณฑ์ที่ใช้บ่อย">
                {variant.presets.map((p) => (
                  <button type="button" key={p.label} className={form.name === p.label ? 'active' : ''}
                    aria-pressed={form.name === p.label}
                    onClick={() => set({ name: form.name === p.label ? '' : p.label })}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="md-fields">
              <label className="full">{variant.nameLabel} *
                <input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={variant.namePlaceholder}
                  aria-invalid={missingName} aria-describedby={missingName ? 'err-name' : undefined} />
                {missingName && <span className="md-error" id="err-name"><AlertTriangle aria-hidden />กรอกชื่อ{noun}</span>}
              </label>
              <label>รหัส *
                <input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder={variant.codePlaceholder}
                  aria-invalid={missingCode} aria-describedby={missingCode ? 'err-code' : undefined} />
                {missingCode && <span className="md-error" id="err-code"><AlertTriangle aria-hidden />กรอกรหัส</span>}
              </label>
              <label>บาร์โค้ด
                <input value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="(ไม่บังคับ)" />
              </label>
              <div className="md-field full">
                <span id="lbl-category">{variant.categoryLabel}</span>
                <CreatableCombobox value={form.categoryId} onChange={(v) => set({ categoryId: v })}
                  options={[{ value: '', label: t.none }, ...(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))]}
                  placeholder={t.selectCategory} searchPlaceholder={t.searchCategory} emptyText={t.noCategory}
                  createLabel={canCreateMaster ? t.addCategory : undefined}
                  onCreate={canCreateMaster ? ((q) => { setNewCat(q); setCatError(''); setCatOpen(true); }) : undefined}
                  ariaLabel={variant.categoryLabel} />
              </div>
            </div>
          </ContentCard>

          {/* B — หน่วย */}
          <ContentCard title={<><span className="md-section-badge">B</span><Scale aria-hidden width={17} />หน่วย</>}
            description={variant.baseUnitHint}>
            <div className="md-fields">
              <div className="md-field">
                <span>หน่วยที่ซื้อจากผู้ขาย</span>
                <CreatableCombobox value={form.purchaseUnitId} onChange={(v) => set({ purchaseUnitId: v })}
                  options={[{ value: '', label: t.sameAsBase }, ...(units.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))]}
                  placeholder={t.sameAsBase} searchPlaceholder={t.searchUnit} emptyText={t.noUnit}
                  createLabel={canCreateMaster ? t.addUnit : undefined}
                  onCreate={canCreateMaster ? ((q) => { setNewUnit({ name: q, code: '' }); setUnitError(''); setUnitTarget('purchase'); }) : undefined}
                  ariaLabel="หน่วยที่ซื้อจากผู้ขาย" />
                <span className="md-hint">เช่น ซื้อไก่เป็นกิโลกรัม ซื้อกล่องอาหารเป็นแพ็ค</span>
              </div>
              <div className="md-field">
                <span>หน่วยฐาน (ใช้ตอนคีย์สูตร) *</span>
                <CreatableCombobox value={form.baseUnitId} onChange={(v) => set({ baseUnitId: v })}
                  options={(units.data ?? []).map((u) => ({ value: u.id, label: `${u.name} (${u.code})` }))}
                  placeholder={t.selectUnit} searchPlaceholder={t.searchUnit} emptyText={t.noUnit}
                  createLabel={canCreateMaster ? t.addUnit : undefined}
                  onCreate={canCreateMaster ? ((q) => { setNewUnit({ name: q, code: '' }); setUnitError(''); setUnitTarget('recipe'); }) : undefined}
                  ariaLabel="หน่วยฐาน" />
                <span className="md-hint">หน่วยที่ใช้ระบุปริมาณจริงในสูตร · ต้นทุนทั้งระบบคิดต่อหน่วยนี้</span>
              </div>

              {/* PHASE 20 — สมการเดียวทั้งระบบ: 1 [หน่วยซื้อ] = [อัตรา] [หน่วยฐาน]
                  หน่วยมาตรฐานระบบเติมและล็อกให้ · หน่วยเฉพาะวัตถุดิบผู้ใช้กรอกเอง */}
              <div className="md-field full">
                <span id="lbl-factor">{factorLocked ? 'อัตราแปลงหน่วย' : `อัตราแปลงของ${noun}รายการนี้`}</span>
                <div className={`md-equation${factorLocked ? ' is-locked' : ''}`}>
                  <span className="eq-const">1</span>
                  <span className="eq-unit">{purchaseUnitCode}</span>
                  <span className="eq-op">=</span>
                  {factorLocked
                    ? <span className="eq-const eq-standard">{formatFactor(conversion.factor ?? 1)}</span>
                    : <input type="number" min="0" step="any" value={form.purchaseToBaseFactor}
                        onChange={(e) => set({ purchaseToBaseFactor: e.target.value })}
                        aria-labelledby="lbl-factor" aria-invalid={badFactor}
                        aria-describedby={badFactor ? 'err-factor' : undefined} />}
                  <span className="eq-unit">{baseUnitCode}</span>
                </div>

                {isSameUnit && <span className="md-hint">หน่วยซื้อและหน่วยฐานเป็นหน่วยเดียวกัน ไม่ต้องแปลง</span>}

                {isStandard && <>
                  <span className="md-hint md-hint-strong"><Check aria-hidden width={14} />หน่วยมาตรฐาน — ระบบคำนวณให้อัตโนมัติ</span>
                  {conversion.reverseText && <span className="md-hint">ด้านกลับ: {conversion.reverseText}</span>}
                </>}

                {!factorLocked && (badFactor
                  ? <span className="md-error" id="err-factor"><AlertTriangle aria-hidden />จำนวนต้องมากกว่า 0</span>
                  : <>
                      <span className="md-hint">อัตรานี้ใช้เฉพาะ{noun}รายการนี้เท่านั้น · {variant.factorHint}</span>
                      {conversion.reverseText && <span className="md-hint">ด้านกลับ: {conversion.reverseText}</span>}
                    </>)}
              </div>
            </div>
          </ContentCard>

          {/* C — ราคา */}
          <ContentCard title={<><span className="md-section-badge">C</span><ShoppingCart aria-hidden width={17} />ราคา</>}
            description={isEdit ? 'อัปเดตราคาซื้อได้ที่การ์ด “ประวัติราคาซื้อ” ด้านขวา' : 'กรอกราคารวมและจำนวนที่ซื้อ ระบบจะแปลงเป็นต้นทุนต่อหน่วยฐานให้ทันที'}>
            {isEdit ? (
              <p className="md-hint">ราคาที่บันทึกไว้จะถูกเก็บเป็นประวัติทุกครั้ง เพื่อให้ย้อนดูได้ว่าต้นทุนเปลี่ยนเมื่อไหร่</p>
            ) : (
              <div className="md-fields">
                <label>ราคาซื้อ (บาท)
                  <input type="number" min="0" step="any" value={form.purchasePrice}
                    onChange={(e) => set({ purchasePrice: e.target.value })} placeholder="350" />
                  <span className="md-hint">ราคารวมที่จ่ายจริงในการซื้อครั้งนั้น</span>
                </label>
                <label>{variant.purchaseQtyLabel}
                  <input type="number" min="0.0001" step="any" value={form.purchaseQuantity}
                    onChange={(e) => set({ purchaseQuantity: e.target.value })} />
                  <span className="md-hint">ได้ของกี่ {purchaseUnitCode} ในราคาด้านซ้าย</span>
                </label>
              </div>
            )}
          </ContentCard>

          {/* D — การควบคุมสต็อก */}
          <ContentCard title={<><span className="md-section-badge">D</span><SlidersHorizontal aria-hidden width={17} />การควบคุมสต็อก</>}
            description="ใช้แจ้งเตือนเมื่อของใกล้หมด — ไม่กระทบการคิดต้นทุน">
            <div className="md-fields">
              <label>จุดสั่งซื้อ ({baseUnitCode})
                <input type="number" min="0" value={form.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} />
                <span className="md-hint">แจ้งเตือนเมื่อคงเหลือถึงจำนวนนี้ (ไม่บังคับ)</span>
              </label>
              <div className="md-field">
                <span>การติดตาม</span>
                {variant.showLotExpiry ? (
                  <div className="md-switches">
                    <label><input type="checkbox" checked={form.isLotTracked} onChange={(e) => set({ isLotTracked: e.target.checked })} />ติดตาม Lot</label>
                    <label><input type="checkbox" checked={form.isExpiryTracked} onChange={(e) => set({ isExpiryTracked: e.target.checked })} />วันหมดอายุ</label>
                  </div>
                ) : (
                  <span className="md-hint">บรรจุภัณฑ์ไม่ต้องติดตาม Lot / วันหมดอายุ ระบบโฟกัสที่ต้นทุนต่อชิ้น</span>
                )}
              </div>
            </div>
          </ContentCard>

          {/* E — หมายเหตุ / รูป */}
          <ContentCard title={<><span className="md-section-badge">E</span><Boxes aria-hidden width={17} />รูปภาพ</>}
            description="ช่วยให้เลือกของถูกตัวตอนคีย์สูตรและรับของ">
            <ImageUpload kind="items" value={form.imageUrl} onChange={(url) => set({ imageUrl: url })} />
            <div className="item-live-preview">
              <Badge variant={variant.kind === 'packaging' ? 'gold' : 'info'}>{variant.kind === 'packaging' ? 'บรรจุภัณฑ์และวัสดุ' : 'วัตถุดิบอาหาร'}</Badge>
              <h3>{form.name || `ชื่อ${noun}`}</h3>
              <p>{form.code || 'รหัส'} · {purchaseUnitCode} → {baseUnitCode}</p>
            </div>
          </ContentCard>
        </div>

        {/* ---------- แผงสรุป ---------- */}
        <div className="md-form-side">
          <section className="md-preview">
            <h3><Calculator aria-hidden />ต้นทุนที่ระบบจะใช้</h3>
            <div className="md-preview-row">
              <span>ราคาซื้อ</span>
              <strong>{preview.pricePerPurchaseUnit != null ? `${formatMoney(preview.pricePerPurchaseUnit, 2)} / ${purchaseUnitCode}` : '—'}</strong>
            </div>
            <div className="md-preview-row">
              <span>การแปลง</span>
              <strong>{preview.conversionText ?? (preview.factorState === 'same' ? 'หน่วยซื้อและหน่วยฐานเหมือนกัน' : '—')}</strong>
            </div>
            <div className="md-preview-row lead">
              <span>{variant.costPerBaseLabel}</span>
              <strong>{preview.baseUnitCost != null ? `${formatMoney(preview.baseUnitCost, 4)} / ${baseUnitCode}` : '—'}</strong>
            </div>
            {preview.formula && <p className="md-preview-formula">{preview.formula}</p>}
            {preview.warning && <div className="rb-callout warn" role="note">
              <AlertTriangle aria-hidden /><div><strong>{preview.warning}</strong></div>
            </div>}
            <p className="md-preview-note">ต้นทุนต่อหน่วยฐานนี้จะถูกใช้คำนวณในทุกสูตรที่ใช้{noun}นี้</p>
          </section>

          {isEdit && detail.data && (
            <ContentCard title={<><History aria-hidden width={17} />ประวัติราคาซื้อ</>}>
              <PriceHistory itemId={id as string} baseUnitCode={baseUnitCode} />
            </ContentCard>
          )}

          <div className="md-form-actions">
            <Link to={variant.listPath} className="btn">ยกเลิก</Link>
            {!isEdit && <button type="button" className="btn" onClick={() => void submit(true)} disabled={saving}>บันทึกและเพิ่มใหม่</button>}
            <button type="button" className="btn primary" onClick={() => void submit()} disabled={saving}>
              {saving ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />}{isEdit ? 'บันทึกการแก้ไข' : `สร้าง${noun}`}
            </button>
          </div>
        </div>
      </div>

      <MasterModal
        open={catOpen}
        title={t.categoryTitle}
        description={t.categoryHint}
        error={catError}
        busy={savingCat}
        confirmLabel={t.addCategory}
        confirmIcon={<Plus aria-hidden width={16} />}
        onClose={() => setCatOpen(false)}
        onConfirm={() => void addCategory()}
      >
        <div className="md-fields">
          <label className="full">{t.categoryName}
            <input autoFocus placeholder={t.categoryPh} value={newCat} onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void addCategory(); } }} />
          </label>
        </div>
      </MasterModal>

      <MasterModal
        open={unitTarget !== null}
        title="เพิ่มหน่วยใหม่"
        description={`เพิ่มแล้วระบบจะเลือกกลับเข้า “${unitTarget === 'purchase' ? 'หน่วยที่ซื้อจากผู้ขาย' : 'หน่วยฐาน'}” ทันที`}
        error={unitError}
        busy={savingUnit}
        confirmLabel="เพิ่มหน่วย"
        confirmIcon={<Plus aria-hidden width={16} />}
        onClose={() => setUnitTarget(null)}
        onConfirm={() => void addUnit()}
      >
        <div className="md-fields">
          <label>ชื่อหน่วย *
            <input autoFocus placeholder="เช่น กระสอบ" value={newUnit.name} onChange={(e) => setNewUnit((u) => ({ ...u, name: e.target.value }))} />
          </label>
          <label>ตัวย่อ *
            <input placeholder="เช่น SACK" value={newUnit.code} onChange={(e) => setNewUnit((u) => ({ ...u, code: e.target.value.toUpperCase() }))} />
          </label>
          <p className="md-hint full">
            <StickyNote aria-hidden width={13} /> หน่วยเก็บเฉพาะชื่อและตัวย่อ · ความสัมพันธ์ระหว่างหน่วย เช่น 1 KG = 1000 G ตั้งได้ที่หน้าสูตรแปลงหน่วย
          </p>
        </div>
      </MasterModal>
    </PageContainer>
  );
}

function PriceHistory({ itemId, baseUnitCode }: { itemId: string; baseUnitCode: string }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const detail = useQuery({ queryKey: ['item', itemId], queryFn: () => catalogApi.item(itemId) });
  const [price, setPrice] = useState('');
  const [qty, setQty] = useState('1');
  const [busy, setBusy] = useState(false);

  const stats = detail.data?.priceStats;
  const history = useMemo(() => detail.data?.priceHistory ?? [], [detail.data?.priceHistory]);
  const spark = useMemo(() => history.slice().reverse().map((h) => h.baseUnitCost), [history]);

  const add = async () => {
    const p = Number(price);
    if (!p || p <= 0) { toast('กรอกราคาซื้อให้ถูกต้อง', 'error'); return; }
    setBusy(true);
    try {
      await catalogApi.addPrice(itemId, { purchasePrice: p, purchaseQuantity: Number(qty) || 1 });
      toast('บันทึกราคาซื้อแล้ว'); setPrice('');
      void qc.invalidateQueries({ queryKey: ['item', itemId] });
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['selectable-items'] });
    } catch (e) { toast(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ', 'error'); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="price-stats">
        <div><span>ล่าสุด</span><strong>{formatMoney(stats?.last ?? null, 4)}</strong></div>
        <div><span>ต่ำสุด</span><strong>{formatMoney(stats?.min ?? null, 4)}</strong></div>
        <div><span>สูงสุด</span><strong>{formatMoney(stats?.max ?? null, 4)}</strong></div>
      </div>
      {spark.length > 1 && <Sparkline values={spark} />}
      <div className="add-price-row">
        <input type="number" placeholder="ราคาซื้อ" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="ราคาซื้อใหม่" />
        <input type="number" className="apr-qty" placeholder="จำนวน" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="จำนวนที่ซื้อ" />
        <button type="button" className="btn primary" onClick={() => void add()} disabled={busy}>อัปเดต</button>
      </div>
      <div className="price-history-list">
        {history.length === 0 && <p className="md-hint"><Info width={15} aria-hidden />ยังไม่มีประวัติราคา</p>}
        {history.slice(0, 8).map((h) => (
          <div className="ph-row" key={h.id}>
            <span className="num">{formatMoney(h.baseUnitCost, 4)}<small> /{baseUnitCode}</small></span>
            <span className="ph-src">{h.purchasePrice ? `${formatMoney(h.purchasePrice, 2)}/${h.purchaseQuantity ?? 1}` : ''}</span>
            <span className="ph-src">{formatThaiDateTime(h.createdAt)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const w = 240, h = 44, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke="var(--blue)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
