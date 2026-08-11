import { verifyPassword, hashPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { readBody, asString, asEnum } from '../lib/validate.js';
import { err } from '../lib/errors.js';
import { requireAuth, loadPagePermissions } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

const BOOTSTRAP_HEADER = 'x-bootstrap-secret';

function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

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

export async function bootstrapFirstAdmin(db, request, env) {
  const configured = env.BOOTSTRAP_SECRET;
  if (!configured) {
    throw err(503, 'bootstrap_not_configured', 'BOOTSTRAP_SECRET belum dikonfigurasi');
  }
  const provided = request.headers.get(BOOTSTRAP_HEADER) || '';
  if (!safeEqual(provided, configured)) {
    throw err(403, 'invalid_bootstrap_secret', 'Bootstrap secret tidak valid');
  }

  const body = await readBody(request);
  const nama = asString(body.nama, { required: true, field: 'nama', max: 100 });
  const username = asString(body.username, { required: true, field: 'username', max: 50 });
  const password = asString(body.password, { required: true, field: 'password', max: 200 });
  const role = asEnum(body.role, ['admin'], { required: false, field: 'role', defaultVal: 'admin' });

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    throw err(400, 'invalid_value', 'username hanya boleh huruf, angka, titik, underscore, minus');
  }
  if (password.length < 8) throw err(400, 'invalid_value', 'password minimal 8 karakter');

  const passwordHash = await hashPassword(password);
  const res = await db.exec(
    `INSERT INTO users (nama, username, password_hash, role, aktif, created_at)
     SELECT ?, ?, ?, ?, 1, ?
     WHERE NOT EXISTS (SELECT 1 FROM users)`,
    nama, username, passwordHash, role, nowIso()
  );
  if (res.changes !== 1) {
    throw err(409, 'bootstrap_done', 'Admin sudah ada; bootstrap tidak tersedia lagi');
  }
  const userId = res.lastRowId;
  if (userId === null || userId === undefined) {
    throw err(500, 'internal', 'Gagal membuat admin pertama');
  }

  await writeAudit(db, {
    userId,
    aksi: 'bootstrap',
    tabel: 'users',
    recordId: userId,
    dataAfter: { nama, username, role },
  });

  return {
    message: 'Admin pertama berhasil dibuat; silakan login',
    user: {
      id: userId,
      nama,
      username,
      role,
      permissions: await loadPagePermissions(db, userId, role),
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