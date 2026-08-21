import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, MailCheck, RefreshCw, ShieldCheck, UserCheck, UserX } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/i18n';
import Badge from '@/components/ui/Badge';
import MasterModal from '@/components/ui/MasterModal';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';
import { registrationBadge, registrationStatusLabel, roleLabel } from '@/lib/admin-vocab';
import { formatThaiDateTime } from '@/lib/utils';
import { UnauthorizedPage } from './UsersPage';

/**
 * PHASE 9 — คำขอลงทะเบียน
 *
 * ย้ายมาใช้ design system และ MasterModal แทน dialog ที่เขียน inline style เอง
 * กติกาทั้งหมดยังเป็นของ backend เหมือนเดิม:
 *   - อนุมัติต้องเลือกบริษัทและบทบาท
 *   - backend ปฏิเสธ SUPER_ADMIN/ADMIN ผ่านการอนุมัติสมัคร (403 ROLE_NOT_ALLOWED)
 *   - คำขอที่ดำเนินการไปแล้วจะถูกปฏิเสธด้วย 409 NOT_PENDING
 *   - ปฏิเสธแล้วไม่ลบผู้ใช้ เก็บเหตุผลไว้และยกเลิก refresh token
 */

interface PendingUser {
  id: string; fullName: string; username: string; email: string;
  isActive: boolean; createdAt: string;
  registrationStatus: string; rejectionReason: string | null;
}
interface Company { id: string; code: string; nameTh: string }
interface Role { id: string; name: string }

type StatusTab = 'PENDING' | 'APPROVED' | 'REJECTED';

export default function RegistrationsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { messages } = useI18n();
  const t = messages.admin;

  const canManage = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('USER_MANAGE'));
  const [status, setStatus] = useState<StatusTab>('PENDING');
  const query = useQuery({
    queryKey: ['registrations', status],
    queryFn: () => apiClient.get<PendingUser[]>(`/admin/registrations?status=${status}`),
    enabled: canManage,
  });

  const [approve, setApprove] = useState<PendingUser | null>(null);
  const [rejecting, setRejecting] = useState<PendingUser | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!canManage) return <UnauthorizedPage />;
  const rows = query.data ?? [];

  const doReject = async () => {
    if (!rejecting) return;
    setBusy(true); setError('');
    try {
      await apiClient.post(`/admin/registrations/${rejecting.id}/reject`, { reason: reason.trim() || undefined });
      toast({ title: 'ปฏิเสธคำขอสมัครแล้ว', variant: 'success' });
      setRejecting(null); setReason('');
      await query.refetch();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ปฏิเสธคำขอไม่สำเร็จ');
    } finally { setBusy(false); }
  };

  return (
    <PageContainer size="wide" className="admin-page registrations-page">
      <PageHeader
        breadcrumb="การจัดการผู้ใช้"
        title="คำขอลงทะเบียน"
        description="ตรวจสอบผู้สมัครใช้งาน แล้วกำหนดบริษัทและบทบาทก่อนอนุมัติ"
        actions={<button type="button" className="btn" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw aria-hidden width={16} className={query.isFetching ? 'spin' : ''} />รีเฟรช
        </button>}
      />

      <KPIGrid columns={2}>
        <KPICard label={`คำขอ${registrationStatusLabel(status)}`} value={query.isLoading ? '—' : rows.length}
          icon={<MailCheck />} hint="ตามแท็บที่เลือก" />
        <KPICard label="รอดำเนินการ" value={status === 'PENDING' ? (query.isLoading ? '—' : rows.length) : '—'}
          icon={<AlertTriangle />} tone={status === 'PENDING' && rows.length > 0 ? 'warning' : 'default'}
          hint={status === 'PENDING' ? 'ต้องอนุมัติหรือปฏิเสธ' : 'เลือกแท็บรออนุมัติเพื่อดู'} />
      </KPIGrid>

      <FilterBar>
        <div className="rb2-tabs" role="radiogroup" aria-label="สถานะคำขอ">
          {(['PENDING', 'APPROVED', 'REJECTED'] as StatusTab[]).map((s) => (
            <button type="button" key={s} role="radio" aria-checked={status === s}
              className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
              {registrationStatusLabel(s)}
            </button>
          ))}
        </div>
      </FilterBar>

      <ContentCard padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table">
            <thead>
              <tr>
                <th>ผู้สมัคร</th><th>Username</th><th>อีเมล</th>
                <th>วันที่สมัคร</th><th>สถานะ</th><th>จัดการ</th>
              </tr>
            </thead>
            {query.isLoading ? <SkeletonRows rows={6} cols={6} /> : (
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td data-label="ผู้สมัคร"><b>{r.fullName}</b></td>
                    <td data-label="Username">@{r.username}</td>
                    <td data-label="อีเมล">{r.email}</td>
                    <td data-label="วันที่สมัคร"><span className="log-time">{formatThaiDateTime(r.createdAt)}</span></td>
                    <td data-label="สถานะ">
                      <span className="md-two-line">
                        <Badge variant={registrationBadge(r.registrationStatus) as 'success' | 'warning' | 'danger' | 'muted'} dot>
                          {registrationStatusLabel(r.registrationStatus)}
                        </Badge>
                        {r.rejectionReason && <small>{r.rejectionReason}</small>}
                      </span>
                    </td>
                    <td data-label="จัดการ">
                      {r.registrationStatus === 'PENDING' ? (
                        <span className="md-row-actions">
                          <button type="button" className="btn primary" onClick={() => { setApprove(r); setError(''); }}>
                            <UserCheck aria-hidden width={15} />อนุมัติ
                          </button>
                          <button type="button" className="btn danger-btn" onClick={() => { setRejecting(r); setReason(''); setError(''); }}>
                            <UserX aria-hidden width={15} />ปฏิเสธ
                          </button>
                        </span>
                      ) : <span className="log-time">ดำเนินการแล้ว</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {query.isError && <EmptyState variant="error" icon={AlertTriangle} title="โหลดคำขอไม่สำเร็จ"
          description={query.error instanceof Error ? query.error.message : 'กรุณาลองอีกครั้ง'}
          action={<button type="button" className="btn" onClick={() => void query.refetch()}>ลองใหม่</button>} />}

        {!query.isLoading && !query.isError && rows.length === 0 && (
          <EmptyState icon={MailCheck}
            title={status === 'PENDING' ? 'ไม่มีคำขอที่รออนุมัติ' : `ไม่มีคำขอที่${registrationStatusLabel(status)}`}
            description={status === 'PENDING' ? 'คำขอสมัครใหม่จะปรากฏที่นี่ทันทีที่มีผู้สมัคร' : 'ลองเปลี่ยนแท็บสถานะเพื่อดูรายการอื่น'} />
        )}
      </ContentCard>

      {approve && <ApproveModal user={approve} t={t}
        onClose={() => setApprove(null)}
        onDone={() => { setApprove(null); void query.refetch(); }} />}

      <MasterModal
        open={Boolean(rejecting)}
        title="ปฏิเสธคำขอสมัคร"
        description={rejecting ? `${rejecting.fullName} · @${rejecting.username}` : ''}
        error={error}
        busy={busy}
        confirmLabel="ปฏิเสธคำขอ"
        confirmIcon={<UserX aria-hidden width={16} />}
        onClose={() => setRejecting(null)}
        onConfirm={() => void doReject()}
      >
        <div className="md-fields">
          <label className="full">เหตุผลที่ปฏิเสธ (ไม่บังคับ)
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3}
              placeholder="เช่น ไม่พบข้อมูลพนักงานในระบบ" />
            <span className="md-hint">เหตุผลนี้จะถูกบันทึกไว้กับคำขอ และแสดงในรายการคำขอที่ถูกปฏิเสธ</span>
          </label>
          <p className="md-hint full">
            <AlertTriangle aria-hidden width={13} /> บัญชีจะถูกปิดใช้งานและเซสชันที่ค้างอยู่จะถูกยกเลิก — ระบบไม่ลบบัญชีทิ้ง
          </p>
        </div>
      </MasterModal>
    </PageContainer>
  );
}

/** อนุมัติ: ต้องเลือกบริษัทและบทบาทตาม contract ของ backend */
function ApproveModal({ user, onClose, onDone, t }: {
  user: PendingUser;
  onClose: () => void;
  onDone: () => void;
  t: Record<string, string>;
}) {
  const { toast } = useToast();
  const companies = useQuery({ queryKey: ['admin-companies'], queryFn: () => apiClient.get<Company[]>('/admin/companies') });
  const roles = useQuery({ queryKey: ['admin-assignable-roles'], queryFn: () => apiClient.get<Role[]>('/admin/assignable-roles') });
  const [companyId, setCompanyId] = useState('');
  const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!companyId || !role) { setError(t.pickCompanyRole ?? 'เลือกบริษัทและบทบาทก่อน'); return; }
    setSaving(true); setError('');
    try {
      await apiClient.post(`/admin/registrations/${user.id}/approve`, { companyId, role });
      toast({ title: 'อนุมัติผู้ใช้เรียบร้อยแล้ว', variant: 'success' });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'อนุมัติไม่สำเร็จ');
      setSaving(false);
    }
  };

  return (
    <MasterModal
      open
      title="อนุมัติคำขอสมัคร"
      description={`${user.fullName} · @${user.username}`}
      error={error}
      busy={saving}
      confirmLabel="อนุมัติ"
      confirmIcon={<UserCheck aria-hidden width={16} />}
      confirmDisabled={!companyId || !role}
      onClose={onClose}
      onConfirm={() => void submit()}
    >
      <div className="md-fields">
        <label className="full">บริษัท *
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">เลือกบริษัท</option>
            {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.nameTh}</option>)}
          </select>
        </label>
        <label className="full">บทบาท *
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">เลือกบทบาท</option>
            {/* รายการนี้มาจาก /admin/assignable-roles ซึ่งไม่รวมบทบาทผู้ดูแลระบบอยู่แล้ว */}
            {roles.data?.map((r) => <option key={r.id} value={r.name}>{roleLabel(r.name)} ({r.name})</option>)}
          </select>
        </label>
        <p className="md-hint full">
          <ShieldCheck aria-hidden width={13} /> ผู้ใช้จะได้รับสิทธิ์ทั้งหมดตามบทบาทที่เลือกทันทีที่อนุมัติ ·
          ระบบไม่อนุญาตให้มอบบทบาทผู้ดูแลระบบผ่านการอนุมัติสมัคร
        </p>
      </div>
    </MasterModal>
  );
}
