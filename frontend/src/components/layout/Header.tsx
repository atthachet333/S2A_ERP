import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Building2, CheckCheck, ChevronDown, ChevronRight, CircleAlert, KeyRound, LogOut, Menu, Monitor, Moon, PanelLeft,  Sun, UserRound, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
import { useTheme } from '@/theme/ThemeContext';
import { MODULES } from './nav-config';
import { formatDate, navigationKeyByPath, useI18n } from '@/i18n/i18n';
import Avatar from '@/components/ui/Avatar';
import SystemStatus from '@/components/ui/SystemStatus';
import { apiClient } from '@/lib/api-client';

type Notification = { id: string; title: string; message: string; severity: string; actionUrl?: string | null; readAt?: string | null; createdAt: string };

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
  const { theme, resolved, setTheme, toggle } = useTheme();
  const { locale, messages } = useI18n(); const shell = messages.shell; const nav = messages.navigation;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationTab, setNotificationTab] = useState<'all' | 'unread' | 'action'>('all');
  const [scrolled, setScrolled] = useState(() => window.scrollY > 20 || document.documentElement.scrollTop > 20);
  const menuRef = useRef<HTMLDivElement>(null);

  const moduleMeta = MODULES[pathname];
  const fallback = PAGE_TITLES[pathname];
  const navigationKey = navigationKeyByPath[pathname as keyof typeof navigationKeyByPath];
  const title = navigationKey ? nav[navigationKey] : moduleMeta?.label ?? fallback?.title ?? 'S2 Accounting Consultant';
  const PageIcon = moduleMeta?.icon;
  const group = navigationKey ? nav.system : moduleMeta?.group ?? fallback?.group ?? nav.overview;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  // ESC ปิดทั้งเมนูผู้ใช้และลิ้นชักแจ้งเตือน
  useEffect(() => {
    if (!menuOpen && !notificationsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setMenuOpen(false);
      setNotificationsOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen, notificationsOpen]);

  // ล็อกการเลื่อนพื้นหลังระหว่างเปิดลิ้นชัก
  useEffect(() => {
    if (!notificationsOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [notificationsOpen]);

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 20 || document.documentElement.scrollTop > 20);
    updateScrolled();
    window.addEventListener('scroll', updateScrolled, { passive: true });
    return () => window.removeEventListener('scroll', updateScrolled);
  }, []);

  useEffect(() => {
    apiClient.get<Notification[]>('/business/notifications').then(setNotifications).catch(() => setNotifications([]));
  }, [user?.activeCompany?.id]);

  const unread = notifications.filter((item) => !item.readAt).length;
  const visibleNotifications = notifications.filter((item) => notificationTab === 'all' || (notificationTab === 'unread' ? !item.readAt : item.severity === 'ACTION_REQUIRED'));
  const readAll = async () => {
    await apiClient.post('/business/notifications/read-all');
    setNotifications((items) => items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })));
  };

  return (
    <header className={`app-header${scrolled ? ' app-header--scrolled' : ''}`}>
      <div className="header-left">
        <button className="icon-btn only-desktop" onClick={onToggleSidebar} aria-label={nav.system}><PanelLeft /></button>
        <button className="icon-btn only-mobile" onClick={onOpenDrawer} aria-label={nav.system}><Menu /></button>
        {PageIcon && <span className="header-page-icon"><PageIcon aria-hidden /></span>}
        <div className="header-title">
          {/* breadcrumb แสดงเฉพาะกลุ่มต้นทาง ไม่ซ้ำกับ h1 ที่เป็นชื่อหน้าอยู่แล้ว */}
          <nav className="breadcrumb" aria-label="เส้นทาง">
            <span>{group}</span>
            <ChevronRight aria-hidden />
          </nav>
          <h1>{title}</h1>
        </div>
      </div>

      {/* เดิมมีปุ่มค้นหา + คีย์ลัด Ctrl K อยู่ตรงนี้ แต่ onClick เป็นฟังก์ชันว่าง
          และระบบยังไม่มี global search ทั้งฝั่ง backend และ command palette
          จึงถอดออกแทนที่จะปล่อยให้เป็นปุ่มที่กดแล้วไม่เกิดอะไร
          ถ้าวันหลังทำ global search จริง ค่อยใส่กลับพร้อม handler */}

      <div className="header-right">
        <button className="header-company-context" onClick={() => navigate('/select-company')} title={shell.changeCompany}><Building2 /><span><small>{shell.currentCompany}</small><strong>{user?.activeCompany?.nameTh}</strong></span><ChevronDown /></button>
        <SystemStatus />
        <div className="header-date">
          <strong>{formatDate(new Date(), locale)}</strong>
        </div>
        <button className="icon-btn notification-trigger" aria-label={shell.notifications} aria-haspopup="dialog" aria-expanded={notificationsOpen} aria-controls="s2a-notification-drawer" onClick={() => setNotificationsOpen(true)}><Bell />{unread > 0 && <span>{unread > 9 ? '9+' : unread}</span>}</button>
        <button className="icon-btn theme-toggle-btn" aria-label={shell.theme} title={`${shell.theme} · ${resolved === 'dark' ? shell.dark : shell.light}`} onClick={toggle}>{resolved === 'dark' ? <Sun aria-hidden /> : <Moon aria-hidden />}</button>

        <div className="user-menu" ref={menuRef}>
          <button className="user-trigger" onClick={() => setMenuOpen((v) => !v)} aria-haspopup="menu" aria-expanded={menuOpen}>
            <Avatar name={user?.fullName} size="sm" />
            <span className="um-text">
              <strong>{user?.fullName}</strong>
              <span>{user?.roles.map((role)=>messages.roles[role as keyof typeof messages.roles]??role).join(', ')}</span>
            </span>
            <ChevronDown aria-hidden width={16} />
          </button>
          {menuOpen && (
            <div className="user-pop" role="menu">
              <div className="up-profile">
                <Avatar name={user?.fullName} />
                <div className="up-id">
                  <strong>{user?.fullName}</strong>
                  <span className="up-role">{user?.roles.map((role) => messages.roles[role as keyof typeof messages.roles] ?? role).join(', ')}</span>
                  {user?.email && <span className="up-email">{user.email}</span>}
                </div>
              </div>
              {user?.activeCompany && (
                <div className="up-company">
                  <Building2 aria-hidden />
                  <div style={{ minWidth: 0 }}>
                    <small>{shell.currentCompany}</small>
                    <strong>{user.activeCompany.nameTh}</strong>
                  </div>
                </div>
              )}
              <div className="up-divider" />
              <div className="up-theme">
                <span className="up-theme-label">{shell.theme}</span>
                <div className="theme-seg" role="group" aria-label={shell.theme}>
                  <button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')} aria-label={shell.light} aria-pressed={theme === 'light'} title={shell.light}><Sun aria-hidden /></button>
                  <button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')} aria-label={shell.dark} aria-pressed={theme === 'dark'} title={shell.dark}><Moon aria-hidden /></button>
                  <button className={theme === 'system' ? 'active' : ''} onClick={() => setTheme('system')} aria-label={shell.system} aria-pressed={theme === 'system'} title={shell.system}><Monitor aria-hidden /></button>
                </div>
              </div>
              <div className="up-divider" />
              <button className="up-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/select-company'); }}><Building2 aria-hidden />{shell.changeCompany}</button>
              <Link className="up-item" to="/profile" role="menuitem" onClick={() => setMenuOpen(false)}><UserRound aria-hidden />{shell.profile}</Link>
              <button className="up-item" role="menuitem" onClick={() => { setMenuOpen(false); navigate('/account/change-password'); }}><KeyRound aria-hidden />{shell.changePassword}</button>
              <div className="up-divider" />
              <button className="up-item danger" role="menuitem" onClick={() => { setMenuOpen(false); onLogout(); }}><LogOut aria-hidden />{nav.signOut}</button>
            </div>
          )}
        </div>
      </div>
      {/* ลิ้นชักแจ้งเตือนต้อง portal ออกไปที่ body:
          ถ้าอยู่ใน <header> (fixed + z-index) จะติดอยู่ใน stacking context ของหัวเว็บ
          ทำให้ z-index ของตัวมันเองไม่มีผลเทียบกับ modal/dropdown ที่อยู่ระดับ root */}
      {notificationsOpen && createPortal(<>
        <button className="notification-scrim" aria-label={shell.notifications} onClick={() => setNotificationsOpen(false)} />
        <aside id="s2a-notification-drawer" className="notification-drawer" role="dialog" aria-modal="true" aria-label={shell.notifications}>
          <header><div><small>NOTIFICATION CENTER</small><h2>{shell.notifications}</h2><p>{unread ? `${unread} ${shell.unread}` : shell.newAppear}</p></div><button className="icon-btn" onClick={() => setNotificationsOpen(false)}><X /></button></header>
          <nav>{([['all',shell.all],['unread',shell.unread],['action',shell.action]] as const).map(([key,label]) => <button key={key} className={notificationTab === key ? 'active' : ''} onClick={() => setNotificationTab(key)}>{label}</button>)}</nav>
          <div className="notification-list">{visibleNotifications.length ? visibleNotifications.map((item) => <article key={item.id} className={!item.readAt ? 'unread' : ''}>
            <span className={`notification-severity ${item.severity.toLowerCase()}`}><CircleAlert /></span><div><small>{item.severity === 'ACTION_REQUIRED' ? shell.action : shell.notifications} · {new Date(item.createdAt).toLocaleString(locale)}</small><h3>{item.title}</h3><p>{item.message}</p>{item.actionUrl && <button onClick={() => { setNotificationsOpen(false); navigate(item.actionUrl!); }}>{shell.details} <ChevronRight /></button>}</div>
          </article>) : <div className="notification-empty"><Bell/><strong>{shell.noNotifications}</strong><span>{shell.newAppear}</span></div>}</div>
          <footer><button onClick={() => void readAll()} disabled={!unread}><CheckCheck /> {shell.markAll}</button></footer>
        </aside>
      </>, document.body)}
    </header>
  );
}
