// Theme system — pilihan tema disimpan, tidak mengubah aturan bisnis/data.
// Default: Classic Navy & Gold (PRD 6 / 12.9). Tema tambahan menampilkan
// kontras & keterbacaan yang terjaga (semua warna via CSS variables).
import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const THEME_KEY = 'irkop_cell_theme';

export const THEMES = [
  { id: 'classic', label: 'Classic Navy & Gold', swatch: ['#0e1a2b', '#d8a94e'] },
  { id: 'paper', label: 'Paper Buku Kas', swatch: ['#ffffff', '#12375c'] },
];

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => localStorage.getItem(THEME_KEY) || 'classic');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      setTheme: setThemeState,
    }),
    [theme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme harus dipakai di dalam <ThemeProvider>');
  return ctx;
}