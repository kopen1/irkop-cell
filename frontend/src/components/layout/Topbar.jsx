import { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useSiteName } from '../../hooks/useSiteName';
import { useTheme, THEMES } from '../../context/ThemeContext';
import { Icon } from '../ui/Icon';

export function Topbar({ title, onOpenMenu }) {
  const { user } = useAuth();
  const siteName = useSiteName();
  return (
    <header className="topbar">
      <button type="button" className="btn btn-ghost btn-sm mobile-only" onClick={onOpenMenu} aria-label="Buka menu navigasi">
        <Icon name="menu" size={20} />
      </button>
      <span className="topbar-brand-mobile">
        <span className="sidebar-logo" style={{ width: 30, height: 30, fontSize: '0.7rem' }}>IK</span>
        {siteName}
      </span>
      <span className="topbar-title desktop-only">{title}</span>
      <span className="topbar-spacer" />
      <span className="text-sm text-secondary desktop-only">{user?.nama}</span>
      <TopbarThemeMenu />
    </header>
  );
}

function TopbarThemeMenu() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => setOpen((v) => !v)}
        aria-label="Pilih tema tampilan"
        aria-expanded={open}
      >
        <Icon name="eye" size={16} />
        <span className="desktop-only">Tema</span>
      </button>
      {open && (
        <div
          className="card"
          style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', padding: 'var(--space-3)', width: 260, zIndex: 60 }}
        >
          <p className="card-title-sm mb-3">Pilih tema</p>
          <div className="flex flex-col gap-2">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`theme-option-row ${theme === t.id ? 'active' : ''}`}
                onClick={() => {
                  setTheme(t.id);
                  setOpen(false);
                }}
              >
                <span className="flex items-center gap-2">
                  <span className="theme-swatch" style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)` }} />
                  <span style={{ fontSize: '0.85rem' }}>{t.label}</span>
                </span>
                {theme === t.id && <Icon name="check" size={16} />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}