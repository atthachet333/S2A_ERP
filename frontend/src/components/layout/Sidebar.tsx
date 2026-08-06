import { NavLink } from 'react-router-dom';
import { LogOut, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { NAV_GROUPS } from './nav-config';
import Avatar from '@/components/ui/Avatar';

export default function Sidebar({ collapsed, onNavigate, onLogout }: {
  collapsed: boolean;
  onNavigate: () => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const roles = user?.roles ?? [];
  const canSee = (required?: string) => !required || roles.includes(required);

  return (
    <aside className="app-sidebar" aria-label="เมนูหลัก">
      <div className="sidebar-brand">
        <img src="/s2a-logo.png" alt="โลโก้ S2A ERP" />
        <div className="brand-text">
          <strong>S2A ERP</strong>
          <span>Production &amp; Inventory</span>
        </div>
        <button className="sidebar-close" onClick={onNavigate} aria-label="ปิดเมนู"><X /></button>
      </div>

      <nav className="sidebar-scroll">
        {NAV_GROUPS.map((group) => {
          const items = group.items.filter((item) => canSee(item.requiredRole));
          if (items.length === 0) return null;
          return (
            <div className="nav-group" key={group.label}>
              <p className="nav-group-label">{collapsed ? '•' : group.label}</p>
              {items.map(({ path, label, icon: Icon }) => (
                <NavLink
                  key={path}
                  to={path}
                  className={({ isActive }) => (isActive ? 'nav-item active' : 'nav-item')}
                  data-tooltip={label}
                  onClick={onNavigate}
                >
                  <Icon aria-hidden />
                  <span className="nav-label">{label}</span>
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
            <span>{roles.join(', ') || 'ผู้ใช้งาน'}</span>
          </div>
        </div>
        <button className="sidebar-logout" onClick={onLogout} data-tooltip="ออกจากระบบ">
          <LogOut aria-hidden />
          <span className="nav-label">ออกจากระบบ</span>
        </button>
      </div>
    </aside>
  );
}
