// Auth state: token + profil + permission. Terintegrasi API Contract Team 1:
//  POST /api/auth/login → { token, user }
//  POST /api/auth/logout
//  GET  /api/auth/me     → profil + permission
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, getToken, setToken, setUnauthorizedHandler } from '../lib/api';

const AuthContext = createContext(null);
const USER_KEY = 'irkop_cell_user';

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY));
    } catch {
      return null;
    }
  });
  const [ready, setReady] = useState(false);

  // Jika ada token tersimpan, pulihkan profil (session persist, PRD 3.1).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const token = getToken();
      if (!token) {
        setReady(true);
        return;
      }
      try {
        const me = await api.get('/auth/me');
        if (!cancelled) {
          setUser(me.user || null);
          localStorage.setItem(USER_KEY, JSON.stringify(me.user || null));
        }
      } catch {
        if (!cancelled) {
          setUser(null);
          localStorage.removeItem(USER_KEY);
          setToken(null);
        }
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Token hangus / 401 → keluar (di-set oleh api client).
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setToken(null);
      localStorage.removeItem(USER_KEY);
      setUser(null);
    });
  }, []);

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    setToken(res.token);
    localStorage.setItem(USER_KEY, JSON.stringify(res.user));
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // stateless JWT: token wajib dibuang sisi klien (keputusan Team 1)
    } finally {
      setToken(null);
      localStorage.removeItem(USER_KEY);
      setUser(null);
    }
  }, []);

  const value = useMemo(() => {
    const permissions = user
      ? Array.isArray(user.permissions)
        ? { role: user.role, halaman: user.permissions }
        : { role: user.role, halaman: user.permissions?.halaman ?? [] }
      : { role: null, halaman: [] };
    return {
      user,
      isAdmin: user?.role === 'admin',
      permissions,
      can: (hallKey) => (user?.role === 'admin' ? hallKey !== 'gaji_karyawan' : permissions.halaman.includes(hallKey)),
      login,
      logout,
      ready,
    };
  }, [user, login, logout, ready]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth harus dipakai di dalam <AuthProvider>');
  return ctx;
}