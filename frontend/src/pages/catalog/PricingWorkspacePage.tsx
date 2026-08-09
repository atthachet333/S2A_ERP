import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CircleDollarSign, TrendingUp, Percent, Store, Bike, Boxes, Save,
  Lightbulb, AlertTriangle, CheckCircle2, Calculator,
} from 'lucide-react';
import { catalogApi, type CostBreakdown, type PricingResult, type RecipeDetail } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import { useToast } from '@/components/ui/Toast';

type Mode = 'marginPercent' | 'markupPercent' | 'sellingPrice';
const TIER_DEFS = [
  { key: 'RETAIL', label: 'หน้าร้าน', icon: Store, factor: 1 },
  { key: 'DELIVERY', label: 'ดิลิเวอรี', icon: Bike, factor: 1.3 },
  { key: 'WHOLESALE', label: 'ขายส่ง', icon: Boxes, factor: 0.85 },
] as const;

export default function PricingWorkspacePage() {
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: () => catalogApi.recipes() });
  const { toast } = useToast();
  const [recipeId, setRecipeId] = useState('');
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [versionId, setVersionId] = useState('');
  const [cost, setCost] = useState<CostBreakdown | null>(null);
  const [pricing, setPricing] = useState<PricingResult | null>(null);
  const [mode, setMode] = useState<Mode>('marginPercent');
  const [value, setValue] = useState(40);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const selectRecipe = async (id: string) => {
    setRecipeId(id); setError(''); setCost(null); setPricing(null); setRecipe(null); setVersionId('');
    if (!id) return;
    try {
      const d = await catalogApi.recipe(id);
      setRecipe(d);
      const active = d.versions.find((v) => v.isActive) ?? d.versions[0];
      setVersionId(active?.id ?? '');
    } catch (e) { setError(e instanceof Error ? e.message : 'โหลดสูตรไม่สำเร็จ'); }
  };

  useEffect(() => {
    if (!versionId) { setCost(null); setPricing(null); return; }
    if (mode === 'marginPercent' && value >= 100) { setError('Margin ต้องต่ำกว่า 100%'); return; }
    let alive = true; setError('');
    catalogApi.calculate({ recipeVersionId: versionId, [mode]: value })
      .then((r) => { if (alive) { setCost(r.breakdown); setPricing(r.pricing); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'คำนวณไม่สำเร็จ'); });
    return () => { alive = false; };
  }, [versionId, mode, value]);

  const unitCost = cost?.unitCost ?? 0;
  const tiers = useMemo(() => {
    if (!pricing) return [];
    return TIER_DEFS.map((t) => {
      const price = pricing.sellingPrice * t.factor;
      const profit = price - unitCost;
      const margin = price > 0 ? (profit / price) * 100 : 0;
      return { ...t, price, profit, margin };
    });
  }, [pricing, unitCost]);

  const recommendations = useMemo(() => {
    const out: { tone: 'good' | 'warn' | 'bad'; text: string }[] = [];
    if (!pricing || !cost) return out;
    if (pricing.isLoss) out.push({ tone: 'bad', text: 'ราคาขายต่ำกว่าต้นทุน — ขายเท่านี้จะขาดทุนทันที' });
    else if (pricing.marginPercent < 20) out.push({ tone: 'warn', text: `กำไรบางเกินไป (margin ${pricing.marginPercent.toFixed(1)}%) ลองเพิ่มราคาหรือลดต้นทุน` });
    else if (pricing.marginPercent >= 50) out.push({ tone: 'good', text: `margin ดีมาก (${pricing.marginPercent.toFixed(1)}%) เมนูนี้ทำกำไรได้ดี` });
    else out.push({ tone: 'good', text: `margin อยู่ในเกณฑ์ดี (${pricing.marginPercent.toFixed(1)}%)` });
    const pkgShare = cost.totalCost > 0 ? (cost.packagingCost / cost.totalCost) * 100 : 0;
    if (pkgShare > 25) out.push({ tone: 'warn', text: `ต้นทุนบรรจุภัณฑ์สูง (${pkgShare.toFixed(0)}% ของต้นทุน) ลองหาแพ็กเกจที่ถูกลง` });
    return out;
  }, [pricing, cost]);

  const save = async (priceType: string, price: number) => {
    if (!recipe) return;
    setSaving(true);
    try {
      await catalogApi.savePrice({ itemId: recipe.product.id, priceType, price, markupPercent: pricing?.markupPercent, marginPercent: pricing?.marginPercent });
      toast(`บันทึกราคา${TIER_DEFS.find((t) => t.key === priceType)?.label ?? ''}แล้ว`);
    } catch (e) { toast(e instanceof Error ? e.message : 'บันทึกราคาไม่สำเร็จ', 'error'); }
    finally { setSaving(false); }
  };

  const marginPct = pricing?.marginPercent ?? 0;

  return (
    <>
      <div className="fcx-hero">
        <div className="fcx-hero-row">
          <div>
            <p className="eyebrow">จัดการเมนูและต้นทุน</p>
            <h1>ราคาขายและกำไร</h1>
            <p>ตั้งราคาขายจากต้นทุนจริง เลือกวิธี markup หรือ margin แล้วเทียบราคาหลายช่องทางพร้อมวิเคราะห์กำไร</p>
          </div>
          <Link to="/costing" className="qa-btn"><Calculator aria-hidden />ดูรายละเอียดต้นทุน</Link>
        </div>
      </div>

      <section className="card card-pad">
        <div className="fcx-picker">
          <label className="fcx-field">เลือกสูตร / เมนู
            <select value={recipeId} onChange={(e) => void selectRecipe(e.target.value)}>
              <option value="">— เลือกสูตร —</option>
              {recipes.data?.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
            </select>
          </label>
          <label className="fcx-field">เวอร์ชันสูตร
            <select value={versionId} onChange={(e) => setVersionId(e.target.value)} disabled={!recipe}>
              {!recipe && <option value="">— เลือกสูตรก่อน —</option>}
              {recipe?.versions.map((v) => <option key={v.id} value={v.id}>เวอร์ชัน {v.versionNo}{v.isActive ? ' (ใช้งาน)' : ''}</option>)}
            </select>
          </label>
        </div>
      </section>

      {error && <div className="alert" style={{ marginTop: 16 }}>{error}</div>}

      {!recipeId && !recipes.isLoading && (
        <section className="card" style={{ marginTop: 16 }}>
          <EmptyState icon={CircleDollarSign} title="เลือกสูตรเพื่อเริ่มตั้งราคาขาย"
            description={recipes.data && recipes.data.length === 0 ? 'ยังไม่มีสูตรในระบบ — สร้างสูตรเมนูก่อน' : 'เลือกสูตร แล้วกำหนดวิธีคิดราคาเพื่อดูกำไรและ margin'}
            action={recipes.data && recipes.data.length === 0 ? <Link to="/recipes" className="btn primary">สร้างสูตร</Link> : undefined} />
        </section>
      )}

      {recipeId && cost && pricing && (
        <div className="fcx-2col" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* วิธีคิดราคา */}
            <section className="card card-pad">
              <h3 className="form-section-title"><Percent aria-hidden />วิธีคิดราคา</h3>
              <div className="fcx-tabs" style={{ marginTop: 6 }}>
                <button className={mode === 'marginPercent' ? 'active' : ''} onClick={() => { setMode('marginPercent'); setValue(40); }}>Margin %</button>
                <button className={mode === 'markupPercent' ? 'active' : ''} onClick={() => { setMode('markupPercent'); setValue(60); }}>Markup %</button>
                <button className={mode === 'sellingPrice' ? 'active' : ''} onClick={() => { setMode('sellingPrice'); setValue(Math.ceil(unitCost * 1.6)); }}>ระบุราคาเอง</button>
              </div>
              <div style={{ marginTop: 14 }}>
                <label className="fcx-field">
                  {mode === 'sellingPrice' ? 'ราคาขายต่อหน่วย (บาท)' : mode === 'marginPercent' ? 'อัตรากำไร Margin (%)' : 'อัตราบวกเพิ่ม Markup (%)'}
                  <input type="number" min="0" step="any" value={value} onChange={(e) => setValue(Number(e.target.value))} />
                </label>
                {mode !== 'sellingPrice' && (
                  <input type="range" min="0" max={mode === 'marginPercent' ? 90 : 300} value={value} onChange={(e) => setValue(Number(e.target.value))} style={{ width: '100%', marginTop: 12 }} aria-label="ปรับค่า" />
                )}
              </div>
            </section>

            {/* วิเคราะห์กำไร */}
            <section className="card card-pad">
              <h3 className="form-section-title"><TrendingUp aria-hidden />วิเคราะห์กำไร</h3>
              <div className="fcx-result" style={{ marginTop: 6 }}>
                <div><div className="k">กำไรต่อหน่วย</div><div className="v" style={{ color: pricing.isLoss ? 'var(--danger)' : 'var(--success)' }}>{formatMoney(pricing.profit, 2)}</div></div>
                <div><div className="k">Margin</div><div className="v">{pricing.marginPercent.toFixed(1)}%</div></div>
                <div><div className="k">Markup</div><div className="v">{pricing.markupPercent.toFixed(1)}%</div></div>
              </div>
              <div style={{ marginTop: 16 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <span>margin</span><span>{marginPct.toFixed(1)}%</span>
                </div>
                <div className="fcx-meter"><i style={{ width: `${Math.max(0, Math.min(100, marginPct))}%` }} /></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-subtle)', marginTop: 4 }}>
                  <span>0%</span><span>ต่ำ</span><span>ดี</span><span>ดีมาก</span>
                </div>
              </div>
            </section>

            {/* เทียบราคาหลายช่องทาง */}
            <section className="card card-pad">
              <h3 className="form-section-title"><CircleDollarSign aria-hidden />เทียบราคาหลายช่องทาง</h3>
              <p className="form-section-sub">อ้างอิงจากราคาหน้าร้านที่คำนวณได้ ปรับสัดส่วนตามช่องทางขายจริงได้</p>
              <div className="fcx-tiers">
                {tiers.map((t, i) => (
                  <div className={`fcx-tier${i === 0 ? ' reco' : ''}`} key={t.key}>
                    <h4><t.icon aria-hidden width={16} />{t.label}{i === 0 && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--gold)' }}>แนะนำ</span>}</h4>
                    <div className="price">{formatMoney(t.price, 0)}</div>
                    <div className={`mgn ${t.margin >= 0 ? 'up' : 'down'}`}>margin {t.margin.toFixed(1)}% · กำไร {formatMoney(t.profit, 2)}</div>
                    <button className="btn" style={{ width: '100%', marginTop: 12, justifyContent: 'center' }} disabled={saving} onClick={() => void save(t.key, t.price)}>
                      <Save aria-hidden />บันทึกราคานี้
                    </button>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* Sidebar */}
          <div className="fcx-sticky" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="card card-pad">
              <h3 className="form-section-title"><Calculator aria-hidden />สรุป</h3>
              <div className="cp-row"><span>ต้นทุนต่อหน่วย</span><strong>{formatMoney(unitCost, 2)}</strong></div>
              <div className="cp-row"><span>ต้นทุนรวม/batch</span><strong>{formatMoney(cost.totalCost, 2)}</strong></div>
              <div className="cp-row big"><span>ราคาขายแนะนำ</span><strong>{formatMoney(pricing.sellingPrice, 2)}</strong></div>
            </section>

            <section className="card card-pad">
              <h3 className="form-section-title"><Lightbulb aria-hidden />คำแนะนำ</h3>
              <div className="fcx-insights" style={{ marginTop: 4 }}>
                {recommendations.map((r, i) => (
                  <div className={`fcx-insight ${r.tone === 'good' ? 'good' : r.tone === 'bad' ? 'bad' : 'warn'}`} key={i}>
                    <span className="ic">{r.tone === 'good' ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}</span>
                    <span style={{ alignSelf: 'center' }}>{r.text}</span>
                  </div>
                ))}
                {recommendations.length === 0 && <p className="subtle" style={{ fontSize: 13 }}>ปรับราคาเพื่อดูคำแนะนำ</p>}
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
