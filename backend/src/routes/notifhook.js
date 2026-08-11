import { err } from '../lib/errors.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../lib/audit.js';

function loadSettings(rows) {
  const conf = {};
  for (const r of rows) conf[r.key] = r.value;
  return conf;
}

export async function webhookNotifHook(db, request, env) {
  const apiKey = request.headers.get('X-API-Key');
  const conf = loadSettings(await db.many('SELECT key, value FROM settings'));
  const expected = conf.notifhook_api_key_raw || '';
  if (!apiKey || !expected || apiKey !== expected) {
    throw err(401, 'invalid_api_key', 'X-API-Key tidak valid atau belum dikonfigurasi');
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    throw err(400, 'invalid_json', 'Body harus JSON valid');
  }
  if (!payload.idempotency_key || typeof payload.idempotency_key !== 'string' || !payload.idempotency_key.trim()) {
    throw err(400, 'missing_field', 'idempotency_key wajib berupa string');
  }
  const idempotencyKey = payload.idempotency_key;

  const existing = await db.one('SELECT * FROM notifhook_log WHERE idempotency_key = ?', idempotencyKey);
  if (existing) {
    return { status: 'diabaikan', duplicate: true, message: 'Webhook sudah pernah diterima', transaksi_id: existing.transaksi_id };
  }

  const sourceRows = await db.many('SELECT * FROM notifhook_source WHERE enabled = 1');
  const autoInput = conf.notifhook_auto_input === '1' || conf.notifhook_auto_input === 'true';

  let status = 'diterima';
  let transaksiId = null;
  let errorMessage = null;

  if (autoInput && payload.transaksi_kode && typeof payload.transaksi_kode === 'string') {
    const tx = await db.one(
      'SELECT * FROM transaksi WHERE kode_transaksi = ? AND deleted_at IS NULL',
      payload.transaksi_kode
    );
    if (!tx) {
      status = 'gagal';
      errorMessage = `Transaksi ${payload.transaksi_kode} tidak ditemukan`;
    } else if (tx.metode_bayar !== 'transfer') {
      status = 'gagal';
      errorMessage = `Transaksi ${payload.transaksi_kode} bukan metode transfer`;
    } else if (tx.konfirmasi_pembayaran !== 'menunggu') {
      status = 'gagal';
      errorMessage = `Konfirmasi transaksi ${payload.transaksi_kode} sudah ${tx.konfirmasi_pembayaran}`;
    } else {
      await db.exec(
        "UPDATE transaksi SET konfirmasi_pembayaran = 'otomatis', updated_at = ? WHERE id = ?",
        nowIso(), tx.id
      );
      await writeAudit(db, {
        userId: null, aksi: 'notifhook_confirm', tabel: 'transaksi', recordId: tx.id,
        dataAfter: { kode_transaksi: tx.kode_transaksi, idempotency_key: idempotencyKey, metode: 'otomatis' },
      });
      status = 'diproses';
      transaksiId = tx.id;
    }
  }

  await db.exec(
    `INSERT INTO notifhook_log
       (idempotency_key, source_app, payload_raw, status, transaksi_id, error_message, diterima_at, diproses_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    idempotencyKey,
    payload.source_app || null,
    JSON.stringify(payload),
    status,
    transaksiId,
    errorMessage,
    nowIso(),
    status === 'diproses' || status === 'gagal' ? nowIso() : null
  );

  return { status, duplicate: false, transaksi_id: transaksiId, error_message: errorMessage };
}