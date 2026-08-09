import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Calculator, AlertTriangle, PackageX, Boxes, Info, Layers, CircleDollarSign,
} from 'lucide-react';
import { catalogApi, type CostBreakdown, type RecipeDetail } from '@/lib/catalog';
import { formatMoney } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';

const SEGMENTS: { key: keyof CostBreakdown; label: string; color: string }[] = [
  { key: 'materialCost', label: 'วัตถุดิบ', color: '#1677c8' },
  { key: 'packagingCost', label: 'บรรจุภัณฑ์', color: '#c6a15b' },
  { key: 'laborCost', label: 'ค่าแรง', color: '#7fb3dd' },
  { key: 'utilityCost', label: 'แก๊ส/ไฟ/น้ำ', color: '#35b6d6' },
  { key: 'overheadCost', label: 'Overhead', color: '#8b7fd0' },
  { key: 'wasteCost', label: 'ของเสีย', color: '#e08a8a' },
  { key: 'otherCost', label: 'อื่น ๆ', color: '#94a3b8' },
];

export default function CostingWorkspacePage() {
  const recipes = useQuery({ queryKey: ['recipes'], queryFn: () => catalogApi.recipes() });
  const [recipeId, setRecipeId] = useState('');
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [versionId, setVersionId] = useState('');
  const [cost, setCost] = useState<CostBreakdown | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    if (!versionId) { setCost(null); return; }
    let alive = true;
    setLoading(true); setError('');
    catalogApi.calculate({ recipeVersionId: versionId })
      .then((r) => { if (alive) setCost(r.breakdown); })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : 'คำนวณไม่สำเร็จ'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [versionId]);

  const version = recipe?.versions.find((v) => v.id === versionId);
  const segs = useMemo(() => {
    if (!cost) return [];
    return SEGMENTS.map((s) => ({ ...s, value: Number(cost[s.key]) || 0 })).filter((s) => s.value > 0);
  }, [cost]);
  const segTotal = segs.reduce((a, b) => a + b.value, 0);

  // ตรวจข้อมูลที่ขาด
  const missing: string[] = [];
  if (version) {
    const hasPackaging = version.ingredients.some((i) => i.item?.type === 'PACKAGING');
    if (!hasPackaging) missing.push('ยังไม่ได้ใส่บรรจุภัณฑ์ในสูตร (ต้นทุนต่อกล่องอาจต่ำกว่าจริง)');
    const noPrice = version.ingredients.filter((i) => i.item && i.item.lastCost <= 0).map((i) => i.item?.name).filter(Boolean);
    if (noPrice.length) missing.push(`ยังไม่มีราคาซื้อของ: ${noPrice.slice(0, 3).join(', ')}${noPrice.length > 3 ? ' …' : ''}`);
    if ((cost?.laborCost ?? 0) === 0 && (cost?.overheadCost ?? 0) === 0) missing.push('ยังไม่ได้ใส่ค่าแรง/ค่าโสหุ้ย (Overhead) ในเวอร์ชันสูตร');
  }

  const donutGradient = useMemo(() => {
    if (!segTotal) return 'conic-gradient(var(--surface-muted) 0 100%)';
    let acc = 0;
    const stops = segs.map((s) => {
      const start = (acc / segTotal) * 360; acc += s.value;
      const end = (acc / segTotal) * 360;
      return `${s.color} ${start.toFixed(1)}deg ${end.toFixed(1)}deg`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [segs, segTotal]);

  return (
    <>
      <div className="fcx-hero">
        <div className="fcx-hero-row">
          <div>
            <p className="eyebrow">จัดการเมนูและต้นทุน</p>
            <h1>คำนวณต้นทุน</h1>
            <p>เลือกสูตรและเวอร์ชัน ระบบจะดึงต้นทุนจริงจากวัตถุดิบและบรรจุภัณฑ์ แล้วแยกให้เห็นทุกหมวด</p>
          </div>
          <Link to="/pricing" className="qa-btn gold"><CircleDollarSign aria-hidden />ไปตั้งราคาขาย</Link>
        </div>
      </div>

      {/* Selector */}
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
          <EmptyState icon={Calculator} title="เลือกสูตรเพื่อเริ่มคำนวณต้นทุน"
            description={recipes.data && recipes.data.length === 0 ? 'ยังไม่มีสูตรในระบบ — สร้างสูตรเมนูก่อน' : 'เลือกสูตรจากช่องด้านบน ระบบจะคำนวณต้นทุนต่อจานให้ทันที'}
            action={recipes.data && recipes.data.length === 0 ? <Link to="/recipes" className="btn primary">สร้างสูตร</Link> : undefined} />
        </section>
      )}

      {recipeId && cost && version && (
        <div className="fcx-2col" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {missing.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {missing.map((m) => (
                  <div className="fcx-missing" key={m}><AlertTriangle aria-hidden /><span>{m}</span></div>
                ))}
              </div>
            )}

            <section className="card card-pad">
              <h3 className="form-section-title"><Layers aria-hidden />ต้นทุนแยกหมวด</h3>
              <p className="form-section-sub">ต้นทุนรวมต่อ batch (ได้ {formatMoney(cost.effectiveYield, 2)} หน่วย)</p>
              <div className="fcx-breakdown">
                {SEGMENTS.map((s) => {
                  const val = Number(cost[s.key]) || 0;
                  const pct = segTotal ? (val / segTotal) * 100 : 0;
                  return (
                    <div className="fcx-brk" key={s.key}>
                      <span className="name"><span className="dot" style={{ background: s.color }} />{s.label}</span>
                      <span className="track"><i style={{ width: `${pct}%`, background: s.color }} /></span>
                      <span className="amt">{formatMoney(val, 2)}</span>
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card card-pad">
              <h3 className="form-section-title"><Boxes aria-hidden />รายการในสูตร</h3>
              <div className="table-wrap">
                <table className="data-table">
                  <thead><tr><th>รายการ</th><th>ประเภท</th><th className="num">ปริมาณ</th><th className="num">ต้นทุน/หน่วย</th><th className="num">รวม</th></tr></thead>
                  <tbody>
                    {version.ingredients.map((ing) => (
                      <tr key={ing.id}>
                        <td><strong>{ing.item?.name ?? '—'}</strong></td>
                        <td>{ing.item?.type === 'PACKAGING' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}</td>
                        <td className="num">{formatMoney(ing.quantityBase, 2)} {ing.item?.baseUnitCode ?? ''}</td>
                        <td className="num">{ing.item && ing.item.lastCost > 0 ? formatMoney(ing.item.lastCost, 4) : <span style={{ color: 'var(--warning)' }}>ไม่มีราคา</span>}</td>
                        <td className="num">{formatMoney(ing.lineCost, 2)}</td>
                      </tr>
                    ))}
                    {version.ingredients.length === 0 && (
                      <tr><td colSpan={5}><span className="subtle" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><PackageX width={15} aria-hidden />สูตรนี้ยังไม่มีรายการวัตถุดิบ</span></td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          {/* Sidebar summary */}
          <div className="fcx-sticky" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <section className="card card-pad">
              <h3 className="form-section-title"><Calculator aria-hidden />สัดส่วนต้นทุน</h3>
              <div className="fcx-donut-wrap" style={{ marginTop: 6 }}>
                <div className="fcx-donut" style={{ background: donutGradient }}>
                  <div className="center"><b>{formatMoney(cost.totalCost, 0)}</b><span>ต่อ batch</span></div>
                </div>
                <div className="fcx-legend" style={{ flex: 1 }}>
                  {segs.map((s) => (
                    <div key={s.key}><i style={{ background: s.color }} />{s.label}<b>{segTotal ? ((s.value / segTotal) * 100).toFixed(0) : 0}%</b></div>
                  ))}
                  {segs.length === 0 && <span className="subtle" style={{ fontSize: 13 }}>ยังไม่มีต้นทุน</span>}
                </div>
              </div>
            </section>

            <section className="card card-pad">
              <div className="fcx-result hi">
                <div className="primary"><div className="k">ต้นทุนรวม/batch</div><div className="v">{formatMoney(cost.totalCost, 2)}</div></div>
                <div><div className="k">ต่อหน่วย</div><div className="v">{formatMoney(cost.unitCost, 2)}</div></div>
                <div><div className="k">Yield</div><div className="v">{formatMoney(cost.effectiveYield, 0)}</div></div>
              </div>
              {loading && <p className="subtle" style={{ fontSize: 12, marginTop: 8, textAlign: 'center' }}>กำลังคำนวณ…</p>}
              <Link to="/pricing" className="btn primary" style={{ width: '100%', marginTop: 14, justifyContent: 'center' }}>
                <CircleDollarSign aria-hidden />ตั้งราคาขายจากต้นทุนนี้
              </Link>
            </section>

            <div className="fcx-missing" style={{ background: 'var(--blue-soft)', borderColor: '#cfe1f3', color: 'var(--blue)' }}>
              <Info aria-hidden /><span>ต้นทุนดึงจากราคาซื้อล่าสุดของวัตถุดิบและบรรจุภัณฑ์แบบเรียลไทม์</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
