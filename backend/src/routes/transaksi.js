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
import { hitungAdmin, normalizeProvider } from '../financial/tarif.js';
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
      jenis: r.jenis ?? null,
      admin_type: r.admin_type ?? null,
      mitra: r.mitra ?? null,
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
    "SELECT id, nama_akun, jumlah, sumber_tipe, mutation_key, kategori, created_at FROM mutasi_saldo WHERE sumber_tipe = 'transaksi' AND sumber_id = ?",
    t.id
  );
  const pembayaran = await db.many(
    'SELECT id, metode, akun_id, nominal FROM transaksi_pembayaran WHERE transaksi_id = ? ORDER BY id',
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
    jenis: t.jenis ?? null,
    admin_type: t.admin_type ?? null,
    mitra: t.mitra ?? null,
    subtotal: t.subtotal,
    diskon: t.diskon,
    total: t.total,
    laba: t.laba,
    manual_entry: t.manual_entry,
    kasir_sesi_id: t.kasir_sesi_id,
    dibuat_oleh: info?.dibuat_oleh_nama ?? null,
    items,
    pembayaran,
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
    const prod = await db.one(
      'SELECT p.*, k.nama AS kategori_nama FROM produk p LEFT JOIN kategori_produk k ON k.id = p.kategori_id WHERE p.id = ?',
      it.produk_id
    );
    if (!prod) throw err(400, 'invalid_product', `Produk id ${it.produk_id} tidak ditemukan`);
    if (prod.deleted_at) throw err(400, 'invalid_product', `Produk ${prod.nama} sudah dihapus`);
    out.set(String(prod.id), prod);
  }
  return out;
}

// Arah mutasi kirim-uang diturunkan dari nama kategori produk:
// - "Tarik ..." (Tarik Tunai): pelanggan kirim saldo ke kita → saldo akun NAMBAH, laci KELUAR.
// - lainnya (Transfer/Saldo/Kirim Uang/dst.): kita kirim saldo → saldo akun KURANG, laci MASUK.
const TARIK_KATEGORI = /tarik/i;

// Gabungkan entri plan dengan akun yang sama. Wajib: dengan Idempotency-Key,
// mutation_key hanya per nama_akun, sehingga entri duplikat akan di-drop oleh
// INSERT OR IGNORE (bug: nominal kirim uang hilang dari Tunai Laci).
function mergePlan(plan) {
  const out = [];
  for (const m of plan) {
    const ex = out.find((x) => x.nama_akun === m.nama_akun);
    if (ex) ex.jumlah += m.jumlah;
    else out.push({ ...m });
  }
  return out.filter((m) => m.jumlah !== 0);
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
      // Tarik tunai: delta negatif (laci keluar, saldo akun bertambah);
      // kirim uang/transfer/saldo: delta positif (laci masuk, saldo akun berkurang).
      const delta = TARIK_KATEGORI.test(prod.kategori_nama || '') ? -nominalRef : nominalRef;
      effects.tunai += delta;
      effects.akun.set(validatedAkun, (effects.akun.get(validatedAkun) || 0) - delta);
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

  return { subtotal, total: subtotal, laba, itemRows, effects };
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
  return mergePlan(list);
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
  const jenis = body.jenis || null;
  if (jenis === 'tariktunai' || jenis === 'transfer') {
    return createAdminTransaksi(db, body, ctx, request, jenis);
  }
  return createProductTransaksi(db, body, ctx, request, jenis);
}

// Mutasi: setiap elemen { nama_akun, jumlah, kategori? }
function insertMutationsStmts(db, sesi, kode, plan, idempotencyKey, now) {
  return plan.map((m, idx) => {
    const mutationKey = idempotencyKey
      ? `req:${idempotencyKey}:transaksi:${m.nama_akun}`
      : `transaksi:${kode}:${m.nama_akun}:${idx}`;
    return db.raw.prepare(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
       VALUES (?, ?, ?, 'transaksi', (SELECT max(id) FROM transaksi), ?, ?, ?)`
    ).bind(sesi.id, m.nama_akun, m.jumlah, mutationKey, m.kategori || null, now);
  });
}

// TARIK TUNAI / TRANSFER (R6) — tidak pakai item produk.
// paymentAkun = akun uang dari akun_master (default 'Tunai Laci') yang
// menerima/mengeluarkan dana; accountName = akun provider (mitra) yang di-mutasi.
function buildAdminPlan(jenis, adminType, nominal, admin, accountName, paymentAkun = 'Tunai Laci') {
  const plan = [];
  if (jenis === 'transfer') {
    plan.push({ nama_akun: accountName, jumlah: -nominal, kategori: 'saldo_akun' });
    plan.push({ nama_akun: paymentAkun, jumlah: nominal + admin, kategori: 'pendapatan' });
    plan.push({ nama_akun: 'Laba', jumlah: admin, kategori: 'pendapatan_admin' });
  } else {
    if (adminType === 'dalam') {
      plan.push({ nama_akun: accountName, jumlah: nominal + admin, kategori: 'saldo_akun' });
      plan.push({ nama_akun: paymentAkun, jumlah: -nominal, kategori: 'pengeluaran' });
    } else {
      plan.push({ nama_akun: accountName, jumlah: nominal, kategori: 'saldo_akun' });
      plan.push({ nama_akun: paymentAkun, jumlah: -(nominal - admin), kategori: 'pengeluaran' });
    }
    plan.push({ nama_akun: 'Laba', jumlah: admin, kategori: 'pendapatan_admin' });
  }
  return plan;
}

async function createAdminTransaksi(db, body, ctx, request, jenis) {
  const { user } = ctx.auth;
  const nominal = Number(body.nominal);
  if (!Number.isInteger(nominal) || nominal < 1) {
    throw err(400, 'invalid_value', 'nominal wajib integer >= 1');
  }
  const mitra = normalizeProvider(body.mitra);
  if (!mitra) throw err(400, 'invalid_provider', 'mitra wajib (DANA/BANK/OVO/GOPAY)');
  const accountName = (await getAccount(db, mitra)).nama_akun;

  let adminType = body.admin_type || null;
  if (jenis === 'transfer') {
    if (adminType && adminType !== 'luar') {
      throw err(400, 'invalid_admin_type', 'Transfer selalu menggunakan Admin Luar');
    }
    adminType = 'luar';
  } else if (adminType !== 'dalam' && adminType !== 'luar') {
    throw err(400, 'invalid_admin_type', 'Tarik Tunai butuh admin_type dalam/luar');
  }

  // Metode pembayaran = akun uang dari akun_master (default Tunai Laci).
  let paymentAkun = 'Tunai Laci';
  if (body.metode_pembayaran) {
    const acc = await getAccount(db, body.metode_pembayaran);
    if (acc.tipe === 'lainnya') {
      throw err(400, 'invalid_payment_account', `${acc.nama_akun} bukan akun uang (tipe ${acc.tipe})`);
    }
    paymentAkun = acc.nama_akun;
  }
  if (paymentAkun === accountName) {
    throw err(400, 'invalid_payment_account', 'Akun pembayaran tidak boleh sama dengan akun provider');
  }

  const admin = await hitungAdmin(db, mitra, nominal);
  const sesi = await requireOpenSession(db);
  const idempotencyKey = request.headers.get('Idempotency-Key') || null;
  const tanggalTx = resolveTanggalTransaksi(body);
  const kode = await generateTransaksiKode(db, tanggalTx);
  const now = nowIso();
  const total = jenis === 'transfer' ? nominal + admin : nominal;
  const plan = buildAdminPlan(jenis, adminType, nominal, admin, accountName, paymentAkun);
  await validatedAccountNames(db, plan, body);

  if (idempotencyKey) {
    const existing = await findExistingByIdempotencyKey(db, idempotencyKey, plan);
    if (existing) {
      return {
        id: existing.kode_transaksi, total: existing.total, status: 'sukses',
        konfirmasi_pembayaran: existing.konfirmasi_pembayaran, created_at: existing.created_at,
        duplicate: true, jenis, admin_type: adminType, mitra, admin,
        preview: { saldo_akun: 0, laci: 0, laba: admin, pembayaran_akun: paymentAkun },
      };
    }
  }

  const stmts = [
    db.raw.prepare(
      `INSERT INTO transaksi
        (kode_transaksi, pelanggan_id, metode_bayar, konfirmasi_pembayaran, subtotal, diskon, total,
         laba, kasir_sesi_id, dibuat_oleh, manual_entry, jenis, admin_type, mitra, tanggal_transaksi, created_at)
       VALUES (?, ?, 'cash_tunai', 'tidak_perlu', ?, 0, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`
    ).bind(kode, body.pelanggan_id || null, total, total, admin, sesi.id, user.id, jenis, adminType, mitra, tanggalTx, now),
    ...insertMutationsStmts(db, sesi, kode, plan, idempotencyKey, now),
  ];

  const { results } = await db.batch(stmts);
  if (!results.every((r) => r.success)) throw err(500, 'tx_failed', 'Gagal menyimpan transaksi');

  const saved = await db.one('SELECT * FROM transaksi WHERE kode_transaksi = ?', kode);

  // Idempotency race: a concurrent twin with the same Idempotency-Key may have
  // committed first, so its mutation_keys (UNIQUE) caused our mutations to be
  // OR IGNORE'd -> our transaksi would be a phantom with 0 mutations. Roll it
  // back and return the twin instead (sequential retries are already caught above).
  if (idempotencyKey) {
    const ins = await db.one(
      "SELECT COUNT(*) AS n FROM mutasi_saldo WHERE sumber_tipe = 'transaksi' AND sumber_id = ?",
      saved.id
    );
    if (Number(ins.n) === 0) {
      const existing = await findExistingByIdempotencyKey(db, idempotencyKey, plan);
      if (existing) {
        await db.exec('DELETE FROM transaksi WHERE id = ?', saved.id);
        return {
          id: existing.kode_transaksi, total: existing.total, status: 'sukses',
          konfirmasi_pembayaran: existing.konfirmasi_pembayaran, created_at: existing.created_at,
          duplicate: true, jenis, admin_type: adminType, mitra, admin,
          preview: { saldo_akun: 0, laci: 0, laba: admin, pembayaran_akun: paymentAkun },
        };
      }
    }
  }

  await writeTransaksiAudit(db, user, saved);
  const saldo = plan.find((p) => p.nama_akun !== paymentAkun && p.nama_akun !== 'Laba')?.jumlah ?? 0;
  const laci = plan.find((p) => p.nama_akun === paymentAkun)?.jumlah ?? 0;
  return {
    id: saved.kode_transaksi, total: saved.total, status: 'sukses',
    konfirmasi_pembayaran: saved.konfirmasi_pembayaran, created_at: saved.created_at,
    duplicate: false, jenis, admin_type: adminType, mitra, admin,
    preview: { saldo_akun: saldo, laci, laba: admin, pembayaran_akun: paymentAkun },
  };
}

async function createProductTransaksi(db, body, ctx, request, jenis) {
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
  const { total, laba, itemRows, effects } = computeItems(body.items, produkMap);

  const payments = Array.isArray(body.payments) ? body.payments : [];
  let plan;
  let konfirmasi;
  let derivedMetode = metodeBayar;
  let paymentRows = [];

  if (payments.length > 0) {
    plan = [];
    let sum = 0;
    let anyTransfer = false;
    for (const p of payments) {
      if (!p || !['tunai', 'transfer'].includes(p.metode)) {
        throw err(400, 'invalid_payment', 'Metode pembayaran harus tunai atau transfer');
      }
      const nominal = Number(p.nominal);
      if (!Number.isInteger(nominal) || nominal <= 0) {
        throw err(400, 'invalid_payment', 'Nominal pembayaran harus integer > 0');
      }
      sum += nominal;
      if (p.metode === 'tunai') {
        plan.push({ nama_akun: 'Tunai Laci', jumlah: nominal, kategori: 'pendapatan' });
      } else {
        const akun = p.akun_id || p.akun_penerima;
        if (!akun) throw err(400, 'missing_field', 'Pembayaran transfer wajib akun_id');
        const valid = (await getAccount(db, akun)).nama_akun;
        plan.push({ nama_akun: valid, jumlah: nominal, kategori: 'pendapatan_transfer' });
        anyTransfer = true;
      }
    }
    if (sum !== total) {
      throw err(400, 'payment_mismatch', `Total pembayaran (${sum}) tidak sama dengan total transaksi (${total})`);
    }
    if (effects.tunai !== 0) plan.push({ nama_akun: 'Tunai Laci', jumlah: effects.tunai, kategori: 'pendapatan' });
    for (const [akun, jml] of effects.akun) {
      if (jml !== 0) plan.push({ nama_akun: akun, jumlah: jml, kategori: 'kirim_uang' });
    }
    plan = mergePlan(plan);
    konfirmasi = anyTransfer ? 'menunggu' : 'tidak_perlu';
    derivedMetode = payments.every((p) => p.metode === 'tunai') ? 'tunai'
      : payments.every((p) => p.metode === 'transfer') ? 'transfer' : 'cash_tunai';
    paymentRows = payments.map((p) => ({
      metode: p.metode,
      akun_id: p.metode === 'transfer' ? (p.akun_id || p.akun_penerima) : null,
      nominal: Number(p.nominal),
    }));
  } else {
    let akunPenerima = null;
    if (metodeBayar === 'transfer') {
      if (!body.akun_penerima) throw err(400, 'missing_field', 'Metode transfer wajib menyertakan akun_penerima');
      akunPenerima = (await getAccount(db, body.akun_penerima)).nama_akun;
    }
    plan = planMutations({ metodeBayar, akunPenerima, total, effects });
    konfirmasi = metodeBayar === 'transfer' ? 'menunggu' : 'tidak_perlu';
  }

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

  const stmts = [
    db.raw.prepare(
      `INSERT INTO transaksi
        (kode_transaksi, pelanggan_id, metode_bayar, konfirmasi_pembayaran, subtotal, diskon, total,
         laba, kasir_sesi_id, dibuat_oleh, manual_entry, jenis, admin_type, mitra, tanggal_transaksi, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(kode, body.pelanggan_id || null, derivedMetode, konfirmasi, total, total, laba, sesi.id, user.id, body.manual_entry === true || body.manual_entry === 1 ? 1 : 0, jenis || null, null, null, tanggalTx, now),
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

  for (const pr of paymentRows) {
    stmts.push(
      db.raw.prepare(
        `INSERT INTO transaksi_pembayaran (transaksi_id, metode, akun_id, nominal)
         VALUES ((SELECT max(id) FROM transaksi), ?, ?, ?)`
      ).bind(pr.metode, pr.akun_id || null, pr.nominal)
    );
  }

  stmts.push(...insertMutationsStmts(db, sesi, kode, plan, idempotencyKey, now));

  if (derivedMetode === 'bon') {
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
  if (['tariktunai', 'transfer'].includes(tx.jenis)) {
    throw err(400, 'readonly_transaksi', 'Transaksi admin (Tarik Tunai / Transfer) tidak dapat diubah');
  }

  const metodeBayar = tx.metode_bayar;
  if (!Array.isArray(body.items) || body.items.length === 0) {
    throw err(400, 'missing_field', 'items wajib diisi minimal 1 produk');
  }
  const sesi = await requireOpenSession(db);
  const actionKey = ctx.idempotencyKey || `upd-${tx.id}-${Date.now()}`;

  const produkMap = await loadProducts(db, body.items);
  const { total, laba, itemRows, effects } = computeItems(body.items, produkMap);

  let akunPenerima = null;
  if (metodeBayar === 'transfer') {
    if (!body.akun_penerima) throw err(400, 'missing_field', 'Metode transfer wajib menyertakan akun_penerima');
    akunPenerima = (await getAccount(db, body.akun_penerima)).nama_akun;
  }

  await reverseFullSource(db, { sumberTipe: 'transaksi', sumberId: tx.id, kasirSesiId: sesi.id, actionKey });

  const plan = planMutations({ metodeBayar, akunPenerima, total, effects });
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
  if (metodeBayar === 'bon') {
    await db.exec(
      'UPDATE kasbon SET nominal = ?, tanggal = ? WHERE transaksi_id = ? AND status = ?',
      total, tanggalTx, tx.id, 'belum_lunas'
    );
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

// Ubah status konfirmasi pembayaran (khusus transaksi transfer & kirim uang).
// Nilai valid: 'tidak_perlu' | 'menunggu' | 'otomatis' | 'manual'. Diubah dari UI dropdown.
const KONFIRMASI_VALUES = ['tidak_perlu', 'menunggu', 'otomatis', 'manual'];

export async function updateKonfirmasi(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const tx = await findTransaksiByRef(db, idStr);
  if (!tx) throw err(404, 'not_found', 'Transaksi tidak ditemukan');
  if (tx.deleted_at) throw err(409, 'already_deleted', 'Transaksi sudah dihapus');
  // Berlaku untuk transaksi transfer ATAU kirim uang (item dengan nominal_referensi)
  // ATAU transaksi admin Transfer/Tarik Tunai (jenis transfer/tariktunai).
  const kirimUang = await db.one(
    'SELECT COUNT(*) AS n FROM transaksi_item WHERE transaksi_id = ? AND nominal_referensi IS NOT NULL AND nominal_referensi != 0',
    tx.id
  );
  const isTransferType =
    tx.metode_bayar === 'transfer' ||
    tx.jenis === 'transfer' ||
    tx.jenis === 'tariktunai' ||
    Number(kirimUang?.n || 0) > 0;
  if (!isTransferType) {
    throw err(400, 'not_transfer', 'Hanya transaksi transfer / kirim uang / tarik tunai yang memiliki status konfirmasi');
  }
  const next = body.konfirmasi_pembayaran || 'manual';
  if (!KONFIRMASI_VALUES.includes(next)) {
    throw err(400, 'invalid_value', 'konfirmasi_pembayaran tidak valid');
  }
  if (next === tx.konfirmasi_pembayaran) {
    return { id: tx.kode_transaksi, status: 'sukses', konfirmasi_pembayaran: next, unchanged: true };
  }
  await db.exec(
    'UPDATE transaksi SET konfirmasi_pembayaran = ?, updated_at = ? WHERE id = ?',
    next, nowIso(), tx.id
  );
  await writeAudit(db, {
    userId: user.id, aksi: 'update_konfirmasi', tabel: 'transaksi', recordId: tx.id,
    dataBefore: { kode_transaksi: tx.kode_transaksi, konfirmasi_pembayaran: tx.konfirmasi_pembayaran },
    dataAfter: { konfirmasi_pembayaran: next },
  });
  return { id: tx.kode_transaksi, status: 'sukses', konfirmasi_pembayaran: next };
}