import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Calculator, Check, CircleDollarSign, Info, Save, UtensilsCrossed } from 'lucide-react';
import { catalogApi, type CostCompletionRow, type CostCompletionSave } from '@/lib/catalog';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { PageContainer, PageHeader, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';
import { baseCostOf, summarizeDraft, type CostDraft } from '@/lib/cost-completion';

/**
 * PHASE 21 — เติมข้อมูลต้นทุนที่ยังขาด
 *
 * หน้านี้มีหน้าที่เดียว: ช่วยให้ผู้ใช้ "กรอกราคาที่ยังไม่มี" ได้เร็ว
 * ไม่ประมาณราคาให้ ไม่เดาค่าใด ๆ และบันทึกเฉพาะแถวที่ผู้ใช้กรอกเองเท่านั้น
 *
 * ช่องว่างกับเลข 0 ไม่ใช่สิ่งเดียวกัน — ใส่ 0 ต้องติ๊กยืนยันว่าเป็นต้นทุนศูนย์จริง
 */

const money = (v: number, digits = 4) =>
  `฿${v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

export default function CostCompletionPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canEdit = Boolean(user?.roles.includes('SUPER_ADMIN')
    || ['INGREDIENT_EDIT', 'PACKAGING_EDIT'].some((p) => user?.permissions.includes(p)));

  const query = useQuery({ queryKey: ['cost-completion'], queryFn: () => catalogApi.costCompletion() });
  const [draft, setDraft] = useState<Record<string, CostDraft>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);

  const rows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const summary = query.data?.summary;

  /** เฉพาะแถวที่ผู้ใช้แตะจริง — ไม่บันทึกทั้งหน้าแบบเหมารวม */
  const pending = useMemo(() => summarizeDraft(rows, draft), [rows, draft]);

  const patch = (itemId: string, next: Partial<CostDraft>) =>
    setDraft((current) => ({ ...current, [itemId]: { ...(current[itemId] ?? { price: '', quantity: '1', explicitZero: false, zeroReason: '' }), ...next } }));

  const save = useMutation({
    mutationFn: (payload: CostCompletionSave[]) => catalogApi.saveCostCompletion(payload),
    onSuccess: (result) => {
      toast(`บันทึกต้นทุน ${result.updated.length} รายการแล้ว`);
      setDraft({}); setConfirmOpen(false);
      void qc.invalidateQueries({ queryKey: ['cost-completion'] });
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['selectable-items'] });
      void qc.invalidateQueries({ queryKey: ['recipe-completeness'] });
    },
    onError: (error: unknown) => {
      setConfirmOpen(false);
      toast(error instanceof Error ? error.message : 'บันทึกไม่สำเร็จ');
    },
  });

  return <PageContainer size="wide" className="ops-page">
    <PageHeader
      breadcrumb={<><Link to="/ingredients">วัตถุดิบ</Link><span> · </span><span>เติมข้อมูลต้นทุน</span></>}
      title="เติมข้อมูลต้นทุนที่ยังขาด"
      description="กรอกราคาซื้อของวัตถุดิบที่ยังไม่มีข้อมูลต้นทุน เรียงตามผลกระทบต่อสูตรที่ใช้งานอยู่"
      actions={<Link to="/ingredients" className="btn">กลับหน้าวัตถุดิบ</Link>}
    />

    <KPIGrid columns={4}>
      <KPICard label="วัตถุดิบทั้งหมด" value={summary?.total ?? '—'} icon={<CircleDollarSign />} hint="ที่ใช้งานอยู่" />
      <KPICard label="มีต้นทุนแล้ว" value={summary?.priced ?? '—'} icon={<Check />} tone="success" hint="คิดต้นทุนสูตรได้" />
      <KPICard label="ยืนยันต้นทุน 0 บาท" value={summary?.explicitZero ?? '—'} icon={<Info />} hint="ตั้งใจให้ไม่มีต้นทุน" />
      <KPICard label="ยังไม่มีข้อมูลต้นทุน" value={summary?.missing ?? '—'} icon={<AlertTriangle />}
        tone={summary && summary.missing > 0 ? 'warning' : 'default'} hint="ทำให้ต้นทุนสูตรต่ำกว่าความจริง" />
    </KPIGrid>

    <ContentCard
      title="รายการที่ต้องเติมข้อมูล"
      description={rows.length ? `${rows.length} รายการ · เรียงตามจำนวนสูตรที่ได้รับผลกระทบ` : undefined}
      padded={false}
    >
      {query.isLoading && <p className="issue-none">กำลังโหลด…</p>}

      {!query.isLoading && rows.length === 0 && <EmptyState icon={Check}
        title="ข้อมูลต้นทุนครบแล้ว"
        description="วัตถุดิบที่ใช้งานอยู่ทุกรายการมีข้อมูลต้นทุนหรือยืนยันว่าเป็นศูนย์แล้ว" />}

      {rows.length > 0 && <div className="table-wrap">
        <table className="data-table cost-fill-table">
          <thead><tr>
            <th>วัตถุดิบ</th><th>หน่วย</th><th className="num">สูตร / เมนู</th>
            <th className="num">ราคาซื้อ</th><th className="num">จำนวนที่ซื้อ</th><th className="num">ต้นทุนต่อหน่วยฐาน</th>
          </tr></thead>
          <tbody>
            {rows.map((row) => <CostRow key={row.id} row={row} draft={draft[row.id]} canEdit={canEdit} onPatch={patch} />)}
          </tbody>
        </table>
      </div>}
    </ContentCard>

    {pending.rows.length > 0 && <div className="cost-fill-bar">
      <span><strong>{pending.rows.length}</strong> รายการที่กรอกไว้และยังไม่ได้บันทึก</span>
      {pending.blocked.length > 0 && <span className="cost-fill-warn">
        <AlertTriangle aria-hidden width={15} />มี {pending.blocked.length} รายการที่ใส่ 0 แต่ยังไม่ได้ยืนยัน
      </span>}
      <button type="button" className="btn" onClick={() => setDraft({})}>ล้างที่กรอกไว้</button>
      <button type="button" className="btn primary" disabled={!canEdit || save.isPending || pending.blocked.length > 0}
        onClick={() => setConfirmOpen(true)}>
        <Save aria-hidden width={16} />ตรวจทานและบันทึก
      </button>
    </div>}

    <ConfirmDialog
      open={confirmOpen}
      title={`บันทึกต้นทุน ${pending.rows.length} รายการ`}
      confirmLabel="บันทึกทั้งหมด"
      onClose={() => setConfirmOpen(false)}
      onConfirm={() => save.mutate(pending.payload)}
      description={<div className="op-confirm cost-fill-confirm">
        <p>ระบบจะบันทึกเฉพาะรายการที่คุณกรอกไว้เท่านั้น รายการอื่นในหน้านี้จะไม่ถูกแตะ</p>
        <div className="table-wrap">
          <table className="unit-table">
            <thead><tr><th>วัตถุดิบ</th><th className="num">ต้นทุนเดิม</th><th className="num">ราคาซื้อใหม่</th><th>การแปลง</th><th className="num">ต้นทุนใหม่</th></tr></thead>
            <tbody>
              {pending.rows.map((p) => <tr key={p.item.id}>
                <td data-label="วัตถุดิบ"><b>{p.item.name}</b><small>{p.item.code}</small></td>
                <td className="num" data-label="ต้นทุนเดิม">{money(p.item.lastCost)}</td>
                <td className="num" data-label="ราคาซื้อใหม่">
                  {p.purchasePrice === 0 ? <b>0 (ยืนยันแล้ว)</b> : `${p.purchasePrice.toLocaleString()} / ${p.purchaseQuantity} ${p.item.purchaseUnit?.code ?? p.item.baseUnit?.code ?? ''}`}
                </td>
                <td data-label="การแปลง">1 {p.item.purchaseUnit?.code ?? p.item.baseUnit?.code} = {p.item.purchaseToBaseFactor.toLocaleString()} {p.item.baseUnit?.code}</td>
                <td className="num" data-label="ต้นทุนใหม่"><b>{money(p.newBaseCost)}</b> / {p.item.baseUnit?.code}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        <p className="op-confirm-impact"><Calculator aria-hidden width={15} />
          ต้นทุนคำนวณด้วยสูตรเดียวกับทั้งระบบ: <b>ราคาซื้อ ÷ จำนวนที่ซื้อ ÷ อัตราแปลง</b> ·
          มีผลกับการคิดต้นทุนปัจจุบันเท่านั้น <b>ไม่แก้ประวัติหรือเอกสารย้อนหลัง</b>
        </p>
      </div>}
    />
  </PageContainer>;
}

function CostRow({ row, draft, canEdit, onPatch }: {
  row: CostCompletionRow;
  draft?: CostDraft;
  canEdit: boolean;
  onPatch: (itemId: string, next: Partial<CostDraft>) => void;
}) {
  const price = draft?.price ?? '';
  const quantity = draft?.quantity ?? '1';
  const explicitZero = draft?.explicitZero ?? false;
  const isZero = price.trim() !== '' && Number(price) === 0;
  const preview = price.trim() === '' ? null : baseCostOf(Number(price), Number(quantity) || 1, row.purchaseToBaseFactor);

  return <tr className={draft ? 'is-edited' : ''}>
    <td data-label="วัตถุดิบ">
      <b>{row.name}</b><small>{row.code}</small>
    </td>
    <td data-label="หน่วย">
      <span className="cost-fill-units">
        {row.purchaseUnit?.code && row.purchaseUnit.code !== row.baseUnit?.code
          ? <>1 {row.purchaseUnit.code} = {row.purchaseToBaseFactor.toLocaleString()} {row.baseUnit?.code}</>
          : <>ซื้อและใช้เป็น {row.baseUnit?.code}</>}
      </span>
    </td>
    <td className="num" data-label="สูตร / เมนู">
      <span className="cost-fill-impact">
        <UtensilsCrossed aria-hidden width={14} />
        {row.recipesAffected} สูตร · {row.menusAffected} เมนู
      </span>
      {row.menuNames.length > 0 && <small className="subtle">{row.menuNames.join(', ')}</small>}
    </td>
    <td className="num" data-label="ราคาซื้อ">
      <input type="number" min="0" step="any" value={price} disabled={!canEdit}
        aria-label={`ราคาซื้อของ ${row.name}`} placeholder="—"
        onChange={(e) => onPatch(row.id, { price: e.target.value })} />
    </td>
    <td className="num" data-label="จำนวนที่ซื้อ">
      <input type="number" min="0" step="any" value={quantity} disabled={!canEdit}
        aria-label={`จำนวนที่ซื้อของ ${row.name}`}
        onChange={(e) => onPatch(row.id, { quantity: e.target.value })} />
    </td>
    <td className="num" data-label="ต้นทุนต่อหน่วยฐาน">
      {preview == null
        ? <span className="subtle">ยังไม่ได้กรอก</span>
        : <b>{money(preview)} / {row.baseUnit?.code}</b>}
      {isZero && <label className="cost-fill-zero">
        <input type="checkbox" checked={explicitZero} disabled={!canEdit}
          onChange={(e) => onPatch(row.id, { explicitZero: e.target.checked })} />
        ยืนยันว่ารายการนี้มีต้นทุน 0 บาท
      </label>}
      {isZero && explicitZero && <input className="cost-fill-reason" type="text" maxLength={200}
        value={draft?.zeroReason ?? ''} placeholder="เหตุผล เช่น น้ำประปา · ได้รับฟรี"
        aria-label={`เหตุผลที่ ${row.name} มีต้นทุน 0`}
        onChange={(e) => onPatch(row.id, { zeroReason: e.target.value })} />}
      {isZero && !explicitZero && <span className="cost-fill-block" role="alert">
        <AlertTriangle aria-hidden width={13} />ต้องยืนยันก่อนจึงจะบันทึกได้
      </span>}
    </td>
  </tr>;
}
