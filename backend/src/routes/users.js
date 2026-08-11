import { err } from '../lib/errors.js';
import { readBody, asString, asEnum, asInt, asBool } from '../lib/validate.js';
import { requireAdmin } from '../lib/auth.js';
import { hashPassword } from '../lib/password.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

const ALL_HALAMAN = [
  'dashboard', 'transaksi', 'kasir', 'laporan', 'daftar_barang',
  'laporan_service_hp', 'kasbon', 'pelanggan', 'pengeluaran',
  'gaji_karyawan', 'pengaturan',
];

export async function listUsers(db, request, ctx) {
  requireAdmin(ctx);
  const rows = await db.many(`
    SELECT u.id, u.nama, u.username, u.role, u.aktif, u.last_login_at, u.created_at,
           (SELECT GROUP_CONCAT(halaman, ',') FROM user_permissions p WHERE p.user_id = u.id) AS permissions
    FROM users u ORDER BY u.id`);
  return rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    username: r.username,
    role: r.role,
    aktif: r.aktif,
    last_login_at: r.last_login_at,
    created_at: r.created_at,
    permissions: r.permissions ? r.permissions.split(',') : [],
  }));
}

export async function createUser(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  const nama = asString(body.nama, { required: true, field: 'nama', max: 100 });
  const username = asString(body.username, { required: true, field: 'username', max: 50 });
  const password = asString(body.password, { required: true, field: 'password', max: 200 });
  const role = asEnum(body.role, ['admin', 'karyawan'], { required: true, field: 'role' });

  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    throw err(400, 'invalid_value', 'username hanya boleh huruf, angka, titik, underscore, minus');
  }
  if (password.length < 8) throw err(400, 'invalid_value', 'password minimal 8 karakter');

  const dup = await db.one('SELECT id FROM users WHERE username = ?', username);
  if (dup) throw err(409, 'duplicate_username', 'Username sudah dipakai');

  const passwordHash = await hashPassword(password);
  const res = await db.exec(
    'INSERT INTO users (nama, username, password_hash, role, aktif, created_at) VALUES (?, ?, ?, ?, 1, ?)',
    nama, username, passwordHash, role, nowIso()
  );
  const userId = res.lastRowId;

  const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions)] : [];
  await setPermissions(db, userId, role, permissions);

  await writeAudit(db, {
    userId: admin.id, aksi: 'create', tabel: 'users', recordId: userId,
    dataAfter: { nama, username, role, permissions },
  });
  return { id: userId, nama, username, role, aktif: 1, permissions: sanitize(permissions) };
}

export async function updateUser(db, request, ctx, idStr) {
  const admin = requireAdmin(ctx);
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const user = await db.one('SELECT * FROM users WHERE id = ?', id);
  if (!user) throw err(404, 'not_found', 'User tidak ditemukan');

  const nama = asString(body.nama, { field: 'nama', max: 100 });
  const username = asString(body.username, { field: 'username', max: 50 });
  const role = asEnum(body.role, ['admin', 'karyawan'], { field: 'role' });
  const aktif = body.aktif === undefined ? undefined : asBool(body.aktif);

  const sets = [];
  const vals = [];
  if (nama !== null) { sets.push('nama = ?'); vals.push(nama); }
  if (username !== null) {
    if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw err(400, 'invalid_value', 'username tidak valid');
    const dup = await db.one('SELECT id FROM users WHERE username = ? AND id != ?', username, id);
    if (dup) throw err(409, 'duplicate_username', 'Username sudah dipakai');
    sets.push('username = ?'); vals.push(username);
  }
  if (role !== null) { sets.push('role = ?'); vals.push(role); }
  if (aktif !== undefined) { sets.push('aktif = ?'); vals.push(aktif); }
  if (body.password) {
    const password = asString(body.password, { field: 'password', max: 200 });
    if (password.length < 8) throw err(400, 'invalid_value', 'password minimal 8 karakter');
    sets.push('password_hash = ?'); vals.push(await hashPassword(password));
  }
  if (!sets.length) throw err(400, 'no_changes', 'Tidak ada field yang diubah');
  sets.push('updated_at = ?'); vals.push(nowIso());
  vals.push(id);

  if (role !== null && role !== user.role && body.permissions !== undefined) {
    throw err(400, 'invalid_value', 'Jangan kirim permissions bersamaan dengan perubahan role');
  }
  if (body.permissions !== undefined) {
    await setPermissions(db, id, role ?? user.role, [...new Set(body.permissions)]);
  }

  await db.exec(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...vals);
  await writeAudit(db, {
    userId: admin.id, aksi: 'update', tabel: 'users', recordId: id,
    dataBefore: { nama: user.nama, username: user.username, role: user.role, aktif: user.aktif },
    dataAfter: body,
  });
  return { id, message: 'User berhasil diperbarui' };
}

export async function setUserPermissions(db, request, ctx, idStr) {
  const admin = requireAdmin(ctx);
  const id = asInt(idStr, { required: true, field: 'id' });
  const body = await readBody(request);
  const user = await db.one('SELECT id, role FROM users WHERE id = ?', id);
  if (!user) throw err(404, 'not_found', 'User tidak ditemukan');

  const permissions = Array.isArray(body.halaman) ? [...new Set(body.halaman)] : [];
  await setPermissions(db, id, user.role, permissions);
  await writeAudit(db, {
    userId: admin.id, aksi: 'update_permission', tabel: 'user_permissions', recordId: id,
    dataAfter: { user_id: id, halaman: sanitize(permissions) },
  });
  return { id, halaman: sanitize(permissions) };
}

function sanitize(list) {
  return list.filter((h) => h !== 'gaji_karyawan');
}

async function setPermissions(db, userId, role, permissions) {
  const allowed = permissions.filter((h) => ALL_HALAMAN.includes(h));
  if (role === 'karyawan') {
    const forbidden = allowed.filter((h) => h === 'gaji_karyawan');
    if (forbidden.length) {
      throw err(403, 'forbidden_permission', 'Hard rule: role karyawan tidak pernah boleh diberi akses gaji_karyawan');
    }
  }
  await db.exec('DELETE FROM user_permissions WHERE user_id = ?', userId);
  const stmts = allowed.map((h) =>
    db.raw.prepare('INSERT OR IGNORE INTO user_permissions (user_id, halaman, created_at) VALUES (?, ?, ?)')
      .bind(userId, h, nowIso())
  );
  if (stmts.length) await db.batch(stmts);
}