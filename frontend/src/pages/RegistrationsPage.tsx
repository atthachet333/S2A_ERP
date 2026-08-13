import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserCheck, UserX, Loader2, X, Clock, RefreshCw, MailCheck } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/i18n';
import Badge from '@/components/ui/Badge';
import { formatThaiDateTime } from '@/lib/utils';
import { UnauthorizedPage } from './UsersPage';

interface PendingUser { id: string; fullName: string; username: string; email: string; isActive: boolean; createdAt: string; registrationStatus: string; rejectionReason: string | null }
interface Company { id: string; code: string; nameTh: string }
interface Role { id: string; name: string }

function ApproveModal({ user, onClose, onDone }: { user: PendingUser; onClose: () => void; onDone: () => void }) {
  const { messages } = useI18n(); const t = messages.admin; const { toast } = useToast();
  const companies = useQuery({ queryKey: ['admin-companies'], queryFn: () => apiClient.get<Company[]>('/admin/companies') });
  const roles = useQuery({ queryKey: ['admin-assignable-roles'], queryFn: () => apiClient.get<Role[]>('/admin/assignable-roles') });
  const [companyId, setCompanyId] = useState(''); const [role, setRole] = useState('');
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const submit = async () => {
    if (!companyId || !role) { setError(t.pickCompanyRole); return; }
    setSaving(true); setError('');
    try { await apiClient.post(`/admin/registrations/${user.id}/approve`, { companyId, role }); toast({ title: t.approved, variant: 'success' }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'error'); setSaving(false); }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={onClose}>
      <div className="dialog" style={{ width: 'min(100%, 460px)' }} onMouseDown={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{t.approveTitle}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={messages.common.close}><X aria-hidden width={16} /></button>
        </div>
        <p style={{ margin: '0 0 12px', color: 'var(--text-subtle)', fontSize: 13 }}>{user.fullName} · @{user.username}</p>
        {error && <div className="alert" style={{ marginBottom: 10 }}>{error}</div>}
        <label style={{ display: 'block', marginBottom: 10 }}>{t.company}
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">—</option>
            {companies.data?.map((c) => <option key={c.id} value={c.id}>{c.nameTh}</option>)}
          </select>
        </label>
        <label style={{ display: 'block' }}>{t.role}
          <select value={role} onChange={(e) => setRole(e.target.value)}>
            <option value="">—</option>
            {roles.data?.map((r) => <option key={r.id} value={r.name}>{messages.roles[r.name as keyof typeof messages.roles] ?? r.name}</option>)}
          </select>
        </label>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="button" className="btn" onClick={onClose} disabled={saving}>{messages.common.cancel}</button>
          <button type="button" className="btn primary" onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="spin" aria-hidden /> : <UserCheck aria-hidden />}{t.approve}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function RegistrationsPage() {
  const { user } = useAuth(); const { toast } = useToast(); const { messages } = useI18n(); const t = messages.admin;
  const canManage = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('USER_MANAGE'));
  const [status, setStatus] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const query = useQuery({ queryKey: ['registrations', status], queryFn: () => apiClient.get<PendingUser[]>(`/admin/registrations?status=${status}`), enabled: canManage });
  const [approve, setApprove] = useState<PendingUser | null>(null);
  const [rejecting, setRejecting] = useState<PendingUser | null>(null);
  const [reason, setReason] = useState('');

  if (!canManage) return <UnauthorizedPage />;
  const rows = query.data ?? [];

  const doReject = async () => {
    if (!rejecting) return;
    try { await apiClient.post(`/admin/registrations/${rejecting.id}/reject`, { reason: reason.trim() || undefined }); toast({ title: t.rejected, variant: 'success' }); setRejecting(null); setReason(''); await query.refetch(); }
    catch (e) { toast({ title: e instanceof Error ? e.message : 'error', variant: 'error' }); }
  };

  return (
    <section className="users-admin-page">
      <header><div><span>REGISTRATION REVIEW</span><h1>{t.registrations}</h1><p>{t.registrationsSubtitle}</p></div></header>
      <div className="toolbar">
        {(['PENDING', 'APPROVED', 'REJECTED'] as const).map((s) => (
          <button key={s} className={`btn ${status === s ? 'primary' : ''}`} onClick={() => setStatus(s)}>{t[s.toLowerCase() as 'pending' | 'approved' | 'rejected']}</button>
        ))}
        <span className="count-pill">{rows.length}</span><div className="spacer" />
        <button className="btn" onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? 'spin' : ''} aria-hidden />{messages.common.retry}</button>
      </div>
      <section className="card"><div className="table-wrap">
        <table className="data-table"><thead><tr><th>{t.name}</th><th>{t.username}</th><th>{messages.business.email}</th><th>{t.registeredAt}</th><th>{messages.business.status}</th><th>{messages.business.actions}</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td><strong>{r.fullName}</strong></td>
                <td>@{r.username}</td>
                <td>{r.email}</td>
                <td>{formatThaiDateTime(r.createdAt)}</td>
                <td>{r.registrationStatus === 'PENDING' ? <Badge variant="warning" dot>{t.pending}</Badge> : r.registrationStatus === 'APPROVED' ? <Badge variant="success" dot>{t.approved}</Badge> : <Badge variant="muted" dot>{t.rejected}</Badge>}{r.rejectionReason ? <small className="table-sub">{r.rejectionReason}</small> : null}</td>
                <td>{r.registrationStatus === 'PENDING' ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="table-action" onClick={() => setApprove(r)}><UserCheck width={14} aria-hidden /> {t.approve}</button>
                    <button className="table-action" onClick={() => { setRejecting(r); setReason(''); }}><UserX width={14} aria-hidden /> {t.reject}</button>
                  </div>
                ) : <span style={{ color: 'var(--text-subtle)' }}>—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!query.isLoading && rows.length === 0 && <div className="business-empty"><MailCheck /><h2>{status === 'PENDING' ? t.noPending : t.noResults}</h2></div>}
      {query.isLoading && <div className="company-empty"><Clock aria-hidden /> {messages.common.loading}</div>}
      </section>

      {approve && <ApproveModal user={approve} onClose={() => setApprove(null)} onDone={() => { setApprove(null); void query.refetch(); }} />}
      {rejecting && (
        <div className="dialog-backdrop" onMouseDown={() => setRejecting(null)}>
          <div className="dialog" style={{ width: 'min(100%, 440px)' }} onMouseDown={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0 }}>{t.rejectTitle}</h3>
            <p style={{ color: 'var(--text-subtle)', fontSize: 13 }}>{rejecting.fullName} · @{rejecting.username}</p>
            <label>{t.reason}<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></label>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
              <button className="btn" onClick={() => setRejecting(null)}>{messages.common.cancel}</button>
              <button className="btn danger-btn" onClick={() => void doReject()}>{t.reject}</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
