import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Boxes, CheckCircle2, Info, Pencil, Plus, Power, Truck,
  Warehouse as WarehouseIcon, PackageSearch,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useToast } from '@/components/ui/Toast';
import { masterConflictMessage, findExisting } from '@/lib/master-validation';
import { partnerApi, warehouseStockBlockMessage, type PartnerStatus, type Supplier, type Warehouse } from '@/lib/partner-api';
import MasterModal from '@/components/ui/MasterModal';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';

/**
 * PHASE 7B — ผู้จำหน่าย และ คลัง
 *
 * อ่านจาก GET /business/suppliers และ GET /business/warehouses ที่เปิดใน Phase 7B
 * (เดิมอ่านผ่าน operations/lookups ซึ่งเห็นแค่ code/name และเฉพาะที่ใช้งานอยู่)
 *
 * แสดงเฉพาะ field ที่ schema มีจริง:
 *   Supplier — code, name, phone, email, taxId, address, isActive, receivingCount
 *   Warehouse — code, name, type, isActive, itemCount, stockValue
 * ไม่มี contactName / description / location เพราะ DB ไม่มีคอลัมน์เหล่านั้น
 *
 * แก้จำนวนสต็อกผ่านหน้านี้ไม่ได้ — PATCH ฝั่ง backend รับเฉพาะ field ของ master
 */

type Section = 'suppliers' | 'warehouses';

/**
 * PHASE 8 (carryover) — ประเภทคลังใช้ enum ItemType ของ schema จริง
 * คำแปลยกมาจากที่ระบบใช้อยู่แล้วในหน้าสินค้า ไม่ได้คิดคำใหม่
 * WASTE มีใน enum แต่ไม่เคยมีคำแปลในระบบ จึงแสดงค่าดิบ ไม่เดา
 */
const WAREHOUSE_TYPES: { value: string; label: string }[] = [
  { value: '', label: 'ทุกประเภท (ไม่ระบุ)' },
  { value: 'RAW_MATERIAL', label: 'วัตถุดิบ' },
  { value: 'PACKAGING', label: 'บรรจุภัณฑ์' },
  { value: 'FINISHED_GOOD', label: 'สินค้าสำเร็จรูป' },
  { value: 'SEMI_FINISHED', label: 'กึ่งสำเร็จรูป' },
  { value: 'CONSUMABLE', label: 'วัสดุสิ้นเปลือง' },
  { value: 'WASTE', label: 'WASTE' },
];
/**
 * PHASE 12 — เดิมฟังก์ชันนี้คืนคำของ "ตัวกรอง" คือ "ทุกประเภท (ไม่ระบุ)"
 * ทำให้คลังจริงที่ยังไม่ได้ตั้งประเภท (เช่น คลังครัวสดดี) แสดงในคอลัมน์ประเภทว่า
 * "ทุกประเภท (ไม่ระบุ)" ซึ่งอ่านแล้วเหมือนคลังนั้นเป็นได้ทุกประเภท
 * แถวข้อมูลจึงใช้คำว่า "ไม่ระบุ" ส่วน dropdown ยังใช้คำเดิม
 */
const warehouseTypeLabel = (v: string | null | undefined) => {
  if (!v) return 'ไม่ระบุ';
  return WAREHOUSE_TYPES.find((t) => t.value === v)?.label ?? v;
};
type Draft = { id?: string; name: string; code: string; phone: string; taxId: string; email: string; address: string; type: string };
const EMPTY_DRAFT: Draft = { name: '', code: '', phone: '', taxId: '', email: '', address: '', type: '' };

const money = (v: number) => `฿${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qty = (v: number) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });

export default function PartnerMastersPage({ section }: { section: Section }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isSupplier = section === 'suppliers';
  const noun = isSupplier ? 'ผู้จำหน่าย' : 'คลัง';

  // สิทธิ์แก้ไขผูกกับ RECEIVING_CREATE เท่ากับที่ backend บังคับใน PATCH
  const canEdit = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('RECEIVING_CREATE'));
  const canViewSupplierAnalytics = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.some((code) => code === 'RECEIVING_VIEW' || code === 'PURCHASE_ORDER_VIEW'));

  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PartnerStatus>('active');
  const [modalOpen, setModalOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [formError, setFormError] = useState('');
  const [toggling, setToggling] = useState<Supplier | Warehouse | null>(null);
  const [toggleError, setToggleError] = useState('');

  // ทั้งสองชนิดใช้ query เดียวกัน จึงประกาศผลเป็น union ของสองแบบ
  const list = useQuery<(Supplier | Warehouse)[]>({
    queryKey: ['partners', section, { search, status }],
    queryFn: async () => (isSupplier
      ? partnerApi.suppliers({ keyword: search, status })
      : partnerApi.warehouses({ keyword: search, status })),
  });

  const rows = useMemo(() => list.data ?? [], [list.data]);
  const suppliers = useMemo(() => (isSupplier ? (rows as Supplier[]) : []), [isSupplier, rows]);
  const warehouses = useMemo(() => (isSupplier ? [] : (rows as Warehouse[])), [isSupplier, rows]);

  /** สร้าง/แก้ไขแล้วต้องล้าง cache ทั้ง master list และ lookups ที่ picker ใช้ */
  const invalidateAll = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['partners'] }),
      qc.invalidateQueries({ queryKey: ['operations-lookups'] }),
    ]);
    // หน้ารับของ/เบิกโหลด lookups เองผ่าน apiClient ไม่ผ่าน react-query
    // จึงส่งสัญญาณให้หน้าที่เปิดค้างอยู่รีเฟรชเมื่อกลับมาโฟกัส
    window.dispatchEvent(new CustomEvent('s2a:master-updated', { detail: { section } }));
  };

  const save = useMutation({
    mutationFn: async () => {
      const name = draft.name.trim();
      const code = draft.code.trim();
      if (draft.id) {
        return isSupplier
          ? partnerApi.updateSupplier(draft.id, { name, code: code || undefined, phone: draft.phone, taxId: draft.taxId, email: draft.email, address: draft.address })
          : partnerApi.updateWarehouse(draft.id, { name, code: code || undefined, type: draft.type || null });
      }
      return isSupplier
        ? partnerApi.createSupplier({ name, code: code || undefined, phone: draft.phone || undefined, taxId: draft.taxId || undefined, email: draft.email || undefined, address: draft.address || undefined })
        : partnerApi.createWarehouse({ name, code: code || undefined });
    },
    onSuccess: async () => {
      toast({ title: draft.id ? `บันทึกข้อมูล${noun}แล้ว` : `เพิ่ม${noun} “${draft.name.trim()}” แล้ว`, variant: 'success' });
      setModalOpen(false); setDraft(EMPTY_DRAFT); setExpanded(false);
      await invalidateAll();
    },
    onError: (e) => setFormError(masterConflictMessage(e, isSupplier ? 'supplier' : 'warehouse', draft.code.trim() || draft.name.trim())),
  });

  const toggleActive = useMutation<Supplier | Warehouse, Error, Supplier | Warehouse>({
    mutationFn: async (row) => (isSupplier
      ? partnerApi.updateSupplier(row.id, { isActive: !row.isActive })
      : partnerApi.updateWarehouse(row.id, { isActive: !row.isActive })),
    onSuccess: async (_d, row) => {
      toast({ title: row.isActive ? `ปิดใช้งาน${noun}แล้ว` : `เปิดใช้งาน${noun}แล้ว`, variant: 'success' });
      setToggling(null); setToggleError('');
      await invalidateAll();
    },
    onError: (e) => {
      // คลังที่ยังมีของ — ใช้ยอดจริงจาก backend ไม่แต่งตัวเลขเอง
      setToggleError(warehouseStockBlockMessage(e) ?? masterConflictMessage(e, isSupplier ? 'supplier' : 'warehouse'));
    },
  });

  const submit = () => {
    const name = draft.name.trim();
    if (!name) { setFormError(`กรอกชื่อ${noun}`); return; }
    // กันสร้างซ้ำตั้งแต่ฝั่ง UI (ตอนแก้ไขไม่นับตัวเอง)
    const others = rows.filter((r) => r.id !== draft.id);
    const dup = findExisting(others, name) ?? (draft.code.trim() ? findExisting(others, draft.code.trim()) : null);
    if (dup) { setFormError(`มี${noun} ${dup.name} อยู่ในระบบแล้ว`); return; }
    setFormError('');
    save.mutate();
  };

  const openCreate = () => { setDraft(EMPTY_DRAFT); setFormError(''); setExpanded(false); setModalOpen(true); };
  const openEdit = (row: Supplier | Warehouse) => {
    const s = isSupplier ? (row as Supplier) : null;
    setDraft({
      id: row.id, name: row.name, code: row.code,
      phone: s?.phone ?? '', taxId: s?.taxId ?? '', email: s?.email ?? '', address: s?.address ?? '',
      type: isSupplier ? '' : ((row as Warehouse).type ?? ''),
    });
    setFormError(''); setExpanded(Boolean(s?.phone || s?.email || s?.taxId || s?.address)); setModalOpen(true);
  };

  const totals = useMemo(() => ({
    receipts: suppliers.reduce((s, r) => s + r.receivingCount, 0),
    items: warehouses.reduce((s, r) => s + r.itemCount, 0),
    value: warehouses.reduce((s, r) => s + r.stockValue, 0),
  }), [suppliers, warehouses]);

  const hasFilter = Boolean(search) || status !== 'active';

  return (
    <PageContainer size="wide" className="master-page partner-page">
      <PageHeader
        breadcrumb="ข้อมูลตั้งต้น"
        title={isSupplier ? 'ผู้จำหน่าย' : 'คลัง'}
        description={isSupplier
          ? 'ผู้ขายที่ใช้อ้างอิงในใบรับของ — เพิ่มไว้ล่วงหน้าเพื่อไม่ต้องพิมพ์ชื่อซ้ำทุกครั้ง'
          : 'คลังที่ใช้เก็บของจริง — จำนวนสต็อกแก้ที่นี่ไม่ได้ ต้องทำผ่านเอกสารรับ/เบิก/ปรับปรุง'}
        actions={<>
          {isSupplier && canViewSupplierAnalytics && <Link className="btn" to="/supplier-analytics"><PackageSearch aria-hidden width={16} />วิเคราะห์การซื้อ</Link>}
          {canEdit && <button type="button" className="btn primary" onClick={openCreate}><Plus aria-hidden width={16} />เพิ่ม{noun}</button>}
        </>}
      />

      {list.isError && <div className="rb-callout warn" role="alert">
        <AlertTriangle aria-hidden /><div><strong>{list.error instanceof Error ? list.error.message : `โหลดรายการ${noun}ไม่สำเร็จ`}</strong></div>
      </div>}

      <KPIGrid columns={isSupplier ? 3 : 4}>
        <KPICard label={`${noun}ทั้งหมด`} value={list.isLoading ? '—' : rows.length}
          icon={isSupplier ? <Truck /> : <WarehouseIcon />} hint={hasFilter ? 'ตามตัวกรองปัจจุบัน' : 'ที่ใช้งานอยู่'} />
        <KPICard label="ใช้งานอยู่" value={list.isLoading ? '—' : rows.filter((r) => r.isActive).length} icon={<CheckCircle2 />}
          hint="เลือกได้ในเอกสารใหม่" />
        {isSupplier
          ? <KPICard label="ใบรับของทั้งหมด" value={totals.receipts} icon={<PackageSearch />} hint="ทุกผู้จำหน่ายรวมกัน" />
          : <>
              <KPICard label="รายการสินค้าในคลัง" value={totals.items} icon={<Boxes />} hint="นับสินค้าไม่ซ้ำ" />
              <KPICard label="มูลค่าสต็อกรวม" value={money(totals.value)} icon={<PackageSearch />} hint="คงเหลือ × ต้นทุนล่าสุด" />
            </>}
      </KPIGrid>

      <FilterBar actions={hasFilter
        ? <button type="button" className="btn" onClick={() => { setSearch(''); setStatus('active'); }}>ล้างตัวกรอง</button>
        : undefined}>
        <input className="s2-search" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder={isSupplier ? 'ค้นหาชื่อ รหัส เบอร์โทร หรืออีเมล' : 'ค้นหาคลัง (ชื่อหรือรหัส)'} aria-label={`ค้นหา${noun}`} />
        <select value={status} onChange={(e) => setStatus(e.target.value as PartnerStatus)} aria-label="สถานะ">
          <option value="active">ใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
          <option value="all">ทุกสถานะ</option>
        </select>
      </FilterBar>

      <ContentCard padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table">
            <thead>
              <tr>
                <th>รหัส</th><th>ชื่อ{noun}</th>
                {isSupplier
                  ? <><th>ติดต่อ</th><th className="num">ใบรับของ</th></>
                  : <><th>ประเภท</th><th className="num">รายการสินค้า</th><th className="num">มูลค่าสต็อก</th></>}
                <th>สถานะ</th><th>จัดการ</th>
              </tr>
            </thead>
            {list.isLoading ? <SkeletonRows rows={6} cols={isSupplier ? 6 : 7} /> : (
              <tbody>
                {isSupplier && suppliers.map((r) => (
                  <tr key={r.id}>
                    <td data-label="รหัส"><span className="unit-code">{r.code}</span></td>
                    <td data-label="ชื่อผู้จำหน่าย"><span className="md-two-line"><b>{r.name}</b>{r.taxId && <small>เลขภาษี {r.taxId}</small>}</span></td>
                    <td data-label="ติดต่อ"><Contact phone={r.phone} email={r.email} /></td>
                    <td className="num" data-label="ใบรับของ">{r.receivingCount}</td>
                    <td data-label="สถานะ"><StatusPill active={r.isActive} /></td>
                    <td data-label="จัดการ"><RowActions row={r} canEdit={canEdit} onEdit={openEdit} onToggle={setToggling} /></td>
                  </tr>
                ))}
                {!isSupplier && warehouses.map((r) => (
                  <tr key={r.id}>
                    <td data-label="รหัส"><span className="unit-code">{r.code}</span></td>
                    <td data-label="ชื่อคลัง"><b>{r.name}</b></td>
                    <td data-label="ประเภท">{warehouseTypeLabel(r.type)}</td>
                    <td className="num" data-label="รายการสินค้า">{r.itemCount}</td>
                    <td className="num" data-label="มูลค่าสต็อก">{money(r.stockValue)}</td>
                    <td data-label="สถานะ"><StatusPill active={r.isActive} /></td>
                    <td data-label="จัดการ">
                      <div className="md-row-actions">
                        <Link className="btn" to={`/inventory?warehouse=${encodeURIComponent(r.id)}`}>ดูสต็อกในคลัง</Link>
                        <RowActions row={r} canEdit={canEdit} onEdit={openEdit} onToggle={setToggling} bare />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {!list.isLoading && !list.isError && rows.length === 0 && (
          hasFilter
            ? <EmptyState icon={isSupplier ? Truck : WarehouseIcon} title="ไม่พบรายการที่ค้นหา" description="ลองเปลี่ยนคำค้นหรือล้างตัวกรอง"
                action={<button type="button" className="btn" onClick={() => { setSearch(''); setStatus('active'); }}>ล้างตัวกรอง</button>} />
            : <EmptyState icon={isSupplier ? Truck : WarehouseIcon} title={`ยังไม่มี${noun}`}
                description={isSupplier ? 'เพิ่มผู้จำหน่ายรายแรกเพื่อใช้อ้างอิงในใบรับของ' : 'เพิ่มคลังแรกเพื่อเริ่มรับของเข้าระบบ'}
                action={canEdit ? <button type="button" className="btn primary" onClick={openCreate}><Plus aria-hidden />เพิ่ม{noun}</button> : undefined} />
        )}
      </ContentCard>

      <p className="md-note">
        <Info aria-hidden />
        {isSupplier
          ? 'ปิดใช้งานแล้วจะไม่ปรากฏให้เลือกในเอกสารใหม่ แต่ใบรับของเดิมยังแสดงชื่อผู้จำหน่ายได้ตามปกติ'
          : 'ปิดใช้งานได้เฉพาะคลังที่ไม่มีสินค้าคงเหลือ · เอกสารเดิมยังแสดงชื่อคลังได้เสมอ'}
      </p>

      {/* สร้าง / แก้ไข ใช้ modal ตัวเดียวกัน (pattern จาก Phase 7) */}
      <MasterModal
        open={modalOpen}
        title={draft.id ? `แก้ไข${noun}` : `เพิ่ม${noun}`}
        description={draft.id
          ? 'แก้ได้เฉพาะข้อมูลทะเบียน — ไม่กระทบเอกสารหรือสต็อกที่บันทึกไว้แล้ว'
          : (isSupplier ? 'กรอกแค่ชื่อก็บันทึกได้ · รายละเอียดอื่นเพิ่มทีหลังได้' : 'กรอกชื่อคลัง · ระบบจะออกรหัสให้อัตโนมัติถ้าไม่ระบุ')}
        error={formError}
        busy={save.isPending}
        confirmLabel={draft.id ? 'บันทึกการแก้ไข' : `เพิ่ม${noun}`}
        confirmIcon={draft.id ? <Pencil aria-hidden width={16} /> : <Plus aria-hidden width={16} />}
        onClose={() => setModalOpen(false)}
        onConfirm={submit}
        width={isSupplier && expanded ? 640 : 560}
      >
        <div className="md-fields">
          <label className="full">ชื่อ{noun} *
            <input autoFocus value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              placeholder={isSupplier ? 'เช่น บจก. วัตถุดิบไทย' : 'เช่น คลังกลาง'}
              onKeyDown={(e) => { if (e.key === 'Enter' && !expanded) { e.preventDefault(); submit(); } }} />
          </label>
          <label className="full">รหัส
            <input value={draft.code} onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
              placeholder={draft.id ? '' : '(เว้นว่างให้ระบบออกให้)'} />
          </label>

          {!isSupplier && draft.id && (
            <label className="full">ประเภทคลัง
              <select value={draft.type} onChange={(e) => setDraft((d) => ({ ...d, type: e.target.value }))}>
                {WAREHOUSE_TYPES.map((t) => <option key={t.value || 'none'} value={t.value}>{t.label}</option>)}
              </select>
              <span className="md-hint">
                เป็นป้ายกำกับว่าคลังนี้ใช้เก็บของประเภทใด · ไม่มีผลต่อการรับ เบิก หรือตัดสต็อก
              </span>
            </label>
          )}

          {isSupplier && !expanded && (
            <button type="button" className="btn full" onClick={() => setExpanded(true)}>เพิ่มรายละเอียดผู้จำหน่าย</button>
          )}
          {isSupplier && expanded && <>
            <label>เบอร์โทร
              <input value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} placeholder="02-000-0000" />
            </label>
            <label>เลขผู้เสียภาษี
              <input value={draft.taxId} onChange={(e) => setDraft((d) => ({ ...d, taxId: e.target.value }))} />
            </label>
            <label className="full">อีเมล
              <input type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} placeholder="sales@example.com" />
            </label>
            <label className="full">ที่อยู่
              <textarea value={draft.address} onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))} placeholder="ที่อยู่สำหรับออกเอกสาร" />
            </label>
          </>}
        </div>
      </MasterModal>

      {/* เปิด/ปิดใช้งาน — บอกผลกระทบก่อน และแสดงเหตุผลถ้า backend บล็อก */}
      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive ? `ปิดใช้งาน${noun}` : `เปิดใช้งาน${noun}`}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        confirmLabel={toggling?.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        onClose={() => { setToggling(null); setToggleError(''); }}
        onConfirm={toggling ? () => toggleActive.mutate(toggling) : undefined}
        description={toggling ? <div className="op-confirm">
          <dl>
            <div><dt>รายการ</dt><dd>{toggling.name}</dd></div>
            <div><dt>รหัส</dt><dd>{toggling.code}</dd></div>
            {!isSupplier && <div><dt>คงเหลือในคลัง</dt><dd>{qty((toggling as Warehouse).onHand)}</dd></div>}
            {isSupplier && <div><dt>ใบรับของ</dt><dd>{(toggling as Supplier).receivingCount} ใบ</dd></div>}
          </dl>
          <p className="op-confirm-impact">
            {toggling.isActive
              ? `เมื่อปิดใช้งาน จะไม่ปรากฏให้เลือกในเอกสารใหม่ แต่เอกสารเดิมทั้งหมดยังแสดงชื่อ${noun}นี้ได้ตามปกติ`
              : `เมื่อเปิดใช้งาน จะกลับมาเลือกได้ในเอกสารใหม่`}
          </p>
          {toggleError && <p className="md-error" role="alert"><AlertTriangle aria-hidden />{toggleError}</p>}
        </div> : ''}
      />
    </PageContainer>
  );
}

function StatusPill({ active }: { active: boolean }) {
  return <span className={`badge ${active ? 'success' : 'muted'}`}>{active ? 'ใช้งาน' : 'ปิดใช้งาน'}</span>;
}

/** ช่องติดต่อ — แสดงเฉพาะที่มีค่าจริง ไม่โชว์ช่องว่างหลอกตา */
function Contact({ phone, email }: { phone: string | null; email: string | null }) {
  if (!phone && !email) return <span className="md-conv same">—</span>;
  return <span className="md-two-line">
    {phone && <b>{phone}</b>}
    {email && <small>{email}</small>}
  </span>;
}

function RowActions({ row, canEdit, onEdit, onToggle, bare }: {
  row: Supplier | Warehouse;
  canEdit: boolean;
  onEdit: (row: Supplier | Warehouse) => void;
  onToggle: (row: Supplier | Warehouse) => void;
  bare?: boolean;
}) {
  if (!canEdit) return <span className="md-conv same">ดูอย่างเดียว</span>;
  const buttons = <>
    <button type="button" className="icon-btn" onClick={() => onEdit(row)} aria-label={`แก้ไข ${row.name}`} title="แก้ไข">
      <Pencil aria-hidden width={16} />
    </button>
    <button type="button" className="icon-btn" onClick={() => onToggle(row)}
      aria-label={`${row.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${row.name}`} title={row.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}>
      <Power aria-hidden width={16} />
    </button>
  </>;
  return bare ? buttons : <div className="md-row-actions">{buttons}</div>;
}
