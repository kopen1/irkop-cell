import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { resolveByPath } from '../../lib/routes';
import { useSiteName } from '../../hooks/useSiteName';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BottomNav, MobileDrawer } from './BottomNav';
import { SyncStatus } from '../ui/SyncStatus';

export function AppShell() {
  const { ready } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => typeof localStorage !== 'undefined' && localStorage.getItem('irkop_sidebar_collapsed') === '1'
  );
  const toggleSidebar = () => {
    setSidebarCollapsed((v) => {
      const next = !v;
      try { localStorage.setItem('irkop_sidebar_collapsed', next ? '1' : '0'); } catch { /* abaikan */ }
      return next;
    });
  };

  const route = resolveByPath(location.pathname);
  const siteName = useSiteName();
  const title = route?.label || siteName;

  if (!ready) return null;

  return (
    <div className="shell">
      <Sidebar collapsed={sidebarCollapsed} />
      <div className="shell-main">
        <Topbar title={title} onOpenMenu={() => setDrawerOpen(true)} onToggleSidebar={toggleSidebar} sidebarCollapsed={sidebarCollapsed} />
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <SyncStatus />
    </div>
  );
}