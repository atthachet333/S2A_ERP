import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Save, TrendingUp, History, Loader2, Check } from 'lucide-react';
import { catalogApi, type ItemType } from '@/lib/catalog';
import { formatFactor, resolveConversion } from '@/lib/standard-conversion';
import { formatMoney, formatThaiDateTime } from '@/lib/utils';
import ImageUpload from '@/components/ui/ImageUpload';
import Badge from '@/components/ui/Badge';
import { useToast } from '@/components/ui/Toast';

const TYPES: { value: ItemType; label: string }[] = [
  { value: 'RAW_MATERIAL', label: 'วัตถุดิบ' },
  { value: 'PACKAGING', label: 'บรรจุภัณฑ์' },
  { value: 'FINISHED_GOOD', label: 'สินค้าสำเร็จรูป' },
  { value: 'SEMI_FINISHED', label: 'กึ่งสำเร็จรูป' },
  { value: 'CONSUMABLE', label: 'วัสดุสิ้นเปลือง' },
];

interface FormState {
  code: string; name: string; barcode: string; type: ItemType; categoryId: string;
  baseUnitId: string; purchaseUnitId: string; purchaseToBaseFactor: string;
  reorderPoint: string; imageUrl: string | null;
  purchasePrice: string; purchaseQuantity: string;
  isLotTracked: boolean; isExpiryTracked: boolean;
}
const EMPTY: FormState = {
  code: '', name: '', barcode: '', type: 'RAW_MATERIAL', categoryId: '',
  baseUnitId: '', purchaseUnitId: '', purchaseToBaseFactor: '1', reorderPoint: '0', imageUrl: null,
  purchasePrice: '', purchaseQuantity: '1',
  isLotTracked: false, isExpiryTracked: false,
};

export default function ItemFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();

  const units = useQuery({ queryKey: ['units'], queryFn: () => catalogApi.units() });
  /* PHASE 20B — ใช้อัตราแปลงมาตรฐานชุดเดียวกับหน้าวัตถุดิบและหน้าบรรจุภัณฑ์
     ก่อนหน้านี้ฟอร์มนี้ปล่อยให้กรอกอัตราเองล้วน จึงยังใส่ 0.001 สำหรับ KG→G ได้อยู่ */
  const conversions = useQuery({ queryKey: ['unit-conversions'], queryFn: () => catalogApi.conversions() });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => catalogApi.categories() });
  const detail = useQuery({ queryKey: ['item', id], queryFn: () => catalogApi.item(id as string), enabled: isEdit });

  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    if (detail.data) {
      const d = detail.data;
      setForm({
        code: d.code, name: d.name, barcode: d.barcode ?? '', type: d.type, categoryId: d.categoryId ?? '',
        baseUnitId: d.baseUnitId, purchaseUnitId: d.purchaseUnitId ?? '', purchaseToBaseFactor: String(d.purchaseToBaseFactor),
        reorderPoint: String(d.reorderPoint), imageUrl: d.imageUrl, purchasePrice: '', purchaseQuantity: '1',
        isLotTracked: d.isLotTracked, isExpiryTracked: d.isExpiryTracked,
      });
    }
  }, [detail.data]);

  // ค่าเริ่มต้นหน่วยฐานเมื่อโหลด units
  useEffect(() => {
    if (!isEdit && !form.baseUnitId && units.data && units.data.length > 0) set({ baseUnitId: units.data[0].id });
  }, [units.data, isEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  const baseUnitCode = units.data?.find((u) => u.id === form.baseUnitId)?.code ?? 'หน่วยฐาน';
  const purchaseUnitCode = units.data?.find((u) => u.id === form.purchaseUnitId)?.code ?? baseUnitCode;

  /* ความหมายเดียวทั้งระบบ: อัตรา = "หนึ่งหน่วยซื้อ มีกี่หน่วยฐาน"
     1 KG = 1,000 G → 1000 (ไม่ใช่ 0.001) · ต้นทุน = ราคา ÷ จำนวนที่ซื้อ ÷ อัตรา */
  const conversion = useMemo(() => resolveConversion({
    purchaseUnitId: form.purchaseUnitId || null,
    baseUnitId: form.baseUnitId || null,
    purchaseUnitCode, baseUnitCode,
    edges: conversions.data ?? [],
    manualFactor: form.purchaseToBaseFactor,
  }), [form.purchaseUnitId, form.baseUnitId, form.purchaseToBaseFactor, purchaseUnitCode, baseUnitCode, conversions.data]);

  const isStandard = conversion.source === 'standard';
  const isSameUnit = conversion.source === 'same';
  const factorLocked = isStandard || isSameUnit;
  const factor = factorLocked ? (conversion.factor ?? 1) : (Number(form.purchaseToBaseFactor) || 1);

  // เปลี่ยนหน่วยเมื่อไร อัตรามาตรฐานต้องถูกเติมทันที ทั้งตอนสร้างและตอนแก้ไข
  useEffect(() => {
    if (!factorLocked) return;
    const resolved = String(conversion.factor ?? 1);
    if (form.purchaseToBaseFactor !== resolved) set({ purchaseToBaseFactor: resolved });
  }, [factorLocked, conversion.factor]); // eslint-disable-line react-hooks/exhaustive-deps

  const price = Number(form.purchasePrice) || 0;
  const qty = Number(form.purchaseQuantity) || 1;
  const pricePerPurchaseUnit = qty > 0 ? price / qty : 0;
  const baseCostPreview = pricePerPurchaseUnit / (factor > 0 ? factor : 1);

  const submit = async (addAnother = false) => {
    setError('');
    if (!form.code.trim() || !form.name.trim() || !form.baseUnitId) { setError('กรอกรหัส ชื่อ และหน่วยฐานให้ครบ'); return; }
    setSaving(true);
    try {
      const payload = {
        code: form.code.trim(), name: form.name.trim(), type: form.type,
        barcode: form.barcode.trim() || null, categoryId: form.categoryId || null,
        baseUnitId: form.baseUnitId, purchaseUnitId: form.purchaseUnitId || null,
        purchaseToBaseFactor: factor, reorderPoint: Number(form.reorderPoint) || 0, imageUrl: form.imageUrl,
        isLotTracked: form.isLotTracked, isExpiryTracked: form.isExpiryTracked,
      };
      if (isEdit) {
        await catalogApi.updateItem(id as string, payload);
      } else {
        await catalogApi.createItem({ ...payload, ...(price > 0 ? { purchasePrice: price, purchaseQuantity: qty } : {}) });
      }
      toast('บันทึกวัตถุดิบสำเร็จ');
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['item-summary'] });
      if (addAnother && !isEdit) setForm({ ...EMPTY, baseUnitId: units.data?.[0]?.id ?? '' });
      else navigate('/items');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Link to="/items" className="btn" style={{ marginBottom: 14 }}><ArrowLeft aria-hidden />กลับ</Link>
      <div className="page-title-block">
        <p className="eyebrow">ข้อมูลอาหาร</p>
        <h1>{isEdit ? 'แก้ไขรายการ' : 'เพิ่มวัตถุดิบ / บรรจุภัณฑ์'}</h1>
        <p>จัดการข้อมูล ราคา หน่วย และการควบคุมสต๊อก เพื่อใช้คำนวณต้นทุนจริง</p>
      </div>

      {error && <div className="alert" style={{ marginTop: 14 }}>{error}</div>}

      <div className="form-2col" style={{ marginTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card card-pad">
            <h2 className="form-section-title">1. ข้อมูลหลัก</h2>
            <div className="field-grid">
              <label>ชื่อวัตถุดิบ *<input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="เช่น ข้าวหอมมะลิ" /></label>
              <label>รหัส *<input value={form.code} onChange={(e) => set({ code: e.target.value })} placeholder="RM-001" /></label>
              <label>บาร์โค้ด<input value={form.barcode} onChange={(e) => set({ barcode: e.target.value })} placeholder="(ไม่บังคับ)" /></label>
              <label>ประเภท
                <select value={form.type} onChange={(e) => set({ type: e.target.value as ItemType })}>
                  {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label>หมวดหมู่
                <select value={form.categoryId} onChange={(e) => set({ categoryId: e.target.value })}>
                  <option value="">— ไม่ระบุ —</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label>จุดสั่งซื้อ (Min Stock)<input type="number" value={form.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} /></label>
            </div>
          </section>

          {!isEdit && (
            <section className="card card-pad">
              <h2 className="form-section-title">2. ข้อมูลการซื้อ</h2>
              <p className="field-hint">กรอกราคารวมและจำนวนที่ซื้อ ระบบจะแปลงเป็นต้นทุนต่อหน่วยฐานให้ทันที</p>
              <div className="field-grid">
                <label>ราคาซื้อ (บาท)<input type="number" min="0" step="any" value={form.purchasePrice} onChange={(e) => set({ purchasePrice: e.target.value })} placeholder="350" /></label>
                <label>จำนวนที่ซื้อ ({purchaseUnitCode})<input type="number" min="0.0001" step="any" value={form.purchaseQuantity} onChange={(e) => set({ purchaseQuantity: e.target.value })} /></label>
              </div>
            </section>
          )}

          <section className="card card-pad">
            <h2 className="form-section-title">3. หน่วยและการแปลง</h2>
            <div className="field-grid">
              <label>หน่วยฐาน (ใช้ในสูตร) *
                <select value={form.baseUnitId} onChange={(e) => set({ baseUnitId: e.target.value })}>
                  <option value="">— เลือก —</option>
                  {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select>
              </label>
              <label>หน่วยซื้อ
                <select value={form.purchaseUnitId} onChange={(e) => set({ purchaseUnitId: e.target.value })}>
                  <option value="">— เหมือนหน่วยฐาน —</option>
                  {units.data?.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.code})</option>)}
                </select>
              </label>
              {/* PHASE 20B — หน่วยมาตรฐานระบบเติมและล็อกให้ · หน่วยเฉพาะรายการยังกรอกเอง */}
              {isSameUnit
                ? <div className="full">
                    <span className="field-hint">หน่วยซื้อและหน่วยฐานเป็นหน่วยเดียวกัน ไม่ต้องแปลง</span>
                  </div>
                : factorLocked
                  ? <div className="full">
                      <strong className="conv-standard">อัตราแปลงหน่วย: 1 {purchaseUnitCode} = {formatFactor(conversion.factor ?? 1)} {baseUnitCode}</strong>
                      <span className="field-hint"><Check aria-hidden width={14} />หน่วยมาตรฐาน — ระบบคำนวณให้อัตโนมัติ</span>
                      {conversion.reverseText && <span className="field-hint">ด้านกลับ: {conversion.reverseText}</span>}
                    </div>
                  : <label className="full">อัตราแปลงของรายการนี้: 1 {purchaseUnitCode} = ? {baseUnitCode}
                      <input type="number" min="0" step="any" value={form.purchaseToBaseFactor}
                        onChange={(e) => set({ purchaseToBaseFactor: e.target.value })} />
                      <span className="field-hint">เช่น 1 กระสอบ = 25 กก. → กรอก 25 · 1 ลัง = 12 ชิ้น → กรอก 12</span>
                      {conversion.reverseText && <span className="field-hint">ด้านกลับ: {conversion.reverseText}</span>}
                    </label>}
            </div>
          </section>

          <section className="card card-pad">
            <h2 className="form-section-title">4. การควบคุมสต๊อก</h2>
            <div className="field-grid">
              <label>จุดสั่งซื้อ (หน่วยฐาน)<input type="number" min="0" value={form.reorderPoint} onChange={(e) => set({ reorderPoint: e.target.value })} /></label>
              <div className="stock-switches">
                <label><input type="checkbox" checked={form.isLotTracked} onChange={(e) => set({ isLotTracked: e.target.checked })} /> รองรับ Lot</label>
                <label><input type="checkbox" checked={form.isExpiryTracked} onChange={(e) => set({ isExpiryTracked: e.target.checked })} /> ติดตามวันหมดอายุ</label>
              </div>
            </div>
          </section>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card card-pad item-image-panel">
            <h2 className="form-section-title">รูปภาพและตัวอย่าง</h2>
            <ImageUpload kind="items" value={form.imageUrl} onChange={(url) => set({ imageUrl: url })} />
            <div className="item-live-preview">
              <Badge variant="muted">{TYPES.find((type) => type.value === form.type)?.label}</Badge>
              <h3>{form.name || 'ชื่อรายการ'}</h3>
              <p>{form.code || 'รหัสรายการ'} · {purchaseUnitCode} → {baseUnitCode}</p>
            </div>
          </section>
          <section className="card card-pad cost-preview">
            <h2 className="form-section-title"><TrendingUp aria-hidden width={17} /> ต้นทุนที่คำนวณได้</h2>
            <div className="cp-row"><span>ราคาต่อ 1 {purchaseUnitCode}</span><strong className="num">{pricePerPurchaseUnit > 0 ? formatMoney(pricePerPurchaseUnit, 2) : '—'}</strong></div>
            <div className="cp-row big"><span>ต้นทุนต่อ 1 {baseUnitCode}</span><strong className="num">{baseCostPreview > 0 ? formatMoney(baseCostPreview, 4) : '—'}</strong></div>
            <p className="field-hint" style={{ marginTop: 8 }}>ต้นทุนต่อหน่วยฐานนี้จะถูกใช้คำนวณต้นทุนในทุกสูตรที่ใช้วัตถุดิบนี้</p>
          </section>

          {isEdit && detail.data && (
            <section className="card card-pad">
              <h2 className="form-section-title"><History aria-hidden width={17} /> ประวัติราคาซื้อ</h2>
              <PriceHistory itemId={id as string} />
            </section>
          )}

          <div className="sticky-form-actions">
            <Link to="/items" className="btn">ยกเลิก</Link>
            {!isEdit && <button className="btn" onClick={() => void submit(true)} disabled={saving}>บันทึกและเพิ่มรายการใหม่</button>}
            <button className="btn primary" onClick={() => void submit()} disabled={saving}>
              {saving ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />}{isEdit ? 'บันทึกการแก้ไข' : 'สร้างวัตถุดิบ'}
            </button>
          </div>
        </div>
      </div>
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
        <div><span>ล่าสุด</span><strong className="num">{formatMoney(stats?.last ?? null, 4)}</strong></div>
        <div><span>ต่ำสุด</span><strong className="num">{formatMoney(stats?.min ?? null, 4)}</strong></div>
        <div><span>สูงสุด</span><strong className="num">{formatMoney(stats?.max ?? null, 4)}</strong></div>
      </div>
      {spark.length > 1 && <Sparkline values={spark} />}
      <div className="add-price-row">
        <input type="number" placeholder="ราคาซื้อ" value={price} onChange={(e) => setPrice(e.target.value)} aria-label="ราคาซื้อใหม่" />
        <input type="number" placeholder="จำนวน" value={qty} onChange={(e) => setQty(e.target.value)} aria-label="จำนวนที่ซื้อ" style={{ maxWidth: 90 }} />
        <button className="btn primary" onClick={() => void add()} disabled={busy}>อัปเดตราคา</button>
      </div>
      <div className="price-history-list">
        {history.length === 0 && <p className="subtle" style={{ fontSize: 13 }}>ยังไม่มีประวัติราคา</p>}
        {history.slice(0, 8).map((h) => (
          <div className="ph-row" key={h.id}>
            <span className="num">{formatMoney(h.baseUnitCost, 4)}<small style={{ color: 'var(--text-subtle)' }}> /หน่วยฐาน</small></span>
            <span className="subtle" style={{ fontSize: 12 }}>{h.purchasePrice ? `ซื้อ ${formatMoney(h.purchasePrice, 2)}/${h.purchaseQuantity ?? 1}` : ''}</span>
            <span className="subtle" style={{ fontSize: 12 }}>{formatThaiDateTime(h.createdAt)}</span>
          </div>
        ))}
      </div>
      {stats && <Badge variant="muted" className="num">{stats.count} รายการ</Badge>}
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
