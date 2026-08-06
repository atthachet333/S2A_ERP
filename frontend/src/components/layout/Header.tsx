import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, ChevronDown, ChevronRight, KeyRound, LogOut, Menu, PanelLeft, Search, UserRound } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { MODULES } from './nav-config';
import { formatThaiDate } from '@/lib/utils';
import Avatar from '@/components/ui/Avatar';
import SystemStatus from '@/components/ui/SystemStatus';

const PAGE_TITLES: Record<string, { title: string; group: string }> = {
  '/profile': { title: 'โปรไฟล์ของฉัน', group: 'บัญชีผู้ใช้' },
  '/unauthorized': { title: 'ไม่มีสิทธิ์เข้าถึง', group: 'ระบบ' },
};

export default function Header({ onToggleSidebar, onOpenDrawer, onLogout }: {
  onToggleSidebar: () => void;
  onOpenDrawer: () => void;
  onLogout: () => void;
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const moduleMeta = MODULES[pathname];
  const fallback = PAGE_TITLES[pathname];
  const title = moduleMeta?.label ?? fallback?.title ?? 'S2A ERP';
  const group = moduleMeta?.group ?? fallback?.group ?? 'ภาพรวม';

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <header className="app-header">
      <div className="header-left">
        <button className="icon-btn only-desktop" onClick={onToggleSidebar} aria-label="ย่อ/ขยายเมนู"><PanelLeft /></button>
        <button className="icon-btn only-mobile" onClick={onOpenDrawer} aria-label="เปิดเมนู"><Menu /></button>
        <div className="header-title">
          <h1>{title}</h1>
          <nav className="breadcrumb" aria-label="เส้นทาง">
            <span>{group}</span>
            <ChevronRight aria-hidden />
            <span>{title}</span>
          </nav>
        </div>
      </div>

      <button className="header-search" onClick={() => {}} type="button" aria-label="ค้นหา (เร็ว ๆ นี้)">
        <Search aria-hidden />
        <span>ค้นหาเมนู เอกสาร หรือข้อมูล…</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="header-right">
        <SystemStatus />
        <div className="header-date">
          <strong>{formatThaiDate(new Date())}</strong>
        </div>
        <button className="icon-btn" aria-label="การแจ้งเตือน"><Bell /></button>

        <div className="user-menu" ref={menuRef}>
          <button className="user-trigger" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <Avatar name={user?.fullName} size="sm" />
            <span className="um-text">
              <strong>{user?.fullName}</strong>
              <span>{user?.roles.join(', ')}</span>
            </span>
            <ChevronDown aria-hidden width={16} />
          </button>
          {menuOpen && (
            <div className="user-pop" role="menu">
              <div className="user-pop-head">
                <strong>{user?.fullName}</strong>
                <span>{user?.email}</span>
              </div>
              <Link to="/profile" role="menuitem" onClick={() => setMenuOpen(false)}><UserRound aria-hidden />โปรไฟล์</Link>
              <button role="menuitem" onClick={() => { setMenuOpen(false); navigate('/account/change-password'); }}><KeyRound aria-hidden />เปลี่ยนรหัสผ่าน</button>
              <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onLogout(); }}><LogOut aria-hidden />ออกจากระบบ</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
