import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import {
  UtensilsCrossed, Package, Plus, Trash2, Calculator, Lock, Save, ImageOff,
  Search, X, AlertTriangle, CheckCircle2, TrendingUp, ReceiptText, Sparkles, Loader2,
} from 'lucide-react';
import { catalogApi, type Item, type MenuRow, type RecipeDetail, type Unit } from '@/lib/catalog';
import {
  computeLine, computeSheet, priceFromMargin, priceFromMarkup, analyzePrice, round,
  EMPTY_OPERATING, type SheetLine, type OperatingCost,
} from '@/lib/cost-sheet';
import { formatMoney } from '@/lib/utils';
import { useToast } from '@/components/ui/Toast';

let seq = 0;
const uid = () => `line-${Date.now()}-${seq++}`;

function lineFromItem(item: Item): SheetLine {
  const factor = item.purchaseToBaseFactor > 0 ? item.purchaseToBaseFactor : 1;
  return {
    id: uid(),
    kind: item.type === 'PACKAGING' ? 'packaging' : 'ingredient',
    itemId: item.id,
    name: item.name,
    purchasePrice: item.lastCost > 0 ? round(item.lastCost * factor, 2) : 0,
    purchaseQty: 1,
    purchaseUnit: item.purchaseUnit?.code ?? item.baseUnit?.code ?? 'หน่วย',
    qtyPerPurchase: factor,
    usage: 0,
    baseUnit: item.baseUnit?.code ?? 'หน่วย',
    wastePercent: 0,
  };
}

const OPS_META: { key: keyof OperatingCost; label: string }[] = [
  { key: 'laborCost', label: 'ค่าแรง' }, { key: 'gasCost', label: 'ค่าแก๊ส' },
  { key: 'electricCost', label: 'ค่าไฟ' }, { key: 'waterCost', label: 'ค่าน้ำ' },
  { key: 'overheadCost', label: 'Overhead' }, { key: 'otherCost', label: 'อื่น ๆ' },
];

const SELL_UNITS = ['กล่อง', 'จาน', 'ชิ้น', 'ถ้วย', 'ถุง', 'แก้ว', 'ชุด', 'ห่อ', 'ถาด', 'ที่', 'ขวด', 'ใบ', 'อัน', 'ซอง'];
const CUSTOM_UNIT = '__custom__';

export default function RecipeBuilderPage() {
  const { id, menuId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [menus, setMenus] = useState<MenuRow[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [detail, setDetail] = useState<RecipeDetail | null>(null);
  const [productId, setProductId] = useState(menuId ?? '');
  const [menuMode, setMenuMode] = useState<'existing' | 'new'>(menuId ? 'existing' : 'new');
  const [newMenuName, setNewMenuName] = useState('');
  const [newMenuCode, setNewMenuCode] = useState('');
  const [newMenuUnitId, setNewMenuUnitId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [batchOutput, setBatchOutput] = useState(1);
  const [sellUnit, setSellUnit] = useState('กล่อง');
  const [customUnit, setCustomUnit] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<SheetLine[]>([]);
  const [ops, setOps] = useState<OperatingCost>(EMPTY_OPERATING);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerKind, setPickerKind] = useState<'ingredient' | 'packaging' | null>(null);

  const [priceMode, setPriceMode] = useState<'marginPercent' | 'markupPercent' | 'sellingPrice'>('marginPercent');
  const [priceValue, setPriceValue] = useState(40);

  useEffect(() => {
    void Promise.all([
      catalogApi.menus(),
      catalogApi.units(),
      catalogApi.items({ pageSize: 200, status: 'active' }),
      id ? catalogApi.recipe(id) : Promise.resolve(null),
    ]).then(([menuRows, unitRows, itemRows, recipe]) => {
      setMenus(menuRows);
      setUnits(unitRows.filter((unit) => unit.isActive));
      setNewMenuUnitId((current) => current || unitRows.find((unit) => unit.isActive)?.id || '');
      const usable = itemRows.items.filter((it) => it.type === 'RAW_MATERIAL' || it.type === 'PACKAGING');
      setItems(usable);
      setDetail(recipe);
      if (recipe) {
        const version = recipe.versions.find((v) => v.isActive) ?? recipe.versions[0];
        setProductId(recipe.product.id); setName(recipe.name); setCode(recipe.code);
        if (version) {
          setBatchOutput(version.standardYieldQty || 1);
          setNote(version.note ?? '');
          setOps({
            laborCost: version.laborCost, electricCost: version.electricCost, waterCost: version.waterCost,
            gasCost: version.gasCost, overheadCost: version.overheadCost, wasteCost: 0, otherCost: version.otherCost,
          });
          const map = new Map(usable.map((it) => [it.id, it]));
          setLines(version.ingredients.map((ing) => {
            const full = map.get(ing.itemId);
            const factor = full?.purchaseToBaseFactor && full.purchaseToBaseFactor > 0 ? full.purchaseToBaseFactor : 1;
            const cost = ing.item?.lastCost ?? full?.lastCost ?? 0;
            return {
              id: uid(), kind: ing.item?.type === 'PACKAGING' ? 'packaging' : 'ingredient', itemId: ing.itemId,
              name: ing.item?.name ?? 'รายการ', purchasePrice: cost > 0 ? round(cost * factor, 2) : 0, purchaseQty: 1,
              purchaseUnit: full?.purchaseUnit?.code ?? ing.item?.baseUnitCode ?? 'หน่วย', qtyPerPurchase: factor,
              usage: ing.quantityBase, baseUnit: ing.item?.baseUnitCode ?? full?.baseUnit?.code ?? 'หน่วย', wastePercent: ing.wastePercent,
            } as SheetLine;
          }));
        }
      }
    }).catch((e: Error) => setError(e.message));
  }, [id]);

  const itemMap = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);
  const summary = useMemo(() => computeSheet(lines, ops, batchOutput), [lines, ops, batchOutput]);
  const ingredientLines = lines.filter((l) => l.kind === 'ingredient');
  const packagingLines = lines.filter((l) => l.kind === 'packaging');
  const effectiveSellUnit = sellUnit === CUSTOM_UNIT ? (customUnit.trim() || 'หน่วย') : sellUnit;

  const update = (lineId: string, patch: Partial<SheetLine>) =>
    setLines((prev) => prev.map((l) => (l.id === lineId ? { ...l, ...patch } : l)));
  const remove = (lineId: string) => setLines((prev) => prev.filter((l) => l.id !== lineId));
  const addItem = (item: Item) => { setLines((prev) => [...prev, lineFromItem(item)]); setPickerKind(null); };

  // ---- pricing preview ----
  const unitCost = summary.costPerUnit;
  const pricing = useMemo(() => {
    const price = priceMode === 'sellingPrice' ? priceValue : priceMode === 'marginPercent' ? priceFromMargin(unitCost, priceValue) : priceFromMarkup(unitCost, priceValue);
    return analyzePrice(unitCost, price);
  }, [priceMode, priceValue, unitCost]);

  // ---- warnings ----
  const belowCost = pricing.sellingPrice > 0 && pricing.isLoss;
  const marginLow = pricing.sellingPrice > 0 && !pricing.isLoss && pricing.marginPercent < 20;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const saveable = lines.filter((l) => l.itemId);
    if (!id && menuMode === 'existing' && !productId) { setError('กรุณาเลือกเมนูก่อนบันทึกสูตร'); return; }
    if (!id && menuMode === 'new' && (!newMenuName.trim() || !newMenuUnitId)) { setError('กรุณาระบุชื่อเมนูและหน่วยขาย'); return; }
    if (saveable.length === 0) { setError('เพิ่มวัตถุดิบหรือบรรจุภัณฑ์อย่างน้อย 1 รายการ'); return; }
    if (id && !reason.trim()) { setError('กรุณาระบุเหตุผลของการสร้างเวอร์ชันใหม่'); return; }
    setBusy(true); setError('');
    try {
      // อัปเดตราคาซื้อล่าสุดของรายการที่ผู้ใช้แก้ราคา เพื่อให้ต้นทุนที่บันทึกตรงกับ Cost Sheet
      for (const line of saveable) {
        const item = itemMap.get(line.itemId!);
        if (!item) continue;
        const sheetCostPerBase = computeLine(line).costPerBase;
        if (sheetCostPerBase > 0 && Math.abs(sheetCostPerBase - item.lastCost) > 1e-6) {
          const factor = item.purchaseToBaseFactor > 0 ? item.purchaseToBaseFactor : 1;
          await catalogApi.addPrice(item.id, { purchasePrice: round(sheetCostPerBase * factor, 6), purchaseQuantity: 1 });
        }
      }
      const version = {
        standardYieldQty: batchOutput, yieldPercent: 100, standardWaste: 0,
        laborCost: ops.laborCost, electricCost: ops.electricCost, waterCost: ops.waterCost,
        gasCost: ops.gasCost, overheadCost: ops.overheadCost, otherCost: ops.otherCost,
        note: note || null,
        ingredients: saveable.map((l) => {
          const item = itemMap.get(l.itemId!);
          return { itemId: l.itemId!, quantityBase: l.usage, unitId: item?.baseUnitId ?? null, wastePercent: l.wastePercent };
        }),
      };
      if (id) {
        await catalogApi.addRecipeVersion(id, { ...version, reason });
        toast('บันทึกเวอร์ชันสูตรใหม่แล้ว');
        navigate(`/recipes/${id}`);
      } else {
        const menuInput = menuMode === 'existing'
          ? { productId }
          : { newMenu: { name: newMenuName.trim(), code: newMenuCode.trim() || undefined, sellingUnitId: newMenuUnitId } };
        const made = await catalogApi.createRecipe({ ...menuInput, code: code || undefined, name: name || undefined, version });
        toast({ title: 'บันทึกสูตรสำเร็จ', description: made.menuCreated ? 'สร้างเมนูใหม่และเชื่อมสูตรเรียบร้อยแล้ว' : 'เชื่อมสูตรกับเมนูเดิมเรียบร้อยแล้ว', variant: 'success' });
        navigate(`/recipes/${made.id}`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="cs-root">
      {/* Top bar */}
      <div className="cs-topbar">
        <p className="eyebrow">COST SHEET · ต้นทุน 1 เมนู</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h1 style={{ margin: '6px 0', fontSize: 23 }}>{id ? 'แก้ไขสูตรเมนูอาหาร & คิดต้นทุน' : 'สร้างสูตรเมนูอาหาร & คิดต้นทุน'}</h1>
          {id && <span className="cs-version-pill"><Sparkles width={13} aria-hidden />เวอร์ชันถัดไป · ต่อจาก V{detail?.versions[0]?.versionNo ?? 1}</span>}
        </div>
        <p style={{ margin: '0 0 2px', color: '#c7d6ec', fontSize: 13.5, maxWidth: 640 }}>
          กำหนดวัตถุดิบ บรรจุภัณฑ์ และค่าใช้จ่าย เพื่อคำนวณต้นทุนจริงของ 1 เมนู
        </p>
        <div className="cs-topbar-grid">
          <div className="cs-tb-field">
            <label>เมนู</label>
            {!id && <div className="recipe-menu-modes"><button type="button" className={menuMode === 'new' ? 'active' : ''} onClick={() => setMenuMode('new')}>พิมพ์เมนูใหม่</button><button type="button" className={menuMode === 'existing' ? 'active' : ''} onClick={() => setMenuMode('existing')}>เลือกเมนูเดิม</button></div>}
            {(id || menuMode === 'existing') ? <select value={productId} disabled={Boolean(id)} onChange={(e) => setProductId(e.target.value)} required>
              <option value="">ค้นหา/เลือกเมนู…</option>
              {menus.map((m) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
            </select> : <div className="recipe-new-menu"><input value={newMenuName} onChange={(e) => setNewMenuName(e.target.value)} placeholder="ชื่อเมนูใหม่" autoFocus /><input value={newMenuCode} onChange={(e) => setNewMenuCode(e.target.value)} placeholder="รหัส (ไม่บังคับ)" /><select value={newMenuUnitId} onChange={(e) => setNewMenuUnitId(e.target.value)}><option value="">เลือกหน่วยขาย…</option>{units.map((unit) => <option key={unit.id} value={unit.id}>{unit.code} — {unit.name}</option>)}</select></div>}
          </div>
          <div className="cs-tb-field"><label>จำนวนที่ผลิต (Batch)</label><input type="number" min="0" step="any" value={batchOutput} onChange={(e) => setBatchOutput(+e.target.value)} /></div>
          <div className="cs-tb-field"><label>หน่วยขาย</label>
            <select value={sellUnit} onChange={(e) => setSellUnit(e.target.value)}>
              {SELL_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
              <option value={CUSTOM_UNIT}>+ กำหนดเอง…</option>
            </select>
            {sellUnit === CUSTOM_UNIT && (
              <input style={{ marginTop: 6 }} value={customUnit} onChange={(e) => setCustomUnit(e.target.value)}
                placeholder="พิมพ์หน่วย เช่น ถาด, ชุดเล็ก" aria-label="หน่วยขายกำหนดเอง" />
            )}
          </div>
          <div className="cs-tb-field"><label>ชื่อสูตร</label><input value={name} disabled={Boolean(id)} onChange={(e) => setName(e.target.value)} placeholder="อัตโนมัติจากเมนู" /></div>
          <button type="submit" className="btn primary" disabled={busy} style={{ height: 40 }}>
            {busy ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />}{id ? 'บันทึกเวอร์ชัน' : 'บันทึกสูตร'}
          </button>
        </div>
      </div>

      {error && <div className="alert" style={{ marginBottom: 14 }}>{error}</div>}

      <div className="cs-page">
        <div>
          <CostSection kind="ingredient" title="วัตถุดิบอาหาร" sub="ใส่ราคาที่ซื้อและปริมาณที่ใช้ ระบบคิดต้นทุนให้"
            icon={UtensilsCrossed} lines={ingredientLines} total={summary.materialCost}
            onAdd={() => setPickerKind('ingredient')} update={update} remove={remove} />

          <CostSection kind="packaging" title="บรรจุภัณฑ์และวัสดุ" sub="กล่อง ถุง ช้อนส้อม ฝา คิดต้นทุนต่อชิ้น"
            icon={Package} lines={packagingLines} total={summary.packagingCost}
            onAdd={() => setPickerKind('packaging')} update={update} remove={remove} />

          {/* Operating cost */}
          <section className="card cs-section operating">
            <div className="cs-section-head">
              <span className="ic"><ReceiptText aria-hidden /></span>
              <div><h2>ค่าใช้จ่ายเพิ่มเติม</h2><p className="sub">ทุกช่องเป็น “บาทต่อ Batch” (ต่อการผลิต 1 ครั้ง)</p></div>
              <span className="total">฿{formatMoney(summary.operatingCost, 2)}</span>
            </div>
            <div className="cs-ops">
              {OPS_META.map(({ key, label }) => (
                <label key={key}>{label}
                  <div className="wrap">
                    <input type="number" min="0" step="any" value={ops[key]} onChange={(e) => setOps((p) => ({ ...p, [key]: +e.target.value }))} />
                    <span>บาท/batch</span>
                  </div>
                </label>
              ))}
            </div>
          </section>

          {id && (
            <label className="fcx-field" style={{ marginTop: 4 }}>เหตุผลของเวอร์ชันใหม่ *
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ปรับสูตร ลดต้นทุน เปลี่ยนบรรจุภัณฑ์" />
            </label>
          )}
        </div>

        {/* Summary sidebar */}
        <aside className="cs-summary">
          <section className="card cs-sum-card">
            <div className="cs-sum-head"><Calculator aria-hidden /><h3>สรุปต้นทุนเมนู</h3></div>
            <div className="cs-sum-row"><span><i className="dot" style={{ background: 'var(--blue)' }} />ต้นทุนวัตถุดิบ</span><strong>฿{formatMoney(summary.materialCost, 2)}</strong></div>
            <div className="cs-sum-row"><span><i className="dot" style={{ background: '#c6a15b' }} />ต้นทุนบรรจุภัณฑ์</span><strong>฿{formatMoney(summary.packagingCost, 2)}</strong></div>
            <div className="cs-sum-row"><span><i className="dot" style={{ background: '#7fb3dd' }} />ค่าแรง</span><strong>฿{formatMoney(summary.laborCost, 2)}</strong></div>
            <div className="cs-sum-row"><span><i className="dot" style={{ background: '#35b6d6' }} />ค่าน้ำ/ไฟ/แก๊ส</span><strong>฿{formatMoney(summary.utilityCost, 2)}</strong></div>
            <div className="cs-sum-row"><span><i className="dot" style={{ background: '#94a3b8' }} />อื่น ๆ</span><strong>฿{formatMoney(summary.overheadCost + summary.otherCost + summary.wasteCost, 2)}</strong></div>
            <div className="cs-sum-total"><span>รวมต่อ Batch</span><strong>฿{formatMoney(summary.totalCost, 2)}</strong></div>
            <div className="cs-unitcost">
              <div className="k">ต้นทุนต่อ 1 {effectiveSellUnit}<b>ผลิตได้ {formatMoney(summary.batchOutput, 0)} {effectiveSellUnit}</b></div>
              <div className="v">฿{formatMoney(summary.costPerUnit, 2)}</div>
            </div>
            {summary.linesMissingPrice > 0 && (
              <div className="cs-warn warn" style={{ marginTop: 12 }}>
                <AlertTriangle aria-hidden />
                <span>มี {summary.linesMissingPrice} รายการยังไม่มีราคาซื้อ — ต้นทุนที่แสดงจึงยังไม่ครบ <Link to="/ingredients">อัปเดตราคา</Link></span>
              </div>
            )}
          </section>

          {/* Distribution */}
          {summary.totalCost > 0 && (
            <section className="card cs-sum-card">
              <div className="cs-sum-head"><TrendingUp aria-hidden /><h3>สัดส่วนต้นทุน</h3></div>
              <div className="cs-dist">
                <DistRow label="วัตถุดิบ" value={summary.materialCost} total={summary.totalCost} color="var(--blue)" />
                <DistRow label="บรรจุภัณฑ์" value={summary.packagingCost} total={summary.totalCost} color="#c6a15b" />
                <DistRow label="ค่าแรง" value={summary.laborCost} total={summary.totalCost} color="#7fb3dd" />
                <DistRow label="น้ำ/ไฟ/แก๊ส" value={summary.utilityCost} total={summary.totalCost} color="#35b6d6" />
                <DistRow label="อื่น ๆ" value={summary.overheadCost + summary.otherCost + summary.wasteCost} total={summary.totalCost} color="#94a3b8" />
              </div>
            </section>
          )}

          {/* Pricing preview */}
          <section className="card cs-sum-card">
            <div className="cs-sum-head"><Sparkles aria-hidden /><h3>ราคาขาย & กำไร</h3></div>
            <div className="cs-price-modes">
              <button type="button" className={priceMode === 'marginPercent' ? 'active' : ''} onClick={() => { setPriceMode('marginPercent'); setPriceValue(40); }}>Margin %</button>
              <button type="button" className={priceMode === 'markupPercent' ? 'active' : ''} onClick={() => { setPriceMode('markupPercent'); setPriceValue(60); }}>Markup %</button>
              <button type="button" className={priceMode === 'sellingPrice' ? 'active' : ''} onClick={() => { setPriceMode('sellingPrice'); setPriceValue(Math.max(1, Math.ceil(unitCost * 1.6))); }}>ระบุราคา</button>
            </div>
            <div className="cs-price-input">
              <input type="number" min="0" step="any" value={priceValue} onChange={(e) => setPriceValue(+e.target.value)} aria-label="ค่าราคา" />
              <span className="suf">{priceMode === 'sellingPrice' ? '฿' : '%'}</span>
            </div>
            <div className="cs-profit-grid">
              <div><div className="k">ราคาขาย/{effectiveSellUnit}</div><div className="v">฿{formatMoney(pricing.sellingPrice, 2)}</div></div>
              <div><div className="k">กำไร/{effectiveSellUnit}</div><div className="v" style={{ color: pricing.isLoss ? 'var(--danger)' : 'var(--success)' }}>฿{formatMoney(pricing.profit, 2)}</div></div>
              <div><div className="k">Margin</div><div className="v">{pricing.marginPercent.toFixed(1)}%</div></div>
              <div><div className="k">กำไร/Batch</div><div className="v">฿{formatMoney(pricing.profit * summary.batchOutput, 2)}</div></div>
            </div>
            {belowCost && <div className="cs-warn bad" style={{ marginTop: 12 }}><AlertTriangle aria-hidden /><span>ราคาขายต่ำกว่าต้นทุน — จะขาดทุน ฿{formatMoney(unitCost - pricing.sellingPrice, 2)} ต่อ {effectiveSellUnit}</span></div>}
            {marginLow && <div className="cs-warn warn" style={{ marginTop: 12 }}><AlertTriangle aria-hidden /><span>กำไรบางเกินไป (margin {pricing.marginPercent.toFixed(1)}%) ลองเพิ่มราคาหรือลดต้นทุน</span></div>}
            {!belowCost && !marginLow && pricing.sellingPrice > 0 && <div className="cs-warn good" style={{ marginTop: 12 }}><CheckCircle2 aria-hidden /><span>margin {pricing.marginPercent.toFixed(1)}% · เมนูนี้ทำกำไรได้ดี</span></div>}
          </section>
        </aside>
      </div>

      {pickerKind && (
        <ItemPicker kind={pickerKind} items={items} used={lines.map((l) => l.itemId).filter(Boolean) as string[]}
          onPick={addItem} onClose={() => setPickerKind(null)} />
      )}
    </form>
  );
}

function CostSection({ kind, title, sub, icon: Icon, lines, total, onAdd, update, remove }: {
  kind: 'ingredient' | 'packaging'; title: string; sub: string; icon: typeof Package;
  lines: SheetLine[]; total: number; onAdd: () => void;
  update: (id: string, patch: Partial<SheetLine>) => void; remove: (id: string) => void;
}) {
  return (
    <section className={`card cs-section ${kind}`}>
      <div className="cs-section-head">
        <span className="ic"><Icon aria-hidden /></span>
        <div><h2>{title}</h2><p className="sub">{sub}</p></div>
        <span className="total">฿{formatMoney(total, 2)}</span>
        <button type="button" className="btn add" onClick={onAdd}><Plus aria-hidden />เพิ่ม{kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}</button>
      </div>
      <div className="cs-scroll">
        <div className="cs-grid">
          <div className="cs-row head">
            <span>รายการ</span><span>ราคาซื้อ</span><span>จำนวน</span><span>หน่วยซื้อ</span><span>ปริมาณ/หน่วย</span>
            <span className="calc"><Lock aria-hidden />รวม</span><span>ใช้ในสูตร</span><span>หน่วยใช้</span>
            <span className="calc"><Lock aria-hidden />ต้นทุน/หน่วย</span><span className="calc"><Lock aria-hidden />ต้นทุน</span><span />
          </div>
          {lines.length === 0 && <div className="cs-empty">ยังไม่มีรายการ — กด “เพิ่ม{kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}” เพื่อเลือกจากคลังข้อมูล</div>}
          {lines.map((line) => {
            const r = computeLine(line);
            return (
              <div className="cs-row body" key={line.id}>
                <div className="cs-cell name" data-label="รายการ">
                  <div className="pick"><span className="ph"><ImageOff width={14} aria-hidden /></span>
                    <div style={{ minWidth: 0 }}><strong>{line.name}</strong><small>{r.hasPrice ? `฿${formatMoney(r.costPerBase, 4)}/${line.baseUnit}` : <span className="cs-noprice"><AlertTriangle width={11} aria-hidden />ยังไม่มีราคา</span>}</small></div>
                  </div>
                </div>
                <div className="cs-cell" data-label="ราคาซื้อ"><input type="number" min="0" step="any" className="num" value={line.purchasePrice} onChange={(e) => update(line.id, { purchasePrice: +e.target.value })} /></div>
                <div className="cs-cell" data-label="จำนวนซื้อ"><input type="number" min="0" step="any" className="num" value={line.purchaseQty} onChange={(e) => update(line.id, { purchaseQty: +e.target.value })} /></div>
                <div className="cs-cell" data-label="หน่วยซื้อ"><input value={line.purchaseUnit} onChange={(e) => update(line.id, { purchaseUnit: e.target.value })} /></div>
                <div className="cs-cell" data-label="ปริมาณต่อหน่วย"><input type="number" min="0" step="any" className="num" value={line.qtyPerPurchase} onChange={(e) => update(line.id, { qtyPerPurchase: +e.target.value })} /></div>
                <div className="cs-calc-cell" data-label="ปริมาณรวม"><div className="cs-calc">{formatMoney(r.baseQty, 0)}<span className="cs-unit-suffix">{line.baseUnit}</span></div></div>
                <div className="cs-cell" data-label="ใช้ในสูตร"><input type="number" min="0" step="any" className="num" value={line.usage} onChange={(e) => update(line.id, { usage: +e.target.value })} /></div>
                <div className="cs-cell" data-label="หน่วยใช้"><input value={line.baseUnit} onChange={(e) => update(line.id, { baseUnit: e.target.value })} /></div>
                <div className="cs-calc-cell" data-label="ต้นทุน/หน่วย"><div className="cs-calc"><Lock className="lock" aria-hidden />{formatMoney(r.costPerBase, 4)}</div></div>
                <div className="cs-calc-cell" data-label="ต้นทุนรายการ"><div className="cs-calc strong">฿{formatMoney(r.cost, 2)}</div></div>
                <button type="button" className="icon-btn cs-del" aria-label={`ลบ ${line.name}`} onClick={() => remove(line.id)}><Trash2 aria-hidden width={16} /></button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DistRow({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="cs-dist-row">
      <span className="nm">{label}</span>
      <span className="track"><i style={{ width: `${pct}%`, background: color }} /></span>
      <span className="pct">{pct.toFixed(0)}%</span>
    </div>
  );
}

function ItemPicker({ kind, items, used, onPick, onClose }: {
  kind: 'ingredient' | 'packaging'; items: Item[]; used: string[];
  onPick: (item: Item) => void; onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const type = kind === 'packaging' ? 'PACKAGING' : 'RAW_MATERIAL';
  const list = items.filter((it) => it.type === type && (q.trim() === '' || it.name.toLowerCase().includes(q.toLowerCase()) || it.code.toLowerCase().includes(q.toLowerCase())));

  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" style={{ width: 'min(100%, 560px)' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>เลือก{kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}จากคลังข้อมูล</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="ปิด"><X aria-hidden width={16} /></button>
        </div>
        <div className="search-box" style={{ maxWidth: 'none', marginBottom: 12 }}>
          <Search aria-hidden /><input autoFocus placeholder="ค้นหาชื่อหรือรหัส" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div style={{ maxHeight: 360, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {list.length === 0 && (
            <div className="empty-state" style={{ padding: '26px 10px' }}>
              <p style={{ margin: 0 }}>ไม่พบรายการ</p>
              <Link to={kind === 'packaging' ? '/packaging/new' : '/ingredients/new'} className="btn" style={{ marginTop: 10 }}><Plus aria-hidden />เพิ่ม{kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ'}ใหม่</Link>
            </div>
          )}
          {list.map((it) => (
            <button type="button" key={it.id} className="cs-pick-item" onClick={() => onPick(it)}
              style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 10, border: '1px solid var(--border)', borderRadius: 12, background: 'var(--surface)', cursor: 'pointer', textAlign: 'left' }}>
              {it.imageUrl ? <img src={it.imageUrl} alt="" width={40} height={40} style={{ borderRadius: 9, objectFit: 'cover' }} /> : <span className="icon-chip slate" style={{ width: 40, height: 40 }}><Package aria-hidden /></span>}
              <div style={{ flex: 1, minWidth: 0 }}>
                <strong style={{ display: 'block', fontSize: 14 }}>{it.name}</strong>
                <span style={{ fontSize: 12, color: 'var(--text-subtle)' }}>{it.code} · {it.lastCost > 0 ? `฿${formatMoney(it.lastCost, 4)}/${it.baseUnit?.code}` : 'ยังไม่มีราคา'}</span>
              </div>
              {used.includes(it.id) && <span className="badge muted">เพิ่มแล้ว</span>}
              <Plus aria-hidden width={18} style={{ color: 'var(--blue)' }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
