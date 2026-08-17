import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { resolveByPath } from '../../lib/routes';
import { useSiteName } from '../../hooks/useSiteName';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { BottomNav, MobileDrawer } from './BottomNav';

export function AppShell() {
  const { ready } = useAuth();
  const location = useLocation();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const route = resolveByPath(location.pathname);
  const siteName = useSiteName();
  const title = route?.label || siteName;

  if (!ready) return null;

  return (
    <div className="shell">
      <Sidebar />
      <div className="shell-main">
        <Topbar title={title} onOpenMenu={() => setDrawerOpen(true)} />
        <main className="shell-content">
          <Outlet />
        </main>
      </div>
      <BottomNav />
      <MobileDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}