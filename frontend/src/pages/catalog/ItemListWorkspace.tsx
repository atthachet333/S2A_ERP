import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import {
  Plus, CheckCircle2, AlertTriangle, Pencil, Power, ImageOff, Ruler,
  LayoutGrid, List, CircleDollarSign, PackagePlus, type LucideIcon,
} from 'lucide-react';
import { catalogApi, type Item, type ItemType } from '@/lib/catalog';
import { useAuth } from '@/auth/AuthContext';
import { canReceiveStock, receivingAccess } from '@/lib/stock-receiving';
import StockReceivingDialog, { type StockReceivingResult } from '@/components/inventory/StockReceivingDialog';
import ReceivingSuccessCard from '@/components/inventory/ReceivingSuccessCard';
import { formatThaiDate } from '@/lib/utils';
import { itemPriceDisplay, needsConversion } from '@/lib/item-unit-price';
import Badge from '@/components/ui/Badge';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';

export interface ItemListVariant {
  kind: 'ingredient' | 'packaging';
  type: ItemType;
  eyebrow: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  newPath: string;
  itemPath: (id: string) => string;
  addLabel: string;
  totalLabel: string;
  emptyTitle: string;
  emptyDesc: string;
  searchPlaceholder: string;
  costLabel: string;
}
const PAGE_SIZE = 12;

export default function ItemListWorkspace({ variant }: { variant: ItemListVariant }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  /* PHASE 20C — กรองตามคุณภาพข้อมูล
     เดิมการ์ด KPI บอกจำนวน "ยังไม่มีราคาซื้อ" ได้ แต่ผู้ใช้หาไม่เจอว่าเป็นรายการไหน
     ต้องไล่ดูทีละหน้า ตัวกรองนี้ทำให้กดจากการ์ดแล้วเห็นเฉพาะรายการที่ต้องแก้ */
  const [dataIssue, setDataIssue] = useState('');
  const [page, setPage] = useState(1);
  const [view, setView] = useState<'table' | 'cards'>('table');
  const [toggling, setToggling] = useState<Item | null>(null);
  /* PHASE 35 — นำเข้าสต็อกจากหน้ารายการโดยตรง
     เปิดจากแถวไหน วัตถุดิบนั้นถูกเลือกไว้ให้แล้ว ไม่ต้องค้นซ้ำ */
  const { user } = useAuth();
  const access = receivingAccess(user?.roles, user?.permissions);
  const canReceive = canReceiveStock(access);
  const [receivingItem, setReceivingItem] = useState<Item | null>(null);
  /* เปิดจากปุ่มบนหัวหน้าจอ = ยังไม่ระบุวัตถุดิบ ให้เลือกใน modal */
  const [receivingPicker, setReceivingPicker] = useState(false);
  const [receivedResult, setReceivedResult] = useState<StockReceivingResult | null>(null);
  const openRowReceiving = (row: Item) => { setReceivedResult(null); setReceivingItem(row); };
  const closeReceiving = () => { setReceivingItem(null); setReceivingPicker(false); };
  const Icon = variant.icon;
  const noun = variant.kind === 'packaging' ? 'บรรจุภัณฑ์' : 'วัตถุดิบ';

  const list = useQuery({
    queryKey: ['items', variant.type, { search, status, dataIssue, page }],
    queryFn: () => catalogApi.items({ type: variant.type, search, status, dataIssue, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });

  /**
   * KPI ต้องนับจากทั้งชุด ไม่ใช่เฉพาะหน้าที่เปิดอยู่
   * /items/summary มีจริงแต่ไม่แยกตามชนิด (นับวัตถุดิบ+บรรจุภัณฑ์รวมกัน) จึงใช้ไม่ได้ที่นี่
   * selectableItems(type) คืนรายการ active ทั้งหมดของชนิดนี้ — เป็น scope ที่ตรงกับคำถามพอดี
   * เพราะ KPI ทั้งสามตัวถามถึงของที่กำลังจะถูกใช้ในสูตรจริง
   */
  const activeAll = useQuery({
    queryKey: ['selectable-items', variant.type],
    queryFn: () => catalogApi.selectableItems(variant.type),
  });

  const kpi = useMemo(() => {
    const rows = activeAll.data;
    if (!rows) return null;
    return {
      active: rows.length,
      noPrice: rows.filter((r) => r.lastCost <= 0).length,
      noFactor: rows.filter((r) => needsConversion(r)).length,
    };
  }, [activeAll.data]);

  const toggle = useMutation({
    mutationFn: (item: Item) => (item.isActive ? catalogApi.deactivateItem(item.id) : catalogApi.activateItem(item.id)),
    onSuccess: (_d, item) => {
      toast(item.isActive ? 'ปิดการใช้งานแล้ว' : 'เปิดการใช้งานแล้ว');
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['selectable-items'] });
    },
    onError: (e) => toast(e instanceof Error ? e.message : 'ทำรายการไม่สำเร็จ', 'error'),
  });

  const rows = list.data?.items ?? [];
  const total = list.data?.total ?? 0;
  const totalPages = list.data?.totalPages ?? 1;
  const resetPage = () => setPage(1);
  const hasFilter = Boolean(search || status || dataIssue);

  return (
    <PageContainer size="wide" className="master-page item-list-workspace">
      <PageHeader
        breadcrumb={variant.eyebrow}
        title={variant.title}
        description={variant.subtitle}
        actions={<>
          {variant.kind === 'ingredient' && kpi && kpi.noPrice > 0 && (
            /* PHASE 21 — ทางลัดไปเติมราคาทีเดียวหลายรายการ แสดงเฉพาะตอนที่ยังมีของค้างจริง */
            <Link to="/ingredients/cost-completion" className="btn"><CircleDollarSign aria-hidden width={16} />เติมข้อมูลต้นทุน ({kpi.noPrice})</Link>
          )}
          <Link to="/units/conversions" className="btn"><Ruler aria-hidden width={16} />สูตรแปลงหน่วย</Link>
          {canReceive && (
            <button type="button" className="btn" onClick={() => { setReceivedResult(null); setReceivingPicker(true); }}>
              <PackagePlus aria-hidden width={16} />นำเข้าสต็อก
            </button>
          )}
          <Link to={variant.newPath} className="btn primary"><Plus aria-hidden width={16} />{variant.addLabel}</Link>
        </>}
      />

      {receivedResult && (
        <ReceivingSuccessCard result={receivedResult} onDismiss={() => setReceivedResult(null)} />
      )}

      <KPIGrid columns={4}>
        <KPICard label={variant.totalLabel} value={total} icon={<Icon />} hint={hasFilter ? 'ตามตัวกรองปัจจุบัน' : 'ทุกสถานะ'} />
        <KPICard label="ใช้งานอยู่" value={kpi ? kpi.active : '—'} icon={<CheckCircle2 />} hint="เลือกใช้ในสูตรได้" />
        <KPICard label="ยังไม่มีราคาซื้อ" value={kpi ? kpi.noPrice : '—'} icon={<AlertTriangle />}
          tone={kpi && kpi.noPrice > 0 ? 'warning' : 'default'}
          hint={kpi && kpi.noPrice > 0 ? 'คิดต้นทุนไม่ได้จนกว่าจะใส่ราคา — กดเพื่อดูรายการ' : 'คิดต้นทุนไม่ได้จนกว่าจะใส่ราคา'}
          active={dataIssue === 'noPrice'}
          onClick={kpi && kpi.noPrice > 0 ? () => { setDataIssue(dataIssue === 'noPrice' ? '' : 'noPrice'); setStatus(''); resetPage(); } : undefined} />
        <KPICard label="ยังไม่ตั้งอัตราแปลง" value={kpi ? kpi.noFactor : '—'} icon={<Ruler />}
          tone={kpi && kpi.noFactor > 0 ? 'warning' : 'default'}
          hint={kpi && kpi.noFactor > 0 ? 'มีหน่วยซื้อแยก แต่ยังไม่ระบุอัตรา — กดเพื่อดูรายการ' : 'มีหน่วยซื้อแยก แต่ยังไม่ระบุอัตรา'}
          active={dataIssue === 'noFactor'}
          onClick={kpi && kpi.noFactor > 0 ? () => { setDataIssue(dataIssue === 'noFactor' ? '' : 'noFactor'); setStatus(''); resetPage(); } : undefined} />
      </KPIGrid>

      <FilterBar actions={<>
        {hasFilter && <button type="button" className="btn" onClick={() => { setSearch(''); setStatus(''); setDataIssue(''); resetPage(); }}>ล้างตัวกรอง</button>}
        <div className="view-toggle" role="group" aria-label="รูปแบบการแสดงผล">
          <button type="button" className={view === 'table' ? 'active' : ''} onClick={() => setView('table')}
            aria-pressed={view === 'table'} aria-label="มุมมองตาราง"><List aria-hidden /></button>
          <button type="button" className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')}
            aria-pressed={view === 'cards'} aria-label="มุมมองการ์ด"><LayoutGrid aria-hidden /></button>
        </div>
      </>}>
        <input className="s2-search" placeholder={variant.searchPlaceholder} value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }} aria-label={`ค้นหา${noun}`} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); resetPage(); }} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </select>
        <select value={dataIssue} onChange={(e) => { setDataIssue(e.target.value); resetPage(); }} aria-label="ความครบถ้วนของข้อมูล">
          <option value="">ข้อมูลครบและไม่ครบ</option>
          <option value="noPrice">เฉพาะที่ยังไม่มีราคาซื้อ</option>
          <option value="noFactor">เฉพาะที่ยังไม่ตั้งอัตราแปลง</option>
        </select>
      </FilterBar>

      <ContentCard padded={false}>
        {view === 'cards' && !list.isLoading && rows.length > 0 && (
          <div className="item-card-grid">
            {rows.map((item) => {
              const p = itemPriceDisplay({
                lastCost: item.lastCost, purchaseToBaseFactor: item.purchaseToBaseFactor,
                purchaseUnitCode: item.purchaseUnit?.code, baseUnitCode: item.baseUnit?.code,
              });
              return (
                <article className="item-visual-card" key={item.id}>
                  <Thumb url={item.imageUrl} />
                  <div>
                    <div className="item-card-head">
                      <span className="unit-tag">{item.baseUnit?.code ?? '—'}</span>
                      {item.isActive ? <Badge variant="success" dot>ใช้งาน</Badge> : <Badge variant="muted">ปิดใช้งาน</Badge>}
                    </div>
                    <small>{item.code}</small>
                    <h3>{item.name}</h3>
                    <p>{item.category?.name ?? variant.title}</p>
                    <span className="md-price">
                      {p.base ? <><b>{p.base}</b>{p.purchase && <small>ซื้อ {p.purchase}</small>}</> : <span className="md-none">ยังไม่มีราคาซื้อ</span>}
                    </span>
                    <Link className="btn" to={variant.itemPath(item.id)}>ดูรายละเอียด</Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {view === 'table' && (
          <div className="table-wrap">
            <table className="data-table md-table">
              <thead>
                <tr>
                  <th>รูป</th><th>รหัส</th>
                  <th className="item-name-col">ชื่อ{noun}</th>
                  <th>หมวด</th>
                  <th>หน่วยซื้อ</th><th>หน่วยฐาน</th><th>อัตราแปลง</th>
                  <th className="num">ราคาซื้อล่าสุด</th>
                  <th className="num">{variant.costLabel}</th>
                  <th>สถานะ</th><th>อัปเดตล่าสุด</th><th>จัดการ</th>
                </tr>
              </thead>
              {list.isLoading ? <SkeletonRows rows={8} cols={12} /> : (
                <tbody>
                  {rows.map((item) => {
                    const p = itemPriceDisplay({
                      lastCost: item.lastCost, purchaseToBaseFactor: item.purchaseToBaseFactor,
                      purchaseUnitCode: item.purchaseUnit?.code, baseUnitCode: item.baseUnit?.code,
                    });
                    return (
                      <tr key={item.id}>
                        <td data-label="รูป"><Thumb url={item.imageUrl} /></td>
                        <td data-label="รหัส"><span className="num">{item.code}</span></td>
                        <td data-label={`ชื่อ${noun}`}>
                          <span className="md-two-line"><b>{item.name}</b>{item.barcode && <small>{item.barcode}</small>}</span>
                        </td>
                        <td data-label="หมวด">{item.category?.name ?? '—'}</td>
                        <td data-label="หน่วยซื้อ">{item.purchaseUnit?.code ?? item.baseUnit?.code ?? '—'}</td>
                        <td data-label="หน่วยฐาน">{item.baseUnit?.code ?? '—'}</td>
                        {/* อัตราแปลงคือตัวเชื่อมที่ทำให้เข้าใจว่า 47/L กับ 0.047/ML คือราคาเดียวกัน */}
                        <td data-label="อัตราแปลง"><ConversionCell display={p} /></td>
                        <td className="num" data-label="ราคาซื้อล่าสุด">
                          {p.purchase ?? <span className="md-none">—</span>}
                        </td>
                        <td className="num" data-label={variant.costLabel}>
                          {p.base ? <b>{p.base}</b> : <span className="md-none">ยังไม่มีราคา</span>}
                        </td>
                        <td data-label="สถานะ">{item.isActive ? <Badge variant="success" dot>ใช้งาน</Badge> : <Badge variant="muted" dot>ปิดใช้งาน</Badge>}</td>
                        <td data-label="อัปเดตล่าสุด">{formatThaiDate(item.updatedAt)}</td>
                        <td data-label="จัดการ">
                          <div className="md-row-actions">
                            <Link className="icon-btn" to={variant.itemPath(item.id)} aria-label={`แก้ไข ${item.name}`} title="แก้ไข / อัปเดตราคา"><Pencil aria-hidden width={16} /></Link>
                            {canReceive && (
                              <button type="button" className="icon-btn" onClick={() => openRowReceiving(item)}
                                aria-label={`นำเข้าสต็อก ${item.name}`} title="นำเข้าสต็อก"><PackagePlus aria-hidden width={16} /></button>
                            )}
                            <button type="button" className="icon-btn" onClick={() => setToggling(item)} disabled={toggle.isPending}
                              aria-label={`${item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${item.name}`}
                              title={item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}><Power aria-hidden width={16} /></button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              )}
            </table>
          </div>
        )}

        {list.isError && !list.isLoading && (
          <EmptyState variant="error" icon={AlertTriangle} title="โหลดข้อมูลไม่สำเร็จ" description={list.error instanceof Error ? list.error.message : 'ลองใหม่อีกครั้ง'} />
        )}
        {!list.isLoading && !list.isError && rows.length === 0 && (
          hasFilter
            ? <EmptyState icon={Icon} title="ไม่พบรายการที่ค้นหา" description="ลองเปลี่ยนคำค้นหรือล้างตัวกรอง"
                action={<button type="button" className="btn" onClick={() => { setSearch(''); setStatus(''); setDataIssue(''); resetPage(); }}>ล้างตัวกรอง</button>} />
            : <EmptyState icon={Icon} title={variant.emptyTitle} description={variant.emptyDesc}
                action={<Link to={variant.newPath} className="btn primary"><Plus aria-hidden />{variant.addLabel}</Link>} />
        )}
        {!list.isLoading && rows.length > 0 && totalPages > 1 && (
          <div className="md-pagination">
            <span>หน้า {page} จาก {totalPages} · ทั้งหมด {total} รายการ</span>
            <div>
              <button type="button" className="btn" onClick={() => setPage(page - 1)} disabled={page <= 1}>ก่อนหน้า</button>
              <button type="button" className="btn" onClick={() => setPage(page + 1)} disabled={page >= totalPages}>ถัดไป</button>
            </div>
          </div>
        )}
      </ContentCard>

      <ConfirmDialog
        open={toggling !== null}
        title={toggling?.isActive ? `ปิดใช้งาน ${noun}` : `เปิดใช้งาน ${noun}`}
        tone={toggling?.isActive ? 'danger' : 'primary'}
        confirmLabel={toggling?.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}
        onClose={() => setToggling(null)}
        onConfirm={toggling ? () => toggle.mutate(toggling) : undefined}
        description={toggling ? <div className="op-confirm">
          <dl>
            <div><dt>รายการ</dt><dd>{toggling.name}</dd></div>
            <div><dt>รหัส</dt><dd>{toggling.code}</dd></div>
          </dl>
          <p className="op-confirm-impact">
            {toggling.isActive
              ? 'เมื่อปิดใช้งาน รายการนี้จะไม่ปรากฏให้เลือกในสูตรและเอกสารใหม่ แต่ข้อมูลเดิมและสูตรที่ใช้อยู่ยังคงเดิมทั้งหมด'
              : 'เมื่อเปิดใช้งาน รายการนี้จะกลับมาเลือกได้ในสูตรและเอกสารใหม่'}
          </p>
        </div> : ''}
      />

      <StockReceivingDialog
        open={receivingItem !== null || receivingPicker}
        item={receivingItem}
        pickerType={variant.type}
        allowPick
        onClose={closeReceiving}
        onReceived={(result) => { setReceivedResult(result); closeReceiving(); }}
      />
    </PageContainer>
  );
}

/** ช่องอัตราแปลงในตาราง — สามสถานะ: หน่วยเดียวกัน / มีอัตรา / ยังไม่ตั้ง */
function ConversionCell({ display }: { display: ReturnType<typeof itemPriceDisplay> }) {
  if (display.factorState === 'missing') {
    return <span className="md-conv missing"><AlertTriangle aria-hidden />ยังไม่ตั้ง</span>;
  }
  if (display.factorState === 'same' || !display.conversion) {
    return <span className="md-conv same">หน่วยเดียวกัน</span>;
  }
  return <span className="md-conv">{display.conversion}</span>;
}

function Thumb({ url }: { url: string | null }) {
  if (!url) return <span className="item-thumb empty"><ImageOff aria-hidden width={16} /></span>;
  return <img className="item-thumb" src={url} alt="" loading="lazy" />;
}
