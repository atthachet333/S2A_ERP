import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, LogOut, Menu, UserRound, UsersRound, X } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/auth/AuthContext';

export default function AppLayout() {
  const { user, logout } = useAuth(); const navigate = useNavigate(); const [open, setOpen] = useState(false);
  const leave = async () => { await logout(); navigate('/login', { replace: true }); };
  return <div className="app-shell">
    <aside className={open ? 'sidebar open' : 'sidebar'}>
      <button className="mobile-close" onClick={() => setOpen(false)} aria-label="ปิดเมนู"><X /></button>
      <div className="brand"><img src="/s2a-logo.png" alt="S2A ERP" /><div><strong>S2A ERP</strong><span>Production & Inventory</span></div></div>
      <nav><NavLink to="/dashboard"><LayoutDashboard />แดชบอร์ด</NavLink><NavLink to="/profile"><UserRound />โปรไฟล์</NavLink>{user?.roles.includes('SUPER_ADMIN') && <NavLink to="/users"><UsersRound />ผู้ใช้งาน</NavLink>}</nav>
      <button className="logout" onClick={() => void leave()}><LogOut />ออกจากระบบ</button>
    </aside>
    <div className="main-panel"><header><button className="menu-button" onClick={() => setOpen(true)} aria-label="เปิดเมนู"><Menu /></button><div><small>เข้าสู่ระบบในชื่อ</small><strong>{user?.fullName}</strong></div></header><main><Outlet /></main></div>
    {open && <button className="backdrop" onClick={() => setOpen(false)} aria-label="ปิดเมนู" />}
  </div>;
}
