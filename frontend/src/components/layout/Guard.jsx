import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { EmptyState } from '../ui/States';
import { Icon } from '../ui/Icon';

export function RequireAuth({ children }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  return children;
}

export function RequirePermission({ permission, children }) {
  const { can, user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return null;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!can(permission)) {
    return (
      <div className="page">
        <EmptyState
          title="Akses terbatas"
          description="Anda tidak memiliki izin untuk membuka halaman ini. Hubungi Admin jika ini seharusnya dapat diakses."
          icon="lock"
        />
      </div>
    );
  }
  return children;
}

export function AdminOnly({ children, permission = 'gaji_karyawan' }) {
  return <RequirePermission permission={permission}>{children}</RequirePermission>;
}

export function PermissionDenied() {
  return (
    <div className="page">
      <div className="state-block">
        <span className="state-icon" aria-hidden="true"><Icon name="lock" size={26} /></span>
        <div>
          <div className="state-title">Akses ditolak</div>
          <div className="state-desc">Halaman ini hanya dapat diakses Admin.</div>
        </div>
      </div>
    </div>
  );
}