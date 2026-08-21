import { useMemo, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle, Check, Copy, History, KeyRound, RefreshCw, ShieldCheck, UserPlus,
  Users as UsersIcon, X,
} from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/lib/api-client';
import Avatar from '@/components/ui/Avatar';
import Badge, { type BadgeVariant } from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import MasterModal from '@/components/ui/MasterModal';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';
import { roleLabel, userStatus } from '@/lib/admin-vocab';
import { useToast } from '@/components/ui/Toast';
import { formatThaiDate, formatThaiDateTime } from '@/lib/utils';

/**
 * PHASE 9 — ผู้ใช้งาน
 *
 * ย้ายมาใช้ design system และแทน window.confirm สองจุดเดิม
 * (รีเซ็ตรหัสผ่าน / ปิดบัญชี) ด้วย ConfirmDialog ที่บอกผลกระทบก่อน
 *
 * ข้อจำกัดที่ยืนยันจาก schema: ไม่มีตาราง Session
 * จึงไม่มี KPI "เซสชันที่ใช้งานอยู่" และไม่มีปุ่มยกเลิกเซสชันแยก
 */

interface UserRow {
  id: string; username: string; fullName: string; email: string;
  isActive: boolean; mustChangePassword: boolean;
  roles: string[]; company: { id: string; nameTh: string };
  lastLoginAt: string | null; createdAt: string;
  registrationStatus?: string | null;
}
interface Role { id: string; name: string; description?: string }
interface Credential { username: string; temporaryPassword: string }

const PAGE_SIZE = 10;
const ROLE_BADGE: Record<string, BadgeVariant> = { SUPER_ADMIN: 'gold', MANAGER: 'info', OPERATIONS: 'success' };
const STATUS_BADGE: Record<string, BadgeVariant> = { success: 'success', muted: 'muted', warning: 'warning', danger: 'danger' };
/** อีเมลที่ระบบสร้างให้อัตโนมัติ ไม่ใช่อีเมลจริงของผู้ใช้ */
const isPlaceholderEmail = (email: string) => email.endsWith('@account.s2a.local');

export default function UsersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [params] = useSearchParams();

  const canView = Boolean(user?.roles.includes('SUPER_ADMIN')
    || ['USER_VIEW', 'USER_MANAGE'].some((p) => user?.permissions.includes(p)));
  const canManage = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('USER_MANAGE'));

  const query = useQuery({ queryKey: ['users'], queryFn: () => apiClient.get<UserRow[]>('/users'), enabled: canView });
  const roleQuery = useQuery({ queryKey: ['user-roles'], queryFn: () => apiClient.get<Role[]>('/users/roles'), enabled: canManage });

  // มาจากปุ่ม "ดูผู้ใช้ในบทบาทนี้" ในหน้าสิทธิ์
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState(params.get('role') ?? '');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [addOpen, setAddOpen] = useState(false);
  const [detail, setDetail] = useState<UserRow>();
  const [credential, setCredential] = useState<Credential>();
  const [pending, setPending] = useState<{ kind: 'reset' | 'toggle'; row: UserRow } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const rows = useMemo(() => query.data ?? [], [query.data]);
  const filtered = useMemo(() => rows.filter((r) => {
    const q = search.trim().toLowerCase();
    if (q && !`${r.fullName} ${r.username} ${r.email}`.toLowerCase().includes(q)) return false;
    if (roleFilter && !r.roles.includes(roleFilter)) return false;
    if (statusFilter === 'active' && !r.isActive) return false;
    if (statusFilter === 'inactive' && r.isActive) return false;
    if (statusFilter === 'mustChange' && !r.mustChangePassword) return false;
    return true;
  }), [rows, search, roleFilter, statusFilter]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
  const hasFilter = Boolean(search || roleFilter || statusFilter);

  if (!canView) return <UnauthorizedPage />;

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true); setError('');
    const d = new FormData(e.currentTarget);
    try {
      const result = await apiClient.post<Credential>('/users', {
        fullName: d.get('fullName'), username: d.get('username'), email: d.get('email'),
        role: d.get('role'), isActive: true, temporaryPassword: d.get('temporaryPassword') || undefined,
      });
      setAddOpen(false); setCredential(result);
      await query.refetch();
      toast({ title: 'สร้างบัญชีสำเร็จ', description: `บัญชี “${result.username}” พร้อมเข้าสู่ระบบด้วยรหัสผ่านชั่วคราว`, variant: 'success' });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถสร้างบัญชีได้');
    } finally { setBusy(false); }
  };

  const resetPassword = async (row: UserRow) => {
    setBusy(true);
    try {
      const result = await apiClient.post<Credential>(`/users/${row.id}/reset-password`);
      setCredential(result); setPending(null);
      await query.refetch();
      toast({ title: 'รีเซ็ตรหัสผ่านแล้ว', description: 'เซสชันเดิมถูกยกเลิกและผู้ใช้ต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบ', variant: 'warning' });
    } catch (reason) {
      toast({ title: 'รีเซ็ตรหัสผ่านไม่สำเร็จ', description: reason instanceof Error ? reason.message : 'กรุณาลองอีกครั้ง', variant: 'error' });
    } finally { setBusy(false); }
  };

  const toggleActive = async (row: UserRow) => {
    try {
      await apiClient.patch(`/users/${row.id}`, { isActive: !row.isActive });
      setDetail(undefined); setPending(null);
      await query.refetch();
      toast({
        title: row.isActive ? 'ปิดบัญชีแล้ว' : 'เปิดบัญชีแล้ว',
        description: row.isActive ? 'เซสชันที่ใช้งานอยู่ถูกยกเลิกเรียบร้อย' : 'บัญชีพร้อมกลับมาใช้งาน',
        variant: 'success',
      });
    } catch (reason) {
      toast({ title: 'ปรับสถานะไม่สำเร็จ', description: reason instanceof Error ? reason.message : 'กรุณาลองอีกครั้ง', variant: 'error' });
    }
  };

  return (
    <PageContainer size="wide" className="admin-page users-admin-page">
      <PageHeader
        breadcrumb="การจัดการผู้ใช้"
        title="ผู้ใช้งาน"
        description="สร้างบัญชี กำหนดบทบาท และจัดการสิทธิ์เข้าถึงบริษัทอย่างปลอดภัย"
        actions={<>
          <button type="button" className="btn" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw aria-hidden width={16} className={query.isFetching ? 'spin' : ''} />รีเฟรช
          </button>
          {canManage && <button type="button" className="btn primary" onClick={() => setAddOpen(true)}>
            <UserPlus aria-hidden width={16} />เพิ่มผู้ใช้งาน
          </button>}
        </>}
      />

      <KPIGrid columns={4}>
        <KPICard label="ผู้ใช้ทั้งหมด" value={query.isLoading ? '—' : rows.length} icon={<UsersIcon />} hint="ทุกสถานะ" />
        <KPICard label="ใช้งานอยู่" value={query.isLoading ? '—' : rows.filter((r) => r.isActive).length} icon={<Check />}
          hint="เข้าสู่ระบบได้" onClick={() => setStatusFilter('active')} active={statusFilter === 'active'} />
        <KPICard label="ปิดใช้งาน" value={query.isLoading ? '—' : rows.filter((r) => !r.isActive).length} icon={<X />}
          hint="เข้าสู่ระบบไม่ได้" onClick={() => setStatusFilter('inactive')} active={statusFilter === 'inactive'} />
        <KPICard label="ต้องเปลี่ยนรหัสผ่าน" value={query.isLoading ? '—' : rows.filter((r) => r.mustChangePassword).length}
          icon={<KeyRound />} tone={rows.some((r) => r.mustChangePassword) ? 'warning' : 'default'}
          hint="ยังใช้รหัสชั่วคราว" onClick={() => setStatusFilter('mustChange')} active={statusFilter === 'mustChange'} />
      </KPIGrid>

      <FilterBar actions={hasFilter
        ? <button type="button" className="btn" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); setPage(1); }}>ล้างตัวกรอง</button>
        : undefined}>
        <input className="s2-search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          placeholder="ค้นหาชื่อ Username หรือ Email" aria-label="ค้นหาผู้ใช้งาน" />
        <select value={roleFilter} onChange={(e) => { setRoleFilter(e.target.value); setPage(1); }} aria-label="บทบาท">
          <option value="">ทุกบทบาท</option>
          {roleQuery.data?.map((r) => <option key={r.id} value={r.name}>{roleLabel(r.name)}</option>)}
        </select>
        <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} aria-label="สถานะ">
          <option value="">ทุกสถานะ</option>
          <option value="active">ใช้งานอยู่</option>
          <option value="inactive">ปิดใช้งาน</option>
          <option value="mustChange">ต้องเปลี่ยนรหัสผ่าน</option>
        </select>
        <span className="count-pill">{filtered.length} รายการ</span>
      </FilterBar>

      {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}

      <ContentCard padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table">
            <thead>
              <tr>
                <th>ชื่อ</th><th>Username / บริษัท</th><th>บทบาท</th>
                <th>สถานะ</th><th>รหัสผ่าน</th><th>เข้าใช้ล่าสุด</th><th>จัดการ</th>
              </tr>
            </thead>
            {query.isLoading ? <SkeletonRows rows={6} cols={7} /> : (
              <tbody>
                {pageRows.map((row) => {
                  const st = userStatus(row);
                  return (
                    <tr key={row.id}>
                      <td data-label="ชื่อ">
                        <span className="admin-user-cell">
                          <Avatar name={row.fullName} size="sm" />
                          <span className="cu-text">
                            <strong>{row.fullName}</strong>
                            <span>{isPlaceholderEmail(row.email) ? 'ไม่ได้ระบุอีเมล' : row.email}</span>
                          </span>
                        </span>
                      </td>
                      <td data-label="Username / บริษัท">
                        <span className="md-two-line"><b>@{row.username}</b><small>{row.company.nameTh}</small></span>
                      </td>
                      <td data-label="บทบาท">
                        <span className="admin-roles-cell">
                          {row.roles.map((r) => <Badge key={r} variant={ROLE_BADGE[r] ?? 'muted'}>{roleLabel(r)}</Badge>)}
                        </span>
                      </td>
                      <td data-label="สถานะ"><Badge variant={STATUS_BADGE[st.tone]} dot>{st.label}</Badge></td>
                      <td data-label="รหัสผ่าน">
                        {row.mustChangePassword
                          ? <Badge variant="warning">ต้องเปลี่ยนรหัส</Badge>
                          : <Badge variant="success">ตั้งค่าแล้ว</Badge>}
                      </td>
                      <td data-label="เข้าใช้ล่าสุด">{row.lastLoginAt ? formatThaiDateTime(row.lastLoginAt) : '—'}</td>
                      <td data-label="จัดการ">
                        <button type="button" className="btn" onClick={() => setDetail(row)}
                          aria-label={`ดูข้อมูล ${row.fullName}`}>ดูข้อมูล</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>

        {query.isError && <EmptyState variant="error" icon={AlertTriangle} title="โหลดข้อมูลไม่สำเร็จ"
          description={query.error instanceof Error ? query.error.message : 'กรุณาลองอีกครั้ง'}
          action={<button type="button" className="btn" onClick={() => void query.refetch()}>ลองอีกครั้ง</button>} />}

        {!query.isLoading && !query.isError && filtered.length === 0 && (
          hasFilter
            ? <EmptyState icon={UsersIcon} title="ไม่พบผู้ใช้งาน" description="ปรับคำค้นหาหรือตัวกรอง แล้วลองอีกครั้ง"
                action={<button type="button" className="btn" onClick={() => { setSearch(''); setRoleFilter(''); setStatusFilter(''); }}>ล้างตัวกรอง</button>} />
            : <EmptyState icon={UsersIcon} title="ยังไม่มีผู้ใช้งาน" description="เพิ่มบัญชีผู้ใช้รายแรกเพื่อเริ่มใช้งานระบบ" />
        )}

        {!query.isLoading && filtered.length > 0 && pages > 1 && (
          <div className="md-pagination">
            <span>หน้า {safePage} จาก {pages} · ทั้งหมด {filtered.length} คน</span>
            <div>
              <button type="button" className="btn" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>ก่อนหน้า</button>
              <button type="button" className="btn" disabled={safePage === pages} onClick={() => setPage(safePage + 1)}>ถัดไป</button>
            </div>
          </div>
        )}
      </ContentCard>

      {/* ---------- เพิ่มผู้ใช้ ---------- */}
      {addOpen && (
        <div className="dialog-backdrop" role="presentation" onMouseDown={() => setAddOpen(false)}>
          <form className="md-modal" onSubmit={(e) => void create(e)} onMouseDown={(e) => e.stopPropagation()}
            role="dialog" aria-modal="true" aria-labelledby="add-user-title">
            <header className="md-modal-head">
              <div>
                <h2 id="add-user-title">เพิ่มผู้ใช้งาน</h2>
                <p>ระบบจะสร้างรหัสผ่านชั่วคราวและบังคับให้เปลี่ยนเมื่อเข้าใช้ครั้งแรก</p>
              </div>
              <button type="button" className="icon-btn" onClick={() => setAddOpen(false)} aria-label="ปิด"><X aria-hidden width={17} /></button>
            </header>
            <div className="md-modal-body">
              {error && <div className="rb-callout warn" role="alert"><AlertTriangle aria-hidden /><div><strong>{error}</strong></div></div>}
              <div className="md-fields">
                <label className="full">ชื่อแสดงผล *<input name="fullName" required /></label>
                <label>Username *
                  <input name="username" pattern="[a-zA-Z0-9._-]+" minLength={3} required />
                  <span className="md-hint">ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง</span>
                </label>
                <label>Email (ไม่บังคับ)<input name="email" type="email" /></label>
                <label className="full">บทบาท *
                  <select name="role" required defaultValue="">
                    <option value="" disabled>เลือกบทบาท</option>
                    {roleQuery.data?.map((r) => <option key={r.id} value={r.name}>{roleLabel(r.name)} ({r.name})</option>)}
                  </select>
                </label>
                <label className="full">รหัสผ่านชั่วคราว
                  <input name="temporaryPassword" type="password" minLength={10} placeholder="เว้นว่างเพื่อให้ระบบสร้างอัตโนมัติ" />
                  <span className="md-hint">อย่างน้อย 10 ตัวอักษร · ระบบไม่เก็บรหัสนี้ไว้แสดงซ้ำ</span>
                </label>
              </div>
            </div>
            <footer className="md-modal-foot">
              <button type="button" className="btn" onClick={() => setAddOpen(false)} disabled={busy}>ยกเลิก</button>
              <button type="submit" className="btn primary" disabled={busy}>{busy ? 'กำลังสร้าง…' : 'สร้างบัญชี'}</button>
            </footer>
          </form>
        </div>
      )}

      {/* ---------- ข้อมูลผู้ใช้ ---------- */}
      <MasterModal
        open={Boolean(detail)}
        title={detail?.fullName ?? ''}
        description={detail ? `@${detail.username} · ${detail.company.nameTh}` : ''}
        confirmLabel="ปิด"
        confirmIcon={<Check aria-hidden width={16} />}
        cancelLabel="ปิดหน้าต่าง"
        onClose={() => setDetail(undefined)}
        onConfirm={() => setDetail(undefined)}
        width={620}
      >
        {detail && <>
          <dl className="doc-grid">
            <div><dt>บทบาท</dt><dd>{detail.roles.map(roleLabel).join(', ') || '—'}</dd></div>
            <div><dt>สถานะ</dt><dd>{userStatus(detail).label}</dd></div>
            <div><dt>อีเมล</dt><dd>{isPlaceholderEmail(detail.email) ? 'ไม่ได้ระบุ' : detail.email}</dd></div>
            <div><dt>รหัสผ่าน</dt><dd>{detail.mustChangePassword ? 'ต้องเปลี่ยนรหัส' : 'ตั้งค่าแล้ว'}</dd></div>
            <div><dt>เข้าสู่ระบบล่าสุด</dt><dd>{detail.lastLoginAt ? formatThaiDateTime(detail.lastLoginAt) : '—'}</dd></div>
            <div><dt>สร้างเมื่อ</dt><dd>{formatThaiDate(detail.createdAt)}</dd></div>
          </dl>

          <div className="md-form-actions">
            <Link className="btn" to={`/activity?user=${encodeURIComponent(detail.username)}`}>
              <History aria-hidden width={15} />ดูประวัติการใช้งาน
            </Link>
            {canManage && <>
              <button type="button" className="btn" disabled={busy} onClick={() => setPending({ kind: 'reset', row: detail })}>
                <KeyRound aria-hidden width={15} />รีเซ็ตรหัสผ่าน
              </button>
              <button type="button" className={`btn${detail.isActive ? ' danger-btn' : ''}`}
                onClick={() => setPending({ kind: 'toggle', row: detail })}>
                {detail.isActive ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
              </button>
            </>}
          </div>
        </>}
      </MasterModal>

      {/* การกระทำที่กระทบการเข้าถึงระบบ ต้องบอกผลก่อนเสมอ (แทน window.confirm เดิม) */}
      <ConfirmDialog
        open={pending?.kind === 'reset'}
        title="รีเซ็ตรหัสผ่าน"
        tone="danger"
        confirmLabel="รีเซ็ตรหัสผ่าน"
        onClose={() => setPending(null)}
        onConfirm={pending ? () => void resetPassword(pending.row) : undefined}
        description={pending ? <div className="op-confirm">
          <dl>
            <div><dt>ผู้ใช้</dt><dd>{pending.row.fullName}</dd></div>
            <div><dt>Username</dt><dd>@{pending.row.username}</dd></div>
          </dl>
          <p className="op-confirm-impact">
            <KeyRound aria-hidden width={15} />
            ระบบจะออกรหัสผ่านชั่วคราวใหม่ · <b>เซสชันที่ใช้งานอยู่จะถูกยกเลิกทั้งหมด</b> และผู้ใช้ต้องตั้งรหัสใหม่เมื่อเข้าสู่ระบบครั้งถัดไป
          </p>
        </div> : ''}
      />

      <ConfirmDialog
        open={pending?.kind === 'toggle'}
        title={pending?.row.isActive ? 'ปิดการใช้งานบัญชี' : 'เปิดการใช้งานบัญชี'}
        tone={pending?.row.isActive ? 'danger' : 'primary'}
        confirmLabel={pending?.row.isActive ? 'ปิดการใช้งาน' : 'เปิดการใช้งาน'}
        onClose={() => setPending(null)}
        onConfirm={pending ? () => void toggleActive(pending.row) : undefined}
        description={pending ? <div className="op-confirm">
          <dl>
            <div><dt>ผู้ใช้</dt><dd>{pending.row.fullName}</dd></div>
            <div><dt>Username</dt><dd>@{pending.row.username}</dd></div>
            <div><dt>บทบาท</dt><dd>{pending.row.roles.map(roleLabel).join(', ') || '—'}</dd></div>
          </dl>
          <p className="op-confirm-impact">
            {pending.row.isActive
              ? <><AlertTriangle aria-hidden width={15} /><b>ผู้ใช้นี้จะเข้าสู่ระบบไม่ได้ทันที</b> และเซสชันที่ใช้งานอยู่จะถูกยกเลิก — ประวัติการทำงานทั้งหมดยังถูกเก็บไว้ครบ</>
              : <><Check aria-hidden width={15} />ผู้ใช้นี้จะกลับมาเข้าสู่ระบบได้ตามบทบาทเดิม</>}
          </p>
        </div> : ''}
      />

      {credential && <CredentialDialog value={credential} onClose={() => setCredential(undefined)} />}
    </PageContainer>
  );
}

/** รหัสผ่านชั่วคราวแสดงครั้งเดียว — ระบบไม่เก็บไว้ให้เปิดดูซ้ำ */
function CredentialDialog({ value, onClose }: { value: Credential; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { await navigator.clipboard.writeText(value.temporaryPassword); setCopied(true); };
  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="credential-dialog" role="dialog" aria-modal="true" aria-labelledby="credential-title">
        <span className="credential-icon"><ShieldCheck aria-hidden /></span>
        <h2 id="credential-title">สร้างข้อมูลเข้าสู่ระบบสำเร็จ</h2>
        <p>รหัสผ่านนี้จะแสดงเพียงครั้งเดียว กรุณาส่งให้ผู้ใช้อย่างปลอดภัย</p>
        <dl>
          <div><dt>Username</dt><dd>{value.username}</dd></div>
          <div>
            <dt>รหัสผ่านชั่วคราว</dt>
            <dd>
              <code>{value.temporaryPassword}</code>
              <button type="button" onClick={() => void copy()}>
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}
              </button>
            </dd>
          </div>
        </dl>
        <div className="credential-warning"><AlertTriangle aria-hidden />ผู้ใช้จะต้องเปลี่ยนรหัสผ่านเมื่อเข้าสู่ระบบครั้งแรก</div>
        <button type="button" className="btn primary" onClick={onClose}>ฉันบันทึกรหัสผ่านแล้ว</button>
      </section>
    </div>
  );
}

export function UnauthorizedPage() {
  return (
    <PageContainer className="admin-page">
      <EmptyState variant="error" icon={AlertTriangle} title="ไม่มีสิทธิ์เข้าถึง"
        description="บัญชีของคุณไม่มีสิทธิ์ใช้งานส่วนนี้ กรุณาติดต่อผู้ดูแลระบบ"
        action={<Link to="/dashboard" className="btn primary">กลับสู่ภาพรวม</Link>} />
    </PageContainer>
  );
}
