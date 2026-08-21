import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Calculator, AlertTriangle, PackageX, Boxes, Layers, CircleDollarSign, RefreshCw,
  Check, ChevronDown, Pencil,
} from 'lucide-react';
import { catalogApi, type CostBreakdown, type RecipeDetail } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard, StickySummary, KPISkeleton, CardSkeleton } from '@/components/layout/page';

/** หมวดต้นทุน — สีมาจาก token ของระบบ ไม่ใช่ hex ลอย ๆ */
const SEGMENTS: { key: keyof CostBreakdown; label: string; tone: string }[] = [
  { key: 'materialCost', label: 'วัตถุดิบ', tone: 'blue' },
  { key: 'packagingCost', label: 'บรรจุภัณฑ์', tone: 'gold' },
  { key: 'utilityCost', label: 'สูตรย่อย', tone: 'violet' },
  { key: 'overheadCost', label: 'ค่าใช้จ่ายการผลิตเพิ่มเติม', tone: 'indigo' },
  { key: 'wasteCost', label: 'ของเสีย', tone: 'rose' },
  { key: 'otherCost', label: 'อื่น ๆ', tone: 'slate' },
];

const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : 0);

export default function CostingWorkspacePage() {
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: () => catalogApi.recipes() });
  const [recipeId, setRecipeId] = useState('');
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [versionId, setVersionId] = useState('');
  const [cost, setCost] = useState<CostBreakdown | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [openGroup, setOpenGroup] = useState<string | null>('materialCost');

  const selectRecipe = async (id: string) => {
    setRecipeId(id); setError(''); setCost(null); setRecipe(null); setVersionId('');
    if (!id) return;
    try {
      const d = await catalogApi.recipe(id);
      setRecipe(d);
      const active = d.versions.find((v) => v.isActive) ?? d.versions[0];
      setVersionId(active?.id ?? '');
    } catch (e) { setError(e instanceof Error ? e.message : 'โหลดสูตรไม่สำเร็จ'); }
  };

  // recalcAt: ปุ่ม "คำนวณใหม่" และการเปลี่ยนราคาวัตถุดิบ/สูตร จะดึงต้นทุนใหม่
  const [recalcAt, setRecalcAt] = useState(0);
  const [calculatedAt, setCalculatedAt] = useState<string | null>(null);
  const [versionNo, setVersionNo] = useState<number | null>(null);
  useEffect(() => {
    if (!versionId) { setCost(null); setCalculatedAt(null); return; }
    let alive = true;
    setLoading(true); setError('');
    catalogApi.calculate({ recipeVersionId: versionId })
      .then((r) => { if (alive) { setCost(r.breakdown); setCalculatedAt(r.calculatedAt ?? new Date().toISOString()); setVersionNo(r.versionNo ?? null); } })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'คำนวณไม่สำเร็จ'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [versionId, recalcAt]);

  const version = recipe?.versions.find((v) => v.id === versionId);
  const segs = useMemo(() => {
    if (!cost) return [];
    return SEGMENTS.map((s) => ({ ...s, value: Number(cost[s.key]) || 0 })).filter((s) => s.value > 0);
  }, [cost]);
  const segTotal = segs.reduce((a, b) => a + b.value, 0);

  /** ต้นทุนต่อบรรทัด — สูตรเดิมของหน้านี้ ไม่ได้เปลี่ยนวิธีคิด */
  const lineCost = (ing: NonNullable<typeof version>['components'][number]) =>
    ing.quantity * (ing.item?.lastCost ?? ing.childRecipe?.unitCost ?? 0) * (1 + ing.wastePercent / 100);

  /** รายการในแต่ละหมวด สำหรับ expand ดูรายละเอียด */
  const groupRows = useMemo(() => {
    const rows = version?.components ?? [];
    return {
      materialCost: rows.filter((r) => r.componentType === 'ITEM'),
      packagingCost: rows.filter((r) => r.componentType === 'PACKAGING'),
      utilityCost: rows.filter((r) => r.componentType === 'SUB_RECIPE'),
    } as Record<string, typeof rows>;
  }, [version]);

  // ตรวจข้อมูลที่ขาด — ตรรกะเดิมของหน้านี้ ไม่ได้เพิ่มกฎธุรกิจใหม่
  const missing: string[] = [];
  let hasPackaging = false;
  let noPriceNames: string[] = [];
  if (version) {
    hasPackaging = version.components.some((i) => i.componentType === 'PACKAGING');
    if (!hasPackaging) missing.push('ยังไม่ได้ใส่บรรจุภัณฑ์ในสูตร (ต้นทุนต่อกล่องอาจต่ำกว่าจริง)');
    noPriceNames = version.components.filter((i) => i.item && i.item.lastCost <= 0).map((i) => i.item?.name ?? '').filter(Boolean);
    if (noPriceNames.length) missing.push(`ยังไม่มีราคาซื้อของ: ${noPriceNames.slice(0, 3).join(', ')}${noPriceNames.length > 3 ? ' …' : ''}`);
    if ((cost?.overheadCost ?? 0) === 0) missing.push('ยังไม่ได้ใส่ค่าใช้จ่ายการผลิตเพิ่มเติมในสูตร');
  }

  /** รายการตรวจสอบ — สร้างจาก state เดิมทั้งหมด ไม่มีกฎใหม่ */
  const checks = version && cost ? [
    { ok: cost.effectiveYield > 0, label: 'สูตรมีผลผลิต', detail: `${formatMoney(cost.effectiveYield, 2)} หน่วย` },
    { ok: noPriceNames.length === 0, label: 'วัตถุดิบทุกรายการมีราคาซื้อ', detail: noPriceNames.length ? `ขาด ${noPriceNames.length} รายการ` : 'ครบทุกรายการ' },
    { ok: (cost.utilityCost ?? 0) === 0 || (cost.utilityCost ?? 0) > 0, label: 'สูตรย่อยมีต้นทุน', detail: (cost.utilityCost ?? 0) > 0 ? `${formatMoney(cost.utilityCost, 2)}` : 'ไม่มีสูตรย่อยในสูตรนี้' },
    { ok: hasPackaging, label: 'มีบรรจุภัณฑ์ในสูตร', detail: hasPackaging ? `${formatMoney(cost.packagingCost, 2)}` : 'ยังไม่ได้ใส่' },
    { ok: (cost.overheadCost ?? 0) > 0, label: 'มีค่าใช้จ่ายการผลิตเพิ่มเติม', detail: (cost.overheadCost ?? 0) > 0 ? `${formatMoney(cost.overheadCost, 2)}` : 'ยังไม่ได้ใส่' },
  ] : [];
  const failedChecks = checks.filter((c) => !c.ok).length;

  const overheadPct = cost && cost.totalCost > 0 ? pct(cost.overheadCost, cost.totalCost) : 0;
  const calculatedText = calculatedAt
    ? new Date(calculatedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })
    : null;

  return (
    <PageContainer size="wide" className="costing-page">
      <PageHeader
        breadcrumb="จัดการเมนูและต้นทุน"
        title="คำนวณต้นทุน"
        description="เลือกสูตรและเวอร์ชัน ระบบจะดึงต้นทุนจริงจากวัตถุดิบและบรรจุภัณฑ์ล่าสุด"
        badge={versionNo != null ? <span className="badge info">เวอร์ชัน {versionNo}</span> : undefined}
        meta={<>
          {recipe && <span>{recipe.name}</span>}
          {calculatedText && <span>คำนวณล่าสุด: {calculatedText}</span>}
        </>}
        actions={<>
          {recipeId && <Link to={`/recipes/${recipeId}`} className="btn"><Pencil aria-hidden width={16} />แก้สูตร</Link>}
          <button type="button" className="btn" disabled={loading || !versionId} onClick={() => setRecalcAt(Date.now())}>
            <RefreshCw aria-hidden width={16} />คำนวณใหม่
          </button>
          <Link to="/pricing" className="btn primary"><CircleDollarSign aria-hidden width={16} />ดูราคาขายและกำไร</Link>
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

      {versionId && cost && (
        <p className="costing-note">
          ต้นทุนนี้อ้างอิง<strong>เวอร์ชันที่บันทึกล่าสุด</strong>{versionNo != null ? ` (เวอร์ชัน ${versionNo})` : ''} —
          ใช้ราคาวัตถุดิบและอัตราแปลงหน่วยล่าสุด ไม่รวมการแก้ไขใน Recipe Builder ที่ยังไม่ได้บันทึก
        </p>
      )}

      {!recipeId && !recipes.isLoading && (
        <ContentCard>
          <EmptyState icon={Calculator} title="ยังไม่มีสูตรสำหรับคำนวณต้นทุน"
            description={recipes.data && recipes.data.length === 0 ? 'ยังไม่มีสูตรในระบบ — สร้างสูตรเมนูก่อน' : 'เลือกสูตรจากช่องด้านบนเพื่อเริ่มคำนวณต้นทุน'}
            action={recipes.data && recipes.data.length === 0 ? <Link to="/recipes/new" className="btn primary">สร้างสูตร</Link> : undefined} />
        </ContentCard>
      )}

      {loading && !cost && <><KPISkeleton count={4} /><CardSkeleton lines={5} /></>}

      {recipeId && cost && version && (
        <>
          {/* ตอบ 5 คำถามแรกให้ได้ทันทีที่เปิดหน้า */}
          <KPIGrid columns={4}>
            <KPICard label="ต้นทุนรวมทั้งสูตร" value={`${formatMoney(cost.totalCost, 2)}`} icon={<Calculator />} hint="รวมทุกหมวด" />
            <KPICard label="ผลผลิตที่ได้" value={formatMoney(cost.effectiveYield, 2)} icon={<Boxes />} hint="หน่วยตามสูตร" />
            <KPICard label="ต้นทุนต่อหน่วย" value={`${formatMoney(cost.unitCost, 2)}`} icon={<CircleDollarSign />} tone="info" hint="ตัวเลขที่ใช้ตั้งราคาขาย" />
            <KPICard label="ค่าใช้จ่ายการผลิตเพิ่มเติม" value={`${formatMoney(cost.overheadCost, 2)}`} icon={<Layers />} hint={`${overheadPct.toFixed(1)}% ของต้นทุนรวม`} />
          </KPIGrid>

          <div className="costing-grid">
            <div className="costing-main">
              <ContentCard title="ต้นทุนแยกหมวด" description={`ต้นทุนรวมต่อรอบการผลิต (ได้ ${formatMoney(cost.effectiveYield, 2)} หน่วย)`}>
                <div className="cost-groups">
                  {segs.map((s) => {
                    const share = pct(s.value, segTotal);
                    const rows = groupRows[s.key as string] ?? [];
                    const expandable = rows.length > 0;
                    const open = openGroup === s.key;
                    return (
                      <div className={`cost-group-row${open ? ' is-open' : ''}`} key={s.key}>
                        <button
                          type="button"
                          className="cg-head"
                          aria-expanded={expandable ? open : undefined}
                          disabled={!expandable}
                          onClick={() => expandable && setOpenGroup(open ? null : (s.key as string))}
                        >
                          <span className={`cg-dot tone-${s.tone}`} aria-hidden />
                          <span className="cg-label">{s.label}</span>
                          <span className="cg-bar" aria-hidden><i className={`tone-${s.tone}`} style={{ width: `${share}%` }} /></span>
                          <span className="cg-pct num">{share.toFixed(1)}%</span>
                          <span className="cg-amt num">{formatMoney(s.value, 2)}</span>
                          {expandable && <ChevronDown className="cg-chev" aria-hidden />}
                        </button>
                        {expandable && open && (
                          <ul className="cg-detail">
                            {rows.map((r) => (
                              <li key={r.id}>
                                <span>{r.item?.name ?? r.childRecipe?.name ?? '—'}</span>
                                <b className="num">{formatMoney(lineCost(r), 2)}</b>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    );
                  })}
                  {segs.length === 0 && <p className="subtle">ยังไม่มีต้นทุนในสูตรนี้</p>}
                </div>
              </ContentCard>

              <ContentCard title="รายการในสูตร" description="ทุกบรรทัดที่ประกอบเป็นต้นทุนรวม" padded={false}>
                <div className="table-wrap">
                  <table className="data-table costing-table">
                    <thead>
                      <tr>
                        <th>รายการ</th><th>ประเภท</th>
                        <th className="num">จำนวน</th><th>หน่วย</th>
                        <th className="num">ราคาต่อหน่วย</th><th className="num">ต้นทุน</th><th className="num">% ของต้นทุน</th>
                      </tr>
                    </thead>
                    <tbody>
                      {version.components.map((ing) => {
                        const c = lineCost(ing);
                        const unitPrice = ing.item?.lastCost ?? ing.childRecipe?.unitCost ?? 0;
                        const type = ing.componentType === 'PACKAGING' ? 'บรรจุภัณฑ์' : ing.componentType === 'SUB_RECIPE' ? 'สูตรย่อย' : 'วัตถุดิบ';
                        return (
                          <tr key={ing.id}>
                            <td data-label="รายการ"><strong>{ing.item?.name ?? ing.childRecipe?.name ?? '—'}</strong></td>
                            <td data-label="ประเภท"><span className="badge muted">{type}</span></td>
                            <td className="num" data-label="จำนวน">{formatMoney(ing.quantity, 2)}</td>
                            <td data-label="หน่วย">{ing.item?.baseUnitCode ?? ''}</td>
                            <td className="num" data-label="ราคาต่อหน่วย">
                              {unitPrice > 0 ? formatMoney(unitPrice, 4)
                                : <span className="cost-nowprice"><AlertTriangle aria-hidden width={13} />ไม่มีราคา</span>}
                            </td>
                            <td className="num" data-label="ต้นทุน">{formatMoney(c, 2)}</td>
                            <td className="num" data-label="% ของต้นทุน">{pct(c, cost.totalCost).toFixed(1)}%</td>
                          </tr>
                        );
                      })}
                      {version.components.length === 0 && (
                        <tr><td colSpan={7}><span className="subtle cost-empty-row"><PackageX width={15} aria-hidden />สูตรนี้ยังไม่มีรายการ</span></td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </ContentCard>

              <ContentCard
                title="ตรวจสอบต้นทุน"
                description={failedChecks ? `มี ${failedChecks} จุดที่ควรตรวจก่อนนำไปตั้งราคา` : 'ข้อมูลครบพร้อมนำไปตั้งราคาขาย'}
                actions={recipeId ? <Link to={`/recipes/${recipeId}`} className="btn"><Pencil aria-hidden width={15} />ไปแก้ใน Recipe Builder</Link> : undefined}
              >
                <ul className="cost-checklist">
                  {checks.map((c) => (
                    <li key={c.label} className={c.ok ? 'ok' : 'warn'}>
                      <span className="ck-icon" aria-hidden>{c.ok ? <Check /> : <AlertTriangle />}</span>
                      <span className="ck-label">{c.label}</span>
                      <span className="ck-detail">{c.detail}</span>
                      <span className="ck-state">{c.ok ? 'ผ่าน' : 'ควรตรวจ'}</span>
                    </li>
                  ))}
                </ul>
                {missing.length > 0 && (
                  <ul className="cost-missing">
                    {missing.map((m) => <li key={m}><AlertTriangle aria-hidden width={14} />{m}</li>)}
                  </ul>
                )}
              </ContentCard>
            </div>

            <StickySummary className="costing-summary">
              <div className="cs-panel">
                <h2><Calculator aria-hidden />สรุปต้นทุน</h2>
                <div className="cs-hero">
                  <span>ต้นทุนต่อหน่วย</span>
                  <strong className="num">{formatMoney(cost.unitCost, 2)}</strong>
                </div>
                <div className="cost-row"><span>ต้นทุนรวม</span><b className="num">{formatMoney(cost.totalCost, 2)}</b></div>
                <div className="cost-row"><span>ผลผลิต</span><b className="num">{formatMoney(cost.effectiveYield, 2)}</b></div>
                <hr />
                {segs.map((s) => (
                  <div className="cost-row" key={s.key}>
                    <span><i className={`cg-dot tone-${s.tone}`} aria-hidden /> {s.label}</span>
                    <b className="num">{formatMoney(s.value, 2)}</b>
                  </div>
                ))}
                {loading && <p className="subtle cs-loading">กำลังคำนวณ…</p>}
                <div className="cs-actions">
                  <Link to="/pricing" className="btn primary"><CircleDollarSign aria-hidden />ตั้งราคาขายจากต้นทุนนี้</Link>
                  {recipeId && <Link to={`/recipes/${recipeId}`} className="btn"><Pencil aria-hidden width={15} />แก้สูตร</Link>}
                </div>
              </div>
            </StickySummary>
          </div>
        </>
      )}
    </PageContainer>
  );
}

