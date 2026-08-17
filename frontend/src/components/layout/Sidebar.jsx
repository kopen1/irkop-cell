import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useSiteName } from '../../hooks/useSiteName';
import { NAV, NAV_SYSTEM, canAccess } from '../../lib/routes';
import { Icon } from '../ui/Icon';

export function NavList({ onNavigate }) {
  const { user, permissions } = useAuth();
  const renderLink = (item) => {
    if (item.adminOnly && user?.role !== 'admin') return null;
    if (!canAccess(permissions, item.key)) return null;
    return (
      <NavLink
        key={item.key}
        to={item.path}
        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
        onClick={onNavigate}
      >
        <Icon name={item.icon} size={17} />
        <span>{item.label}</span>
      </NavLink>
    );
  };

  return (
    <nav className="sidebar-nav" aria-label="Navigasi utama">
      <div className="nav-section-label">Menu Utama</div>
      {NAV.filter((n) => n.main).map(renderLink)}
      <div className="nav-section-label">Menu Lainnya</div>
      {NAV.filter((n) => !n.main).map(renderLink)}
      <div className="nav-section-label">Sistem</div>
      {NAV_SYSTEM.map(renderLink)}
    </nav>
  );
}

export function Sidebar({ onNavigate }) {
  const { user, logout } = useAuth();
  const siteName = useSiteName();
  return (
    <aside className="sidebar sidebar-desktop">
      <div className="sidebar-brand">
        <span className="sidebar-logo">IK</span>
        <div>
          <div className="sidebar-brand-name">{siteName}</div>
          <div className="sidebar-brand-sub">POS & Buku Kas</div>
        </div>
      </div>
      <NavList onNavigate={onNavigate} />
      <div className="sidebar-foot">
        <div className="text-sm" style={{ marginBottom: 8 }}>
          <span className="font-bold">{user?.nama}</span>{' '}
          <span className="badge badge-accent">{user?.role === 'admin' ? 'Admin' : 'Karyawan'}</span>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={logout}>
          <Icon name="logout" size={15} /> Keluar
        </button>
      </div>
    </aside>
  );
}