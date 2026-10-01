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
  // Validasi id tema: kalau localStorage berisi nilai yang tidak dikenal
  // (mis. "dark" dari versi lama), data-theme tidak akan cocok dengan blok
  // [data-theme='...'] mana pun -> semua variabel warna hilang -> seluruh
  // teks jatuh ke warna default browser (terlihat "pertebal" semua).
  const [theme, setThemeState] = useState(() => {
    const simpanan = localStorage.getItem(THEME_KEY);
    return THEMES.some((t) => t.id === simpanan) ? simpanan : 'classic';
  });

  useEffect(() => {
    const valid = THEMES.some((t) => t.id === theme) ? theme : 'classic';
    document.documentElement.setAttribute('data-theme', valid);
    localStorage.setItem(THEME_KEY, valid);
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