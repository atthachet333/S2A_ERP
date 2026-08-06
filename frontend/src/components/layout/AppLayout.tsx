import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useAuth } from '@/auth/AuthContext';
import Sidebar from './Sidebar';
import Header from './Header';

const COLLAPSE_KEY = 's2a_sidebar_collapsed';

export default function AppLayout() {
  const { logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem(COLLAPSE_KEY) === '1');
  const [drawerOpen, setDrawerOpen] = useState(false);

  // ปิด drawer เมื่อเปลี่ยนหน้า (mobile)
  useEffect(() => { setDrawerOpen(false); }, [location.pathname]);

  const toggleCollapsed = () => {
    setCollapsed((v) => {
      const next = !v;
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
      return next;
    });
  };

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className={cn('app-shell', collapsed && 'collapsed', drawerOpen && 'drawer-open')}>
      <Sidebar collapsed={collapsed} onNavigate={() => setDrawerOpen(false)} onLogout={() => void handleLogout()} />
      <button className="app-backdrop" aria-label="ปิดเมนู" onClick={() => setDrawerOpen(false)} />
      <div className="app-main">
        <Header
          onToggleSidebar={toggleCollapsed}
          onOpenDrawer={() => setDrawerOpen(true)}
          onLogout={() => void handleLogout()}
        />
        <main className="app-content">
          <div className="content-container">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
