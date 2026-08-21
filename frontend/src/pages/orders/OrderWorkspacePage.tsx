import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowLeft, CalendarDays, Check, ClipboardCheck, Loader2, Plus,
  Info, Save, Search, Trash2, UserRound, Wallet,
} from 'lucide-react';
import { catalogApi, type MenuRow } from '@/lib/catalog';
import { orderApi, orderErrorMessage, searchCustomers, type NewOrderLine } from '@/lib/order-api';
import {
  PRICE_TIERS, PRICE_TIER_LABEL, belowCost, lineTotal, orderTotals, type PriceTierCode,
} from '@/lib/order-vocab';
import { PageContainer, PageHeader, ContentCard, StickySummary } from '@/components/layout/page';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import CustomerQuickCreateModal, { type QuickCreatedCustomer } from '@/components/customers/CustomerQuickCreateModal';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/auth/AuthContext';

/**
 * PHASE 8 — สร้างออเดอร์
 *
 * แทนฟอร์มเดิมที่ให้ผู้ใช้ "พิมพ์รหัสเมนูเอง" และสร้างได้ทีละ 1 บรรทัด
 * ทั้งที่ POST /business/orders รองรับหลายบรรทัด + ส่วนลด + ภาษี อยู่แล้ว
 *
 * ระดับราคา: อ่านจาก SellingPrice ของเมนูนั้น (GET /costing/prices/:itemId)
 * ใช้เติมราคาต่อหน่วยให้อัตโนมัติ
 * ข้อจำกัดที่ผู้ใช้ต้องรู้: SalesOrder ไม่มีคอลัมน์เก็บ "ระดับราคา"
 * สิ่งที่บันทึกจริงคือ unitPrice ของแต่ละบรรทัด — จึงบอกไว้ในแผงสรุป
 *
 * PHASE 8B — รองรับโหมดแก้ไขร่างด้วย (route /orders/:id/edit)
 * ใช้หน้าเดียวกันทั้งสร้างและแก้ เพื่อไม่ให้ผู้ใช้ต้องเรียนรู้สองแบบ
 * แก้ได้เฉพาะสถานะร่าง — สถานะอื่น backend คืน 409 และหน้านี้แสดงเป็นอ่านอย่างเดียว
 */

type Line = {
  key: string;
  menuId: string;
  name: string;
  code: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  /** ราคาตามระดับที่เลือก ใช้เทียบว่าผู้ใช้แก้ราคาเองหรือไม่ */
  tierPrice: number | null;
  cost: number | null;
};

const money = (v: number) => `฿${Number(v ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyText = (v: number) => Number(v ?? 0).toLocaleString('en-US', { maximumFractionDigits: 4 });
const today = () => new Date().toISOString().slice(0, 10);

export default function OrderWorkspacePage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const { id: editId } = useParams();
  const isEdit = Boolean(editId);

  // โหลดใบเดิมเมื่ออยู่ในโหมดแก้ไข
  const existing = useQuery({
    queryKey: ['order', editId],
    queryFn: () => orderApi.order(editId as string),
    enabled: isEdit, retry: false,
  });

  const canCreate = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('ORDER_CREATE'));
  const canCreateCustomer = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('CUSTOMER_CREATE'));

  const customers = useQuery({ queryKey: ['order-customers'], queryFn: () => orderApi.customers() });
  const menus = useQuery({ queryKey: ['menus'], queryFn: () => catalogApi.menus() });

  // มาจากปุ่ม "สร้างออเดอร์ให้ลูกค้านี้" ในหน้าโปรไฟล์ลูกค้า
  const [customerId, setCustomerId] = useState(params.get('customer') ?? '');
  const [customerTerm, setCustomerTerm] = useState('');
  const [pickerOpen, setPickerOpen] = useState(!params.get('customer'));
  const [quickCreate, setQuickCreate] = useState<{ open: boolean; prefill: string }>({ open: false, prefill: '' });

  const [deliveryDate, setDeliveryDate] = useState(today());
  const [deliveryTime, setDeliveryTime] = useState('');
  const [note, setNote] = useState('');
  const [discount, setDiscount] = useState('0');

  const [tier, setTier] = useState<PriceTierCode>('RETAIL');
  const [lines, setLines] = useState<Line[]>([]);
  const [menuTerm, setMenuTerm] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const customer = customers.data?.find((c) => c.id === customerId) ?? null;
  const customerResults = useMemo(
    () => searchCustomers(customers.data ?? [], customerTerm).slice(0, 40),
    [customers.data, customerTerm],
  );
  const menuResults = useMemo(() => {
    const rows = (menus.data ?? []).filter((m) => m.isActive);
    const q = menuTerm.trim().toLowerCase();
    if (!q) return rows.slice(0, 40);
    return rows.filter((m) => `${m.code} ${m.name}`.toLowerCase().includes(q)).slice(0, 40);
  }, [menus.data, menuTerm]);

  /** ราคาแต่ละระดับของเมนูที่ถูกเลือกไว้ — โหลดทีละเมนู แล้ว cache ไว้ */
  const [tierPrices, setTierPrices] = useState<Record<string, Record<string, number>>>({});
  const loadTierPrices = async (menuId: string) => {
    if (tierPrices[menuId]) return tierPrices[menuId];
    try {
      const rows = await catalogApi.sellingPrices(menuId);
      const map: Record<string, number> = {};
      for (const r of rows) map[r.priceType] = r.price;
      setTierPrices((cur) => ({ ...cur, [menuId]: map }));
      return map;
    } catch {
      // ไม่มีราคาที่ตั้งไว้ก็ไม่เป็นไร ผู้ใช้กรอกเองได้
      setTierPrices((cur) => ({ ...cur, [menuId]: {} }));
      return {};
    }
  };

  const addMenu = async (menu: MenuRow) => {
    if (lines.some((l) => l.menuId === menu.id)) return;
    const prices = await loadTierPrices(menu.id);
    const tierPrice = prices[tier] ?? null;
    setLines((cur) => [...cur, {
      key: crypto.randomUUID(),
      menuId: menu.id, name: menu.name, code: menu.code,
      unit: menu.sellingUnit ?? 'หน่วย',
      quantity: 1,
      unitPrice: tierPrice ?? menu.sellingPrice ?? 0,
      tierPrice,
      cost: menu.unitCost,
    }]);
  };

  // เติมค่าจากใบเดิมเข้าฟอร์มครั้งเดียวเมื่อโหลดเสร็จ
  const [preloaded, setPreloaded] = useState(false);
  useEffect(() => {
    const doc = existing.data;
    if (!doc || preloaded) return;
    setCustomerId(doc.customerId);
    setPickerOpen(false);
    setDeliveryDate(doc.deliveryDate.slice(0, 10));
    setDeliveryTime(doc.deliveryTime ?? '');
    setNote(doc.note ?? '');
    setDiscount(String(Number(doc.discount) || 0));
    if (doc.priceTier && (PRICE_TIERS as readonly string[]).includes(doc.priceTier)) {
      setTier(doc.priceTier as PriceTierCode);
    }
    // ราคาที่โหลดมาคือราคาที่ "ใช้จริง" ในใบนั้น ไม่ใช่ราคาปัจจุบันของเมนู
    setLines(doc.items.map((l) => ({
      key: crypto.randomUUID(),
      menuId: l.menuId, name: l.menuNameSnapshot, code: '',
      unit: l.unit,
      quantity: Number(l.quantity) || 0,
      unitPrice: Number(l.unitPrice) || 0,
      tierPrice: null,
      cost: null,
    })));
    setPreloaded(true);
  }, [existing.data, preloaded]);

  // เปลี่ยนระดับราคา → เติมราคาใหม่ให้ทุกบรรทัดที่มีราคาระดับนั้น
  useEffect(() => {
    if (lines.length === 0) return;
    // ตอน preload ใบเดิม ห้ามเขียนทับราคาที่บันทึกไว้ด้วยราคาปัจจุบัน
    if (isEdit && !preloaded) return;
    setLines((cur) => cur.map((l) => {
      const p = tierPrices[l.menuId]?.[tier];
      if (p == null) return { ...l, tierPrice: null };
      return { ...l, tierPrice: p, unitPrice: p };
    }));
  }, [tier]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchLine = (key: string, patch: Partial<Line>) =>
    setLines((cur) => cur.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const removeLine = (key: string) => setLines((cur) => cur.filter((l) => l.key !== key));

  const totals = useMemo(() => orderTotals(lines, discount, 0), [lines, discount]);

  const blockers = useMemo(() => {
    const out: string[] = [];
    if (!customerId) out.push('เลือกลูกค้าก่อน');
    if (!deliveryDate) out.push('ระบุวันที่ส่ง');
    if (lines.length === 0) out.push('เพิ่มรายการอย่างน้อย 1 รายการ');
    if (lines.some((l) => !(l.quantity > 0))) out.push('จำนวนต้องมากกว่า 0 ทุกรายการ');
    return out;
  }, [customerId, deliveryDate, lines]);

  const submit = async () => {
    if (blockers.length > 0 || saving) return;
    setSaving(true); setError('');
    try {
      const items: NewOrderLine[] = lines.map((l) => ({
        menuId: l.menuId,
        menuNameSnapshot: l.name,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
      }));
      const payload = {
        customerId,
        deliveryDate,
        deliveryTime: deliveryTime || undefined,
        discount: Number(discount) || 0,
        note: note.trim() || undefined,
        priceTier: tier,
        items,
      };
      // แก้ร่าง = PATCH ใบเดิม (id/เลขที่/วันที่สร้าง คงเดิม) ไม่สร้างใบใหม่
      const saved = isEdit
        ? await orderApi.updateOrder(editId as string, payload)
        : await orderApi.createOrder({ ...payload, idempotencyKey: crypto.randomUUID() });
      toast({ title: isEdit ? `บันทึกร่าง ${saved.orderNo} แล้ว` : `สร้างออเดอร์ ${saved.orderNo} แล้ว`, variant: 'success' });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['orders'] }),
        qc.invalidateQueries({ queryKey: ['order', saved.id] }),
      ]);
      navigate(`/orders/${saved.id}`);
    } catch (e) {
      setError(orderErrorMessage(e, 'บันทึกออเดอร์ไม่สำเร็จ'));
    } finally { setSaving(false); }
  };

  // เปิด URL แก้ไขของออเดอร์ที่ยืนยันแล้ว → บอกตรง ๆ ไม่ให้ฟอร์มขึ้นมาหลอกให้กรอก
  if (isEdit && existing.data && existing.data.status !== 'DRAFT') {
    return <PageContainer className="order-page">
      <PageHeader
        breadcrumb={<><Link to="/orders">คำสั่งซื้อ</Link><span> · </span><span>แก้ไข</span></>}
        title={`แก้ไขออเดอร์ ${existing.data.orderNo}`}
        actions={<Link to={`/orders/${existing.data.id}`} className="btn"><ArrowLeft aria-hidden width={16} />กลับไปหน้ารายละเอียด</Link>}
      />
      <EmptyState variant="error" icon={Info} title="ออเดอร์นี้ยืนยันแล้ว จึงไม่สามารถแก้ไขรายการได้"
        description="แก้ไขได้เฉพาะออเดอร์ที่ยังเป็นร่างเท่านั้น เพื่อไม่ให้เอกสารที่ยืนยันไปแล้วเปลี่ยนย้อนหลัง"
        action={<Link className="btn primary" to={`/orders/${existing.data.id}`}>ดูรายละเอียดออเดอร์</Link>} />
    </PageContainer>;
  }

  if (isEdit && existing.isError) {
    return <PageContainer className="order-page">
      <EmptyState variant="error" icon={AlertTriangle} title="โหลดออเดอร์ไม่สำเร็จ"
        description={orderErrorMessage(existing.error, 'ลองใหม่อีกครั้ง')}
        action={<Link className="btn" to="/orders">กลับหน้ารายการ</Link>} />
    </PageContainer>;
  }

  if (!canCreate) {
    return <PageContainer className="order-page">
      <EmptyState variant="error" icon={AlertTriangle} title="ไม่มีสิทธิ์สร้างออเดอร์"
        description="บัญชีนี้ยังไม่มีสิทธิ์ ORDER_CREATE"
        action={<Link className="btn" to="/orders">กลับหน้ารายการ</Link>} />
    </PageContainer>;
  }

  return (
    <PageContainer size="wide" className="order-page order-workspace-page">
      <PageHeader
        breadcrumb={<><Link to="/orders">คำสั่งซื้อ</Link><span> · </span><span>{isEdit ? 'แก้ไขร่าง' : 'สร้างใหม่'}</span></>}
        title={isEdit ? `แก้ไขออเดอร์ ${existing.data?.orderNo ?? ''}`.trim() : 'สร้างออเดอร์'}
        description={isEdit
          ? 'แก้ไขได้เฉพาะร่าง — เลขที่ออเดอร์และวันที่สร้างยังเป็นใบเดิม'
          : 'เลือกลูกค้า เลือกเมนู แล้วระบบจะสรุปยอดให้เห็นก่อนยืนยัน'}
        actions={<Link to="/orders" className="btn"><ArrowLeft aria-hidden width={16} />กลับหน้ารายการ</Link>}
      />

      {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

      <div className="ops-workspace">
        <div className="ops-workspace-main">
          {/* A — ลูกค้า */}
          <ContentCard title={<><span className="md-section-badge">A</span><UserRound aria-hidden width={17} />ลูกค้า</>}
            description="ออเดอร์ทุกใบต้องผูกกับลูกค้าในระบบ">
            {customer && !pickerOpen ? (
              <div className="ord-customer-card">
                <div>
                  <p className="ord-customer-code">{customer.code}</p>
                  <h3>{customer.name}</h3>
                  <p className="ord-customer-meta">
                    {[customer.contactName, customer.phone, customer.email].filter(Boolean).join(' · ') || 'ไม่มีข้อมูลติดต่อ'}
                  </p>
                  {customer.address && <p className="ord-customer-meta">{customer.address}</p>}
                </div>
                <div className="ord-customer-actions">
                  <button type="button" className="btn" onClick={() => { setPickerOpen(true); setCustomerTerm(''); }}>เปลี่ยนลูกค้า</button>
                  <Link className="btn" to={`/customers/${customer.id}`}>ดูข้อมูลลูกค้า</Link>
                </div>
              </div>
            ) : (
              <div className="ord-picker">
                <div className="issue-picker-search">
                  <Search aria-hidden />
                  <input value={customerTerm} onChange={(e) => setCustomerTerm(e.target.value)}
                    placeholder="ค้นหาชื่อ รหัส เบอร์โทร หรืออีเมล" aria-label="ค้นหาลูกค้า" />
                </div>
                <div className="ord-picker-list">
                  {customers.isLoading && <p className="issue-none">กำลังโหลดรายชื่อลูกค้า…</p>}
                  {customerResults.map((c) => (
                    <button type="button" key={c.id} className="issue-pick"
                      onClick={() => { setCustomerId(c.id); setPickerOpen(false); }}>
                      <span className="ip-main">
                        <strong>{c.code} · {c.name}</strong>
                        <small>{[c.contactName, c.phone].filter(Boolean).join(' · ') || 'ไม่มีข้อมูลติดต่อ'}</small>
                      </span>
                      <span className="ip-add"><Check aria-hidden width={15} />เลือก</span>
                    </button>
                  ))}
                  {!customers.isLoading && customerResults.length === 0 && (
                    <p className="issue-none">{customerTerm ? `ไม่พบลูกค้าที่ตรงกับ “${customerTerm}”` : 'ยังไม่มีลูกค้าในระบบ'}</p>
                  )}
                  {canCreateCustomer && (
                    <button type="button" className="ord-picker-create"
                      onClick={() => setQuickCreate({ open: true, prefill: customerTerm })}>
                      <Plus aria-hidden width={15} />เพิ่มลูกค้า{customerTerm ? ` “${customerTerm}”` : ''}
                    </button>
                  )}
                </div>
              </div>
            )}
          </ContentCard>

          {/* B — ข้อมูลออเดอร์ */}
          <ContentCard title={<><span className="md-section-badge">B</span><CalendarDays aria-hidden width={17} />ข้อมูลออเดอร์</>}
            description="กำหนดวันและเวลาที่ต้องส่งมอบ">
            <div className="md-fields">
              <label>วันที่ส่ง *
                <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
              </label>
              <label>เวลาส่ง
                <input type="time" value={deliveryTime} onChange={(e) => setDeliveryTime(e.target.value)} />
                <span className="md-hint">ไม่ระบุก็ได้</span>
              </label>
            </div>
          </ContentCard>

          {/* D — ระดับราคา (วางก่อนรายการ เพราะมีผลกับราคาที่เติมให้) */}
          <ContentCard title={<><span className="md-section-badge">C</span><Wallet aria-hidden width={17} />ระดับราคา</>}
            description="เลือกก่อนเพิ่มรายการ ระบบจะเติมราคาต่อหน่วยให้อัตโนมัติ">
            <div className="ord-tiers" role="radiogroup" aria-label="ระดับราคา">
              {PRICE_TIERS.map((t) => (
                <button type="button" key={t} role="radio" aria-checked={tier === t}
                  className={`ord-tier${tier === t ? ' active' : ''}`} onClick={() => setTier(t)}>
                  {PRICE_TIER_LABEL[t]}
                </button>
              ))}
            </div>
            <p className="md-hint">
              ราคามาจากราคาขายที่ตั้งไว้ในหน้าราคาขายและกำไร · เมนูที่ยังไม่ได้ตั้งราคาระดับนี้ ให้กรอกราคาเองในตาราง
            </p>
          </ContentCard>

          {/* C — รายการสินค้า */}
          <ContentCard title={<><span className="md-section-badge">D</span><ClipboardCheck aria-hidden width={17} />รายการสินค้า</>}
            description="ค้นหาเมนูแล้วกดเพิ่ม — ไม่ต้องจำรหัสเมนูอีกต่อไป">
            <div className="ord-picker">
              <div className="issue-picker-search">
                <Search aria-hidden />
                <input value={menuTerm} onChange={(e) => setMenuTerm(e.target.value)}
                  placeholder="ค้นหารหัสหรือชื่อเมนู" aria-label="ค้นหาเมนู" />
              </div>
              <div className="ord-picker-list">
                {menus.isLoading && <p className="issue-none">กำลังโหลดเมนู…</p>}
                {menuResults.map((m) => {
                  const added = lines.some((l) => l.menuId === m.id);
                  return (
                    <button type="button" key={m.id} className={`issue-pick${added ? ' is-added' : ''}`}
                      aria-pressed={added} onClick={() => void addMenu(m)}>
                      <span className="ip-main">
                        <strong>{m.code} · {m.name}</strong>
                        <small>{m.sellingUnit ?? 'ไม่ระบุหน่วย'}{m.category ? ` · ${m.category.name}` : ''}</small>
                      </span>
                      <span className="ip-stock">
                        <b className="ip-avail">{m.sellingPrice != null ? money(m.sellingPrice) : '—'}</b>
                        <small>{m.sellingPrice != null ? 'ราคาปลีกที่ตั้งไว้' : 'ยังไม่ได้ตั้งราคา'}</small>
                      </span>
                      <span className="ip-add">{added ? <><Check aria-hidden width={15} />เพิ่มแล้ว</> : <><Plus aria-hidden width={15} />เพิ่ม</>}</span>
                    </button>
                  );
                })}
                {!menus.isLoading && menuResults.length === 0 && (
                  <p className="issue-none">{menuTerm ? `ไม่พบเมนูที่ตรงกับ “${menuTerm}”` : 'ยังไม่มีเมนูในระบบ'}</p>
                )}
              </div>
            </div>

            {lines.length === 0 ? (
              <p className="issue-none">ยังไม่มีรายการ — ค้นหาเมนูแล้วกดเพิ่มด้านบน</p>
            ) : (
              <div className="table-wrap">
                <table className="data-table md-table ord-lines">
                  <thead>
                    <tr>
                      <th>รายการ</th><th className="num">จำนวน</th><th>หน่วยขาย</th>
                      <th className="num">ราคาต่อหน่วย</th><th className="num">ยอดรวม</th><th>จัดการ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const total = lineTotal(l.quantity, l.unitPrice);
                      const overridden = l.tierPrice != null && Math.abs(l.tierPrice - l.unitPrice) > 0.0001;
                      const under = belowCost(l.unitPrice, l.cost);
                      return (
                        <tr key={l.key}>
                          <td data-label="รายการ">
                            <span className="md-two-line"><b>{l.name}</b><small>{l.code}</small></span>
                          </td>
                          <td className="num" data-label="จำนวน">
                            <input type="number" min="0.0001" step="any" className="ord-num" value={l.quantity}
                              aria-label={`จำนวน ${l.name}`}
                              onChange={(e) => patchLine(l.key, { quantity: Number(e.target.value) })} />
                          </td>
                          <td data-label="หน่วยขาย">{l.unit}</td>
                          <td className="num" data-label="ราคาต่อหน่วย">
                            <input type="number" min="0" step="any" className="ord-num" value={l.unitPrice}
                              aria-label={`ราคาต่อหน่วย ${l.name}`}
                              onChange={(e) => patchLine(l.key, { unitPrice: Number(e.target.value) })} />
                            {/* แก้ราคาเอง → บอกว่าราคาตามระดับคือเท่าไร */}
                            {overridden && <small className="ord-override">
                              {PRICE_TIER_LABEL[tier]} {money(l.tierPrice as number)}
                            </small>}
                            {l.tierPrice == null && <small className="ord-override warn">ยังไม่ได้ตั้ง{PRICE_TIER_LABEL[tier]}</small>}
                          </td>
                          <td className="num" data-label="ยอดรวม"><b>{money(total)}</b></td>
                          <td data-label="จัดการ">
                            <button type="button" className="icon-btn" onClick={() => removeLine(l.key)}
                              aria-label={`ลบ ${l.name}`}><Trash2 aria-hidden width={16} /></button>
                          </td>
                          {/* สมการอ่านเป็นประโยค */}
                          <td className="ord-line-eq" data-label="สรุป">
                            <span className="num">{qtyText(l.quantity)} {l.unit}</span>
                            <b aria-hidden> × </b><span className="sr-sep">คูณ</span>
                            <span className="num">{money(l.unitPrice)}</span>
                            <b aria-hidden> = </b><span className="sr-sep">เท่ากับ</span>
                            <strong className="num">{money(total)}</strong>
                            {under != null && <span className="ord-under" role="note">
                              <AlertTriangle aria-hidden width={13} />ราคานี้ต่ำกว่าต้นทุน {money(under)}
                            </span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ContentCard>

          {/* E — หมายเหตุ */}
          <ContentCard title={<><span className="md-section-badge">E</span>หมายเหตุ</>}
            description="ข้อความที่จะติดไปกับเอกสารออเดอร์">
            <div className="md-fields">
              <label className="full">หมายเหตุ (ไม่บังคับ)
                <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ส่งก่อน 9 โมง / แยกน้ำจิ้ม" />
              </label>
              <label>ส่วนลด (บาท)
                <input type="number" min="0" step="any" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                <span className="md-hint">หักจากยอดรวมก่อนเป็นยอดสุทธิ</span>
              </label>
            </div>
          </ContentCard>
        </div>

        {/* ---------- แผงสรุป ---------- */}
        <StickySummary className="ops-summary-panel">
          <div className="ops-sum">
            <h2><Wallet aria-hidden width={17} />สรุปออเดอร์</h2>
            <dl>
              <div><dt>เลขที่</dt><dd>{isEdit ? (existing.data?.orderNo ?? '—') : 'ระบบออกเลข SO ให้อัตโนมัติ'}</dd></div>
              <div><dt>ลูกค้า</dt><dd>{customer?.name ?? '—'}</dd></div>
              <div><dt>วันที่ส่ง</dt><dd>{deliveryDate ? new Date(deliveryDate).toLocaleDateString('th-TH') : '—'}</dd></div>
              <div><dt>ระดับราคาที่บันทึก</dt><dd>{PRICE_TIER_LABEL[tier]}</dd></div>
              <div><dt>จำนวนรายการ</dt><dd className="num">{totals.lineCount}</dd></div>
              <div><dt>จำนวนรวม</dt><dd className="num">{qtyText(totals.totalQuantity)}</dd></div>
              <div><dt>ยอดรวม</dt><dd className="num">{money(totals.subtotal)}</dd></div>
              {totals.discount > 0 && <div><dt>ส่วนลด</dt><dd className="num">− {money(totals.discount)}</dd></div>}
            </dl>
            <div className="ops-sum-total"><span>ยอดสุทธิ</span><strong className="num">{money(totals.total)}</strong></div>

            {blockers.length > 0 ? (
              <div className="save-blockers" role="status">
                <p className="sb-head"><AlertTriangle aria-hidden width={16} />ยังบันทึกไม่ได้ {blockers.length} จุด</p>
                <ul>{blockers.map((b) => <li key={b}><span>{b}</span></li>)}</ul>
              </div>
            ) : (
              <p className="ops-sum-note"><Check aria-hidden width={15} />ระบบจะบันทึกเป็นร่างก่อน ยืนยันได้ที่หน้าออเดอร์</p>
            )}

            {/* ระดับราคาถูกบันทึกแล้วตั้งแต่ Phase 8B แต่ยังไม่ใช่ตัวเลขการเงิน */}
            <p className="ops-sum-note"><Info aria-hidden width={15} />
              ระบบบันทึกทั้ง “ระดับราคา” และ “ราคาต่อหน่วยของแต่ละรายการ” · ยอดเงินของออเดอร์ยึดตามราคาต่อหน่วยเสมอ
            </p>

            <div className="ops-sum-actions">
              <button type="button" className="btn primary" disabled={blockers.length > 0 || saving}
                onClick={() => setConfirmOpen(true)}>
                {saving ? <Loader2 className="spin" aria-hidden width={16} /> : isEdit ? <Save aria-hidden width={16} /> : <ClipboardCheck aria-hidden width={16} />}
                {isEdit ? 'บันทึกการแก้ไข' : 'บันทึกร่างออเดอร์'}
              </button>
            </div>
          </div>
        </StickySummary>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={isEdit ? 'บันทึกการแก้ไขร่าง' : 'บันทึกร่างออเดอร์'}
        confirmLabel={isEdit ? 'บันทึกการแก้ไข' : 'บันทึกร่าง'}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void submit()}
        description={<div className="op-confirm">
          <dl>
            <div><dt>ลูกค้า</dt><dd>{customer?.name ?? '—'}</dd></div>
            <div><dt>วันที่ส่ง</dt><dd>{deliveryDate ? new Date(deliveryDate).toLocaleDateString('th-TH') : '—'}</dd></div>
            <div><dt>จำนวนรายการ</dt><dd>{totals.lineCount} รายการ</dd></div>
            <div><dt>ยอดสุทธิ</dt><dd>{money(totals.total)}</dd></div>
          </dl>
          <p className="op-confirm-impact">
            <ClipboardCheck aria-hidden width={15} />
            {isEdit
              ? <>บันทึกทับใบเดิม <b>{existing.data?.orderNo}</b> — เลขที่และวันที่สร้างไม่เปลี่ยน และยังเป็น<b>ร่าง</b>อยู่</>
              : <>ระบบจะออกเลขออเดอร์ให้และบันทึกเป็น<b>ร่าง</b> — ยังไม่ตัดสต็อกและยังแก้ไม่ได้จนกว่าจะยืนยัน</>}
          </p>
        </div>}
      />

      {quickCreate.open && <CustomerQuickCreateModal
        prefillName={quickCreate.prefill}
        onClose={() => setQuickCreate({ open: false, prefill: '' })}
        onCreated={(c: QuickCreatedCustomer) => {
          setQuickCreate({ open: false, prefill: '' });
          void qc.invalidateQueries({ queryKey: ['order-customers'] });
          void customers.refetch().then(() => { setCustomerId(c.id); setPickerOpen(false); });
        }}
      />}
    </PageContainer>
  );
}
