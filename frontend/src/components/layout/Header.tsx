import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Building2, CheckCheck, ChevronDown, ChevronRight, CircleAlert, KeyRound, LogOut, Menu, PanelLeft, Search, UserRound, X } from 'lucide-react';
import { useAuth } from '@/auth/AuthContext';
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
          <h1>{title}</h1>
          <nav className="breadcrumb" aria-label="เส้นทาง">
            <span>{group}</span>
            <ChevronRight aria-hidden />
            <span>{title}</span>
          </nav>
        </div>
      </div>

      <button className="header-search" onClick={() => {}} type="button" aria-label={shell.search}>
        <Search aria-hidden />
        <span>{shell.search}</span>
        <kbd>Ctrl K</kbd>
      </button>

      <div className="header-right">
        <button className="header-company-context" onClick={() => navigate('/select-company')} title={shell.changeCompany}><Building2 /><span><small>{shell.currentCompany}</small><strong>{user?.activeCompany?.nameTh}</strong></span><ChevronDown /></button>
        <SystemStatus />
        <div className="header-date">
          <strong>{formatDate(new Date(), locale)}</strong>
        </div>
        <button className="icon-btn notification-trigger" aria-label={shell.notifications} onClick={() => setNotificationsOpen(true)}><Bell />{unread > 0 && <span>{unread > 9 ? '9+' : unread}</span>}</button>

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
              <div className="user-pop-head">
                <strong>{user?.fullName}</strong>
                <span>{user?.email}</span>
              </div>
              <div className="user-pop-head"><strong>{user?.activeCompany?.nameTh}</strong><span>{user?.activeCompany?.code}</span></div>
              <button role="menuitem" onClick={() => { setMenuOpen(false); navigate('/select-company'); }}><Building2 aria-hidden />{shell.changeCompany}</button>
              <Link to="/profile" role="menuitem" onClick={() => setMenuOpen(false)}><UserRound aria-hidden />{shell.profile}</Link>
              <button role="menuitem" onClick={() => { setMenuOpen(false); navigate('/account/change-password'); }}><KeyRound aria-hidden />{shell.changePassword}</button>
              <button role="menuitem" className="danger" onClick={() => { setMenuOpen(false); onLogout(); }}><LogOut aria-hidden />{nav.signOut}</button>
            </div>
          )}
        </div>
      </div>
      {notificationsOpen && <>
        <button className="notification-scrim" aria-label={shell.notifications} onClick={() => setNotificationsOpen(false)} />
        <aside className="notification-drawer" aria-label={shell.notifications}>
          <header><div><small>NOTIFICATION CENTER</small><h2>{shell.notifications}</h2><p>{unread ? `${unread} ${shell.unread}` : shell.newAppear}</p></div><button className="icon-btn" onClick={() => setNotificationsOpen(false)}><X /></button></header>
          <nav>{([['all',shell.all],['unread',shell.unread],['action',shell.action]] as const).map(([key,label]) => <button key={key} className={notificationTab === key ? 'active' : ''} onClick={() => setNotificationTab(key)}>{label}</button>)}</nav>
          <div className="notification-list">{visibleNotifications.length ? visibleNotifications.map((item) => <article key={item.id} className={!item.readAt ? 'unread' : ''}>
            <span className={`notification-severity ${item.severity.toLowerCase()}`}><CircleAlert /></span><div><small>{item.severity === 'ACTION_REQUIRED' ? shell.action : shell.notifications} · {new Date(item.createdAt).toLocaleString(locale)}</small><h3>{item.title}</h3><p>{item.message}</p>{item.actionUrl && <button onClick={() => { setNotificationsOpen(false); navigate(item.actionUrl!); }}>{shell.details} <ChevronRight /></button>}</div>
          </article>) : <div className="notification-empty"><Bell/><strong>{shell.noNotifications}</strong><span>{shell.newAppear}</span></div>}</div>
          <footer><button onClick={() => void readAll()} disabled={!unread}><CheckCheck /> {shell.markAll}</button></footer>
        </aside>
      </>}
    </header>
  );
}
