import { useCallback, useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { NAV_GROUPS, navGroupHeading } from './nav-config';
import Avatar from '@/components/ui/Avatar';
import { navigationKeyByPath, useI18n } from '@/i18n/i18n';

/**
 * PHASE 34 — จำสถานะพับกลุ่มไว้ใน localStorage
 * เก็บเฉพาะ "กลุ่มที่ถูกพับ" เพื่อให้กลุ่มที่เพิ่มมาใหม่ในอนาคตเปิดอยู่เป็นค่าเริ่มต้น
 */
const COLLAPSED_GROUPS_KEY = 's2a_sidebar_groups_collapsed';

function readCollapsedGroups(): string[] {
  try {
    const raw = localStorage.getItem(COLLAPSED_GROUPS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
}

export default function Sidebar({ collapsed, onNavigate, onLogout }: {
  collapsed: boolean;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const { messages } = useI18n(); const nav = messages.navigation;
  const { pathname } = useLocation();
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(readCollapsedGroups);

  /* หมายเหตุ: ห้ามเขียน localStorage ข้างใน state updater
     เพราะ StrictMode เรียก updater ซ้ำสองรอบ จะกลายเป็นสลับค่าไปกลับจนไม่มีอะไรเปลี่ยน */
  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((current) => {
      const next = current.includes(label) ? current.filter((item) => item !== label) : [...current, label];
      return next;
    });
  }, []);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSED_GROUPS_KEY, JSON.stringify(collapsedGroups)); } catch { /* โหมดส่วนตัวของเบราว์เซอร์เขียนไม่ได้ ไม่ต้องล้ม UI */ }
  }, [collapsedGroups]);

  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const canSee = (requiredRole?: string, requiredPermission?: string, requiredAnyPermission?: string[]) =>
    (!requiredRole || roles.includes(requiredRole))
    && (!requiredPermission || permissions.includes(requiredPermission) || isSuperAdmin)
    && (!requiredAnyPermission?.length || isSuperAdmin || requiredAnyPermission.some((p) => permissions.includes(p)));

  const labelFor = (path: string, fallback: string) => {
    const key = navigationKeyByPath[path as keyof typeof navigationKeyByPath];
    return key ? nav[key] : fallback;
  };

  return (
    <aside className="app-sidebar" aria-label={nav.system}>
      <div className="sidebar-brand">
        <span className="sidebar-logo"><img src="/s2a-logo.png" alt="โลโก้ S2 Accounting Consultant" /></span>
        <div className="brand-text">
          <strong>S2 ACCOUNTING<br />CONSULTANT</strong>
          <span>PRODUCTION &amp; INVENTORY</span>
        </div>
        <button className="sidebar-close" onClick={onNavigate} aria-label={nav.closeMenu}><X /></button>
      </div>

      <nav className="sidebar-scroll">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => canSee(item.requiredRole, item.requiredPermission, item.requiredAnyPermission));
          if (items.length === 0) return null;
          const heading = navGroupHeading(group.label, nav as unknown as Record<string, string>);
          // กลุ่มที่มีหน้าปัจจุบันอยู่ข้างใน ต้องกางเสมอ ไม่งั้นผู้ใช้จะไม่เห็นว่าตัวเองอยู่ตรงไหน
          const holdsActive = items.some((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
          const isCollapsed = !collapsed && !holdsActive && collapsedGroups.includes(group.label);
          const bodyId = `nav-group-${group.label}`;
          return (
            <div className={`nav-group${isCollapsed ? ' nav-group--collapsed' : ''}`} key={group.label}>
              {collapsed ? (
                <p className="nav-group-label" aria-hidden>•</p>
              ) : (
                <button
                  type="button"
                  className="nav-group-toggle"
                  onClick={() => toggleGroup(group.label)}
                  aria-expanded={!isCollapsed}
                  aria-controls={bodyId}
                >
                  <span className="nav-group-label">{heading}</span>
                  <ChevronDown className="nav-group-caret" aria-hidden />
                </button>
              )}
              <div className="nav-group-body" id={bodyId} hidden={isCollapsed}>
                {isCollapsed ? null : items.map(({ path, label, icon: Icon }) => (
                  <NavLink
                    key={path}
                    to={path}
                    className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                    data-tooltip={labelFor(path, label)}
                    onClick={onNavigate}
                  >
                    <span className="nav-icon"><Icon aria-hidden /></span>
                    <span className="nav-label">{labelFor(path, label)}</span>
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <div className="sidebar-foot">
        <div className="sidebar-user">
          <Avatar name={user?.fullName} size="sm" />
          <div className="su-text">
            <strong>{user?.fullName}</strong>
            <span>{roles.map((role) => messages.roles[role as keyof typeof messages.roles] ?? role).join(', ') || nav.users}</span>
          </div>
        </div>
        <button className="sidebar-logout" onClick={onLogout} data-tooltip={nav.signOut}>
          <LogOut aria-hidden />
          <span className="nav-label">{nav.signOut}</span>
        </button>
      </div>
    </aside>
  );
}
