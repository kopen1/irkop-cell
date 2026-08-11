import { err } from '../lib/errors.js';
import { nowIso, wibDateToday, isValidCalendarDate } from '../lib/time.js';

function resolveTanggalTransaksi(body) {
  const t = body.tanggal_transaksi || wibDateToday();
  if (!isValidCalendarDate(t)) {
    throw err(400, 'invalid_value', 'tanggal_transaksi harus format YYYY-MM-DD');
  }
  if (t > wibDateToday()) {
    throw err(400, 'invalid_value', 'tanggal_transaksi tidak boleh di masa depan');
  }
  return t;
}
import { reverseFullSource } from '../financial/reversal.js';
import { getAccount } from '../financial/akun.js';
import { requireOpenSession } from '../financial/kasir.js';
import { writeAudit } from '../lib/audit.js';

function buildListWhere(url, params) {
  const where = ['t.deleted_at IS NULL'];
  const bind = [];
  if (params.has('date')) {
    if (params.has('date_from') || params.has('date_to')) {
      throw err(400, 'invalid_filter', 'date tidak boleh digabung dengan date_from/date_to');
    }
    const d = params.get('date');
    if (!isValidCalendarDate(d)) throw err(400, 'invalid_filter', 'date harus format YYYY-MM-DD');
    where.push('t.tanggal_transaksi = ?');
    bind.push(d);
  } else if (params.has('date_from') || params.has('date_to')) {
    const df = params.get('date_from');
    const dt = params.get('date_to');
    if (!df || !dt) throw err(400, 'invalid_filter', 'date_from dan date_to wajib diisi bersamaan');
    if (!isValidCalendarDate(df) || !isValidCalendarDate(dt)) {
      throw err(400, 'invalid_filter', 'date_from/date_to harus format YYYY-MM-DD');
    }
    if (df > dt) throw err(400, 'invalid_filter', 'date_from tidak boleh setelah date_to');
    where.push('t.tanggal_transaksi >= ? AND t.tanggal_transaksi <= ?');
    bind.push(df, dt);
  }
  if (params.has('pelanggan_id')) {
    where.push('t.pelanggan_id = ?');
    bind.push(Number(params.get('pelanggan_id')));
  }
  if (params.has('metode_bayar')) {
    const m = params.get('metode_bayar');
    if (!['tunai', 'transfer', 'bon', 'cash_tunai'].includes(m)) throw err(400, 'invalid_filter', 'metode_bayar tidak valid');
    where.push('t.metode_bayar = ?');
    bind.push(m);
  }
  if (params.has('status_konfirmasi')) {
    const s = params.get('status_konfirmasi');
    if (!['tidak_perlu', 'menunggu', 'otomatis', 'manual'].includes(s)) throw err(400, 'invalid_filter', 'status_konfirmasi tidak valid');
    where.push('t.konfirmasi_pembayaran = ?');
    bind.push(s);
  }
  const q = params.get('q');
  if (q && q.trim()) {
    const like = `%${q.trim()}%`;
    where.push(`(
      t.kode_transaksi LIKE ? OR
      EXISTS (SELECT 1 FROM transaksi_item ti WHERE ti.transaksi_id = t.id AND ti.nama_produk_snapshot LIKE ?) OR
      EXISTS (SELECT 1 FROM pelanggan pl WHERE pl.id = t.pelanggan_id AND pl.nama LIKE ?)
    )`);
    bind.push(like, like, like);
  }
  return { where: where.join(' AND '), bind };
}

export async function listTransaksi(db, request, ctx) {
  const url = new URL(request.url);
  const { where, bind } = buildListWhere(url, url.searchParams);

  const count = await db.one(
    `SELECT COUNT(*) AS total_items, COALESCE(SUM(t.total), 0) AS total_nilai
       FROM transaksi t WHERE ${where}`,
    ...bind
  );

  const limit = Math.min(Number(url.searchParams.get('limit') || '100'), 200);
  const offset = Math.max(Number(url.searchParams.get('offset') || '0'), 0);

  const rows = await db.many(
    `SELECT t.*, u.nama AS dibuat_oleh_nama, p.nama AS pelanggan_nama
       FROM transaksi t
       LEFT JOIN users u ON u.id = t.dibuat_oleh
       LEFT JOIN pelanggan p ON p.id = t.pelanggan_id
      WHERE ${where} ORDER BY t.tanggal_transaksi DESC, t.id DESC LIMIT ? OFFSET ?`,
    ...[...bind, limit, offset]
  );

  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.many(
        `SELECT * FROM transaksi_item WHERE transaksi_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
        ...ids
      )
    : [];
  const itemMap = {};
  for (const it of items) {
    (itemMap[it.transaksi_id] = itemMap[it.transaksi_id] || []).push(it);
  }

  return {
    items: rows.map((r) => ({
      id: r.kode_transaksi,
      transaksi_id: r.id,
      created_at: r.created_at,
      tanggal_transaksi: r.tanggal_transaksi,
      pelanggan_id: r.pelanggan_id,
      pelanggan_nama: r.pelanggan_nama,
      metode_bayar: r.metode_bayar,
      konfirmasi_pembayaran: r.konfirmasi_pembayaran,
      subtotal: r.subtotal,
      diskon: r.diskon,
      total: r.total,
      laba: r.laba,
      manual_entry: r.manual_entry,
      dibuat_oleh: r.dibuat_oleh_nama,
      items: itemMap[r.id] || [],
    })),
    total_items: count.total_items,
    total_nilai: count.total_nilai,
    filter: {
      date: url.searchParams.get('date'),
      date_from: url.searchParams.get('date_from'),
      date_to: url.searchParams.get('date_to'),
      q: url.searchParams.get('q'),
      pelanggan_id: url.searchParams.get('pelanggan_id'),
      metode_bayar: url.searchParams.get('metode_bayar'),
      status_konfirmasi: url.searchParams.get('status_konfirmasi'),
    },
  };
}

async function findTransaksiByRef(db, ref) {
  const num = Number(ref);
  if (Number.isInteger(num)) {
    const row = await db.one('SELECT * FROM transaksi WHERE id = ?', num);
    if (row) return row;
  }
  return db.one('SELECT * FROM transaksi WHERE kode_transaksi = ?', String(ref));
}

export async function getTransaksi(db, request, ctx, idStr) {
  const t = await findTransaksiByRef(db, idStr);
  if (!t || t.deleted_at) throw err(404, 'not_found', 'Transaksi tidak ditemukan');
  const info = await db.one(
    `SELECT u.nama AS dibuat_oleh_nama, p.nama AS pelanggan_nama
       FROM transaksi tt
       LEFT JOIN users u ON u.id = tt.dibuat_oleh
       LEFT JOIN pelanggan p ON p.id = tt.pelanggan_id
      WHERE tt.id = ?`,
    t.id
  );
  const items = await db.many('SELECT * FROM transaksi_item WHERE transaksi_id = ? ORDER BY id', t.id);
  const mutasi = await db.many(
    "SELECT id, nama_akun, jumlah, sumber_tipe, mutation_key, created_at FROM mutasi_saldo WHERE sumber_tipe = 'transaksi' AND sumber_id = ?",
    t.id
  );
  return {
    id: t.kode_transaksi,
    transaksi_id: t.id,
    created_at: t.created_at,
    tanggal_transaksi: t.tanggal_transaksi,
    pelanggan_id: t.pelanggan_id,
    pelanggan_nama: info?.pelanggan_nama ?? null,
    metode_bayar: t.metode_bayar,
    konfirmasi_pembayaran: t.konfirmasi_pembayaran,
    subtotal: t.subtotal,
    diskon: t.diskon,
    total: t.total,
    laba: t.laba,
    manual_entry: t.manual_entry,
    kasir_sesi_id: t.kasir_sesi_id,
    dibuat_oleh: info?.dibuat_oleh_nama ?? null,
    items,
    mutasi_saldo: mutasi,
  };
}

export async function generateTransaksiKode(db, date, attempts = 3, excludeId = null) {
  const excl = excludeId ? 'AND id != ?' : '';
  const row = await db.one(
    `SELECT COUNT(*) AS n FROM transaksi WHERE tanggal_transaksi = ? AND deleted_at IS NULL ${excl}`,
    ...[date, ...(excludeId ? [excludeId] : [])]
  );
  const base = Number(row.n);
  for (let i = 0; i < attempts; i += 1) {
    const seq = String(base + 1 + i).padStart(3, '0');
    const kode = `TX-${date.replace(/-/g, '')}-${seq}`;
    const dup = await db.one(
      'SELECT id FROM transaksi WHERE kode_transaksi = ? AND id != ?',
      kode,
      excludeId || 0
    );
    if (!dup) return kode;
  }
  throw err(500, 'kode_conflict', 'Gagal membuat kode transaksi yang unik');
}

async function loadProducts(db, items) {
  const out = new Map();
  for (const it of items) {
    if (!it || !it.produk_id) throw err(400, 'missing_field', 'setiap item wajib punya produk_id');
    const prod = await db.one('SELECT * FROM produk WHERE id = ?', it.produk_id);
    if (!prod) throw err(400, 'invalid_product', `Produk id ${it.produk_id} tidak ditemukan`);
    if (prod.deleted_at) throw err(400, 'invalid_product', `Produk ${prod.nama} sudah dihapus`);
    out.set(String(prod.id), prod);
  }
  return out;
}

function computeItems(items, produkMap) {
  let subtotal = 0;
  let laba = 0;
  const itemRows = [];
  const effects = { tunai: 0, akun: new Map() };

  for (const it of items) {
    const prod = produkMap.get(String(it.produk_id));
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1) throw err(400, 'invalid_value', `qty item ${prod.nama} harus integer >= 1`);
    const harga = Number(prod.harga);
    const modal = prod.harga_modal == null ? 0 : Number(prod.harga_modal);
    subtotal += harga * qty;
    laba += (harga - modal) * qty;

    const nominalRef = it.nominal_referensi == null ? null : Number(it.nominal_referensi);
    const akunSumber = it.akun_sumber || null;
    let validatedAkun = null;
    if (nominalRef !== null && nominalRef !== 0 && nominalRef !== undefined) {
      if (!Number.isInteger(nominalRef) || nominalRef < 1) {
        throw err(400, 'invalid_value', 'nominal_referensi harus integer >= 1');
      }
      if (!akunSumber) throw err(400, 'missing_field', 'item kirim uang wajib memiliki akun_sumber');
      validatedAkun = akunSumber;
    }

    itemRows.push({
      produk_id: prod.id,
      nama: prod.nama,
      harga,
      harga_modal: prod.harga_modal,
      qty,
      subtotal: harga * qty,
      nominal_referensi: nominalRef,
      akun_sumber: validatedAkun,
    });
  }

  return { subtotal, total: subtotal, laba, itemRows };
}

function planMutations({ metodeBayar, akunPenerima, total, effects }) {
  const list = [];
  if (metodeBayar === 'tunai') {
    list.push({ nama_akun: 'Tunai Laci', jumlah: total });
  } else if (metodeBayar === 'cash_tunai') {
    list.push({ nama_akun: 'Tunai Laci', jumlah: total });
  } else if (metodeBayar === 'transfer') {
    list.push({ nama_akun: akunPenerima, jumlah: total });
  }
  if (effects.tunai !== 0) list.push({ nama_akun: 'Tunai Laci', jumlah: effects.tunai });
  for (const [akun, jml] of effects.akun) {
    if (jml !== 0) list.push({ nama_akun: akun, jumlah: jml });
  }
  return list;
}

async function validatedAccountNames(db, plan, body) {
  const names = new Set();
  for (const m of plan) names.add(m.nama_akun);
  if (body.akun_penerima) names.add(body.akun_penerima);
  const out = {};
  for (const n of names) out[n] = (await getAccount(db, n)).nama_akun;
  return out;
}

async function findExistingByIdempotencyKey(db, idKey, plan) {
  for (const m of plan) {
    const row = await db.one(
      'SELECT sumber_id FROM mutasi_saldo WHERE mutation_key = ?',
      `req:${idKey}:transaksi:${m.nama_akun}`
    );
    if (row && row.sumber_id) {
      return db.one('SELECT * FROM transaksi WHERE id = ?', row.sumber_id);
    }
  }
  return null;
}

async function writeTransaksiAudit(db, user, tx, aksi = 'create', before = null, after = null) {
  await writeAudit(db, {
    userId: user.id,
    aksi,
    tabel: 'transaksi',
    recordId: tx.id,
    dataBefore: before,
    dataAfter: after || { kode_transaksi: tx.kode_transaksi, total: tx.total, metode_bayar: tx.metode_bayar, konfirmasi_pembayaran: tx.konfirmasi_pembayaran },
  });
}

export async function createTransaksi(db, body, ctx, request) {
  const { user } = ctx.auth;
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw err(400, 'missing_field', 'items wajib diisi minimal 1 produk');
  }
  const metodeBayar = body.metode_bayar;
  if (!['tunai', 'transfer', 'bon', 'cash_tunai'].includes(metodeBayar)) {
    throw err(400, 'invalid_value', 'metode_bayar tidak valid');
  }
  if (body.pelanggan_id) {
    const p = await db.one('SELECT id FROM pelanggan WHERE id = ?', body.pelanggan_id);
    if (!p) throw err(400, 'invalid_pelanggan', 'Pelanggan tidak ditemukan');
  }

  const sesi = await requireOpenSession(db);
  const produkMap = await loadProducts(db, body.items);
  const { total, laba, itemRows } = computeItems(body.items, produkMap);

  let akunPenerima = null;
  if (metodeBayar === 'transfer') {
    if (!body.akun_penerima) throw err(400, 'missing_field', 'Metode transfer wajib menyertakan akun_penerima');
    akunPenerima = (await getAccount(db, body.akun_penerima)).nama_akun;
  }

  const plan = planMutations({ metodeBayar, akunPenerima, total, effects: effBody(itemRows) });
  await validatedAccountNames(db, plan, body);

  const idempotencyKey = request.headers.get('Idempotency-Key') || null;
  if (idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(db, idempotencyKey, plan);
    if (existing) {
      return { id: existing.kode_transaksi, total: existing.total, status: 'sukses', konfirmasi_pembayaran: existing.konfirmasi_pembayaran, created_at: existing.created_at, duplicate: true };
    }
  }

  const tanggalTx = resolveTanggalTransaksi(body);
  const kode = await generateTransaksiKode(db, tanggalTx);
  const now = nowIso();
  const konfirmasi = metodeBayar === 'transfer' ? 'menunggu' : 'tidak_perlu';

  const stmts = [
    db.raw.prepare(
      `INSERT INTO transaksi
        (kode_transaksi, pelanggan_id, metode_bayar, konfirmasi_pembayaran, subtotal, diskon, total,
         laba, kasir_sesi_id, dibuat_oleh, manual_entry, tanggal_transaksi, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(kode, body.pelanggan_id || null, metodeBayar, konfirmasi, total, total, laba, sesi.id, user.id, body.manual_entry === true || body.manual_entry === 1 ? 1 : 0, tanggalTx, now),
  ];

  for (const it of itemRows) {
    stmts.push(
      db.raw.prepare(
        `INSERT INTO transaksi_item
          (transaksi_id, produk_id, nama_produk_snapshot, harga_snapshot, harga_modal_snapshot, qty, subtotal, nominal_referensi, akun_sumber)
         VALUES ((SELECT max(id) FROM transaksi), ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(it.produk_id, it.nama, it.harga, it.harga_modal, it.qty, it.subtotal, it.nominal_referensi, it.akun_sumber)
    );
  }

  plan.forEach((m, idx) => {
    const mutationKey = idempotencyKey
      ? `req:${idempotencyKey}:transaksi:${m.nama_akun}`
      : `transaksi:${kode}:${m.nama_akun}:${idx}`;
    stmts.push(
      db.raw.prepare(
        `INSERT OR IGNORE INTO mutasi_saldo
           (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
         VALUES (?, ?, ?, 'transaksi', (SELECT max(id) FROM transaksi), ?, ?)`
      ).bind(sesi.id, m.nama_akun, m.jumlah, mutationKey, now)
    );
  });

  if (metodeBayar === 'bon') {
    stmts.push(
      db.raw.prepare(
        `INSERT INTO kasbon (pelanggan_id, transaksi_id, nominal, status, tanggal, dicatat_oleh)
         VALUES (?, (SELECT max(id) FROM transaksi), ?, 'belum_lunas', ?, ?)`
      ).bind(body.pelanggan_id || null, total, tanggalTx, user.id)
    );
  }

  const { results } = await db.batch(stmts);
  if (!results.every((r) => r.success)) throw err(500, 'tx_failed', 'Gagal menyimpan transaksi');

  const saved = await db.one('SELECT * FROM transaksi WHERE kode_transaksi = ?', kode);
  await writeTransaksiAudit(db, user, saved);
  return { id: saved.kode_transaksi, total: saved.total, status: 'sukses', konfirmasi_pembayaran: saved.konfirmasi_pembayaran, created_at: saved.created_at, duplicate: false };
}

function effBody(itemRows) {
  const effects = { tunai: 0, akun: new Map() };
  for (const it of itemRows) {
    if (it.nominal_referensi != null && it.nominal_referensi !== 0 && it.akun_sumber) {
      effects.tunai += it.nominal_referensi + it.harga * it.qty;
      effects.akun.set(it.akun_sumber, (effects.akun.get(it.akun_sumber) || 0) - it.nominal_referensi);
    }
  }
  return effects;
}

export async function softDeleteTransaksi(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const tx = await findTransaksiByRef(db, idStr);
  if (!tx) throw err(404, 'not_found', 'Transaksi tidak ditemukan');
  if (tx.deleted_at) throw err(409, 'already_deleted', 'Transaksi sudah dihapus');

  const reason = body.deleted_reason || 'manual soft-delete';
  const sesi = await requireOpenSession(db);
  const actionKey = ctx.idempotencyKey || `del-${tx.id}-${Date.now()}`;

  const reversalResult = await reverseFullSource(db, {
    sumberTipe: 'transaksi', sumberId: tx.id, kasirSesiId: sesi.id, actionKey,
  });

  await db.exec(
    'UPDATE transaksi SET deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ? WHERE id = ?',
    nowIso(), user.id, reason, nowIso(), tx.id
  );
  await writeAudit(db, {
    userId: user.id, aksi: 'soft_delete', tabel: 'transaksi', recordId: tx.id,
    dataBefore: { kode_transaksi: tx.kode_transaksi, total: tx.total, metode_bayar: tx.metode_bayar },
    dataAfter: { deleted_reason: reason, reversal: reversalResult },
  });
  return { id: tx.kode_transaksi, status: 'soft_deleted', reversal: reversalResult };
}

export async function updateTransaksi(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const tx = await findTransaksiByRef(db, idStr);
  if (!tx) throw err(404, 'not_found', 'Transaksi tidak ditemukan');
  if (tx.deleted_at) throw err(409, 'already_deleted', 'Transaksi sudah dihapus');

  const metodeBayar = tx.metode_bayar;
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw err(400, 'missing_field', 'items wajib diisi minimal 1 produk');
  }
  const sesi = await requireOpenSession(db);
  const actionKey = ctx.idempotencyKey || `upd-${tx.id}-${Date.now()}`;

  const produkMap = await loadProducts(db, body.items);
  const { total, laba, itemRows } = computeItems(body.items, produkMap);

  let akunPenerima = null;
  if (metodeBayar === 'transfer') {
    if (!body.akun_penerima) throw err(400, 'missing_field', 'Metode transfer wajib menyertakan akun_penerima');
    akunPenerima = (await getAccount(db, body.akun_penerima)).nama_akun;
  }

  await reverseFullSource(db, { sumberTipe: 'transaksi', sumberId: tx.id, kasirSesiId: sesi.id, actionKey });

  const plan = planMutations({ metodeBayar, akunPenerima, total, effects: effBody(itemRows) });
  await validatedAccountNames(db, plan, body);

  const now = nowIso();
  let tanggalTx = tx.tanggal_transaksi;
  let kode = tx.kode_transaksi;
  if (body.tanggal_transaksi !== undefined && body.tanggal_transaksi !== tx.tanggal_transaksi) {
    tanggalTx = resolveTanggalTransaksi(body);
    kode = await generateTransaksiKode(db, tanggalTx, 3, tx.id);
  }

  const stmts = [
    db.raw.prepare(
      'UPDATE transaksi SET subtotal = ?, total = ?, laba = ?, pelanggan_id = ?, tanggal_transaksi = ?, kode_transaksi = ?, updated_at = ? WHERE id = ?'
    ).bind(total, total, laba, body.pelanggan_id || null, tanggalTx, kode, now, tx.id),
    db.raw.prepare('DELETE FROM transaksi_item WHERE transaksi_id = ?').bind(tx.id),
  ];
  for (const it of itemRows) {
    stmts.push(
      db.raw.prepare(
        `INSERT INTO transaksi_item
          (transaksi_id, produk_id, nama_produk_snapshot, harga_snapshot, harga_modal_snapshot, qty, subtotal, nominal_referensi, akun_sumber)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(tx.id, it.produk_id, it.nama, it.harga, it.harga_modal, it.qty, it.subtotal, it.nominal_referensi, it.akun_sumber)
    );
  }
  plan.forEach((m, idx) => {
    const mutationKey = `transaksi:${tx.kode_transaksi}:${m.nama_akun}:v:${actionKey}:${idx}`;
    stmts.push(
      db.raw.prepare(
        `INSERT OR IGNORE INTO mutasi_saldo
           (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
         VALUES (?, ?, ?, 'transaksi', ?, ?, ?)`
      ).bind(sesi.id, m.nama_akun, m.jumlah, tx.id, mutationKey, now)
    );
  });
  const { results } = await db.batch(stmts);
  if (metodeBayar === 'bon' && tanggalTx !== tx.tanggal_transaksi) {
    await db.exec('UPDATE kasbon SET tanggal = ? WHERE transaksi_id = ?', tanggalTx, tx.id);
  }
  if (!results.every((r) => r.success)) throw err(500, 'tx_update_failed', 'Gagal memperbarui transaksi');

  const saved = await db.one('SELECT * FROM transaksi WHERE id = ?', tx.id);
  await writeAudit(db, {
    userId: user.id, aksi: 'update', tabel: 'transaksi', recordId: tx.id,
    dataBefore: { kode_transaksi: tx.kode_transaksi, total: tx.total },
    dataAfter: { total: saved.total, action_key: actionKey },
  });
  return { id: saved.kode_transaksi, total: saved.total, status: 'sukses', action_key: actionKey };
}