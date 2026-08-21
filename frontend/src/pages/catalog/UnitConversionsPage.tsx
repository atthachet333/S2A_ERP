import { FormEvent, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Info, Pencil, Plus, Ruler, Trash2, X } from 'lucide-react';
import { catalogApi, type Item, type Unit, type UnitConversion } from '@/lib/catalog';
import { ApiClientError } from '@/lib/api-client';
import {
  classifyFormula, describeFormula, draftFactor, FORMULA_KIND_LABEL, inverseText, RECOMMENDED,
  validateFormula, type FormulaDraft, type FormulaKind,
} from '@/lib/unit-formulas';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PageContainer, PageHeader, FilterBar } from '@/components/layout/page';

const EMPTY: FormulaDraft = { fromQty: 1, fromUnitId: '', toQty: 1, toUnitId: '', note: '' };
const fmt = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 6 });

/**
 * จัดการสูตรแปลงหน่วย
 * - “มาตรฐานระบบ” = ตาราง UnitConversion (ใช้ได้กับทุกวัตถุดิบ)
 * - “เฉพาะวัตถุดิบ” = Item.purchaseToBaseFactor (อ่านอย่างเดียวที่นี่ แก้ที่หน้าวัตถุดิบ)
 * ทั้งสองเป็นแหล่งข้อมูลเดิมของระบบ — ไม่สร้างระบบแปลงหน่วยซ้ำ
 */
export default function UnitConversionsPage() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = Boolean(user?.roles.includes('SUPER_ADMIN')
    || ['INGREDIENT_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_CREATE', 'PACKAGING_EDIT'].some((p) => user?.permissions.includes(p)));

  const unitsQ = useQuery({ queryKey: ['units'], queryFn: catalogApi.units });
  const conversionsQ = useQuery({ queryKey: ['unit-conversions'], queryFn: catalogApi.conversions });
  const itemsQ = useQuery({ queryKey: ['items', 'selectable'], queryFn: () => catalogApi.selectableItems() });

  const units: Unit[] = useMemo(() => unitsQ.data ?? [], [unitsQ.data]);
  const conversions: UnitConversion[] = useMemo(() => conversionsQ.data ?? [], [conversionsQ.data]);
  const items: Item[] = useMemo(() => itemsQ.data ?? [], [itemsQ.data]);

  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<FormulaKind | 'ALL'>('ALL');
  const [wizardOpen, setWizardOpen] = useState(false);
  const [draft, setDraft] = useState<FormulaDraft>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removing, setRemoving] = useState<UnitConversion | null>(null);

  const codeOf = (id: string) => units.find((u) => u.id === id)?.code ?? '';
  const nameOf = (id: string) => units.find((u) => u.id === id)?.name ?? codeOf(id);
  const unitByCode = (code: string) => units.find((u) => u.code.trim().toUpperCase() === code.trim().toUpperCase());

  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['unit-conversions'] }),
    qc.invalidateQueries({ queryKey: ['units'] }),
  ]);

  const saveMutation = useMutation({
    mutationFn: () => catalogApi.saveConversion({ fromUnitId: draft.fromUnitId, toUnitId: draft.toUnitId, factor: draftFactor(draft) }),
    onSuccess: async () => { await refresh(); toast('บันทึกสูตรแปลงหน่วยแล้ว'); closeWizard(); },
    onError: (e) => toast(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ', 'error'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => catalogApi.deleteConversion(id),
    onSuccess: async () => { await refresh(); toast('ลบสูตรแปลงหน่วยแล้ว'); setRemoving(null); },
    onError: (e) => {
      setRemoving(null);
      toast(e instanceof ApiClientError && e.code === 'CONVERSION_IN_USE' ? e.message : e instanceof Error ? e.message : 'ลบไม่สำเร็จ', 'error');
    },
  });

  const closeWizard = () => { setWizardOpen(false); setDraft(EMPTY); setEditingId(null); };
  const openCreate = () => { setDraft(EMPTY); setEditingId(null); setWizardOpen(true); };
  const openEdit = (c: UnitConversion) => {
    setDraft({ fromQty: 1, fromUnitId: c.fromUnitId, toQty: c.factor, toUnitId: c.toUnitId, note: '' });
    setEditingId(c.id); setWizardOpen(true);
  };
  const applyRecommended = (fromCode: string, toCode: string, toQty: number | null) => {
    const from = unitByCode(fromCode), to = unitByCode(toCode);
    setDraft({ fromQty: 1, fromUnitId: from?.id ?? '', toQty: toQty ?? 1, toUnitId: to?.id ?? '', note: '' });
    setEditingId(null); setWizardOpen(true);
  };

  const rows = useMemo(() => conversions.map((c) => ({ ...c, kind: classifyFormula(c.fromCode, c.toCode) })), [conversions]);
  const term = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (kindFilter !== 'ALL' && r.kind !== kindFilter) return false;
    if (!term) return true;
    return `${r.fromCode} ${r.toCode} ${r.fromName ?? ''} ${r.toName ?? ''}`.toLowerCase().includes(term);
  });

  // สูตรเฉพาะวัตถุดิบที่ตั้งไว้แล้ว (หน่วยซื้อ ≠ หน่วยฐาน) — แก้ที่หน้าวัตถุดิบ
  const itemFormulas = items.filter((i) => i.purchaseUnitId && i.purchaseUnitId !== i.baseUnitId && i.purchaseToBaseFactor > 0);

  const issue = wizardOpen ? validateFormula(draft, conversions.filter((c) => c.id !== editingId), units) : null;
  const factor = draftFactor(draft);
  const blocking = issue != null && issue.code !== 'DUPLICATE';

  const submit = (e: FormEvent) => { e.preventDefault(); if (blocking || factor == null) return; saveMutation.mutate(); };

  return <PageContainer className="units-page">
    <PageHeader
      breadcrumb="MASTER DATA"
      title="จัดการสูตรแปลงหน่วย"
      description="ตั้งค่าว่า 1 หน่วยหนึ่งเท่ากับกี่หน่วยอีกแบบ เพื่อให้ระบบคิดต้นทุนข้ามหน่วยได้ถูกต้อง"
      meta={<><span>สูตรมาตรฐาน <b className="num">{conversions.length}</b></span><span>สูตรเฉพาะวัตถุดิบ <b className="num">{itemFormulas.length}</b></span></>}
      actions={<Link to="/units" className="btn"><ArrowLeft aria-hidden width={16} />กลับไปหน้าหน่วยนับ</Link>}
    />

    <div className="conv-guide">
      <Info aria-hidden width={16} />
      <div>
        <p>ตัวอย่างที่ใช้บ่อย:</p>
        <ul>
          <li>ซื้อเป็น <b>L</b> แต่สูตรใช้ <b>ML</b> → ตั้ง <b>1 L = 1,000 ML</b></li>
          <li>ซื้อเป็น <b>KG</b> แต่สูตรใช้ <b>G</b> → ตั้ง <b>1 KG = 1,000 G</b></li>
          <li>กล่องหนึ่งมี 12 ชิ้น → ตั้ง <b>1 BOX = 12 PCS</b></li>
        </ul>
      </div>
    </div>

    <FilterBar actions={canManage ? <button type="button" className="primary-button" onClick={openCreate}><Plus aria-hidden width={16} />เพิ่มสูตรแปลง</button> : undefined}>
      <input className="s2-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาสูตรแปลง (เช่น KG, ML)…" aria-label="ค้นหาสูตรแปลงหน่วย" />
      <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value as FormulaKind | 'ALL')} aria-label="ประเภท">
        <option value="ALL">ทุกประเภท</option>
        {(Object.keys(FORMULA_KIND_LABEL) as FormulaKind[]).map((k) => <option key={k} value={k}>{FORMULA_KIND_LABEL[k]}</option>)}
      </select>
    </FilterBar>

    <table className="unit-table">
      <thead><tr><th>หน่วยต้นทาง</th><th>สมการ</th><th>หน่วยปลายทาง</th><th>ประเภท</th><th>ใช้งานที่</th><th>จัดการ</th></tr></thead>
      <tbody>
        {visible.map((c) => <tr key={c.id}>
          <td data-label="หน่วยต้นทาง"><span className="unit-code">{c.fromCode}</span></td>
          <td data-label="สมการ"><b>1 {c.fromCode} = {fmt(c.factor)} {c.toCode}</b><small className="conv-inv">{inverseText(c.fromCode, c.toCode, c.factor)}</small></td>
          <td data-label="หน่วยปลายทาง"><span className="unit-code">{c.toCode}</span></td>
          <td data-label="ประเภท"><span className="unit-pill on">{FORMULA_KIND_LABEL[c.kind]}</span></td>
          <td data-label="ใช้งานที่">{c.usageCount ? `${c.usageCount} รายการในสูตร` : '—'}</td>
          <td data-label="จัดการ">
            {canManage ? <div className="conv-card-actions">
              <button type="button" onClick={() => openEdit(c)}><Pencil aria-hidden />แก้ไข</button>
              <button type="button" className="danger" onClick={() => setRemoving(c)}><Trash2 aria-hidden />ลบ</button>
            </div> : '—'}
          </td>
        </tr>)}
      </tbody>
    </table>
    {visible.length === 0 && <p className="recipe-list-empty">{term || kindFilter !== 'ALL' ? 'ไม่พบสูตรที่ค้นหา' : 'ยังไม่มีสูตรแปลงหน่วย'}</p>}

    <div className="card card-pad conv-item-card">
      <h2>สูตรเฉพาะวัตถุดิบ</h2>
      <p className="field-hint">อัตราที่ต่างกันตามชนิดวัตถุดิบ (เช่น 1 L ของน้ำมัน = 1,000 ML) เก็บอยู่ที่วัตถุดิบแต่ละรายการ จึงไม่กระทบวัตถุดิบอื่น — แก้ไขได้ที่หน้าวัตถุดิบ หัวข้อ “อัตราแปลงหน่วยสำหรับสูตร”</p>
      {itemFormulas.length === 0 && <p>ยังไม่มีวัตถุดิบที่ตั้งอัตราเฉพาะไว้</p>}
      <div className="conv-grid">
        {itemFormulas.map((i) => <article className="conv-card" key={i.id}>
          <div className="eq">1 {i.purchaseUnit?.code} = {fmt(i.purchaseToBaseFactor)} {i.baseUnit?.code}</div>
          <small className="inv">{i.name} · {i.code}</small>
          <div className="conv-card-actions"><Link to={`/ingredients/${i.id}`} className="btn">แก้ไขวัตถุดิบ</Link></div>
        </article>)}
      </div>
    </div>

    {wizardOpen && <div className="modal-backdrop" role="presentation" onClick={closeWizard}>
      <section className="unit-modal wizard" role="dialog" aria-modal="true" aria-labelledby="conv-wizard" onClick={(e) => e.stopPropagation()}>
        <div className="add-unit-head">
          <div><p className="eyebrow">UNIT CONVERSION</p><h2 id="conv-wizard">{editingId ? 'แก้ไขสูตรแปลงหน่วย' : 'เพิ่มสูตรแปลงหน่วย'}</h2></div>
          <button type="button" className="icon-btn" onClick={closeWizard} aria-label="ปิด"><X aria-hidden /></button>
        </div>

        <form onSubmit={submit}>
          <div className="wizard-equation">
            <input type="number" min="0" step="any" aria-label="จำนวนต้นทาง" value={draft.fromQty} onChange={(e) => setDraft((d) => ({ ...d, fromQty: Number(e.target.value) }))} />
            <select aria-label="หน่วยต้นทาง" value={draft.fromUnitId} onChange={(e) => setDraft((d) => ({ ...d, fromUnitId: e.target.value }))}>
              <option value="">— หน่วย —</option>{units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
            <strong>=</strong>
            <input type="number" min="0" step="any" aria-label="จำนวนปลายทาง" value={draft.toQty} onChange={(e) => setDraft((d) => ({ ...d, toQty: Number(e.target.value) }))} />
            <select aria-label="หน่วยปลายทาง" value={draft.toUnitId} onChange={(e) => setDraft((d) => ({ ...d, toUnitId: e.target.value }))}>
              <option value="">— หน่วย —</option>{units.map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}
            </select>
          </div>

          {draft.fromUnitId && draft.toUnitId && factor != null && <div className="wizard-preview">
            <p>{describeFormula(draft.fromQty, nameOf(draft.fromUnitId), draft.toQty, nameOf(draft.toUnitId))}</p>
            <p className="wizard-store">จะบันทึกเป็น: <b>1 {codeOf(draft.fromUnitId)} = {fmt(factor)} {codeOf(draft.toUnitId)}</b></p>
            <small>ระบบจะคำนวณกลับอัตโนมัติ: {inverseText(codeOf(draft.fromUnitId), codeOf(draft.toUnitId), factor)}</small>
          </div>}

          {issue && <p className={blocking ? 'field-error' : 'wizard-warn'} role="alert">{issue.message}</p>}

          <label>หมายเหตุ (ไม่บังคับ)
            <input value={draft.note ?? ''} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} placeholder="เช่น อ้างอิงฉลากสินค้า" />
          </label>

          <div className="modal-actions">
            <button type="button" className="btn" onClick={closeWizard}>ยกเลิก</button>
            <button className="btn primary" disabled={blocking || factor == null || saveMutation.isPending}><Ruler aria-hidden />บันทึกสูตร</button>
          </div>
        </form>

        {!editingId && <div className="wizard-recommend">
          <h3>สูตรแนะนำ</h3>
          <div className="reco-grid">
            {RECOMMENDED.map((r) => <button type="button" key={`${r.fromCode}-${r.toCode}`} className={`reco-card${r.warn ? ' warn' : ''}`}
              onClick={() => applyRecommended(r.fromCode, r.toCode, r.toQty)}>
              <b>1 {r.fromCode} = {r.toQty != null ? fmt(r.toQty) : '___'} {r.toCode}</b>
              <span>{FORMULA_KIND_LABEL[r.kind]} · {r.hint}</span>
              {r.warn && <em><AlertTriangle aria-hidden width={12} />{r.warn}</em>}
            </button>)}
          </div>
        </div>}
      </section>
    </div>}

    <ConfirmDialog open={removing !== null} title="ลบสูตรแปลงหน่วย" tone="danger"
      description={removing ? `ยืนยันลบ 1 ${removing.fromCode} = ${fmt(removing.factor)} ${removing.toCode}? ระบบจะตรวจก่อนว่ามีสูตรใดใช้หน่วยนี้อยู่หรือไม่` : ''}
      confirmLabel="ลบสูตร" onClose={() => setRemoving(null)}
      onConfirm={removing ? () => deleteMutation.mutate(removing.id) : undefined} />
  </PageContainer>;
}
