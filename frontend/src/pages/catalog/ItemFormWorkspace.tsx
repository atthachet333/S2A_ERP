import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Save, Loader2, Info, Boxes, ShoppingCart, Scale, SlidersHorizontal,
  Calculator, History, Plus, X,
} from 'lucide-react';
import { catalogApi, type ItemType } from '@/lib/catalog';
import { formatMoney, formatThaiDateTime } from '@/lib/utils';
import ImageUpload from '@/components/ui/ImageUpload';
import Badge from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

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

  const units = useQuery({ queryKey: ['units'], queryFn: () => catalogApi.units() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => catalogApi.categories() });
  const detail = useQuery({ queryKey: ['item', id], queryFn: () => catalogApi.item(id as string), enabled: isEdit });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  // เพิ่มหน่วยกำหนดเอง (PART H/I) — ใช้ได้ทั้งหน่วยซื้อและหน่วยฐาน
  const [unitTarget, setUnitTarget] = useState<'purchase' | 'recipe' | null>(null);
  const [newUnit, setNewUnit] = useState({ name: '', code: '', category: 'COUNT' });
  const [savingUnit, setSavingUnit] = useState(false);
  const addUnit = async () => {
    if (!newUnit.name.trim() || !newUnit.code.trim()) { toast('กรอกชื่อหน่วยและตัวย่อ', 'error'); return; }
    setSavingUnit(true);
    try {
      const created = await catalogApi.createUnit({ code: newUnit.code.trim(), name: newUnit.name.trim() });
      await qc.invalidateQueries({ queryKey: ['units'] });
      set(unitTarget === 'purchase' ? { purchaseUnitId: created.id } : { baseUnitId: created.id });
      toast(`เพิ่มหน่วย “${created.name}” แล้ว`);
      setNewUnit({ name: '', code: '', category: 'COUNT' }); setUnitTarget(null);
    } catch (e) { toast(e instanceof Error ? e.message : 'เพิ่มหน่วยไม่สำเร็จ', 'error'); }
    finally { setSavingUnit(false); }
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

  const factor = Number(form.purchaseToBaseFactor) || 1;
  const price = Number(form.purchasePrice) || 0;
  const qty = Number(form.purchaseQuantity) || 1;
  const pricePerPurchaseUnit = qty > 0 ? price / qty : 0;
  const baseCostPreview = pricePerPurchaseUnit / (factor > 0 ? factor : 1);
  const baseUnitCode = units.data?.find((u) => u.id === form.baseUnitId)?.code ?? 'หน่วยฐาน';
  const purchaseUnitCode = units.data?.find((u) => u.id === form.purchaseUnitId)?.code ?? 'หน่วยซื้อ';

  const submit = async (addAnother = false) => {
    setError('');
    if (!form.code.trim() || !form.name.trim() || !form.baseUnitId) { setError('กรอก ชื่อ รหัส และหน่วยฐานให้ครบ'); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(), name: form.name.trim(), type: variant.type,
        barcode: form.barcode.trim() || null, categoryId: form.categoryId || null,
        baseUnitId: form.baseUnitId, purchaseUnitId: form.purchaseUnitId || null,
        purchaseToBaseFactor: factor, reorderPoint: Number(form.reorderPoint) || 0, imageUrl: form.imageUrl,
        isLotTracked: variant.showLotExpiry ? form.isLotTracked : false,
        isExpiryTracked: variant.showLotExpiry ? form.isExpiryTracked : false,
      };
      if (isEdit) await catalogApi.updateItem(id as string, payload);
      else await catalogApi.createItem({ ...payload, ...(price > 0 ? { purchasePrice: price, purchaseQuantity: qty } : {}) });
      toast('บันทึกสำเร็จ');
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['item-summary'] });
      if (addAnother && !isEdit) setForm({ ...EMPTY, baseUnitId: form.baseUnitId });
      else navigate(variant.listPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally { setSaving(false); }
  };

  const noun = variant.kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ';

  return (
    <>
      <Link to={variant.listPath} className="btn" style={{ marginBottom: 14 }}><ArrowLeft aria-hidden />กลับ</Link>
      <div className="page-title-block">
        <p className="eyebrow">{variant.eyebrow}</p>
        <h1>{isEdit ? `แก้ไข${noun}` : `เพิ่ม${noun}`}</h1>
        <p>กรอกข้อมูลเป็นขั้นตอน ระบบจะสรุปต้นทุนต่อหน่วยให้อัตโนมัติทางด้านขวา</p>
      </div>

      {error && <div className="alert" style={{ marginTop: 14 }}>{error}</div>}

      <div className="form-2col" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* 1 — ข้อมูลหลัก */}
          <section className="card card-pad">
            <h3 className="form-section-title"><span className="sec-no">1</span>ข้อมูลหลัก</h3>
            <p className="form-section-sub">ชื่อและรหัสสำหรับอ้างอิง{noun}นี้ในสูตรและรายงาน</p>
            {variant.presets && (
              <div className="fcx-presets" role="group" aria-label="ประเภทบรรจุภัณฑ์ที่ใช้บ่อย">
                {variant.presets.map((p) => (
                  <button type="button" key={p.label} className={form.name === p.label ? 'active' : ''}
                    onClick={() => set({ name: form.name === p.label ? '' : p.label })}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="field-grid">
              <label className="full">{variant.nameLabel} *<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder={variant.namePlaceholder} /></label>
              <label>รหัส *<input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder={variant.codePlaceholder} /></label>
              <label>บาร์โค้ด<input value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="(ไม่บังคับ)" /></label>
              <label className="full">{variant.categoryLabel}
                <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                  <option value="">— ไม่ระบุ —</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            </div>
          </section>

          {/* 2 — ข้อมูลการซื้อ */}
          <section className="card card-pad">
            <h3 className="form-section-title"><ShoppingCart aria-hidden />ข้อมูลการซื้อ</h3>
            <p className="form-section-sub">
              {isEdit ? 'อัปเดตราคาซื้อได้ที่การ์ด “ประวัติราคาซื้อ” ด้านขวา' : 'กรอกราคารวมและจำนวนที่ซื้อ ระบบจะแปลงเป็นต้นทุนต่อหน่วยฐานให้ทันที'}
            </p>
            <div className="field-grid">
              <label className="full">หน่วยที่ซื้อจากผู้ขาย
                <div className="unit-picker-row"><select value={form.purchaseUnitId} onChange={(e) => set({ purchaseUnitId: e.target.value })}>
                  <option value="">— เหมือนหน่วยฐาน —</option>
                  {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select><button type="button" className="btn" onClick={() => setUnitTarget('purchase')}><Plus aria-hidden />เพิ่มหน่วย</button></div>
                <span className="field-hint">เช่น ซื้อไก่เป็นกิโลกรัม ซื้อกล่องอาหารเป็นแพ็ค</span>
              </label>
              {!isEdit && <>
                <label>ราคาซื้อ (บาท) ต่อ {qty > 1 ? `${qty} ` : ''}{purchaseUnitCode}
                  <input type="number" min="0" step="any" value={form.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} placeholder="350" />
                </label>
                <label className="full">{variant.purchaseQtyLabel}
                  <input type="number" min="0.0001" step="any" value={form.purchaseQuantity} onChange={(e) => set({ purchaseQuantity: e.target.value })} />
                  <span className="field-hint">ตัวอย่าง: ซื้อครั้งละกี่ {purchaseUnitCode} ในราคาด้านบน</span>
                </label>
              </>}
            </div>
          </section>

          {/* 3 — หน่วยใช้งานในสูตร */}
          <section className="card card-pad">
            <h3 className="form-section-title"><Scale aria-hidden />หน่วยใช้งานในสูตร</h3>
            <p className="form-section-sub">{variant.baseUnitHint}</p>
            <div className="field-grid">
              <label className="full">หน่วยที่ใช้ตอนทำสูตร * <small>(หน่วยฐานของรายการ)</small>
                <div className="unit-picker-row"><select value={form.baseUnitId} onChange={(e) => set({ baseUnitId: e.target.value })}>
                  <option value="">— เลือก —</option>
                  {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select><button type="button" className="btn" onClick={() => setUnitTarget('recipe')}><Plus aria-hidden />เพิ่มหน่วย</button></div>
                <span className="field-hint">หน่วยนี้คือหน่วยที่ใช้ระบุปริมาณจริงในสูตรอาหาร</span>
              </label>
              <div className="conversion-sentence full"><span><b>1</b><em>{purchaseUnitCode}</em></span><strong>=</strong><label><input aria-label="จำนวนหน่วยที่ใช้ในสูตรต่อหน่วยซื้อ" type="number" min="0" step="any" value={form.purchaseToBaseFactor} onChange={(e) => set({ purchaseToBaseFactor: e.target.value })} /><em>{baseUnitCode}</em></label></div>
              <span className="field-hint full">สำหรับหน่วยเฉพาะ เช่น กำ ลูก หรือชิ้น สามารถกำหนดค่าต่อ{noun}รายการนี้ได้ · {variant.factorHint}</span>
            </div>
          </section>

          {/* 4 — การควบคุมต้นทุน / สต๊อก */}
          <section className="card card-pad">
            <h3 className="form-section-title"><SlidersHorizontal aria-hidden />การควบคุมต้นทุน</h3>
            <div className="field-grid">
              <label>จุดสั่งซื้อ ({baseUnitCode})
                <input type="number" min="0" value={form.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} />
                <span className="field-hint">แจ้งเตือนเมื่อของใกล้หมด (ไม่บังคับ)</span>
              </label>
              {variant.showLotExpiry ? (
                <div className="fcx-field" style={{ justifyContent: 'flex-end' }}>
                  <span>การติดตาม</span>
                  <div className="stock-switches">
                    <label style={{ flexDirection: 'row' }}><input type="checkbox" checked={form.isLotTracked} onChange={(e) => set({ isLotTracked: e.target.checked })} /> ติดตาม Lot</label>
                    <label style={{ flexDirection: 'row' }}><input type="checkbox" checked={form.isExpiryTracked} onChange={(e) => set({ isExpiryTracked: e.target.checked })} /> วันหมดอายุ</label>
                  </div>
                </div>
              ) : (
                <div className="fcx-field" style={{ justifyContent: 'center' }}>
                  <span className="field-hint">บรรจุภัณฑ์ไม่ต้องติดตาม Lot / วันหมดอายุ ระบบโฟกัสที่ต้นทุนต่อชิ้น</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* ---------- Sidebar ---------- */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }} className="fcx-sticky">
          <section className="card card-pad">
            <h3 className="form-section-title"><Boxes aria-hidden />รูปภาพและตัวอย่าง</h3>
            <ImageUpload kind="items" value={form.imageUrl} onChange={(url) => set({ imageUrl: url })} />
            <div className="item-live-preview">
              <Badge variant={variant.kind === 'packaging' ? 'gold' : 'info'}>{variant.kind === 'packaging' ? 'บรรจุภัณฑ์และวัสดุ' : 'วัตถุดิบอาหาร'}</Badge>
              <h3 style={{ margin: '10px 0 2px' }}>{form.name || `ชื่อ${noun}`}</h3>
              <p style={{ margin: 0, color: 'var(--text-subtle)', fontSize: 13 }}>{form.code || 'รหัส'} · {purchaseUnitCode} → {baseUnitCode}</p>
            </div>
          </section>

          <section className="card card-pad cost-preview">
            <h3 className="form-section-title"><Calculator aria-hidden />ต้นทุนที่คำนวณได้</h3>
            <div className="cp-row"><span>ราคาต่อ 1 {purchaseUnitCode}</span><strong>{pricePerPurchaseUnit > 0 ? formatMoney(pricePerPurchaseUnit, 2) : '—'}</strong></div>
            <div className="cp-row big"><span>{variant.costPerBaseLabel}</span><strong>{baseCostPreview > 0 ? formatMoney(baseCostPreview, 4) : '—'}</strong></div>
            {pricePerPurchaseUnit > 0 && (
              <div className="cp-formula">
                <b>{formatMoney(pricePerPurchaseUnit, 2)}</b> ต่อ {purchaseUnitCode} ÷ <b>{factor}</b> {baseUnitCode}/{purchaseUnitCode} = <b>{formatMoney(baseCostPreview, 4)}</b> ต่อ {baseUnitCode}
              </div>
            )}
            <p className="field-hint" style={{ marginTop: 10 }}>ต้นทุนต่อหน่วยฐานนี้จะถูกใช้คำนวณในทุกสูตรที่ใช้{noun}นี้</p>
          </section>

          {isEdit && detail.data && (
            <section className="card card-pad">
              <h3 className="form-section-title"><History aria-hidden />ประวัติราคาซื้อ</h3>
              <PriceHistory itemId={id as string} />
            </section>
          )}

          <div className="sticky-form-actions">
            <Link to={variant.listPath} className="btn">ยกเลิก</Link>
            {!isEdit && <button className="btn" onClick={() => void submit(true)} disabled={saving}>บันทึกและเพิ่มใหม่</button>}
            <button className="btn primary" onClick={() => void submit()} disabled={saving}>
              {saving ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />}{isEdit ? 'บันทึกการแก้ไข' : `สร้าง${noun}`}
            </button>
          </div>
        </div>
      </div>
      {unitTarget && <div className="modal-backdrop" role="presentation"><section className="unit-modal" role="dialog" aria-modal="true" aria-labelledby="add-unit-title"><div className="add-unit-head"><div><p className="eyebrow">UNIT MASTER</p><h2 id="add-unit-title">เพิ่มหน่วยใหม่</h2></div><button type="button" className="icon-btn" onClick={() => setUnitTarget(null)} aria-label="ปิด"><X aria-hidden /></button></div><p className="field-hint">เพิ่มแล้วระบบจะเลือกกลับเข้า “{unitTarget === 'purchase' ? 'หน่วยที่ซื้อจากผู้ขาย' : 'หน่วยที่ใช้ตอนทำสูตร'}” ทันที</p><label>ชื่อหน่วย<input autoFocus placeholder="เช่น กระสอบ" value={newUnit.name} onChange={(e) => setNewUnit((u) => ({ ...u, name: e.target.value }))} /></label><label>ตัวย่อ<input placeholder="เช่น SACK" value={newUnit.code} onChange={(e) => setNewUnit((u) => ({ ...u, code: e.target.value.toUpperCase() }))} /></label><label>ประเภท<select value={newUnit.category} onChange={(e) => setNewUnit((u) => ({ ...u, category: e.target.value }))}><option value="WEIGHT">น้ำหนัก</option><option value="VOLUME">ปริมาตร</option><option value="COUNT">จำนวน</option><option value="PACKAGING">บรรจุภัณฑ์</option><option value="CUSTOM">กำหนดเอง</option></select><span className="field-hint">ใช้ช่วยเลือกความหมายของหน่วยในหน้าจอนี้ โดย Unit Master เดิมเก็บชื่อและตัวย่อ</span></label><div className="modal-actions"><button type="button" className="btn" onClick={() => setUnitTarget(null)}>ยกเลิก</button><button type="button" className="btn primary" onClick={() => void addUnit()} disabled={savingUnit}>{savingUnit ? <Loader2 className="spin" aria-hidden /> : <Plus aria-hidden />}เพิ่มหน่วย</button></div></section></div>}
    </>
  );
}

function PriceHistory({ itemId }: { itemId: string }) {
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
        <input type="number" placeholder="จำนวน" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="จำนวนที่ซื้อ" style={{ maxWidth: 90 }} />
        <button className="btn primary" onClick={() => void add()} disabled={busy}>อัปเดต</button>
      </div>
      <div className="price-history-list">
        {history.length === 0 && <p className="subtle" style={{ fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}><Info width={15} aria-hidden />ยังไม่มีประวัติราคา</p>}
        {history.slice(0, 8).map((h) => (
          <div className="ph-row" key={h.id}>
            <span className="num">{formatMoney(h.baseUnitCost, 4)}<small style={{ color: 'var(--text-subtle)' }}> /หน่วยฐาน</small></span>
            <span className="subtle" style={{ fontSize: 12 }}>{h.purchasePrice ? `฿${formatMoney(h.purchasePrice, 2)}/${h.purchaseQuantity ?? 1}` : ''}</span>
            <span className="subtle" style={{ fontSize: 12 }}>{formatThaiDateTime(h.createdAt)}</span>
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
