import { useState } from 'react';
import { AlertTriangle, BadgeCheck, History, RefreshCw, UserRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useActivity } from '@/hooks/useActivity';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { UnauthorizedPage } from '@/pages/UsersPage';
import { formatThaiDateTime } from '@/lib/utils';

const ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: 'เข้าสู่ระบบสำเร็จ', LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ',
  CHANGE_PASSWORD: 'เปลี่ยนรหัสผ่าน', CREATE: 'สร้างข้อมูล', UPDATE: 'แก้ไขข้อมูล', DELETE: 'ลบข้อมูล',
};

export default function ActivityPage() {
  const { user } = useAuth();
  const isAdmin = Boolean(user?.roles.includes('SUPER_ADMIN'));
  const [page, setPage] = useState(1);
  const query = useActivity(page, 15, isAdmin);

  if (!isAdmin) return <UnauthorizedPage />;

  const data = query.data;
  const totalPages = data?.totalPages ?? 1;

  return (
    <>
      <div className="page-title-block">
        <p className="eyebrow">AUDIT</p>
        <h1>ประวัติการใช้งาน</h1>
        <p>บันทึกการเข้าใช้งานและการเปลี่ยนแปลงข้อมูลในระบบ</p>
      </div>

      <div className="toolbar" style={{ marginTop: 18, justifyContent: 'flex-end' }}>
        <button className="btn" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw aria-hidden className={query.isFetching ? 'spin' : ''} />รีเฟรช
        </button>
      </div>

      <section className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr><th>เวลา</th><th>ผู้ใช้งาน</th><th>การกระทำ</th><th>รายการ</th><th>สถานะ</th><th>IP</th></tr>
            </thead>
            {query.isLoading ? <SkeletonRows rows={8} cols={6} /> : (
              <tbody>
                {data?.items.map((a) => (
                  <tr key={a.id}>
                    <td style={{ whiteSpace: 'nowrap' }}>{formatThaiDateTime(a.createdAt)}</td>
                    <td>
                      <div className="cell-user">
                        <span className={`icon-chip ${a.success ? 'green' : 'amber'}`} style={{ width: 30, height: 30 }}>
                          {a.type === 'LOGIN' ? <UserRound aria-hidden width={16} /> : <BadgeCheck aria-hidden width={16} />}
                        </span>
                        <div className="cu-text"><strong>{a.actor ?? 'ระบบ'}</strong></div>
                      </div>
                    </td>
                    <td>{ACTION_LABEL[a.action] ?? a.action}</td>
                    <td>{a.entity ?? '—'}</td>
                    <td>{a.success ? <Badge variant="success" dot>สำเร็จ</Badge> : <Badge variant="danger" dot>ไม่สำเร็จ</Badge>}</td>
                    <td style={{ color: 'var(--text-subtle)' }}>{a.ip ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>

        {query.isError && <EmptyState variant="error" icon={AlertTriangle} title="โหลดประวัติไม่สำเร็จ" description="ไม่สามารถดึงประวัติการใช้งานได้ในขณะนี้" action={<button className="btn" onClick={() => void query.refetch()}><RefreshCw aria-hidden />ลองอีกครั้ง</button>} />}
        {!query.isLoading && !query.isError && (!data || data.items.length === 0) && (
          <EmptyState icon={History} title="ยังไม่มีประวัติการใช้งาน" description="เมื่อมีการเข้าใช้งานหรือแก้ไขข้อมูล รายการจะปรากฏที่นี่" />
        )}

        {data && data.items.length > 0 && (
          <div className="pagination">
            <span className="pg-info">หน้า {data.page} จาก {totalPages} · ทั้งหมด {data.total} รายการ</span>
            <div className="pg-controls">
              <button className="pg-btn" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>ก่อนหน้า</button>
              <button className="pg-btn" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>ถัดไป</button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
