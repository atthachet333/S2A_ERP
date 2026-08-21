import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, History, Info, LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useActivity, type ActivityEntry } from '@/hooks/useActivity';
import Badge from '@/components/ui/Badge';
import EmptyState from '@/components/ui/EmptyState';
import { SkeletonRows } from '@/components/ui/Skeleton';
import { PageContainer, PageHeader, FilterBar, ContentCard, KPIGrid, KPICard } from '@/components/layout/page';
import { auditActionLabel, auditEntityLabel } from '@/lib/admin-vocab';
import { UnauthorizedPage } from '@/pages/UsersPage';
import { formatThaiDateTime } from '@/lib/utils';

/**
 * PHASE 9 — ประวัติการใช้งาน (Audit + Login)
 *
 * ข้อจำกัดของ contract ปัจจุบัน (ตรวจแล้วใน activity.route.ts / schema.prisma):
 *   - GET /activity คืน audit กับ login รวมกันเป็น feed เดียว จึงแยกเป็นสองแท็บฝั่งหน้าจอ
 *   - endpoint ไม่มีตัวกรองใด ๆ (วันที่ / ผู้ใช้ / action / ผลลัพธ์)
 *     ตัวกรองในหน้านี้จึงกรอง "เฉพาะรายการในหน้าที่โหลดมาแล้ว" และเขียนบอกไว้ตรง ๆ
 *   - endpoint ไม่คืน before/after ของ AuditLog → แสดงรายละเอียดการเปลี่ยนแปลงไม่ได้
 *   - endpoint ไม่คืน userAgent และ LoginLog ไม่มีคอลัมน์เหตุผลที่ล้มเหลว
 *     จึงไม่มีคอลัมน์อุปกรณ์และเหตุผล — ไม่แต่งข้อมูลขึ้นเอง
 */

type Tab = 'ALL' | 'AUDIT' | 'LOGIN';
const PAGE_SIZE = 25;

export default function ActivityPage() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  // backend อนุญาตเฉพาะ SUPER_ADMIN — หน้าจอสะท้อนกติกาเดียวกัน ไม่ใช่เป็นผู้ตัดสินเอง
  const isAdmin = Boolean(user?.roles.includes('SUPER_ADMIN'));

  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<Tab>('ALL');
  const [keyword, setKeyword] = useState(params.get('user') ?? '');
  const [result, setResult] = useState('');
  const [debounced, setDebounced] = useState(keyword);

  // หน่วงคำค้นเพื่อไม่ให้กรองใหม่ทุกตัวอักษร
  useEffect(() => {
    const t = setTimeout(() => setDebounced(keyword), 300);
    return () => clearTimeout(t);
  }, [keyword]);

  const query = useActivity(page, PAGE_SIZE, isAdmin);

  const all = useMemo(() => query.data?.items ?? [], [query.data]);
  const rows = useMemo(() => {
    const q = debounced.trim().toLowerCase();
    return all.filter((e) => {
      if (tab !== 'ALL' && e.type !== tab) return false;
      if (result === 'success' && !e.success) return false;
      if (result === 'failed' && e.success) return false;
      if (!q) return true;
      return `${e.actor ?? ''} ${e.action} ${e.entity ?? ''} ${e.ip ?? ''}`.toLowerCase().includes(q);
    });
  }, [all, tab, result, debounced]);

  if (!isAdmin) return <UnauthorizedPage />;

  const totalPages = query.data?.totalPages ?? 1;
  const hasFilter = Boolean(debounced || result || tab !== 'ALL');
  const auditCount = all.filter((e) => e.type === 'AUDIT').length;
  const loginCount = all.filter((e) => e.type === 'LOGIN').length;
  const failedCount = all.filter((e) => e.type === 'LOGIN' && !e.success).length;

  return (
    <PageContainer size="wide" className="admin-page activity-page">
      <PageHeader
        breadcrumb="การตรวจสอบระบบ"
        title="ประวัติการใช้งาน"
        description="บันทึกการเข้าสู่ระบบและการเปลี่ยนแปลงข้อมูล — เรียงจากล่าสุด"
        actions={<button type="button" className="btn" onClick={() => void query.refetch()} disabled={query.isFetching}>
          <RefreshCw aria-hidden width={16} className={query.isFetching ? 'spin' : ''} />รีเฟรช
        </button>}
      />

      <KPIGrid columns={3}>
        <KPICard label="เหตุการณ์ในหน้านี้" value={query.isLoading ? '—' : all.length} icon={<History />}
          hint={`หน้า ${page} จาก ${totalPages}`} />
        <KPICard label="การเปลี่ยนแปลงข้อมูล" value={query.isLoading ? '—' : auditCount} icon={<ShieldCheck />}
          hint="เฉพาะในหน้านี้" onClick={() => setTab('AUDIT')} active={tab === 'AUDIT'} />
        <KPICard label="เข้าสู่ระบบไม่สำเร็จ" value={query.isLoading ? '—' : failedCount} icon={<AlertTriangle />}
          tone={failedCount > 0 ? 'warning' : 'default'}
          hint={`จาก ${loginCount} ครั้งในหน้านี้`} />
      </KPIGrid>

      <FilterBar actions={<>
        {hasFilter && <button type="button" className="btn"
          onClick={() => { setKeyword(''); setResult(''); setTab('ALL'); }}>ล้างตัวกรอง</button>}
        <div className="rb2-tabs" role="radiogroup" aria-label="ประเภทเหตุการณ์">
          {([['ALL', 'ทั้งหมด'], ['AUDIT', 'การเปลี่ยนแปลงข้อมูล'], ['LOGIN', 'การเข้าสู่ระบบ']] as [Tab, string][]).map(([v, label]) => (
            <button type="button" key={v} role="radio" aria-checked={tab === v}
              className={tab === v ? 'active' : ''} onClick={() => setTab(v)}>{label}</button>
          ))}
        </div>
      </>}>
        <input className="s2-search" value={keyword} onChange={(e) => setKeyword(e.target.value)}
          placeholder="ค้นหาผู้ใช้ เหตุการณ์ หรือ IP" aria-label="ค้นหาเหตุการณ์" />
        <select value={result} onChange={(e) => setResult(e.target.value)} aria-label="ผลลัพธ์">
          <option value="">ทุกผลลัพธ์</option>
          <option value="success">สำเร็จ</option>
          <option value="failed">ไม่สำเร็จ</option>
        </select>
      </FilterBar>

      {/* บอกตรง ๆ ว่าตัวกรองมีขอบเขตแค่ไหน เพื่อไม่ให้เข้าใจผิดว่าค้นทั้งระบบ */}
      <p className="admin-note">
        <Info aria-hidden />
        ตัวกรองในหน้านี้ใช้กับ {all.length} เหตุการณ์ที่โหลดมาในหน้านี้เท่านั้น — ระบบยังไม่รองรับการค้นหาย้อนหลังทั้งหมดจากเซิร์ฟเวอร์
      </p>

      <ContentCard padded={false}>
        <div className="table-wrap">
          <table className="data-table md-table">
            <thead>
              <tr>
                <th>เวลา</th><th>ผู้ใช้</th><th>เหตุการณ์</th>
                <th>ส่วนที่เกี่ยวข้อง</th><th>ผลลัพธ์</th><th>IP</th>
              </tr>
            </thead>
            {query.isLoading ? <SkeletonRows rows={10} cols={6} /> : (
              <tbody>
                {rows.map((e) => <ActivityRow key={e.id} entry={e} />)}
              </tbody>
            )}
          </table>
        </div>

        {query.isError && <EmptyState variant="error" icon={AlertTriangle} title="โหลดประวัติไม่สำเร็จ"
          description={query.error instanceof Error ? query.error.message : 'กรุณาลองอีกครั้ง'}
          action={<button type="button" className="btn" onClick={() => void query.refetch()}>ลองใหม่</button>} />}

        {!query.isLoading && !query.isError && rows.length === 0 && (
          hasFilter
            ? <EmptyState icon={History} title="ไม่พบเหตุการณ์ที่ตรงกับตัวกรอง"
                description="ลองล้างตัวกรอง หรือเปลี่ยนไปหน้าอื่นเพื่อดูช่วงเวลาก่อนหน้า"
                action={<button type="button" className="btn" onClick={() => { setKeyword(''); setResult(''); setTab('ALL'); }}>ล้างตัวกรอง</button>} />
            : <EmptyState icon={History} title="ยังไม่มีประวัติการใช้งาน" description="เหตุการณ์จะถูกบันทึกอัตโนมัติเมื่อมีการใช้งานระบบ" />
        )}

        {!query.isLoading && totalPages > 1 && (
          <div className="md-pagination">
            <span>หน้า {page} จาก {totalPages}</span>
            <div>
              <button type="button" className="btn" disabled={page <= 1} onClick={() => setPage(page - 1)}>ก่อนหน้า</button>
              <button type="button" className="btn" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>ถัดไป</button>
            </div>
          </div>
        )}
      </ContentCard>
    </PageContainer>
  );
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const isLogin = entry.type === 'LOGIN';
  return (
    <tr>
      <td data-label="เวลา"><span className="log-time">{formatThaiDateTime(entry.createdAt)}</span></td>
      <td data-label="ผู้ใช้">
        {entry.actor
          ? <Link className="inline-link" to={`/users?search=${encodeURIComponent(entry.actor)}`}>{entry.actor}</Link>
          : <span className="log-time">—</span>}
      </td>
      <td data-label="เหตุการณ์">
        <span className="log-entity">
          {isLogin ? <LogIn aria-hidden width={14} /> : <ShieldCheck aria-hidden width={14} />}
          {/* action ที่ไม่รู้จักแสดงค่าดิบ ไม่เดาความหมาย */}
          {auditActionLabel(entry.action)}
        </span>
      </td>
      <td data-label="ส่วนที่เกี่ยวข้อง">
        <span className="log-entity">{auditEntityLabel(entry.entity)}{entry.entity && <code>{entry.entity}</code>}</span>
      </td>
      <td data-label="ผลลัพธ์">
        {entry.success
          ? <Badge variant="success" dot>สำเร็จ</Badge>
          : <Badge variant="danger" dot>ไม่สำเร็จ</Badge>}
      </td>
      <td data-label="IP"><span className="log-ip">{entry.ip ?? '—'}</span></td>
    </tr>
  );
}
