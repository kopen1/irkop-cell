import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme, THEMES } from '../context/ThemeContext';
import { ApiError } from '../lib/api';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';

export default function LoginPage() {
  const { user, login, ready } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const from = location.state?.from?.pathname || '/';

  if (!ready) return null;
  if (user) return <Navigate to={from} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setError(err.message);
      else setError('Terjadi kesalahan. Silakan coba lagi.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-page">
      <Card className="login-card">
        <div style={{ textAlign: 'center', marginBottom: 'var(--space-5)' }}>
          <span className="sidebar-logo" style={{ width: 52, height: 52, fontSize: '1.05rem', margin: '0 auto 12px' }}>IK</span>
          <h1 className="page-title">Iirkop Cell</h1>
          <p className="text-sm text-secondary">POS &amp; Buku Kas Digital</p>
        </div>

        <form onSubmit={onSubmit} noValidate>
          <div className="flex flex-col gap-4">
            <Field label="Username / email" required>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                placeholder="username"
                required
                autoFocus
              />
            </Field>
            <Field label="Password" required>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="••••••••"
                required
              />
            </Field>
            {error && (
              <p className="field-error" role="alert" style={{ fontSize: '0.88rem' }}>
                {error}
              </p>
            )}
            <Button type="submit" block size="lg" loading={busy}>
              Masuk
            </Button>
          </div>
        </form>

        <div className="mt-4" style={{ borderTop: '1px solid var(--border)', paddingTop: 'var(--space-3)' }}>
          <p className="text-xs text-muted mb-2">Tema tampilan</p>
          <div className="flex gap-2">
            {THEMES.map((t) => (
              <button key={t.id} type="button" className="theme-swatch active" onClick={() => setTheme(t.id)} title={t.label}
                style={{ background: `linear-gradient(135deg, ${t.swatch[0]} 50%, ${t.swatch[1]} 50%)`, opacity: theme === t.id ? 1 : 0.55 }}>
                <span className="sr-only">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </Card>
    </div>
  );
}