import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { AlertTriangle, RefreshCw, Search, UserPlus, Users as UsersIcon } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/lib/api-client';
import Avatar from '@/components/ui/Avatar';
import Badge, { type BadgeVariant } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useToast } from '@/components/ui/Toast';
import { formatThaiDate, formatThaiDateTime } from '@/lib/utils';

interface UserRow {
  id: string; username: string; fullName: string; email: string;
  isActive: boolean; mustChangePassword: boolean; roles: string[];
  lastLoginAt: string | null; createdAt: string;
}

const PAGE_SIZE = 8;
const ROLE_BADGE: Record<string, BadgeVariant> = { SUPER_ADMIN: 'gold', ADMIN: 'info' };

export default function UsersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const isAdmin = Boolean(user?.roles.includes('SUPER_ADMIN'));

  const query = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserRow[]>('/users'),
    enabled: isAdmin,
  });

  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const roleOptions = useMemo(() => [...new Set(rows.flatMap((r) => r.roles))].sort(), [rows]);

  const filtered = useMemo(() => rows.filter((r) => {
    const q = search.trim().toLowerCase();
    const matchQ = !q || r.fullName.toLowerCase().includes(q) || r.username.toLowerCase().includes(q) || r.email.toLowerCase().includes(q);
    const matchRole = !roleFilter || r.roles.includes(roleFilter);
    const matchStatus = !statusFilter || (statusFilter === 'active' ? r.isActive : !r.isActive);
    return matchQ && matchRole && matchStatus;
  }), [rows, search, roleFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const resetPage = () => setPage(1);

  if (!isAdmin) return <UnauthorizedPage />;

  return (
    <>
      <div className="page-title-block">
        <p className="eyebrow">ADMINISTRATION</p>
        <h1>ผู้ใช้งาน</h1>
        <p>จัดการบัญชีและตรวจสอบบทบาทในระบบ</p>
      </div>

      <div className="toolbar" style={{ marginTop: 18 }}>
        <div className="search-box">
          <Search aria-hidden />
          <input placeholder="ค้นหาชื่อ, ชื่อผู้ใช้ หรืออีเมล" value={search} onChange={(e) => { setSearch(e.target.value); resetPage(); }} aria-label="ค้นหาผู้ใช้งาน" />
        </div>
        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); resetPage(); }} aria-label="กรองตามบทบาท">
          <option value="">ทุกบทบาท</option>
          {roleOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); resetPage(); }} aria-label="กรองตามสถานะ">
          <option value="">ทุกสถานะ</option>
          <option value="active">ใช้งาน</option>
          <option value="inactive">ปิดใช้งาน</option>
        </select>
        <span className="count-pill">{filtered.length} รายการ</span>
        <div className="spacer" />
        <button className="btn" onClick={() => { void query.refetch(); toast('รีเฟรชข้อมูลแล้ว'); }} disabled={query.isFetching}>
          <RefreshCw aria-hidden className={query.isFetching ? 'spin' : ''} />รีเฟรช
        </button>
        <button className="btn primary" onClick={() => setAddOpen(true)}><UserPlus aria-hidden />เพิ่มผู้ใช้งาน</button>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>ผู้ใช้งาน</th><th>ชื่อผู้ใช้</th><th>บทบาท</th><th>สถานะ</th>
                <th>เข้าสู่ระบบล่าสุด</th><th>วันที่สร้าง</th><th>รหัสผ่าน</th>
              </tr>
            </thead>
            {query.isLoading ? (
              <SkeletonRows rows={6} cols={7} />
            ) : (
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="cell-user">
                        <Avatar name={row.fullName} size="sm" />
                        <div className="cu-text"><strong>{row.fullName}</strong><span>{row.email}</span></div>
                      </div>
                    </td>
                    <td>@{row.username}</td>
                    <td>{row.roles.map((r) => <Badge key={r} variant={ROLE_BADGE[r] ?? 'muted'}>{r}</Badge>)}</td>
                    <td>{row.isActive ? <Badge variant="success" dot>ใช้งาน</Badge> : <Badge variant="muted" dot>ปิดใช้งาน</Badge>}</td>
                    <td>{row.lastLoginAt ? formatThaiDateTime(row.lastLoginAt) : '—'}</td>
                    <td>{formatThaiDate(row.createdAt)}</td>
                    <td>{row.mustChangePassword ? <Badge variant="warning">รอเปลี่ยน</Badge> : <Badge variant="muted">ตั้งค่าแล้ว</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {query.isError && !query.isLoading && (
          <EmptyState variant="error" icon={AlertTriangle} title="โหลดข้อมูลไม่สำเร็จ"
            description={query.error instanceof Error ? query.error.message : 'ไม่สามารถดึงรายชื่อผู้ใช้งานได้'}
            action={<button className="btn" onClick={() => void query.refetch()}><RefreshCw aria-hidden />ลองอีกครั้ง</button>} />
        )}
        {!query.isLoading && !query.isError && filtered.length === 0 && (
          <EmptyState icon={UsersIcon} title="ไม่พบผู้ใช้งาน" description="ลองปรับคำค้นหาหรือตัวกรอง" />
        )}

        {!query.isLoading && !query.isError && filtered.length > 0 && (
          <div className="pagination">
            <span className="pg-info">หน้า {safePage} จาก {totalPages}</span>
            <div className="pg-controls">
              <button className="pg-btn" onClick={() => setPage(safePage - 1)} disabled={safePage <= 1}>ก่อนหน้า</button>
              {Array.from({ length: totalPages }).map((_, i) => (
                <button key={i} className={`pg-btn${safePage === i + 1 ? ' active' : ''}`} onClick={() => setPage(i + 1)}>{i + 1}</button>
              ))}
              <button className="pg-btn" onClick={() => setPage(safePage + 1)} disabled={safePage >= totalPages}>ถัดไป</button>
            </div>
          </div>
        )}
      </section>

      <ConfirmDialog
        open={addOpen}
        title="เพิ่มผู้ใช้งาน"
        description="ฟีเจอร์การเพิ่มผู้ใช้งานผ่านหน้าจอกำลังอยู่ระหว่างการพัฒนา และจะเปิดใช้งานในเฟสถัดไป ขณะนี้สามารถเพิ่มผู้ใช้ผ่านกระบวนการ seed ของระบบ"
        confirmLabel="รับทราบ"
        onConfirm={() => toast('บันทึกไว้แล้ว ฟีเจอร์นี้จะเปิดใช้งานเร็ว ๆ นี้')}
        onClose={() => setAddOpen(false)}
      />
    </>
  );
}

export function UnauthorizedPage() {
  return (
    <div className="placeholder-page">
      <div className="card placeholder-hero">
        <span className="icon-chip amber"><AlertTriangle aria-hidden /></span>
        <Badge variant="danger" dot>ไม่มีสิทธิ์เข้าถึง</Badge>
        <h1>ไม่มีสิทธิ์เข้าถึง</h1>
        <p>บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้ กรุณาติดต่อผู้ดูแลระบบ</p>
      </div>
      <div className="placeholder-actions"><Link to="/dashboard" className="btn primary">กลับสู่ภาพรวม</Link></div>
    </div>
  );
}
