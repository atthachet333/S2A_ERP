import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowRight, CheckCircle2,
  ClipboardList, Info, PackageOpen, Plus, RefreshCw, ShoppingCart, SlidersHorizontal,
  TrendingDown, UtensilsCrossed, Warehouse, CircleDollarSign, ClipboardCheck, type LucideIcon,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useDashboardSummary } from '@/hooks/useDashboardSummary';
import { useActivity } from '@/hooks/useActivity';
import { canAny, countToday, draftCount, useDashboardData } from '@/hooks/useDashboardData';
import { activityLabel, buildDashboardAlerts, restockList, type Severity } from '@/lib/dashboard-alerts';
import {
  DOC_KIND_LABEL, costingSummary, pricingSummary, recentDocuments, recipesNeedingAttention,
} from '@/lib/dashboard-lists';
import { STATUS_BADGE, statusInfo, statusLabel } from '@/lib/operations-vocab';
import EmptyState from '@/components/ui/EmptyState';
import { DocBarChart, DonutChart } from '@/components/dashboard/Charts';
import { documentBars, inventoryComposition, menuReadiness } from '@/lib/dashboard-charts';
import { companyContactRows, useCompanyProfile } from '@/hooks/useCompanyProfile';
import { formatMoney, formatThaiDate, greeting, timeAgo } from '@/lib/utils';
import { primaryCards, type PrimaryCard } from '@/lib/dashboard-primary';
import {
  PageContainer, PageHeader, KPIGrid, KPICard, ContentCard, KPISkeleton, CardSkeleton,
} from '@/components/layout/page';

/** ปุ่มลัด — แสดงเฉพาะที่ผู้ใช้มีสิทธิ์ทำจริง */
const QUICK_ACTIONS: { to: string; label: string; icon: LucideIcon; perms: string[] }[] = [
  { to: '/receiving/new', label: 'รับของเข้า', icon: PackageOpen, perms: ['RECEIVING_CREATE'] },
  { to: '/stock-issues/new', label: 'เบิกให้ครัวกลาง', icon: ClipboardList, perms: ['STOCK_ISSUE_CREATE'] },
  { to: '/inventory/adjustments', label: 'ปรับปรุงสต็อก', icon: SlidersHorizontal, perms: ['INVENTORY_ADJUST'] },
  { to: '/recipes/new', label: 'สร้างสูตร', icon: UtensilsCrossed, perms: ['RECIPE_CREATE', 'CATALOG_MANAGE'] },
  { to: '/ingredients/new', label: 'เพิ่มวัตถุดิบ', icon: Plus, perms: ['ITEM_CREATE', 'CATALOG_MANAGE'] },
  { to: '/orders', label: 'ออเดอร์', icon: ShoppingCart, perms: ['ORDER_VIEW'] },
];

/** ไอคอนของการ์ดหลัก — สื่อความหมายคู่กับข้อความเสมอ ไม่ใช้สีอย่างเดียว */
/** โทนของการ์ดหลัก → โทนของ KPICard ที่ระบบมีอยู่แล้ว */
const TONE_MAP = {
  danger: 'danger', costing: 'warning', inventory: 'info', operations: 'ops', healthy: 'success',
} as const;

const PRIMARY_ICON = {
  attention: AlertTriangle,
  costing: CircleDollarSign,
  inventory: Warehouse,
  operations: ClipboardCheck,
} as const;

const SEVERITY_META: Record<Severity, { label: string; icon: LucideIcon }> = {
  critical: { label: 'ต้องแก้ทันที', icon: AlertTriangle },
  warning: { label: 'ควรตรวจสอบ', icon: AlertTriangle },
  info: { label: 'ข้อมูลไม่ครบ', icon: Info },
};

/** การ์ดที่โหลดข้อมูลไม่ได้ ต้องไม่ทำให้ทั้งหน้าพัง */
function CardError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="dash-error" role="alert">
      <AlertTriangle aria-hidden />
      <span>โหลดข้อมูลไม่ได้</span>
      <button type="button" className="btn" onClick={onRetry}>ลองใหม่</button>
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  const permissions = useMemo(() => user?.permissions ?? [], [user?.permissions]);
  const isAdmin = roles.includes('SUPER_ADMIN');

  const summary = useDashboardSummary();
  const activity = useActivity(1, 6, isAdmin);
  const d = useDashboardData(roles, permissions);

  const invKpi = d.inventory.data?.kpi;
  const invRows = d.inventory.data?.rows;
  const menus = d.menus.data;
  const s = summary.data;

  const receivingToday = countToday(d.receiving.data, 'receiptDate');
  const issueToday = countToday(d.issues.data, 'issueDate');
  const adjustToday = countToday(d.adjustments.data, 'createdAt');

  const alerts = useMemo(() => buildDashboardAlerts({
    inventoryKpi: invKpi,
    inventoryRows: invRows,
    menus,
    receivingDrafts: draftCount(d.receiving.data),
    issueDrafts: draftCount(d.issues.data),
    itemsWithoutPrice: s?.itemsWithoutPrice,
  }), [invKpi, invRows, menus, d.receiving.data, d.issues.data, s?.itemsWithoutPrice]);

  const restock = useMemo(() => restockList(invRows, 5), [invRows]);
  const quickActions = QUICK_ACTIONS.filter((a) => canAny(roles, permissions, ...a.perms));

  /* Phase 11 — การ์ดที่เคยมีแต่ตัวเลข ได้รายการจริงมาถ่วงให้สมดุลกับการ์ดคู่ของมัน */
  const recentDocs = useMemo(() => recentDocuments({
    receiving: d.permissions.canReceiving ? d.receiving.data : undefined,
    issues: d.permissions.canIssues ? d.issues.data : undefined,
    adjustments: d.permissions.canInventory ? d.adjustments.data : undefined,
  }, 5), [d.receiving.data, d.issues.data, d.adjustments.data,
    d.permissions.canReceiving, d.permissions.canIssues, d.permissions.canInventory]);

  /* PHASE 14 — กราฟทั้งหมดคำนวณจากข้อมูลที่โหลดอยู่แล้ว ไม่มี endpoint ใหม่
     และไม่มีกราฟแนวโน้ม เพราะ stock ledger จริงมีข้อมูลวันเดียว */
  const invSlices = useMemo(() => inventoryComposition(invKpi), [invKpi]);
  const menuSlices = useMemo(() => menuReadiness(menus), [menus]);
  const docBars = useMemo(() => documentBars({
    receiving: d.permissions.canReceiving ? d.receiving.data : undefined,
    issues: d.permissions.canIssues ? d.issues.data : undefined,
    adjustments: d.permissions.canInventory ? d.adjustments.data : undefined,
  }), [d.receiving.data, d.issues.data, d.adjustments.data,
    d.permissions.canReceiving, d.permissions.canIssues, d.permissions.canInventory]);
  const companyProfile = useCompanyProfile();

  const costing = useMemo(() => costingSummary(menus), [menus]);

  /* PHASE 22 — ข้อมูลของการ์ดหลักมาจากชุดข้อมูลจริงที่หน้านี้ดึงอยู่แล้วทั้งหมด
     ไม่มีการเรียก API เพิ่มเพื่อสร้างตัวเลขใหม่ และไม่มีค่าที่เดาขึ้นเอง */
  const primary = useMemo(() => primaryCards({
    alerts,
    itemsMissingCost: s?.itemsWithoutPrice,
    costing: costing.total > 0 ? { totalMenus: costing.total, withCost: costing.total - costing.noCost - costing.noRecipe } : undefined,
    inventory: invKpi ? {
      itemCount: invKpi.itemCount, outCount: invKpi.outCount,
      lowCount: invKpi.lowCount, negativeCount: invKpi.negativeCount, totalValue: invKpi.totalValue,
    } : undefined,
    operations: {
      receivingDrafts: (d.receiving.data ?? []).filter((r) => r.status === 'DRAFT').length,
      issueDrafts: (d.issues.data ?? []).filter((r) => r.status === 'DRAFT').length,
      todayMovements: invKpi?.movementsToday ?? 0,
    },
    permissions: {
      canInventory: d.permissions.canInventory,
      canOperations: d.permissions.canReceiving || d.permissions.canIssues,
    },
  }), [alerts, s?.itemsWithoutPrice, costing, invKpi, d.receiving.data, d.issues.data,
    d.permissions.canInventory, d.permissions.canReceiving, d.permissions.canIssues]);
  const pricing = useMemo(() => pricingSummary(menus), [menus]);
  const recipeGaps = useMemo(() => recipesNeedingAttention(menus, 5), [menus]);

  const pricedMenus = (menus ?? []).filter((m) => m.sellingPrice != null);
  const belowCost = pricedMenus.filter((m) => (m.margin ?? 0) < 0);
  const initialLoading = summary.isLoading && d.inventory.isLoading;

  return (
    <PageContainer size="wide" className="dashboard-page">
      <PageHeader
        breadcrumb="ภาพรวม"
        title="ภาพรวมระบบ"
        description="สรุปสถานะการดำเนินงาน ต้นทุน และคลังสินค้า"
        meta={<>
          {/* ทักทายแบบสั้น ๆ ในแถบข้อมูล ไม่ให้กินพื้นที่เหมือน hero เดิม */}
          {user?.fullName && <span>{greeting()}, <b>{user.fullName}</b></span>}
          <span>{formatThaiDate(new Date())}</span>
          {/* เวลาอัปเดตมาจาก react-query ที่ดึงสำเร็จจริง ไม่ใช่เวลาที่ render */}
          {d.lastUpdatedAt > 0 && (
            <span>อัปเดตล่าสุด {new Date(d.lastUpdatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}</span>
          )}
          {d.isFetching && <span>กำลังอัปเดต…</span>}
        </>}
        actions={
          <button type="button" className="btn" onClick={() => d.refetchAll()} disabled={d.isFetching}>
            <RefreshCw aria-hidden width={16} />รีเฟรชข้อมูล
          </button>
        }
      />

      {/* ---------- PHASE 22 — การ์ดหลัก 4 ใบ ----------
          ตอบสี่คำถามแรกของผู้บริหาร: ต้องจัดการอะไร · ต้นทุนครบไหม · สต็อกเป็นไง · งานเดินแค่ไหน
          ทุกตัวเลขมาจากข้อมูลจริงทั้งหมด ไม่มีแนวโน้มหรือการพยากรณ์ที่สร้างขึ้นเอง */}
      {initialLoading ? <KPISkeleton count={4} /> : (
        <KPIGrid columns={4} className="dash-primary">
          {primary.map((card: PrimaryCard) => {
            const Icon = PRIMARY_ICON[card.id];
            return <KPICard
              key={card.id}
              label={card.label}
              value={card.value == null ? '—' : card.value.toLocaleString()}
              unit={card.value != null ? card.unit : undefined}
              icon={<Icon />}
              tone={TONE_MAP[card.tone]}
              breakdown={card.breakdown}
              hint={card.hint}
              to={card.to}
            />;
          })}
        </KPIGrid>
      )}

      <div className="dash-grid">
        {/* ---------- ต้องจัดการตอนนี้ ---------- */}
        <ContentCard className="dash-span-8" title="ต้องจัดการตอนนี้"
          description={alerts.length ? `${alerts.length} เรื่องที่ควรดำเนินการ` : 'ไม่มีเรื่องค้างในตอนนี้'}>
          {d.inventory.isError && d.menus.isError
            ? <CardError onRetry={() => d.refetchAll()} />
            : alerts.length === 0
              ? <EmptyState icon={CheckCircle2} title="ไม่มีเรื่องต้องจัดการ" description="สต็อก ราคา และเอกสารอยู่ในสถานะปกติทั้งหมด" />
              : (
                <ul className="dash-alerts">
                  {alerts.map((a) => {
                    const meta = SEVERITY_META[a.severity];
                    const Icon = meta.icon;
                    return (
                      <li key={a.id} className={`sev-${a.severity}`}>
                        <span className="al-icon" aria-hidden><Icon /></span>
                        <div className="al-body">
                          <strong>{a.title}</strong>
                          <span>{a.detail}</span>
                        </div>
                        <span className="al-sev">{meta.label}</span>
                        <Link to={a.ctaTo} className="btn">{a.ctaLabel}</Link>
                      </li>
                    );
                  })}
                </ul>
              )}
        </ContentCard>

        {/* ---------- Quick actions ---------- */}
        <ContentCard className="dash-span-4" title="ทางลัด" description="เริ่มงานที่ทำบ่อยได้ทันที">
          {quickActions.length === 0
            ? <EmptyState icon={Info} title="ยังไม่มีทางลัด" description="บัญชีนี้ยังไม่มีสิทธิ์สร้างเอกสาร" />
            : (
              <div className="dash-quick">
                {quickActions.map((a) => (
                  <Link key={a.to} to={a.to} className="dash-quick-btn">
                    <span aria-hidden><a.icon /></span>{a.label}
                  </Link>
                ))}
              </div>
            )}
        </ContentCard>

        {/* ---------- คลังสินค้า ---------- */}
        {d.permissions.canInventory && (
          <ContentCard className="dash-span-7" title="ภาพรวมคลังสินค้า"
            description="สถานะคงเหลือจากบัญชีการเคลื่อนไหวจริง"
            actions={<Link to="/inventory" className="btn">ดูคลังทั้งหมด<ArrowRight aria-hidden width={15} /></Link>}>
            {d.inventory.isError ? <CardError onRetry={() => void d.inventory.refetch()} />
              : d.inventory.isLoading ? <CardSkeleton lines={5} />
              : invKpi && (
                <>
                  <div className="dash-statrow">
                    <div><span>มูลค่ารวม</span><b className="num">{formatMoney(invKpi.totalValue, 0)}</b></div>
                    <div><span>มีของ</span><b className="num">{invKpi.itemCount - invKpi.outCount - invKpi.negativeCount}</b></div>
                    <div className={invKpi.lowCount ? 'is-warn' : ''}><span>ใกล้หมด</span><b className="num">{invKpi.lowCount}</b></div>
                    <div className={invKpi.outCount ? 'is-bad' : ''}><span>หมด</span><b className="num">{invKpi.outCount}</b></div>
                    {invKpi.negativeCount > 0 && <div className="is-bad"><span>ติดลบ</span><b className="num">{invKpi.negativeCount}</b></div>}
                  </div>
                  {invKpi.thresholdMissing && (
                    <p className="dash-note"><Info aria-hidden width={14} />บางรายการยังไม่ได้ตั้งจุดสั่งซื้อ ระบบจึงไม่เตือนว่าใกล้หมด</p>
                  )}
                  {invSlices.length > 0 && (
                    <DonutChart slices={invSlices}
                      centerValue={String(invKpi.itemCount)} centerLabel="รายการ" />
                  )}
                  <h3 className="dash-sub">รายการที่ควรเติมสต็อก</h3>
                  <div className="dash-fill">
                  {restock.length === 0
                    ? <p className="dash-ok"><CheckCircle2 aria-hidden width={15} />ทุกรายการอยู่เหนือจุดสั่งซื้อ</p>
                    : (
                      <ul className="dash-list">
                        {restock.map((r) => (
                          <li key={`${r.itemId}-${r.warehouseId}`}>
                            <div className="dl-main"><strong>{r.name}</strong><small>{r.code} · {r.warehouseName}</small></div>
                            <div className="dl-num"><b className="num">{formatMoney(r.available, 2)}</b><small>{r.unit}</small></div>
                            <div className="dl-num"><b className="num">{r.threshold > 0 ? formatMoney(r.threshold, 2) : '—'}</b><small>จุดสั่งซื้อ</small></div>
                            <span className={`badge ${r.status === 'LOW' ? 'warning' : 'danger'}`}>
                              {r.status === 'LOW' ? 'ใกล้หมด' : r.status === 'OUT' ? 'หมด' : 'ติดลบ'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
          </ContentCard>
        )}

        {/* ---------- การเคลื่อนไหววันนี้ ---------- */}
        <ContentCard className="dash-span-5" title="เอกสารปฏิบัติการวันนี้"
          description="นับจำนวนเอกสาร ไม่ใช่จำนวนรายการเดินสต็อก จึงไม่เท่ากับ KPI ด้านบน">
          {d.receiving.isError && d.issues.isError && d.adjustments.isError
            ? <CardError onRetry={() => d.refetchAll()} />
            : (
              <div className="dash-ops">
                {[
                  { key: 'gr', label: 'รับของเข้า', to: '/receiving', c: receivingToday, can: d.permissions.canReceiving, err: d.receiving.isError },
                  { key: 'ri', label: 'เบิกครัวกลาง', to: '/stock-issues', c: issueToday, can: d.permissions.canIssues, err: d.issues.isError },
                  { key: 'aj', label: 'ปรับปรุงสต็อก', to: '/inventory/adjustments', c: adjustToday, can: d.permissions.canInventory, err: d.adjustments.isError },
                ].filter((x) => x.can).map((x) => (
                  <div className="dash-op" key={x.key}>
                    <div className="op-head"><strong>{x.label}</strong><Link to={x.to}>เปิด<ArrowRight aria-hidden width={13} /></Link></div>
                    {x.err ? <span className="dash-op-err">โหลดไม่ได้</span> : (
                      <>
                        <b className="op-total num">{x.c.total}</b>
                        <div className="op-split">
                          <span>ยืนยันแล้ว <b className="num">{x.c.confirmed}</b></span>
                          <span>ร่าง <b className="num">{x.c.draft}</b></span>
                          {x.c.reversed > 0 && <span>กลับรายการ <b className="num">{x.c.reversed}</b></span>}
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {receivingToday.total + issueToday.total + adjustToday.total === 0
                  && !d.receiving.isLoading && !d.issues.isLoading && (
                  <p className="dash-ok dash-ops-empty"><CheckCircle2 aria-hidden width={15} />วันนี้ยังไม่มีการเคลื่อนไหวสต็อก</p>
                )}
              </div>
            )}
          <h3 className="dash-sub">เอกสารทั้งหมดในระบบ</h3>
          <DocBarChart bars={docBars} />
          {/* เอกสารล่าสุดจากทั้งสามชนิด — ใช้เลขที่และวันที่ที่ API ส่งมาจริง */}
          <h3 className="dash-sub">เอกสารล่าสุด</h3>
          <div className="dash-fill">
            {recentDocs.length === 0
              ? <p className="dash-ok"><Info aria-hidden width={15} />ยังไม่มีเอกสารในระบบ</p>
              : (
                <ul className="dash-list dash-docs">
                  {recentDocs.map((doc) => (
                    <li key={doc.id}>
                      <div className="dl-main">
                        <strong>{doc.docNo}</strong>
                        <small>{DOC_KIND_LABEL[doc.kind]}{doc.at ? ` · ${formatThaiDate(doc.at)}` : ''}</small>
                      </div>
                      <Link to={doc.to} className="dl-open">เปิด<ArrowRight aria-hidden width={13} /></Link>
                      <span className={`badge ${STATUS_BADGE[statusInfo(doc.kind, doc.status).tone]}`}>
                        {statusLabel(doc.kind, doc.status)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </ContentCard>

        {/* ---------- ต้นทุนและสูตร ---------- */}
        <ContentCard className="dash-span-6" title="ต้นทุนและสูตรอาหาร"
          description="สถานะสูตรจากข้อมูลที่บันทึกไว้"
          actions={<><Link to="/recipes" className="btn">ดูสูตร</Link><Link to="/costing" className="btn">คำนวณต้นทุน</Link></>}>
          {summary.isError ? <CardError onRetry={() => void summary.refetch()} />
            : summary.isLoading ? <CardSkeleton lines={4} />
            : s && (
              <>
                <div className="dash-statrow">
                  <div><span>สูตรทั้งหมด</span><b className="num">{s.recipes}</b></div>
                  <div><span>ใช้งานอยู่</span><b className="num">{s.activeRecipes}</b></div>
                  <div className={costing.noRecipe ? 'is-warn' : ''}><span>เมนูยังไม่มีสูตร</span><b className="num">{costing.noRecipe}</b></div>
                  <div className={s.itemsWithoutPrice ? 'is-warn' : ''}><span>วัตถุดิบไม่มีราคา</span><b className="num">{s.itemsWithoutPrice}</b></div>
                </div>
                {s.itemsWithoutPrice > 0
                  ? <p className="dash-note"><AlertTriangle aria-hidden width={14} />ต้นทุนของสูตรที่ใช้วัตถุดิบเหล่านี้จะต่ำกว่าความจริง</p>
                  : <p className="dash-ok"><CheckCircle2 aria-hidden width={15} />วัตถุดิบทุกรายการมีราคาซื้อแล้ว</p>}
                {menuSlices.length > 0 && (
                  <DonutChart slices={menuSlices}
                    centerValue={String(costing.total)} centerLabel="เมนู" />
                )}
                <h3 className="dash-sub">เมนูที่ยังคิดต้นทุนไม่ได้</h3>
                <div className="dash-fill">
                  {d.menus.isError ? <p className="dash-note"><AlertTriangle aria-hidden width={14} />โหลดรายการเมนูไม่ได้</p>
                    : recipeGaps.length === 0
                      ? <p className="dash-ok"><CheckCircle2 aria-hidden width={15} />เมนูที่ใช้งานอยู่มีสูตรและต้นทุนครบแล้ว</p>
                      : (
                        <ul className="dash-list">
                          {recipeGaps.map((m) => (
                            <li key={m.id}>
                              <div className="dl-main"><strong>{m.name}</strong><small>{m.code}</small></div>
                              <Link to="/recipes" className="dl-open">จัดการสูตร<ArrowRight aria-hidden width={13} /></Link>
                              <span className={`badge ${m.issue === 'NO_RECIPE' ? 'warning' : 'info'}`}>{m.label}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                </div>
              </>
            )}
        </ContentCard>

        {/* ---------- ราคาขายและกำไร ---------- */}
        <ContentCard className="dash-span-6" title="ราคาขายและกำไร"
          description="เทียบราคาขายกับต้นทุนที่บันทึกไว้"
          actions={<Link to="/pricing" className="btn">จัดการราคาขาย</Link>}>
          {d.menus.isError ? <CardError onRetry={() => void d.menus.refetch()} />
            : d.menus.isLoading ? <CardSkeleton lines={4} />
            : (
              <>
                <div className="dash-statrow">
                  <div><span>เมนูใช้งานอยู่</span><b className="num">{pricing.total}</b></div>
                  <div><span>ตั้งราคาแล้ว</span><b className="num">{pricing.priced}</b></div>
                  <div className={pricing.unpriced ? 'is-warn' : ''}><span>ยังไม่ตั้งราคา</span><b className="num">{pricing.unpriced}</b></div>
                  <div className={pricing.belowCost ? 'is-bad' : ''}><span>ต่ำกว่าต้นทุน</span><b className="num">{pricing.belowCost}</b></div>
                </div>
                {belowCost.length > 0
                  ? <p className="dash-note"><AlertTriangle aria-hidden width={14} />ยิ่งขายยิ่งขาดทุนจนกว่าจะปรับราคาหรือลดต้นทุน</p>
                  : <p className="dash-ok"><CheckCircle2 aria-hidden width={15} />ไม่มีราคาขายต่ำกว่าต้นทุน</p>}
                <h3 className="dash-sub">เมนูที่ควรตรวจราคา</h3>
                <div className="dash-fill">
                  {belowCost.length === 0
                    ? <p className="dash-ok"><CheckCircle2 aria-hidden width={15} />ทุกเมนูที่ตั้งราคาแล้วมีกำไรเป็นบวก</p>
                    : (
                      <ul className="dash-list">
                        {belowCost.slice(0, 5).map((m) => (
                          <li key={m.id}>
                            <div className="dl-main"><strong>{m.name}</strong><small>{m.code}</small></div>
                            <div className="dl-num"><b className="num">{formatMoney(m.unitCost ?? 0, 2)}</b><small>ต้นทุน/หน่วย</small></div>
                            <div className="dl-num"><b className="num">{formatMoney(m.sellingPrice ?? 0, 2)}</b><small>ราคาขาย</small></div>
                            <span className="badge danger"><TrendingDown aria-hidden width={12} />ขาดทุน</span>
                          </li>
                        ))}
                      </ul>
                    )}
                </div>
              </>
            )}
        </ContentCard>

        {/* ---------- ออเดอร์ ---------- */}
        {d.permissions.canOrders && (
          <ContentCard className="dash-span-7" title="ออเดอร์ล่าสุด"
            description="คำสั่งซื้อที่บันทึกในระบบ"
            actions={<Link to="/orders" className="btn">ดูออเดอร์ทั้งหมด<ArrowRight aria-hidden width={15} /></Link>}>
            {d.orders.isError ? <CardError onRetry={() => void d.orders.refetch()} />
              : d.orders.isLoading ? <CardSkeleton lines={4} />
              : (d.orders.data ?? []).length === 0
                ? <EmptyState icon={ShoppingCart} title="ยังไม่มีคำสั่งซื้อ" description="เมื่อมีออเดอร์เข้ามา รายการจะแสดงที่นี่"
                    action={<Link to="/orders" className="btn primary">ไปที่หน้าออเดอร์</Link>} />
                : (
                  <ul className="dash-list">
                    {(d.orders.data ?? []).slice(0, 6).map((o) => (
                      <li key={o.id}>
                        <div className="dl-main"><strong>{o.orderNo}</strong><small>{o.customer?.name ?? '—'}</small></div>
                        <div className="dl-num"><b className="num">{formatMoney(Number(o.totalAmount ?? 0), 2)}</b><small>ยอดรวม</small></div>
                        <span className={`badge ${STATUS_BADGE[statusInfo('order', o.status).tone]}`}>{statusLabel('order', o.status)}</span>
                      </li>
                    ))}
                  </ul>
                )}
          </ContentCard>
        )}

        {/* ---------- กิจกรรมล่าสุด (เฉพาะผู้ดูแล) ---------- */}
        {isAdmin && (
          <ContentCard className="dash-span-5" title="กิจกรรมล่าสุด"
            description="การกระทำล่าสุดในระบบ"
            actions={<Link to="/activity" className="btn">ดูประวัติทั้งหมด</Link>}>
            {activity.isError ? <CardError onRetry={() => void activity.refetch()} />
              : activity.isLoading ? <CardSkeleton lines={5} />
              : (activity.data?.items ?? []).length === 0
                ? <EmptyState icon={Info} title="ยังไม่มีกิจกรรม" />
                : (
                  <ul className="dash-activity">
                    {(activity.data?.items ?? []).map((a) => (
                      <li key={a.id}>
                        <span className="ac-time num">{timeAgo(a.createdAt)}</span>
                        <div className="ac-body">
                          <strong>{activityLabel(a.action)}</strong>
                          <small>{a.actor ?? 'ระบบ'}{a.entity ? ` · ${a.entity}` : ''}</small>
                        </div>
                        {!a.success && <span className="badge danger">ไม่สำเร็จ</span>}
                      </li>
                    ))}
                  </ul>
                )}
          </ContentCard>
        )}
        {/* ---------- ข้อมูลบริษัท (เต็มแถว จึงไม่กระทบการจับคู่ความสูงเดิม) ---------- */}
        {companyProfile.data && (
          <ContentCard className="dash-span-12 dash-company" title="ข้อมูลบริษัท"
            description="ข้อมูลชุดเดียวกับที่ใช้บนหัวเอกสาร PDF"
            actions={<Link to="/settings/company" className="btn">แก้ไขข้อมูล</Link>}>
            <div className="dash-company-grid">
              <div className="dc-identity">
                {companyProfile.data.logoUrl
                  ? <img src={companyProfile.data.logoUrl} alt="" className="dc-logo" />
                  : <span className="dc-logo dc-logo-text">{companyProfile.data.nameTh.replace(/^บริษัท\s*/, '').slice(0, 2)}</span>}
                <div>
                  <strong>{companyProfile.data.nameTh}</strong>
                  {companyProfile.data.nameEn && <span>{companyProfile.data.nameEn}</span>}
                </div>
              </div>
              <dl className="dc-rows">
                {companyContactRows(companyProfile.data).map((row) => (
                  <div key={row.label}><dt>{row.label}</dt><dd>{row.value}</dd></div>
                ))}
              </dl>
            </div>
          </ContentCard>
        )}
      </div>
    </PageContainer>
  );
}

