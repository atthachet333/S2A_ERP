import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Check, Loader2, Lock, RefreshCw, Save, Search, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/i18n';
import {
  groupLabel, labelFor, permissionDiff, roleLabel, sortGroups, hasPermissionChanges,
} from '@/lib/admin-vocab';
import { PageContainer, PageHeader, ContentCard, KPIGrid, KPICard, CardSkeleton } from '@/components/layout/page';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import EmptyState from '@/components/ui/EmptyState';
import { UnauthorizedPage } from './UsersPage';

/**
 * PHASE 9 — บทบาทและสิทธิ์
 *
 * เดิมเป็นตาราง matrix กว้าง (role × permission ทุกช่อง) ซึ่งอ่านยากและเลื่อนแนวนอนตลอด
 * รอบนี้เปลี่ยนเป็น: เลือกบทบาททางซ้าย → เห็นสิทธิ์แยกเป็นการ์ดรายโมดูลทางขวา
 *
 * ความปลอดภัย: หน้านี้เป็น UX เท่านั้น
 * backend เป็นผู้บังคับสิทธิ์เสมอ —
 *   GET  /admin/permissions/matrix        ต้องมี ROLE_MANAGE | PERMISSION_MANAGE | USER_MANAGE
 *   PUT  /admin/roles/:roleName/permissions ต้องมี PERMISSION_MANAGE และปฏิเสธ SUPER_ADMIN (409 ROLE_LOCKED)
 * ทั้งสองอย่างมีอยู่แล้ว รอบนี้ไม่แตะ
 */

interface Matrix {
  roles: { id: string; name: string; description?: string | null }[];
  permissions: { code: string; group: string }[];
  grants: Record<string, string[]>;
  /** บทบาทที่แก้ไม่ได้ — backend ส่ง [SUPER_ADMIN] มาเพราะ bypass สิทธิ์ทั้งหมดในระดับโค้ด */
  locked: string[];
}
interface UserRow { id: string; roles: string[] }

export default function AdminPermissionsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { locale } = useI18n();

  // เข้าหน้าได้ตามสิทธิ์จริงที่ backend ใช้กับ matrix (ไม่ใช่แค่ SUPER_ADMIN)
  const canRead = Boolean(user?.roles.includes('SUPER_ADMIN')
    || ['ROLE_MANAGE', 'PERMISSION_MANAGE', 'USER_MANAGE'].some((p) => user?.permissions.includes(p)));
  const canManage = Boolean(user?.roles.includes('SUPER_ADMIN') || user?.permissions.includes('PERMISSION_MANAGE'));

  const query = useQuery({
    queryKey: ['admin-matrix'],
    queryFn: () => apiClient.get<Matrix>('/admin/permissions/matrix'),
    enabled: canRead,
  });
  // จำนวนผู้ใช้ต่อบทบาท — มี source จริงจาก /users
  const usersQuery = useQuery({
    queryKey: ['users'],
    queryFn: () => apiClient.get<UserRow[]>('/users'),
    enabled: canRead && Boolean(user?.roles.includes('SUPER_ADMIN') || ['USER_VIEW', 'USER_MANAGE'].some((p) => user?.permissions.includes(p))),
    retry: false,
  });

  const [selectedRole, setSelectedRole] = useState('');
  const [draft, setDraft] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [onlyGranted, setOnlyGranted] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const data = query.data;
  const roles = useMemo(() => data?.roles ?? [], [data]);
  const locked = useMemo(() => new Set(data?.locked ?? []), [data]);

  // เลือกบทบาทแรกที่แก้ได้ให้อัตโนมัติ
  useEffect(() => {
    if (!data || selectedRole) return;
    const first = data.roles.find((r) => !data.locked.includes(r.name)) ?? data.roles[0];
    if (first) setSelectedRole(first.name);
  }, [data, selectedRole]);

  const granted = useMemo(() => data?.grants[selectedRole] ?? [], [data, selectedRole]);
  // เปลี่ยนบทบาท → รีเซ็ตฉบับร่างเป็นค่าที่บันทึกไว้จริง
  useEffect(() => { setDraft(new Set(granted)); }, [selectedRole, granted]);

  const diff = useMemo(() => permissionDiff(granted, [...draft]), [granted, draft]);
  const changed = hasPermissionChanges(diff);
  const isLocked = locked.has(selectedRole);

  const roleUserCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const u of usersQuery.data ?? []) for (const r of u.roles) map.set(r, (map.get(r) ?? 0) + 1);
    return map;
  }, [usersQuery.data]);

  /** สิทธิ์แยกตามโมดูล + ตัวกรอง */
  const groups = useMemo(() => {
    if (!data) return [];
    const q = search.trim().toLowerCase();
    const byGroup = new Map<string, { code: string; group: string }[]>();
    for (const p of data.permissions) {
      if (onlyGranted && !draft.has(p.code)) continue;
      if (q && !`${p.code} ${labelFor(p.code, p.group, locale)}`.toLowerCase().includes(q)) continue;
      const list = byGroup.get(p.group) ?? [];
      list.push(p);
      byGroup.set(p.group, list);
    }
    return sortGroups([...byGroup.keys()]).map((g) => ({ group: g, items: byGroup.get(g) ?? [] }));
  }, [data, search, onlyGranted, draft, locale]);

  if (!canRead) return <UnauthorizedPage />;

  const toggle = (code: string) => {
    if (isLocked || !canManage) return;
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  };
  const toggleGroup = (codes: string[], on: boolean) => {
    if (isLocked || !canManage) return;
    setDraft((cur) => {
      const next = new Set(cur);
      for (const c of codes) { if (on) next.add(c); else next.delete(c); }
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    try {
      await apiClient.put(`/admin/roles/${selectedRole}/permissions`, { permissions: [...draft] });
      toast({ title: `บันทึกสิทธิ์ของ “${roleLabel(selectedRole)}” แล้ว`, variant: 'success' });
      setConfirmOpen(false);
      await query.refetch();
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : 'บันทึกสิทธิ์ไม่สำเร็จ', variant: 'error' });
    } finally { setSaving(false); }
  };

  return (
    <PageContainer size="wide" className="admin-page permissions-page">
      <PageHeader
        breadcrumb="สิทธิ์และความปลอดภัย"
        title="บทบาทและสิทธิ์"
        description="กำหนดว่าแต่ละบทบาททำอะไรได้บ้าง — ระบบจะบังคับสิทธิ์จริงที่เซิร์ฟเวอร์เสมอ"
        actions={<>
          <button type="button" className="btn" onClick={() => void query.refetch()} disabled={query.isFetching}>
            <RefreshCw aria-hidden width={16} className={query.isFetching ? 'spin' : ''} />รีเฟรช
          </button>
          {canManage && (
            <button type="button" className="btn primary" disabled={!changed || isLocked || saving}
              onClick={() => setConfirmOpen(true)}>
              <Save aria-hidden width={16} />บันทึกสิทธิ์
            </button>
          )}
        </>}
      />

      {query.isError && <EmptyState variant="error" icon={AlertTriangle} title="โหลดสิทธิ์ไม่สำเร็จ"
        description={query.error instanceof Error ? query.error.message : 'ลองใหม่อีกครั้ง'}
        action={<button type="button" className="btn" onClick={() => void query.refetch()}>ลองใหม่</button>} />}

      {query.isLoading && <CardSkeleton lines={6} />}

      {data && <>
        <KPIGrid columns={3}>
          <KPICard label="บทบาททั้งหมด" value={roles.length} icon={<ShieldCheck />} hint="ตามที่ระบบกำหนดไว้" />
          <KPICard label="สิทธิ์ในระบบ" value={data.permissions.length} icon={<Check />} hint="permission code ทั้งหมด" />
          <KPICard label={`สิทธิ์ของ ${roleLabel(selectedRole)}`}
            value={isLocked ? 'ทั้งหมด' : draft.size} icon={<Lock />}
            hint={isLocked ? 'มีสิทธิ์ทั้งหมดโดยระบบ' : `จาก ${data.permissions.length} รายการ`} />
        </KPIGrid>

        <div className="perm-layout">
          {/* ---------- ซ้าย: เลือกบทบาท ---------- */}
          <aside className="perm-roles">
            <h2 className="perm-roles-title">บทบาท</h2>
            <ul role="list">
              {roles.map((r) => {
                const count = data.grants[r.name]?.length ?? 0;
                const users = roleUserCount.get(r.name);
                const lockedRole = locked.has(r.name);
                return (
                  <li key={r.id}>
                    <button type="button" className={`perm-role${selectedRole === r.name ? ' active' : ''}`}
                      aria-current={selectedRole === r.name} onClick={() => setSelectedRole(r.name)}>
                      <span className="perm-role-main">
                        <strong>{roleLabel(r.name)}</strong>
                        <small>{r.name}</small>
                      </span>
                      <span className="perm-role-meta">
                        {lockedRole
                          ? <span className="badge gold"><Lock aria-hidden width={11} />ทั้งหมด</span>
                          : <span className="badge muted">{count} สิทธิ์</span>}
                        {users != null && <small>{users} ผู้ใช้</small>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </aside>

          {/* ---------- ขวา: สิทธิ์รายโมดูล ---------- */}
          <div className="perm-detail">
            <ContentCard
              title={<><ShieldCheck aria-hidden width={17} />{roleLabel(selectedRole)}</>}
              description={<>
                <code className="perm-role-code">{selectedRole}</code>
                {roles.find((r) => r.name === selectedRole)?.description
                  ? ` · ${roles.find((r) => r.name === selectedRole)?.description}`
                  : ''}
              </>}
              actions={usersQuery.data
                ? <Link className="btn" to={`/users?role=${encodeURIComponent(selectedRole)}`}>
                    <Users aria-hidden width={15} />ดูผู้ใช้ในบทบาทนี้
                  </Link>
                : undefined}
            >
              {isLocked ? (
                <div className="rb-callout warn" role="note">
                  <Lock aria-hidden />
                  <div>
                    <strong>บทบาทนี้มีสิทธิ์ทั้งหมดโดยระบบ</strong>
                    <p className="md-hint">ระบบข้ามการตรวจสิทธิ์ให้บทบาทนี้ในระดับโค้ด จึงแก้ไขรายการสิทธิ์ไม่ได้ เพื่อป้องกันการล็อกตัวเองออกจากระบบทั้งหมด</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="perm-toolbar">
                    <div className="issue-picker-search perm-search">
                      <Search aria-hidden />
                      <input value={search} onChange={(e) => setSearch(e.target.value)}
                        placeholder="ค้นหาสิทธิ์จากชื่อหรือโค้ด" aria-label="ค้นหาสิทธิ์" />
                    </div>
                    <button type="button" className={`btn${onlyGranted ? ' primary' : ''}`} aria-pressed={onlyGranted}
                      onClick={() => setOnlyGranted((v) => !v)}>แสดงเฉพาะที่เลือก</button>
                  </div>

                  {changed && (
                    <p className="perm-changed" role="status">
                      <AlertTriangle aria-hidden width={15} />
                      ยังไม่ได้บันทึก — เพิ่ม {diff.added.length} · ลบ {diff.removed.length}
                    </p>
                  )}
                  {!canManage && (
                    <p className="md-hint">บัญชีนี้ดูได้อย่างเดียว การแก้ไขสิทธิ์ต้องมีสิทธิ์ PERMISSION_MANAGE</p>
                  )}
                </>
              )}
            </ContentCard>

            {!isLocked && groups.map(({ group, items }) => {
              const codes = items.map((i) => i.code);
              const allOn = codes.every((c) => draft.has(c));
              return (
                <ContentCard key={group}
                  title={groupLabel(group, locale)}
                  description={`${codes.filter((c) => draft.has(c)).length} จาก ${codes.length} สิทธิ์`}
                  actions={canManage ? (
                    <button type="button" className="btn" onClick={() => toggleGroup(codes, !allOn)}>
                      {allOn ? 'เอาออกทั้งหมด' : 'เลือกทั้งหมด'}
                    </button>
                  ) : undefined}
                >
                  <ul className="perm-list" role="list">
                    {items.map((p) => {
                      const on = draft.has(p.code);
                      const wasOn = granted.includes(p.code);
                      return (
                        <li key={p.code}>
                          <label className={`perm-item${on !== wasOn ? ' is-changed' : ''}`}>
                            <input type="checkbox" checked={on} disabled={!canManage}
                              onChange={() => toggle(p.code)} />
                            <span className="perm-item-text">
                              <strong>{labelFor(p.code, p.group, locale)}</strong>
                              {/* โค้ดจริงต้องเห็นเสมอ เพื่อให้ตรวจสอบย้อนหลังได้ */}
                              <code>{p.code}</code>
                            </span>
                            {on !== wasOn && <span className="perm-item-flag">{on ? 'เพิ่ม' : 'ลบ'}</span>}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                </ContentCard>
              );
            })}

            {!isLocked && groups.length === 0 && (
              <EmptyState icon={Search} title="ไม่พบสิทธิ์ที่ค้นหา"
                description="ลองเปลี่ยนคำค้น หรือปิดตัวกรอง “แสดงเฉพาะที่เลือก”"
                action={<button type="button" className="btn" onClick={() => { setSearch(''); setOnlyGranted(false); }}>ล้างตัวกรอง</button>} />
            )}
          </div>
        </div>
      </>}

      {/* การเปลี่ยนสิทธิ์เป็นเรื่องความปลอดภัย จึงต้องสรุปให้เห็นก่อนเสมอ */}
      <ConfirmDialog
        open={confirmOpen}
        title="ยืนยันการแก้ไขสิทธิ์"
        confirmLabel={saving ? 'กำลังบันทึก…' : 'บันทึกสิทธิ์'}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => void save()}
        description={<div className="op-confirm">
          <dl>
            <div><dt>บทบาท</dt><dd>{roleLabel(selectedRole)} ({selectedRole})</dd></div>
            <div><dt>เพิ่มสิทธิ์</dt><dd>{diff.added.length} รายการ</dd></div>
            <div><dt>ลบสิทธิ์</dt><dd>{diff.removed.length} รายการ</dd></div>
            <div><dt>คงเดิม</dt><dd>{diff.unchanged} รายการ</dd></div>
          </dl>
          {diff.added.length > 0 && <p className="perm-diff-list"><b>เพิ่ม:</b> {diff.added.join(', ')}</p>}
          {diff.removed.length > 0 && <p className="perm-diff-list"><b>ลบ:</b> {diff.removed.join(', ')}</p>}
          <p className="op-confirm-impact">
            <ShieldCheck aria-hidden width={15} />
            ผู้ใช้ทุกคนในบทบาทนี้จะได้รับผลทันทีในการเข้าใช้งานครั้งถัดไป และระบบจะบันทึกการเปลี่ยนแปลงนี้ไว้ในประวัติการตรวจสอบ
          </p>
        </div>}
      />

      {saving && <span className="sr-only" role="status"><Loader2 aria-hidden />กำลังบันทึก</span>}
    </PageContainer>
  );
}
