import { NavLink } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { NAV_GROUPS } from './nav-config';
import Avatar from '@/components/ui/Avatar';
import { navigationKeyByPath, useI18n } from '@/i18n/i18n';

/**
 * หัวข้อกลุ่มเมนู — จับคู่ด้วยชื่อกลุ่ม ไม่ใช่ลำดับ
 * ของเดิมใช้ index ทำให้หัวข้อเพี้ยนทันทีที่มีการเพิ่มกลุ่มใหม่
 * กลุ่มที่ยังไม่มีคำแปล จะใช้ชื่อกลุ่มภาษาไทยจาก nav-config ตามเดิม
 */
const GROUP_I18N_KEY: Record<string, 'overview' | 'menuCost' | 'dataSales' | 'orderOperations' | 'system'> = {
  'ภาพรวม': 'overview',
  'จัดการเมนูและต้นทุน': 'menuCost',
  'ข้อมูลและยอดขาย': 'dataSales',
  'ออเดอร์และปฏิบัติการ': 'orderOperations',
};
function groupHeading(label: string, nav: Record<string, string>): string {
  const key = GROUP_I18N_KEY[label];
  return key ? (nav[key] ?? label) : label;
}

export default function Sidebar({ collapsed, onNavigate, onLogout }: {
  collapsed: boolean;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const { messages } = useI18n(); const nav = messages.navigation;
  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];
  const isSuperAdmin = roles.includes('SUPER_ADMIN');
  const canSee = (requiredRole?: string, requiredPermission?: string, requiredAnyPermission?: string[]) =>
    (!requiredRole || roles.includes(requiredRole))
    && (!requiredPermission || permissions.includes(requiredPermission) || isSuperAdmin)
    && (!requiredAnyPermission?.length || isSuperAdmin || requiredAnyPermission.some((p) => permissions.includes(p)));

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
          return (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{collapsed ? '•' : groupHeading(group.label, nav)}</p>
              {items.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                  data-tooltip={navigationKeyByPath[path as keyof typeof navigationKeyByPath] ? nav[navigationKeyByPath[path as keyof typeof navigationKeyByPath]] : label}
                  onClick={onNavigate}
                >
                  <span className="nav-icon"><Icon aria-hidden /></span>
                  <span className="nav-label">{navigationKeyByPath[path as keyof typeof navigationKeyByPath] ? nav[navigationKeyByPath[path as keyof typeof navigationKeyByPath]] : label}</span>
                </NavLink>
              ))}
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
