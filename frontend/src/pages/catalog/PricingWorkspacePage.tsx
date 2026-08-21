import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CircleDollarSign, TrendingUp, Percent, Store, Bike, Boxes, Save,
  Lightbulb, AlertTriangle, CheckCircle2, Calculator, Pencil,
} from 'lucide-react';
import { catalogApi, type CostBreakdown, type PricingResult, type RecipeDetail } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard, StickySummary } from '@/components/layout/page';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';
import { analyzePrice, priceFromMargin, priceFromMarkup } from '@/lib/cost-sheet';

type Mode = 'marginPercent' | 'markupPercent' | 'sellingPrice';
/** 3 ระดับราคา — ใช้ค่า priceType เดิมใน SellingPrice จึงไม่ต้องทำ migration */
const TIERS = [
  { key: 'RETAIL' as const, label: 'ราคาปลีก', icon: Store, defaultMargin: 40 },
  { key: 'WHOLESALE' as const, label: 'ราคาส่ง', icon: Boxes, defaultMargin: 29.4 },
  { key: 'AGENT' as const, label: 'ราคาคนรู้จัก', icon: Bike, defaultMargin: 21.6 },
];
type TierKey = (typeof TIERS)[number]['key'];
type TierState = { mode: Mode; value: number };

/** คำนวณราคา/กำไรของหนึ่งระดับราคา — ใช้สูตรกลางเดียวกับ backend ไม่สร้าง logic ใหม่ */
function tierResultFor(st: TierState, unitCost: number) {
  const price = st.mode === 'sellingPrice' ? st.value
    : st.mode === 'marginPercent' ? priceFromMargin(unitCost, st.value)
    : priceFromMarkup(unitCost, st.value);
  return analyzePrice(unitCost, price);
}

export default function PricingWorkspacePage() {
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: () => catalogApi.recipes() });
  const { toast } = useToast();
  const { user } = useAuth();
  const qc = useQueryClient();
  // backend เป็นผู้ตัดสินสิทธิ์จริง (POST /costing/price ใช้ PRICING_EDIT) — ที่นี่แค่ซ่อน UI ให้ตรงกัน
  const canEditPricing = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('PRICING_EDIT'));
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
  /**
   * ค่าที่แสดงสด — ใช้สูตรกลางเดียวกับ backend (lib/cost-sheet) ไม่สร้าง pricing logic ใหม่
   * แก้ค่าใดค่าหนึ่ง อีกสองค่าจะคำนวณตามทันที เช่น ต้นทุน 100 + margin 40% → ราคา 166.67, กำไร 66.67, markup 66.67%
   */
  const live = useMemo(() => {
    const price = mode === 'sellingPrice' ? value
      : mode === 'marginPercent' ? priceFromMargin(unitCost, value)
      : priceFromMarkup(unitCost, value);
    return analyzePrice(unitCost, price);
  }, [mode, value, unitCost]);
  // ต้นทุนต่อหน่วยขาย (ต่อ portion ถ้ามี ไม่งั้นต่อหน่วยผลผลิต) — ฐานเดียวกับ Recipe Builder
  const unitLabel = recipe?.versions.find((v) => v.id === versionId)?.portionUnit || 'หน่วย';
  const [tierState, setTierState] = useState<Record<TierKey, TierState>>({
    RETAIL: { mode: 'marginPercent', value: 40 },
    WHOLESALE: { mode: 'marginPercent', value: 29.4 },
    AGENT: { mode: 'marginPercent', value: 21.6 },
  });
  const setTierMode = (key: TierKey, m: Mode) => setTierState((prev) => {
    const r = tierResultFor(prev[key], unitCost);
    const next = m === 'sellingPrice' ? Number(r.sellingPrice.toFixed(2)) : m === 'marginPercent' ? Number(r.marginPercent.toFixed(2)) : Number(r.markupPercent.toFixed(2));
    return { ...prev, [key]: { mode: m, value: next } };
  });
  const setTierValue = (key: TierKey, v: number) => setTierState((prev) => ({ ...prev, [key]: { ...prev[key], value: v } }));
  const tierResult = (key: TierKey) => tierResultFor(tierState[key], unitCost);

  // โหลดราคาที่บันทึกไว้ของเมนูนี้ มาเป็นค่าเริ่มต้นของแต่ละระดับ
  const savedPrices = useQuery({
    queryKey: ['selling-prices', recipe?.product.id],
    queryFn: () => catalogApi.sellingPrices(recipe!.product.id),
    enabled: Boolean(recipe?.product.id),
  });
  useEffect(() => {
    const rows = savedPrices.data;
    if (!rows?.length) return;
    setTierState((prev) => {
      const next = { ...prev };
      for (const row of rows) {
        const key = row.priceType as TierKey;
        if (key in next && row.price > 0) next[key] = { mode: 'sellingPrice', value: row.price };
      }
      return next;
    });
  }, [savedPrices.data]);

  const saveTier = async (key: TierKey) => {
    if (!recipe) return;
    const r = tierResult(key);
    if (r.sellingPrice <= 0) { toast('ราคาขายต้องมากกว่า 0', 'error'); return; }
    setSaving(true);
    try {
      await catalogApi.savePrice({ itemId: recipe.product.id, priceType: key, price: r.sellingPrice, marginPercent: r.marginPercent, markupPercent: r.markupPercent });
      await qc.invalidateQueries({ queryKey: ['selling-prices', recipe.product.id] });
      await qc.invalidateQueries({ queryKey: ['menus'] });
      toast(`บันทึก${TIERS.find((t) => t.key === key)?.label ?? ''}แล้ว`);
    } catch (e) { toast(e instanceof Error ? e.message : 'บันทึกราคาไม่สำเร็จ', 'error'); }
    finally { setSaving(false); }
  };

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

  const marginPct = pricing?.marginPercent ?? 0;

  return (
    <PageContainer size="wide" className="pricing-page">
      <PageHeader
        breadcrumb="จัดการเมนูและต้นทุน"
        title="ราคาขายและกำไร"
        description="ตั้งราคาขายจากต้นทุนจริง เลือกวิธีคิดราคา แล้วเทียบราคาหลายช่องทางพร้อมกำไร"
        meta={<>
          {recipe && <span>{recipe.name}</span>}
          {cost && <span>ต้นทุนต่อหน่วย {formatMoney(unitCost, 2)} / {unitLabel}</span>}
        </>}
        actions={<>
          {recipeId && <Link to={`/recipes/${recipeId}`} className="btn"><Pencil aria-hidden width={16} />แก้สูตร</Link>}
          <Link to="/costing" className="btn primary"><Calculator aria-hidden width={16} />ดูรายละเอียดต้นทุน</Link>
        </>}
      />

      <FilterBar>
        <label className="s2-field">เลือกสูตร / เมนู
          <select value={recipeId} onChange={(e) => void selectRecipe(e.target.value)}>
            <option value="">— เลือกสูตร —</option>
            {recipes.data?.map((r) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
          </select>
        </label>
        <label className="s2-field">เวอร์ชันสูตร
          <select value={versionId} onChange={(e) => setVersionId(e.target.value)} disabled={!recipe}>
            {!recipe && <option value="">— เลือกสูตรก่อน —</option>}
            {recipe?.versions.map((v) => <option key={v.id} value={v.id}>เวอร์ชัน {v.versionNo}{v.isActive ? ' (ใช้งาน)' : ''}</option>)}
          </select>
        </label>
      </FilterBar>

      {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

      {!recipeId && !recipes.isLoading && (
        <ContentCard>
          <EmptyState icon={CircleDollarSign} title="ยังไม่ได้ตั้งราคาขาย"
            description={recipes.data && recipes.data.length === 0 ? 'ยังไม่มีสูตรในระบบ — สร้างสูตรเมนูก่อน' : 'เลือกสูตร แล้วกำหนดวิธีคิดราคาเพื่อดูกำไรและ margin'}
            action={recipes.data && recipes.data.length === 0 ? <Link to="/recipes/new" className="btn primary">สร้างสูตร</Link> : undefined} />
        </ContentCard>
      )}

      {recipeId && cost && pricing && <>
        {/* ยึดต้นทุนไว้บนสุด ให้เห็นก่อนตัดสินใจตั้งราคา */}
        <KPIGrid columns={4}>
          <KPICard
            label="ต้นทุนต่อหน่วย"
            value={`${formatMoney(unitCost, 2)}`}
            icon={<Calculator />}
            tone="info"
            hint={`ต่อ 1 ${unitLabel}`}
          />
          {TIERS.map((t) => {
            const c = tierResult(t.key);
            return (
              <KPICard
                key={t.key}
                label={t.label}
                value={`${formatMoney(c.sellingPrice, 2)}`}
                icon={<t.icon />}
                tone={c.isLoss ? 'danger' : 'default'}
                hint={c.isLoss
                  ? `ต่ำกว่าทุน ${formatMoney(unitCost - c.sellingPrice, 2)}`
                  : `กำไร ${formatMoney(c.profit, 2)} · ${c.marginPercent.toFixed(1)}%`}
              />
            );
          })}
        </KPIGrid>
        <div className="pricing-grid">
          <div className="pricing-main">
            {/* วิธีคิดราคา */}
            <section className="card card-pad">
              <h3 className="form-section-title"><Percent aria-hidden />ราคาขายและกำไร</h3>
              <p className="form-section-sub">
                {canEditPricing
                  ? 'เลือกช่องที่ต้องการกำหนด แล้วแก้ไขค่าได้ทันที — อีกสองค่าจะคำนวณให้อัตโนมัติ'
                  : 'คุณมีสิทธิ์ดูอย่างเดียว (ต้องมีสิทธิ์ PRICING_EDIT จึงจะแก้ราคาได้)'}
              </p>

              <div className="pricing-edit">
                <div className="pricing-modes" role="group" aria-label="โหมดคำนวณราคา">
                  <button type="button" className={mode === 'sellingPrice' ? 'active' : ''} disabled={!canEditPricing}
                    onClick={() => { setMode('sellingPrice'); setValue(Number(live.sellingPrice.toFixed(2))); }}>ราคาขาย</button>
                  <button type="button" className={mode === 'marginPercent' ? 'active' : ''} disabled={!canEditPricing}
                    onClick={() => { setMode('marginPercent'); setValue(Number(live.marginPercent.toFixed(2))); }}>Margin %</button>
                  <button type="button" className={mode === 'markupPercent' ? 'active' : ''} disabled={!canEditPricing}
                    onClick={() => { setMode('markupPercent'); setValue(Number(live.markupPercent.toFixed(2))); }}>Markup %</button>
                </div>

                {/* ช่องที่เลือกเป็นตัวกำหนด ส่วนอีกสองช่องเป็นค่าที่คำนวณได้ (แสดงเป็น derived) */}
                <div className="pricing-fields">
                  <label>ราคาขายต่อหน่วย (฿)
                    <input type="number" min="0" step="0.01" aria-label="ราคาขายต่อหน่วย"
                      className={mode === 'sellingPrice' ? '' : 'derived'}
                      value={mode === 'sellingPrice' ? value : Number(live.sellingPrice.toFixed(2))}
                      disabled={!canEditPricing || mode !== 'sellingPrice'}
                      onChange={(e) => setValue(Number(e.target.value))} />
                  </label>
                  <label>Margin (%)
                    <input type="number" min="0" max="99.99" step="0.01" aria-label="Margin"
                      className={mode === 'marginPercent' ? '' : 'derived'}
                      value={mode === 'marginPercent' ? value : Number(live.marginPercent.toFixed(2))}
                      disabled={!canEditPricing || mode !== 'marginPercent'}
                      onChange={(e) => setValue(Number(e.target.value))} />
                  </label>
                  <label>Markup (%)
                    <input type="number" min="0" step="0.01" aria-label="Markup"
                      className={mode === 'markupPercent' ? '' : 'derived'}
                      value={mode === 'markupPercent' ? value : Number(live.markupPercent.toFixed(2))}
                      disabled={!canEditPricing || mode !== 'markupPercent'}
                      onChange={(e) => setValue(Number(e.target.value))} />
                  </label>
                </div>

                {canEditPricing && mode !== 'sellingPrice' && (
                  <input type="range" min="0" max={mode === 'marginPercent' ? 90 : 300} value={value}
                    onChange={(e) => setValue(Number(e.target.value))} aria-label="ปรับค่า" />
                )}

                <div className="pricing-result">
                  <div><span>ต้นทุนต่อหน่วย</span><b>{formatMoney(unitCost, 2)}</b></div>
                  <div><span>ราคาขาย</span><b>{formatMoney(live.sellingPrice, 2)}</b></div>
                  <div className={live.isLoss ? 'loss' : ''}><span>{live.isLoss ? 'ขาดทุนต่อหน่วย' : 'กำไรต่อหน่วย'}</span>
                    <b>{formatMoney(Math.abs(live.profit), 2)}</b></div>
                </div>

                {live.isLoss && <div className="loss-warning" role="alert">
                  <AlertTriangle aria-hidden />
                  <div><strong>ราคาขายต่ำกว่าต้นทุน</strong>
                    <span>ต้นทุน {formatMoney(unitCost, 2)} · ราคาขาย {formatMoney(live.sellingPrice, 2)} · ขาดทุนต่อหน่วย {formatMoney(unitCost - live.sellingPrice, 2)}</span>
                  </div>
                </div>}

                {!canEditPricing && <p className="pricing-readonly">ต้องมีสิทธิ์ <b>PRICING_EDIT</b> จึงจะแก้ไขและบันทึกราคาขายได้ · การบันทึกถูกตรวจสอบสิทธิ์ที่เซิร์ฟเวอร์อีกชั้น</p>}
              </div>
            </section>

            {/* วิเคราะห์กำไร */}
            <section className="card card-pad">
              <h3 className="form-section-title"><TrendingUp aria-hidden />วิเคราะห์กำไร</h3>
              <div className="fcx-result profit-result">
                <div><div className="k">กำไรต่อหน่วย</div><div className={`v ${pricing.isLoss ? 'is-loss' : 'is-profit'}`}>{formatMoney(pricing.profit, 2)}</div></div>
                <div><div className="k">Margin</div><div className="v">{pricing.marginPercent.toFixed(1)}%</div></div>
                <div><div className="k">Markup</div><div className="v">{pricing.markupPercent.toFixed(1)}%</div></div>
              </div>
              <div className="margin-meter">
                <div className="mm-head">
                  <span>margin</span><span>{marginPct.toFixed(1)}%</span>
                </div>
                <div className="fcx-meter"><i style={{ width: `${Math.max(0, Math.min(100, marginPct))}%` }} /></div>
                <div className="mm-scale">
                  <span>0%</span><span>ต่ำ</span><span>ดี</span><span>ดีมาก</span>
                </div>
              </div>
            </section>

            {/* เทียบราคาหลายช่องทาง */}
            <section className="card card-pad">
              <h3 className="form-section-title"><CircleDollarSign aria-hidden />เทียบราคาหลายช่องทาง</h3>
              <p className="form-section-sub">อ้างอิงจากราคาหน้าร้านที่คำนวณได้ ปรับสัดส่วนตามช่องทางขายจริงได้</p>
              <div className="tier-grid">
                {TIERS.map((def) => {
                  const st = tierState[def.key];
                  const calc = tierResult(def.key);
                  return (
                    <article className={`tier-card${calc.isLoss ? ' loss' : ''}`} key={def.key}>
                      <h4><def.icon aria-hidden width={16} />{def.label}</h4>
                      <div className="tier-price">{formatMoney(calc.sellingPrice, 2)} <small>/ {unitLabel}</small></div>
                      <ul className="tier-stats">
                        <li><span>{calc.isLoss ? 'ขาดทุน/หน่วย' : 'กำไร/หน่วย'}</span><b>{formatMoney(Math.abs(calc.profit), 2)}</b></li>
                        <li><span>กำไรเทียบราคาขาย</span><b>{calc.marginPercent.toFixed(2)}%</b></li>
                        <li><span>กำไรบวกจากต้นทุน</span><b>{calc.markupPercent.toFixed(2)}%</b></li>
                      </ul>

                      <div className="pricing-modes" role="group" aria-label={`วิธีคิดราคา ${def.label}`}>
                        {(['sellingPrice', 'marginPercent', 'markupPercent'] as const).map((m) => (
                          <button type="button" key={m} className={st.mode === m ? 'active' : ''} disabled={!canEditPricing}
                            onClick={() => setTierMode(def.key, m)}>
                            {m === 'sellingPrice' ? 'ราคาขาย' : m === 'marginPercent' ? 'Margin' : 'Markup'}
                          </button>
                        ))}
                      </div>
                      <label className="tier-input">{st.mode === 'sellingPrice' ? 'ราคาขาย (฿)' : st.mode === 'marginPercent' ? 'Margin (%)' : 'Markup (%)'}
                        <input type="number" min="0" step="0.01" aria-label={`${def.label} ${st.mode}`} value={st.value}
                          disabled={!canEditPricing}
                          onChange={(e) => setTierValue(def.key, Number(e.target.value))} />
                      </label>

                      {calc.isLoss && <p className="tier-warn" role="alert">
                        <AlertTriangle aria-hidden width={14} />ราคานี้ต่ำกว่าต้นทุน · ขาดทุน {formatMoney(unitCost - calc.sellingPrice, 2)}/{unitLabel}
                      </p>}

                      <button className="btn tier-save"
                        disabled={saving || !canEditPricing} onClick={() => void saveTier(def.key)}>
                        <Save aria-hidden />บันทึกราคานี้
                      </button>
                    </article>
                  );
                })}
              </div>
              <p className="field-hint">ต้นทุนต่อหน่วยที่ใช้เปรียบเทียบ: {formatMoney(unitCost, 2)} / {unitLabel} · ราคาที่บันทึกแล้วจะถูกบันทึกเป็นสแนปช็อตในออเดอร์ ไม่เปลี่ยนย้อนหลัง</p>
            </section>

            {/* เทียบทุกระดับในมุมเดียว — ตัวเลขทั้งหมดมาจาก tierResult ชุดเดิม ไม่ได้คิดใหม่ */}
            <ContentCard title="ตารางเทียบราคา" description="ดูทุกระดับราคาพร้อมกันเพื่อเลือกให้เหมาะกับช่องทางขาย" padded={false}>
              <div className="table-wrap">
                <table className="data-table price-compare">
                  <thead>
                    <tr>
                      <th>ระดับราคา</th>
                      <th className="num">ราคาขาย</th>
                      <th className="num">กำไร/หน่วย</th>
                      <th className="num">กำไรเทียบราคาขาย</th>
                      <th className="num">กำไรบวกจากต้นทุน</th>
                      <th>สถานะ</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="pc-cost">
                      <td data-label="ระดับราคา"><strong>ต้นทุนต่อหน่วย</strong></td>
                      <td className="num" data-label="ราคาขาย">{formatMoney(unitCost, 2)}</td>
                      <td className="num" colSpan={3} data-label="หมายเหตุ">เกณฑ์เปรียบเทียบ</td>
                      <td data-label="สถานะ">—</td>
                    </tr>
                    {TIERS.map((t) => {
                      const c = tierResult(t.key);
                      return (
                        <tr key={t.key} className={c.isLoss ? 'is-loss' : undefined}>
                          <td data-label="ระดับราคา"><strong>{t.label}</strong></td>
                          <td className="num" data-label="ราคาขาย">{formatMoney(c.sellingPrice, 2)}</td>
                          <td className="num" data-label="กำไร/หน่วย">{formatMoney(c.profit, 2)}</td>
                          <td className="num" data-label="กำไรเทียบราคาขาย">{c.marginPercent.toFixed(2)}%</td>
                          <td className="num" data-label="กำไรบวกจากต้นทุน">{c.markupPercent.toFixed(2)}%</td>
                          <td data-label="สถานะ">
                            {c.isLoss
                              ? <span className="badge danger"><AlertTriangle aria-hidden width={12} />ต่ำกว่าทุน</span>
                              : <span className="badge success"><CheckCircle2 aria-hidden width={12} />มีกำไร</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="price-glossary">
                <p><b>กำไรเทียบราคาขาย (Margin)</b> คือกำไรคิดเป็นเปอร์เซ็นต์ของ<b>ราคาขาย</b> — ขายได้ 100 บาท เหลือกำไรกี่บาท</p>
                <p><b>กำไรบวกจากต้นทุน (Markup)</b> คือกำไรที่บวกเพิ่มจาก<b>ต้นทุน</b> — ต้นทุน 100 บาท บวกไปกี่เปอร์เซ็นต์</p>
              </div>
            </ContentCard>
          </div>

          <StickySummary className="pricing-summary">
            <section className="card card-pad">
              <h3 className="form-section-title"><Calculator aria-hidden />สรุป</h3>
              <div className="cs-hero">
                <span>ต้นทุนต่อหน่วย</span>
                <strong className="num">{formatMoney(unitCost, 2)}</strong>
              </div>
              <div className="cp-row"><span>ต้นทุนรวม/batch</span><strong>{formatMoney(cost.totalCost, 2)}</strong></div>
              <hr />
              {TIERS.map((t) => {
                const c = tierResult(t.key);
                return (
                  <div className={`cp-row${c.isLoss ? ' loss' : ''}`} key={t.key}>
                    <span>{t.label}</span>
                    <strong>{formatMoney(c.sellingPrice, 2)}</strong>
                  </div>
                );
              })}
              {(() => {
                const results = TIERS.map((t) => tierResult(t.key));
                const losses = results.filter((r) => r.isLoss).length;
                const profits = results.map((r) => r.profit);
                return (
                  <div className="cp-foot">
                    <div className="cp-row"><span>กำไรสูงสุด/ต่ำสุด</span>
                      <strong>{formatMoney(Math.max(...profits), 2)} / {formatMoney(Math.min(...profits), 2)}</strong></div>
                    {losses > 0
                      ? <p className="cp-warn" role="status"><AlertTriangle aria-hidden width={15} />มี {losses} ระดับราคาที่ต่ำกว่าต้นทุน</p>
                      : <p className="cp-ok" role="status"><CheckCircle2 aria-hidden width={15} />ทุกระดับราคามีกำไร</p>}
                  </div>
                );
              })()}
            </section>

            <section className="card card-pad">
              <h3 className="form-section-title"><Lightbulb aria-hidden />คำแนะนำ</h3>
              <div className="fcx-insights">
                {recommendations.map((r, i) => (
                  <div className={`fcx-insight ${r.tone === 'good' ? 'good' : r.tone === 'bad' ? 'bad' : 'warn'}`} key={i}>
                    <span className="ic">{r.tone === 'good' ? <CheckCircle2 aria-hidden /> : <AlertTriangle aria-hidden />}</span>
                    <span className="insight-text">{r.text}</span>
                  </div>
                ))}
                {recommendations.length === 0 && <p className="subtle insight-empty">ปรับราคาเพื่อดูคำแนะนำ</p>}
              </div>
            </section>
          </StickySummary>
        </div>
      </>}
    </PageContainer>
  );
}
