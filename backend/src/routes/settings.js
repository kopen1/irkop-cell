import { err } from '../lib/errors.js';
import { readBody } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';
import { requireAdmin } from '../lib/auth.js';
import { randomToken } from '../lib/password.js';

export async function getSettings(db, request, ctx) {
  requireAdmin(ctx);
  const rows = await db.many('SELECT key, value, updated_at FROM settings ORDER BY key');
  const conf = {};
  for (const r of rows) conf[r.key] = r.value;

  const sources = await db.many('SELECT * FROM notifhook_source ORDER BY id');
  const lastLog = await db.one('SELECT diterima_at, status FROM notifhook_log ORDER BY id DESC LIMIT 1');
  const apiKey = conf.notifhook_api_key_raw;
  return {
    ...conf,
    waktu_server: nowIso(),
    notifhook: {
      auto_input: conf.notifhook_auto_input === '1' || conf.notifhook_auto_input === 'true',
      endpoint: '/api/notifhook',
      api_key: apiKey || null,
      api_key_generate_hint: apiKey ? 'ada' : 'belum di-generate',
      sources,
      kesehatan: {
        toggle: conf.notifhook_auto_input === '1' || conf.notifhook_auto_input === 'true',
        terakhir_terima: lastLog ? lastLog.diterima_at : null,
        status_terakhir: lastLog ? lastLog.status : null,
      },
    },
  };
}

export async function updateSettings(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  if (body && typeof body === 'object') {
    const allowed = new Set(['app_timezone', 'default_theme', 'nama_website', 'notifhook_auto_input', 'theme']);
    for (const [k, v] of Object.entries(body)) {
      if (!allowed.has(k)) throw err(400, 'invalid_setting', `Setting '${k}' tidak diizinkan`);
      const val = typeof v === 'boolean' ? (v ? '1' : '0') : String(v);
      await db.exec(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        k, val, nowIso()
      );
    }
    await writeAudit(db, { userId: admin.id, aksi: 'update', tabel: 'settings', recordId: 'settings', dataAfter: body });
  }
  return getSettings(db, request, ctx);
}

export async function generateNotifhookKey(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const key = `irk_${randomToken(32)}`;
  await db.exec(
    `INSERT INTO settings (key, value, updated_at) VALUES ('notifhook_api_key_raw', ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    key, nowIso()
  );
  await writeAudit(db, { userId: admin.id, aksi: 'generate_api_key', tabel: 'settings', recordId: 'notifhook_api_key' });
  return { api_key: key, message: 'API key NotifHook di-generate. Simpan dengan aman.' };
}

export async function upsertNotifhookSource(db, request, ctx) {
  const admin = requireAdmin(ctx);
  const body = await readBody(request);
  const sourceName = String(body.source_name || '').trim();
  const matcherType = body.matcher_type;
  const matcherValue = String(body.matcher_value || '').trim();
  if (!sourceName) throw err(400, 'missing_field', 'source_name wajib diisi');
  if (!['package_name', 'custom_rule'].includes(matcherType)) {
    throw err(400, 'invalid_value', 'matcher_type harus package_name atau custom_rule');
  }
  if (!matcherValue) throw err(400, 'missing_field', 'matcher_value wajib diisi');
  const enabled = body.enabled === undefined ? 1 : (body.enabled === true || body.enabled === 1 || body.enabled === '1' ? 1 : 0);
  const existing = await db.one('SELECT id FROM notifhook_source WHERE source_name = ?', sourceName);
  if (existing) {
    await db.exec(
      'UPDATE notifhook_source SET matcher_type = ?, matcher_value = ?, enabled = ?, updated_at = ? WHERE id = ?',
      matcherType, matcherValue, enabled, nowIso(), existing.id
    );
  } else {
    await db.exec(
      'INSERT INTO notifhook_source (source_name, enabled, matcher_type, matcher_value, created_at) VALUES (?, ?, ?, ?, ?)',
      sourceName, enabled, matcherType, matcherValue, nowIso()
    );
  }
  await writeAudit(db, { userId: admin.id, aksi: 'update', tabel: 'notifhook_source', recordId: sourceName, dataAfter: { source_name: sourceName, matcher_type: matcherType, matcher_value: matcherValue, enabled } });
  return { source_name: sourceName, enabled, matcher_type: matcherType, matcher_value: matcherValue };
}