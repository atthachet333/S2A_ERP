import { Fragment, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ShieldCheck, Save, Lock, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { apiClient } from '@/lib/api-client';
import { useToast } from '@/components/ui/Toast';
import { useI18n, type Locale } from '@/i18n/i18n';
import { UnauthorizedPage } from './UsersPage';

interface Matrix { roles: { id: string; name: string }[]; permissions: { code: string; group: string }[]; grants: Record<string, string[]>; locked: string[] }

// แปลง permission code → ป้ายที่มนุษย์อ่านง่าย (localized) — โค้ดดิบเป็นข้อมูลรอง
const GROUP_LABELS: Record<string, Record<Locale, string>> = {
  Ingredients: { th: 'วัตถุดิบ', en: 'Ingredients', 'zh-CN': '原料' },
  Packaging: { th: 'บรรจุภัณฑ์', en: 'Packaging', 'zh-CN': '包装' },
  Recipes: { th: 'สูตรอาหาร', en: 'Recipes', 'zh-CN': '配方' },
  Costing: { th: 'ต้นทุน', en: 'Costing', 'zh-CN': '成本' },
  Pricing: { th: 'ราคาขาย/กำไร', en: 'Pricing', 'zh-CN': '售价' },
  Customers: { th: 'ลูกค้า', en: 'Customers', 'zh-CN': '客户' },
  Orders: { th: 'ออเดอร์', en: 'Orders', 'zh-CN': '订单' },
  Receiving: { th: 'รับของ', en: 'Receiving', 'zh-CN': '入库' },
  Stock: { th: 'สต๊อก', en: 'Stock', 'zh-CN': '库存' },
  Companies: { th: 'บริษัท', en: 'Companies', 'zh-CN': '公司' },
  Dashboard: { th: 'แดชบอร์ด', en: 'Dashboard', 'zh-CN': '仪表板' },
  Reports: { th: 'รายงาน', en: 'Reports', 'zh-CN': '报表' },
  Notifications: { th: 'การแจ้งเตือน', en: 'Notifications', 'zh-CN': '通知' },
  Documents: { th: 'เอกสาร', en: 'Documents', 'zh-CN': '文档' },
  Users: { th: 'ผู้ใช้งาน', en: 'Users', 'zh-CN': '用户' },
  Permissions: { th: 'สิทธิ์และบทบาท', en: 'Permissions', 'zh-CN': '权限' },
  Audit: { th: 'บันทึกการใช้งาน', en: 'Audit', 'zh-CN': '审计' },
  Settings: { th: 'ตั้งค่าระบบ', en: 'Settings', 'zh-CN': '设置' },
  Other: { th: 'อื่น ๆ', en: 'Other', 'zh-CN': '其他' },
};
const ACTION_LABELS: Record<string, Record<Locale, string>> = {
  VIEW: { th: 'ดู', en: 'View', 'zh-CN': '查看' },
  CREATE: { th: 'เพิ่ม', en: 'Add', 'zh-CN': '新增' },
  EDIT: { th: 'แก้ไข', en: 'Edit', 'zh-CN': '编辑' },
  MANAGE: { th: 'จัดการ', en: 'Manage', 'zh-CN': '管理' },
  CALCULATE: { th: 'คำนวณ', en: 'Calculate', 'zh-CN': '计算' },
  CONFIRM: { th: 'ยืนยัน', en: 'Confirm', 'zh-CN': '确认' },
  SEND: { th: 'ส่ง', en: 'Send', 'zh-CN': '发送' },
  CANCEL: { th: 'ยกเลิก', en: 'Cancel', 'zh-CN': '取消' },
  COMPLETE: { th: 'ปิดงาน', en: 'Complete', 'zh-CN': '完成' },
  SWITCH: { th: 'สลับ', en: 'Switch', 'zh-CN': '切换' },
  DOWNLOAD: { th: 'ดาวน์โหลด', en: 'Download', 'zh-CN': '下载' },
  EMAIL: { th: 'ส่งอีเมล', en: 'Email', 'zh-CN': '发邮件' },
  SETTINGS: { th: 'ตั้งค่า', en: 'Settings', 'zh-CN': '设置' },
};
function labelFor(code: string, group: string, locale: Locale): string {
  const g = GROUP_LABELS[group]?.[locale] ?? group;
  const suffix = code.split('_').slice(-1)[0];
  const action = ACTION_LABELS[suffix]?.[locale];
  if (code === 'PERMISSION_MANAGE') return locale === 'th' ? 'จัดการสิทธิ์' : locale === 'en' ? 'Manage permissions' : '管理权限';
  if (code === 'ROLE_MANAGE') return locale === 'th' ? 'จัดการบทบาท' : locale === 'en' ? 'Manage roles' : '管理角色';
  if (!action) return g;
  return locale === 'th' ? `${action}${g}` : `${action} ${g}`;
}

export default function AdminPermissionsPage() {
  const { user } = useAuth(); const { toast } = useToast(); const { locale, messages } = useI18n();
  const t = messages.admin;
  const isSuper = Boolean(user?.roles.includes('SUPER_ADMIN'));
  const query = useQuery({ queryKey: ['admin-matrix'], queryFn: () => apiClient.get<Matrix>('/admin/permissions/matrix'), enabled: isSuper });
  const [draft, setDraft] = useState<Record<string, Set<string>>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!query.data) return;
    const next: Record<string, Set<string>> = {};
    for (const role of query.data.roles) next[role.name] = new Set(query.data.grants[role.name] ?? []);
    setDraft(next); setDirty(new Set());
  }, [query.data]);

  const grouped = useMemo(() => {
    const map = new Map<string, { code: string; group: string }[]>();
    for (const p of query.data?.permissions ?? []) { const arr = map.get(p.group) ?? []; arr.push(p); map.set(p.group, arr); }
    return [...map.entries()];
  }, [query.data]);

  if (!isSuper) return <UnauthorizedPage />;

  const locked = new Set(query.data?.locked ?? []);
  const toggle = (roleName: string, code: string) => {
    if (locked.has(roleName)) return;
    setDraft((prev) => {
      const set = new Set(prev[roleName]); if (set.has(code)) set.delete(code); else set.add(code);
      return { ...prev, [roleName]: set };
    });
    setDirty((prev) => new Set(prev).add(roleName));
  };
  const save = async () => {
    setSaving(true);
    try {
      for (const roleName of dirty) {
        await apiClient.put(`/admin/roles/${roleName}/permissions`, { permissions: [...(draft[roleName] ?? [])] });
      }
      toast({ title: t.saved, variant: 'success' });
      setDirty(new Set());
      await query.refetch();
    } catch (e) { toast({ title: e instanceof Error ? e.message : 'error', variant: 'error' }); }
    finally { setSaving(false); }
  };

  const roles = query.data?.roles ?? [];
  return (
    <section className="users-admin-page">
      <header>
        <div><span>ROLES & PERMISSIONS</span><h1>{t.title}</h1><p>{t.subtitle}</p></div>
        <button className="btn primary" disabled={saving || dirty.size === 0} onClick={() => void save()}>
          {saving ? <Loader2 className="spin" aria-hidden /> : <Save aria-hidden />}{t.save}{dirty.size ? ` (${dirty.size})` : ''}
        </button>
      </header>
      <div className="toolbar"><span className="count-pill"><ShieldCheck width={14} aria-hidden /> {roles.length} {t.roles} · {query.data?.permissions.length ?? 0} {t.permissions}</span><div className="spacer" /><button className="btn" onClick={() => void query.refetch()}><RefreshCw className={query.isFetching ? 'spin' : ''} aria-hidden />{messages.common.retry}</button></div>
      {query.isLoading ? <div className="company-empty">{messages.common.loading}</div> : (
        <section className="card"><div className="table-wrap" style={{ overflowX: 'auto' }}>
          <table className="data-table" style={{ minWidth: 720 }}>
            <thead><tr><th style={{ position: 'sticky', left: 0, background: 'var(--surface)', minWidth: 200 }}>{t.permission}</th>
              {roles.map((r) => <th key={r.id} style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>{messages.roles[r.name as keyof typeof messages.roles] ?? r.name}{locked.has(r.name) && <Lock width={11} aria-hidden style={{ marginLeft: 4, verticalAlign: 'middle' }} />}</th>)}
            </tr></thead>
            <tbody>
              {grouped.map(([group, perms]) => (
                <Fragment key={group}>
                  <tr><td colSpan={roles.length + 1} style={{ background: 'var(--surface-2, rgba(127,127,127,0.08))', fontWeight: 600, fontSize: 12 }}>{GROUP_LABELS[group]?.[locale] ?? group}</td></tr>
                  {perms.map((p) => (
                    <tr key={p.code}>
                      <td style={{ position: 'sticky', left: 0, background: 'var(--surface)' }}>
                        <div style={{ fontSize: 13.5 }}>{labelFor(p.code, p.group, locale)}</div>
                        <small className="table-sub" style={{ opacity: 0.6 }}>{p.code}</small>
                      </td>
                      {roles.map((r) => {
                        const isLocked = locked.has(r.name);
                        const checked = isLocked ? true : (draft[r.name]?.has(p.code) ?? false);
                        return <td key={r.id} style={{ textAlign: 'center' }}>
                          <input type="checkbox" checked={checked} disabled={isLocked} aria-label={`${p.code} · ${r.name}`}
                            onChange={() => toggle(r.name, p.code)} />
                        </td>;
                      })}
                    </tr>
                  ))}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <p className="field-hint" style={{ padding: 12 }}><Lock width={12} aria-hidden /> {t.superLocked}</p>
        </section>
      )}
    </section>
  );
}
