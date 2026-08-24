import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { AuthUser } from '@/auth/AuthContext';
import { makeUser, renderWithProviders } from './test-utils';

/**
 * PHASE 5 — Dashboard
 * หน้านี้ถูกออกแบบใหม่เป็น Executive + Operations overview
 * เจตนาเดิมที่ยังใช้ได้ถูกยกมาครบ: แสดงชื่อผู้ใช้, ทางลัดไป route ถูกต้อง,
 * กิจกรรมล่าสุดจำกัดเฉพาะผู้ดูแล
 */

const store = vi.hoisted(() => ({
  user: null as AuthUser | null,
  summary: {} as Record<string, unknown>,
  activity: {} as Record<string, unknown>,
  dash: {} as Record<string, unknown>,
}));

vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ user: store.user }) }));
vi.mock('@/hooks/useDashboardSummary', () => ({ useDashboardSummary: () => store.summary }));
vi.mock('@/hooks/useActivity', () => ({ useActivity: () => store.activity }));
vi.mock('@/lib/catalog', () => ({ catalogApi: { menus: vi.fn(() => Promise.resolve([])) } }));

// จำลองชั้นข้อมูลของ Dashboard — ตัว hook จริงมีเทสแยกของมันเอง
const refetchAll = vi.hoisted(() => vi.fn());
vi.mock('@/hooks/useDashboardData', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useDashboardData')>('@/hooks/useDashboardData');
  return { ...actual, useDashboardData: () => store.dash };
});

import DashboardPage from '@/pages/DashboardPage';

const q = (data: unknown, over: Record<string, unknown> = {}) =>
  ({ data, isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), ...over });

const INV_KPI = { itemCount: 12, totalValue: 284300, lowCount: 2, outCount: 1, negativeCount: 0, movementsToday: 7, thresholdMissing: false };
const INV_ROWS = [
  { itemId: 'i1', code: 'RM-001', name: 'ไข่ไก่', type: 'RAW_MATERIAL', warehouseId: 'w1', warehouseCode: 'W1', warehouseName: 'คลังกลาง', onHand: 0, reserved: 0, available: 0, unit: 'ฟอง', lastCost: 8, stockValue: 0, threshold: 20, status: 'OUT' as const, lastMovementAt: null },
  { itemId: 'i2', code: 'RM-002', name: 'น้ำมันพืช', type: 'RAW_MATERIAL', warehouseId: 'w1', warehouseCode: 'W1', warehouseName: 'คลังกลาง', onHand: 3, reserved: 0, available: 3, unit: 'L', lastCost: 47, stockValue: 141, threshold: 10, status: 'LOW' as const, lastMovementAt: null },
];

function baseDash(over: Record<string, unknown> = {}) {
  return {
    inventory: q({ rows: INV_ROWS, kpi: INV_KPI }),
    orderKpi: q({ totalOrders: 8, todayOrders: 3, monthOrders: 8, revenueToday: 1200, revenueMonth: 9000, pendingAmount: 500 }),
    orders: q([]),
    receiving: q([]),
    issues: q([]),
    adjustments: q([]),
    menus: q([]),
    permissions: { canInventory: true, canOrders: true, canOrderKpi: true, canReceiving: true, canIssues: true },
    refetchAll, isFetching: false,
    ...over,
  };
}

describe('DashboardPage', () => {
  beforeEach(() => {
    refetchAll.mockClear();
    store.summary = { data: { users: 2, activeUsers: 2, units: 3, warehouses: 1, items: 5, recipes: 4, rawMaterials: 4, menus: 2, activeRecipes: 3, itemsWithoutPrice: 0 }, isLoading: false, isError: false, refetch: vi.fn() };
    store.activity = { data: { items: [], page: 1, pageSize: 6, total: 0, totalPages: 0 }, isLoading: false, isError: false, refetch: vi.fn() };
    store.dash = baseDash();
    store.user = makeUser();
  });

  /* ---------- เจตนาเดิมที่ยกมา ---------- */
  it('1 แสดงชื่อผู้ใช้ (แบบกระชับ ไม่ใช่ hero ใหญ่)', () => {
    store.user = makeUser({ fullName: 'วิน ผู้ดูแล' });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'ภาพรวมระบบ' })).toBeInTheDocument();
    expect(screen.getByText('วิน ผู้ดูแล')).toBeInTheDocument();
  });

  it('2 ทางลัดชี้ไป route ที่ถูกต้อง', () => {
    renderWithProviders(<DashboardPage />);
    const quick = document.querySelector('.dash-quick')!;
    expect(within(quick as HTMLElement).getByRole('link', { name: /รับของเข้า/ })).toHaveAttribute('href', '/receiving/new');
    expect(within(quick as HTMLElement).getByRole('link', { name: /เบิกให้ครัวกลาง/ })).toHaveAttribute('href', '/stock-issues/new');
    expect(within(quick as HTMLElement).getByRole('link', { name: /สร้างสูตร/ })).toHaveAttribute('href', '/recipes/new');
  });

  it('3 กิจกรรมล่าสุดแสดง empty state เมื่อไม่มีข้อมูล (admin)', () => {
    store.user = makeUser({ roles: ['SUPER_ADMIN'] });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('ยังไม่มีกิจกรรม')).toBeInTheDocument();
  });

  it('4 กิจกรรมล่าสุดไม่แสดงเลยสำหรับผู้ใช้ที่ไม่ใช่ผู้ดูแล', () => {
    store.user = makeUser({ roles: ['ADMIN'] });
    renderWithProviders(<DashboardPage />);
    expect(screen.queryByRole('heading', { name: 'กิจกรรมล่าสุด' })).not.toBeInTheDocument();
  });

  /* ---------- KPI จากข้อมูลจริง ---------- */
  it('5 KPI ใช้ตัวเลขจริงจาก API ไม่ใช่ค่าที่แต่งขึ้น', () => {
    renderWithProviders(<DashboardPage />);
    /* PHASE 22 — แถวบนเปลี่ยนเป็นการ์ดหลัก 4 ใบ ตัวเลขยังมาจาก API เดิมทั้งหมด
       การ์ดสต็อกสรุปจำนวนที่ต้องดู และบอกขนาดคลังจริงไว้ในบรรทัดท้าย */
    expect(screen.getAllByText('฿284,300').length).toBeGreaterThan(0);
    expect(screen.getByText('ทั้งคลัง 12 รายการ')).toBeInTheDocument();
    expect(screen.getByText('หมดสต็อก')).toBeInTheDocument();
    // "ใกล้หมด" ปรากฏทั้งในการ์ดสต็อกและในรายการเรื่องที่ต้องจัดการ ซึ่งถูกต้องทั้งคู่
    expect(screen.getAllByText('ใกล้หมด').length).toBeGreaterThan(0);
    // ไม่มีตัวเลขไหนถูกแต่งขึ้น — การ์ดทั้งสี่ใบมาจากชุดข้อมูลที่ mock ไว้เท่านั้น
    expect(screen.getByText('ความครบถ้วนของต้นทุน')).toBeInTheDocument();
    expect(screen.getByText('งานปฏิบัติการ')).toBeInTheDocument();
  });

  it('6 ไม่มี trend ปลอม — ไม่มีข้อความ % เพิ่ม/ลดที่ไม่มีข้อมูลย้อนหลังรองรับ', () => {
    renderWithProviders(<DashboardPage />);
    const body = document.body.textContent ?? '';
    expect(body).not.toMatch(/[+-]\d+(\.\d+)?%\s*(จากเดือนก่อน|จากเมื่อวาน|MoM|WoW)/);
  });

  it('7 ไม่แสดง KPI ที่ผู้ใช้ไม่มีสิทธิ์เห็น', () => {
    store.dash = baseDash({
      permissions: { canInventory: false, canOrders: false, canOrderKpi: false, canReceiving: false, canIssues: false },
    });
    renderWithProviders(<DashboardPage />);
    /* PHASE 22 — การ์ดหลักมีครบสี่ใบเสมอตามที่ออกแบบไว้
       แต่ใบที่ผู้ใช้ไม่มีสิทธิ์ต้องบอกตรง ๆ ว่าไม่มีสิทธิ์ และต้องไม่มีตัวเลขของจริงหลุดออกมา */
    expect(screen.getAllByText('ไม่มีสิทธิ์ดูข้อมูลนี้').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('฿284,300')).not.toBeInTheDocument();
    expect(screen.queryByText('ทั้งคลัง 12 รายการ')).not.toBeInTheDocument();
    // การ์ดต้นทุนยังแสดงได้ เพราะข้อมูลมาจาก /dashboard/summary ไม่ใช่สิทธิ์คลัง
    expect(screen.getByText('ความครบถ้วนของต้นทุน')).toBeInTheDocument();
  });

  /* ---------- Alerts ---------- */
  it('8 แสดงเรื่องที่ต้องจัดการจากสถานะสต็อกจริง พร้อมปุ่มไปต่อ', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('สินค้าหมดสต็อก 1 รายการ')).toBeInTheDocument();
    expect(screen.getByText('ใกล้ถึงจุดสั่งซื้อ 2 รายการ')).toBeInTheDocument();
    const alerts = document.querySelectorAll('.dash-alerts li');
    expect(alerts.length).toBeGreaterThanOrEqual(2);
    expect(within(alerts[0] as HTMLElement).getByRole('link')).toHaveAttribute('href', '/inventory?status=OUT');
  });

  it('9 ระดับความรุนแรงมีข้อความกำกับ ไม่ได้สื่อด้วยสีอย่างเดียว', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getAllByText('ต้องแก้ทันที').length).toBeGreaterThan(0);
    expect(screen.getAllByText('ควรตรวจสอบ').length).toBeGreaterThan(0);
  });

  it('10 ไม่มีเรื่องค้าง → empty state เชิงบวก ไม่ใช่ error', () => {
    store.dash = baseDash({
      inventory: q({ rows: [], kpi: { ...INV_KPI, lowCount: 0, outCount: 0, negativeCount: 0 } }),
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('ไม่มีเรื่องต้องจัดการ')).toBeInTheDocument();
  });

  /* ---------- Operations ---------- */
  it('11 นับเอกสารวันนี้จากรายการจริง แยกยืนยัน/ร่าง', () => {
    const today = new Date().toISOString();
    store.dash = baseDash({
      receiving: q([
        { id: 'a', status: 'CONFIRMED', receiptDate: today },
        { id: 'b', status: 'DRAFT', receiptDate: today },
        { id: 'c', status: 'CONFIRMED', receiptDate: '2020-01-01T00:00:00.000Z' },
      ]),
    });
    renderWithProviders(<DashboardPage />);
    const ops = document.querySelectorAll('.dash-op');
    const gr = [...ops].find((o) => o.textContent?.includes('รับของเข้า'))!;
    expect(gr.querySelector('.op-total')?.textContent).toBe('2');   // นับเฉพาะวันนี้
    expect(gr.textContent).toContain('ยืนยันแล้ว');
  });

  it('12 ร่างที่ค้างกลายเป็นเรื่องต้องจัดการ', () => {
    store.dash = baseDash({
      receiving: q([{ id: 'a', status: 'DRAFT', receiptDate: '2020-01-01T00:00:00.000Z' }]),
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('ใบรับของรอยืนยัน 1 ใบ')).toBeInTheDocument();
  });

  /* ---------- Orders ---------- */
  it('13 ไม่มีออเดอร์ → empty state ไม่ใช่ข้อมูลปลอม', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('ยังไม่มีคำสั่งซื้อ')).toBeInTheDocument();
  });

  it('14 มีออเดอร์ → แสดงเลขที่ ลูกค้า และยอดจริง', () => {
    store.dash = baseDash({
      orders: q([{ id: 'o1', orderNo: 'SO-0001', status: 'PENDING', totalAmount: 1250.5, customer: { name: 'ร้านลุงหนวด' } }]),
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('SO-0001')).toBeInTheDocument();
    expect(screen.getByText('ร้านลุงหนวด')).toBeInTheDocument();
    expect(screen.getByText('฿1,250.50')).toBeInTheDocument();
  });

  /* ---------- Partial failure ---------- */
  it('15 API หนึ่งล้ม การ์ดอื่นยังทำงาน และการ์ดที่ล้มมีปุ่มลองใหม่', () => {
    const invRefetch = vi.fn();
    store.dash = baseDash({
      inventory: q(undefined, { isError: true, refetch: invRefetch }),
    });
    renderWithProviders(<DashboardPage />);
    // การ์ดคลังแสดง error
    const errors = screen.getAllByText('โหลดข้อมูลไม่ได้');
    expect(errors.length).toBeGreaterThan(0);
    // การ์ดอื่นยังอยู่
    expect(screen.getByRole('heading', { name: 'ต้นทุนและสูตรอาหาร' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'ราคาขายและกำไร' })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'ลองใหม่' })[0]);
    expect(invRefetch).toHaveBeenCalled();
  });

  /* ---------- Refresh ---------- */
  it('16 ปุ่มรีเฟรชเรียก refetch ไม่ได้ reload ทั้งหน้า', () => {
    renderWithProviders(<DashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: /รีเฟรชข้อมูล/ }));
    expect(refetchAll).toHaveBeenCalledOnce();
  });

  it('17 ระหว่างโหลดครั้งแรกแสดง skeleton ไม่ใช่ spinner กลางจอ', () => {
    store.summary = { ...store.summary, isLoading: true };
    store.dash = baseDash({ inventory: q(undefined, { isLoading: true }) });
    renderWithProviders(<DashboardPage />);
    expect(document.querySelectorAll('.skeleton').length).toBeGreaterThan(0);
  });

  /* ---------- Pricing ---------- */
  it('18 ราคาต่ำกว่าต้นทุนถูกยกขึ้นมาเตือน', () => {
    store.dash = baseDash({
      menus: q([
        { id: 'm1', code: 'M-1', name: 'ชาไทย', imageUrl: null, category: null, sellingUnit: null, isActive: true, recipeId: 'r1', hasRecipe: true, totalCost: 20, sellingPrice: 15, margin: -33.3 },
        { id: 'm2', code: 'M-2', name: 'กาแฟ', imageUrl: null, category: null, sellingUnit: null, isActive: true, recipeId: 'r2', hasRecipe: true, totalCost: 10, sellingPrice: 25, margin: 60 },
      ]),
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('ราคาขายต่ำกว่าต้นทุน 1 เมนู')).toBeInTheDocument();
    expect(screen.getAllByText('ชาไทย').length).toBeGreaterThan(0);
  });

  it('19 ไม่มีราคาต่ำกว่าต้นทุน → ข้อความเชิงบวก', () => {
    store.dash = baseDash({
      menus: q([{ id: 'm2', code: 'M-2', name: 'กาแฟ', imageUrl: null, category: null, sellingUnit: null, isActive: true, recipeId: 'r2', hasRecipe: true, totalCost: 10, sellingPrice: 25, margin: 60 }]),
    });
    renderWithProviders(<DashboardPage />);
    expect(screen.getByText('ไม่มีราคาขายต่ำกว่าต้นทุน')).toBeInTheDocument();
  });

  /* ---------- a11y ---------- */
  it('20 หัวข้อเรียงลำดับถูก: h1 เดียว การ์ดเป็น h2', () => {
    renderWithProviders(<DashboardPage />);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { level: 2 }).length).toBeGreaterThan(2);
  });
});
