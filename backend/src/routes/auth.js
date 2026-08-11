import { verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { readBody } from '../lib/validate.js';
import { err } from '../lib/errors.js';
import { requireAuth, loadPagePermissions } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

export async function login(db, request, env) {
  const body = await readBody(request);
  if (!body.username || !body.password) {
    throw err(400, 'missing_field', 'username dan password wajib diisi');
  }
  const user = await db.one('SELECT * FROM users WHERE username = ?', String(body.username).trim());
  if (!user) throw err(401, 'invalid_credentials', 'Username atau password salah');
  if (user.aktif !== 1) throw err(403, 'user_inactive', 'Akun dinonaktifkan');

  const ok = await verifyPassword(String(body.password), user.password_hash);
  if (!ok) throw err(401, 'invalid_credentials', 'Username atau password salah');

  const token = await signToken(
    { sub: user.id, role: user.role, nama: user.nama },
    env.JWT_SECRET,
    Number(env.TOKEN_TTL || 2592000)
  );

  await db.exec('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), user.id);
  await writeAudit(db, { userId: user.id, aksi: 'login', tabel: 'users', recordId: user.id });

  const permissions = await loadPagePermissions(db, user.id, user.role);
  return {
    token,
    user: {
      id: user.id,
      nama: user.nama,
      username: user.username,
      role: user.role,
      permissions,
    },
  };
}

export async function logout(db, request, ctx) {
  const auth = requireAuth(ctx);
  await writeAudit(db, { userId: auth.user.id, aksi: 'logout', tabel: 'users', recordId: auth.user.id });
  return { success: true, message: 'Logout berhasil; token dibuang oleh klien (JWT stateless)' };
}

export async function me(db, request, ctx) {
  const auth = requireAuth(ctx);
  return {
    user: {
      id: auth.user.id,
      nama: auth.user.nama,
      username: auth.user.username,
      role: auth.user.role,
      permissions: auth.permissions,
    },
  };
}