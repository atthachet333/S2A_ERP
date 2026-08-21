import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Info, Plus, Ruler, Scale, Tags, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { catalogApi, type Category, type Unit } from '@/lib/catalog';
import { masterConflictMessage, findExisting } from '@/lib/master-validation';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import MasterModal from '@/components/ui/MasterModal';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';

/**
 * PHASE 7 — หน่วย / หมวดหมู่
 *
 * หน่วยเก็บแค่ "รหัส + ชื่อ" (schema `Unit` ไม่มีคอลัมน์ประเภท)
 * จึงไม่แสดงคอลัมน์ประเภท เพราะจะเป็นการสร้าง enum ขึ้นมาเองโดยไม่มีที่เก็บ
 * สิ่งที่แสดงแทนคือ "ถูกใช้งานที่ไหน" ซึ่งคำนวณจากข้อมูลจริง
 * (สินค้าที่อ้างหน่วยนี้ + สูตรแปลงหน่วยที่อ้างหน่วยนี้)
 *
 * ความสัมพันธ์ระหว่างหน่วย (1 KG = 1000 G) มีเจ้าของเดียวคือหน้า /units/conversions
 * หน้านี้จึงลิงก์ไป ไม่ทำฟอร์มซ้ำ
 */
export default function CatalogMastersPage({ section }: { section: 'units' | 'categories' }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const canManage = Boolean(user?.roles.includes('SUPER_ADMIN')
    || ['INGREDIENT_CREATE', 'INGREDIENT_EDIT', 'PACKAGING_CREATE', 'PACKAGING_EDIT'].some((p) => user?.permissions.includes(p)));

  const isUnits = section === 'units';
  const noun = isUnits ? 'หน่วย' : 'หมวดหมู่';

  const unitsQ = useQuery({ queryKey: ['units'], queryFn: catalogApi.units });
  const categoriesQ = useQuery({ queryKey: ['categories'], queryFn: catalogApi.categories });
  const conversionsQ = useQuery({ queryKey: ['unit-conversions'], queryFn: catalogApi.conversions, enabled: isUnits });
  // ใช้หาว่าหน่วยไหนถูกอ้างอิงอยู่บ้าง — ข้อมูลจริงจาก active items
  const itemsQ = useQuery({ queryKey: ['selectable-items', 'all'], queryFn: () => catalogApi.selectableItems(), enabled: isUnits });

  const units: Unit[] = useMemo(() => unitsQ.data ?? [], [unitsQ.data]);
  const categories: Category[] = categoriesQ.data ?? [];
  const conversions = useMemo(() => conversionsQ.data ?? [], [conversionsQ.data]);

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ code: '', name: '' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  /** หน่วยนี้ถูกใช้ที่ไหนบ้าง — นับจากสินค้าและสูตรแปลงจริง */
  const usage = useMemo(() => {
    const map = new Map<string, { items: number; conversions: number }>();
    const bump = (code: string | undefined | null, key: 'items' | 'conversions') => {
      if (!code) return;
      const cur = map.get(code) ?? { items: 0, conversions: 0 };
      cur[key] += 1;
      map.set(code, cur);
    };
    for (const it of itemsQ.data ?? []) {
      bump(it.baseUnit?.code, 'items');
      if (it.purchaseUnit?.code && it.purchaseUnit.code !== it.baseUnit?.code) bump(it.purchaseUnit.code, 'items');
    }
    for (const c of conversions) { bump(c.fromCode, 'conversions'); bump(c.toCode, 'conversions'); }
    return map;
  }, [itemsQ.data, conversions]);

  const save = async () => {
    const code = draft.code.trim();
    const name = draft.name.trim();
    if (!code || !name) { setFormError(`กรอกรหัสและชื่อ${noun}ให้ครบ`); return; }

    // กันสร้างซ้ำตั้งแต่ฝั่ง UI — ไม่ต้องรอ 409 กลับมา
    const dup = findExisting(isUnits ? units : categories, code) ?? findExisting(isUnits ? units : categories, name);
    if (dup) { setFormError(`มี${noun} ${dup.code} · ${dup.name} อยู่ในระบบแล้ว`); return; }

    setSaving(true); setFormError('');
    try {
      if (isUnits) await catalogApi.createUnit({ code, name });
      else await catalogApi.createCategory({ code, name });
      await qc.invalidateQueries({ queryKey: [isUnits ? 'units' : 'categories'] });
      toast(`เพิ่ม${noun} “${name}” แล้ว`);
      setDraft({ code: '', name: '' }); setAddOpen(false);
    } catch (e) { setFormError(masterConflictMessage(e, isUnits ? 'unit' : 'category', code)); }
    finally { setSaving(false); }
  };

  const rows: (Unit | Category)[] = isUnits ? units : categories;
  const term = search.trim().toLowerCase();
  const visible = rows.filter((r) => {
    if (status && String(r.isActive) !== (status === 'active' ? 'true' : 'false')) return false;
    if (!term) return true;
    return r.code.toLowerCase().includes(term) || r.name.toLowerCase().includes(term);
  });
  const loading = isUnits ? unitsQ.isLoading : categoriesQ.isLoading;
  const failed = isUnits ? unitsQ.isError : categoriesQ.isError;
  const hasFilter = Boolean(search || status);
  const activeCount = rows.filter((r) => r.isActive).length;

  return (
    <PageContainer size="wide" className="master-page units-page">
      <PageHeader
        breadcrumb="ข้อมูลตั้งต้น"
        title={isUnits ? 'หน่วย' : 'หมวดหมู่'}
        description={isUnits
          ? 'หน่วยที่ใช้ได้ทั้งระบบ — เก็บเฉพาะรหัสและชื่อ ส่วนความสัมพันธ์ระหว่างหน่วยตั้งที่หน้าสูตรแปลงหน่วย'
          : 'หมวดหมู่สำหรับจัดกลุ่มวัตถุดิบและบรรจุภัณฑ์'}
        actions={<>
          {isUnits && <Link to="/units/conversions" className="btn"><Ruler aria-hidden width={16} />จัดการสูตรแปลงหน่วย</Link>}
          {canManage && <button type="button" className="btn primary" onClick={() => { setDraft({ code: '', name: '' }); setFormError(''); setAddOpen(true); }}>
            <Plus aria-hidden width={16} />เพิ่ม{noun}
          </button>}
        </>}
      />

      <KPIGrid columns={isUnits ? 3 : 2}>
        <KPICard label={`${noun}ทั้งหมด`} value={rows.length} icon={isUnits ? <Scale /> : <Tags />} />
        <KPICard label="ใช้งานอยู่" value={activeCount} icon={<CheckCircle2 />} hint={`เลือกได้ตอนคีย์ข้อมูล`} />
        {isUnits && <KPICard label="สูตรแปลงมาตรฐาน" value={conversions.length} icon={<Ruler />}
          hint="ใช้ได้กับทุกวัตถุดิบ" />}
      </KPIGrid>

      <FilterBar actions={hasFilter
        ? <button type="button" className="btn" onClick={() => { setSearch(''); setStatus(''); }}>ล้างตัวกรอง</button>
        : undefined}>
        <input className="s2-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={isUnits ? 'ค้นหาหน่วย (รหัสหรือชื่อ)' : 'ค้นหาหมวดหมู่'} aria-label={`ค้นหา${noun}`} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </select>
      </FilterBar>

      <ContentCard padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อ{noun}</th>
                {isUnits ? <th>ถูกใช้งานที่</th> : <th className="num">จำนวนรายการ</th>}
                <th>สถานะ</th>
              </tr>
            </thead>
            {loading ? <SkeletonRows rows={8} cols={4} /> : (
              <tbody>
                {visible.map((r) => {
                  const u = usage.get(r.code);
                  return (
                    <tr key={r.id}>
                      <td data-label="รหัส"><span className="unit-code">{r.code}</span></td>
                      <td data-label={`ชื่อ${noun}`}>{r.name}</td>
                      {isUnits
                        ? <td data-label="ถูกใช้งานที่"><UnitUsage usage={u} /></td>
                        : <td className="num" data-label="จำนวนรายการ">{(r as Category).itemCount ?? 0}</td>}
                      <td data-label="สถานะ">
                        <span className={`badge ${r.isActive ? 'success' : 'muted'}`}>{r.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>

        {failed && !loading && <EmptyState variant="error" icon={AlertTriangle} title="โหลดข้อมูลไม่สำเร็จ" description="ลองใหม่อีกครั้ง" />}
        {!loading && !failed && visible.length === 0 && (
          hasFilter
            ? <EmptyState icon={isUnits ? Scale : Tags} title="ไม่พบรายการที่ค้นหา" description="ลองเปลี่ยนคำค้นหรือล้างตัวกรอง"
                action={<button type="button" className="btn" onClick={() => { setSearch(''); setStatus(''); }}>ล้างตัวกรอง</button>} />
            : <EmptyState icon={isUnits ? Scale : Tags} title={`ยังไม่มี${noun}`}
                description={isUnits ? 'เพิ่มหน่วยที่ใช้ซื้อและใช้ในสูตร เช่น KG, G, L, ML, ชิ้น' : 'เพิ่มหมวดหมู่เพื่อจัดกลุ่มวัตถุดิบและบรรจุภัณฑ์'}
                action={canManage ? <button type="button" className="btn primary" onClick={() => setAddOpen(true)}><Plus aria-hidden />เพิ่ม{noun}</button> : undefined} />
        )}
      </ContentCard>

      {isUnits && <p className="md-note">
        <Info aria-hidden />
        หน่วยที่ถูกใช้อยู่ในสินค้าหรือสูตรแปลง จะลบไม่ได้เพื่อไม่ให้ต้นทุนที่คำนวณไว้แล้วเสียหาย
      </p>}

      <MasterModal
        open={addOpen}
        title={`เพิ่ม${noun}`}
        description={isUnits
          ? 'ใส่ตัวย่อที่จะเห็นในตาราง และชื่อเต็มที่คนอ่านเข้าใจ'
          : 'ชื่อหมวดหมู่ที่จะใช้จัดกลุ่มในทะเบียนวัตถุดิบและบรรจุภัณฑ์'}
        error={formError}
        busy={saving}
        confirmLabel={`เพิ่ม${noun}`}
        confirmIcon={<Plus aria-hidden width={16} />}
        onClose={() => setAddOpen(false)}
        onConfirm={() => void save()}
      >
        <div className="md-fields">
          <label>รหัส *
            <input autoFocus value={draft.code} placeholder={isUnits ? 'เช่น ML' : 'เช่น CAT-01'}
              onChange={(e) => setDraft((d) => ({ ...d, code: isUnits ? e.target.value.toUpperCase() : e.target.value }))} />
          </label>
          <label>ชื่อ{noun} *
            <input value={draft.name} placeholder={isUnits ? 'เช่น มิลลิลิตร' : 'เช่น เนื้อสัตว์'}
              onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void save(); } }} />
          </label>
          {isUnits && <p className="md-hint full">
            หน่วยเก็บเฉพาะรหัสและชื่อ · ความสัมพันธ์ เช่น 1 KG = 1000 G ตั้งที่หน้า “สูตรแปลงหน่วย”
          </p>}
        </div>
      </MasterModal>
    </PageContainer>
  );
}

/** ที่ที่หน่วยนี้ถูกอ้างอิงอยู่ — บอกเป็นตัวเลขจริง ไม่ใช่แค่ ใช้/ไม่ใช้ */
function UnitUsage({ usage }: { usage?: { items: number; conversions: number } }) {
  if (!usage || (usage.items === 0 && usage.conversions === 0)) {
    return <span className="md-conv same">ยังไม่ถูกใช้งาน</span>;
  }
  return <span className="md-usage">
    {usage.items > 0 && <span className="md-conv">สินค้า {usage.items}</span>}
    {usage.conversions > 0 && <span className="md-conv">สูตรแปลง {usage.conversions}</span>}
  </span>;
}
