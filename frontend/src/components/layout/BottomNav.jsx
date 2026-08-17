import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSiteName } from '../../hooks/useSiteName';
import { MAIN_NAV_MOBILE } from '../../lib/routes';
import { NavList } from './Sidebar';
import { Icon } from '../ui/Icon';

export function BottomNav() {
  const { can } = useAuth();
  const items = MAIN_NAV_MOBILE.filter((n) => can(n.key));
  if (items.length === 0) return null;
  return (
    <nav className="mobile-nav mobile-only" aria-label="Navigasi bawah">
      {items.map((n) => (
        <NavLink key={n.key} to={n.path} className={({ isActive }) => `mobile-nav-item ${isActive ? 'active' : ''}`}>
          <span className="mn-icon"><Icon name={n.icon} size={20} /></span>
          <span>{n.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function MobileDrawer({ open, onClose }) {
  const { user, logout } = useAuth();
  const siteName = useSiteName();
  if (!open) return null;
  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <aside className="drawer" aria-label="Menu navigasi">
        <header className="drawer-head">
          <div className="flex items-center gap-2">
            <span className="sidebar-logo">IK</span>
            <span className="sidebar-brand-name">{siteName}</span>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Tutup menu">
            <Icon name="close" size={18} />
          </button>
        </header>
        <div className="drawer-scroll">
          <div className="drawer-user">
            <div className="font-bold">{user?.nama}</div>
            <span className="text-sm text-secondary">{user?.role === 'admin' ? 'Admin' : 'Karyawan'}</span>
          </div>
          <NavList onNavigate={onClose} />
          <div className="drawer-user">
            <button type="button" className="btn btn-ghost btn-sm" onClick={logout}>
              <Icon name="logout" size={15} /> Keluar
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}