import { verifyToken } from './jwt.js';
import { err } from './errors.js';

export function readAuthHeader(request) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function authenticate(db, request, env) {
  const token = readAuthHeader(request);
  if (!token) throw err(401, 'unauthorized', 'Authorization header required');

  const secret = env.JWT_SECRET;
  const payload = await verifyToken(token, secret);
  if (!payload || !payload.sub) throw err(401, 'invalid_token', 'Invalid or expired token');

  const user = await db.one(
    'SELECT id, nama, username, role, aktif FROM users WHERE id = ?',
    payload.sub
  );
  if (!user) throw err(401, 'invalid_token', 'User not found');
  if (user.aktif !== 1) throw err(403, 'user_inactive', 'Akun dinonaktifkan');

  return {
    user,
    permissions: await loadPagePermissions(db, user.id, user.role),
  };
}

export async function loadPagePermissions(db, userId, role) {
  if (role === 'admin') {
    return {
      dashboard: true, transaksi: true, kasir: true, laporan: true,
      daftar_barang: true, laporan_service_hp: true, kasbon: true,
      pelanggan: true, pengeluaran: true, gaji_karyawan: true, pengaturan: true,
    };
  }
  const rows = await db.many(
    'SELECT halaman FROM user_permissions WHERE user_id = ?',
    userId
  );
  const map = {};
  for (const r of rows) {
    if (r.halaman !== 'gaji_karyawan') map[r.halaman] = true;
  }
  return map;
}

export function requireAuth(ctx) {
  if (!ctx.auth) throw err(401, 'unauthorized', 'Authentication required');
  return ctx.auth;
}

export function requireAdmin(ctx) {
  const { user } = requireAuth(ctx);
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');
  return user;
}

export function requirePage(ctx, halaman) {
  const auth = requireAuth(ctx);
  if (auth.user.role === 'admin') return auth;
  if (auth.permissions[halaman]) return auth;
  throw err(403, 'forbidden', `Akses ke halaman ${halaman} tidak diizinkan`);
}

export function buildCtx(db, env) {
  return { db, env };
}