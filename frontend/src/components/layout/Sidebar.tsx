import { NavLink } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { NAV_GROUPS } from './nav-config';
import Avatar from '@/components/ui/Avatar';
import { navigationKeyByPath, useI18n } from '@/i18n/i18n';

export default function Sidebar({ collapsed, onNavigate, onLogout }: {
  collapsed: boolean;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const { messages } = useI18n(); const nav = messages.navigation;
  const roles = user?.roles ?? [];
  const permissions = user?.permissions ?? [];
  const canSee = (requiredRole?: string, requiredPermission?: string) => (!requiredRole || roles.includes(requiredRole)) && (!requiredPermission || permissions.includes(requiredPermission) || roles.includes('SUPER_ADMIN'));

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
        {NAV_GROUPS.map((group, groupIndex) => {
          const items = group.items.filter((item) => canSee(item.requiredRole, item.requiredPermission));
          if (items.length === 0) return null;
          return (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{collapsed ? '•' : [nav.overview,nav.menuCost,nav.dataSales,nav.orderOperations,nav.system][groupIndex] ?? group.label}</p>
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
