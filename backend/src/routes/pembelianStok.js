// Beli / inject stok (voucher & aksesoris). Bukan penjualan & bukan biaya:
// memindahkan nilai dari akun uang sumber (mis. OrderKuota) ke stok fisik.
// - mutasi akun sumber: −total (sumber_tipe='penyesuaian', kategori='pembelian_stok')
// - produk.stok += qty, produk.harga_modal = harga beli terbaru
// - kalau modal beli > harga server, buat harga_alert (beli di atas harga server)
import { err } from '../lib/errors.js';
import { nowIso, wibDateToday, isValidCalendarDate } from '../lib/time.js';
import { getAccount } from '../financial/akun.js';
import { requireSessionForToday } from '../financial/kasir.js';
import { reverseFullSource } from '../financial/reversal.js';
import { writeAudit } from '../lib/audit.js';
import { asInt } from '../lib/validate.js';

const KATEGORI = 'pembelian_stok';
const AKUN_UANG = ['tunai', 'bank', 'e_wallet', 'digital'];

async function resolveMoneyAccount(db, nama) {
  const acc = await getAccount(db, nama);
  if (!AKUN_UANG.includes(acc.tipe)) {
    throw err(400, 'invalid_account', `Akun '${acc.nama_akun}' bukan akun uang (tipe ${acc.tipe})`);
  }
  return acc.nama_akun;
}

function stockStatements(db, items, sign, now) {
  return items
    .filter((it) => it.produk_id && it.qty)
    .map((it) =>
      db.raw
        .prepare('UPDATE produk SET stok = stok + ?, updated_at = ? WHERE id = ?')
        .bind(sign * Number(it.qty), now, it.produk_id)
    );
}

async function buildItems(db, rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw err(400, 'missing_field', 'items wajib diisi minimal 1 produk');
  }
  const items = [];
  let total = 0;
  for (const raw of rawItems) {
    const produkId = asInt(raw.produk_id, { required: true, field: 'produk_id', min: 1 });
    const qty = asInt(raw.qty, { required: true, field: 'qty', min: 1 });
    const prod = await db.one(
      `SELECT p.id, p.nama, p.kode, p.harga_modal, k.lacak_stok
         FROM produk p LEFT JOIN kategori_produk k ON k.id = p.kategori_id
        WHERE p.id = ? AND p.deleted_at IS NULL`,
      produkId
    );
    if (!prod) throw err(400, 'invalid_product', `Produk id ${produkId} tidak ditemukan`);
    if (Number(prod.lacak_stok || 0) !== 1) {
      throw err(400, 'invalid_product', `Produk '${prod.nama}' kategorinya tidak melacak stok`);
    }
    let modal = raw.harga_modal_satuan;
    if (modal === undefined || modal === null || modal === '') {
      modal = prod.harga_modal == null ? 0 : Number(prod.harga_modal);
    }
    modal = Number(modal);
    if (!Number.isInteger(modal) || modal < 0) {
      throw err(400, 'invalid_value', `harga_modal_satuan '${prod.nama}' harus integer >= 0`);
    }
    const subtotal = modal * qty;
    total += subtotal;
    items.push({ produk_id: prod.id, kode: prod.kode, nama: prod.nama, qty, harga_modal_satuan: modal, subtotal });
  }
  if (total < 1) throw err(400, 'invalid_value', 'Total pembelian harus lebih dari 0');
  return { items, total };
}

function mutationKey(idempotencyKey, id, akun) {
  return idempotencyKey ? `req:${idempotencyKey}:pembelian_stok:${akun}` : `pembelian_stok:${id}:${akun}`;
}

// Buat alert bila harga beli (modal) melebihi harga server yang tersimpan.
async function maybePriceAlert(db, item) {
  const hs = await db.one('SELECT harga_server FROM harga_server WHERE kode_produk = ?', item.kode);
  if (!hs) return;
  const server = Number(hs.harga_server);
  if (item.harga_modal_satuan > server) {
    await db.exec(
      `INSERT INTO harga_alert (kode_produk, nama_produk, harga_lama, harga_baru, selisih, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      item.kode, item.nama, server, item.harga_modal_satuan, item.harga_modal_satuan - server, nowIso()
    );
  }
}

function validateHeader(body) {
  const tanggal = body.tanggal || wibDateToday();
  if (!isValidCalendarDate(tanggal)) throw err(400, 'invalid_value', 'tanggal harus format YYYY-MM-DD');
  if (tanggal > wibDateToday()) throw err(400, 'invalid_value', 'tanggal tidak boleh di masa depan');
  return { tanggal, catatan: body.catatan ? String(body.catatan).trim() : null };
}

export async function listPembelianStok(db, request, ctx) {
  const url = new URL(request.url);
  const params = url.searchParams;
  const where = ['ps.deleted_at IS NULL'];
  const bind = [];
  if (params.has('tanggal')) {
    const d = params.get('tanggal');
    if (!isValidCalendarDate(d)) throw err(400, 'invalid_filter', 'tanggal harus format YYYY-MM-DD');
    where.push('ps.tanggal = ?');
    bind.push(d);
  } else if (params.has('tanggal_from') || params.has('tanggal_to')) {
    const df = params.get('tanggal_from');
    const dt = params.get('tanggal_to');
    if (!df || !dt) throw err(400, 'invalid_filter', 'tanggal_from dan tanggal_to wajib bersamaan');
    if (!isValidCalendarDate(df) || !isValidCalendarDate(dt)) throw err(400, 'invalid_filter', 'format tanggal tidak valid');
    if (df > dt) throw err(400, 'invalid_filter', 'tanggal_from tidak boleh setelah tanggal_to');
    where.push('ps.tanggal >= ? AND ps.tanggal <= ?');
    bind.push(df, dt);
  }
  const limit = Math.min(Number(params.get('limit') || '100'), 200);
  const offset = Math.max(Number(params.get('offset') || '0'), 0);
  const rows = await db.many(
    `SELECT ps.*, u.nama AS dibuat_oleh_nama FROM pembelian_stok ps
       LEFT JOIN users u ON u.id = ps.dibuat_oleh
      WHERE ${where.join(' AND ')} ORDER BY ps.tanggal DESC, ps.id DESC LIMIT ? OFFSET ?`,
    ...[...bind, limit, offset]
  );
  const ids = rows.map((r) => r.id);
  const items = ids.length
    ? await db.many(
        `SELECT psi.*, p.nama AS produk_nama, p.kode AS produk_kode
           FROM pembelian_stok_item psi LEFT JOIN produk p ON p.id = psi.produk_id
          WHERE psi.pembelian_id IN (${ids.map(() => '?').join(',')}) ORDER BY psi.id`,
        ...ids
      )
    : [];
  const itemMap = {};
  for (const it of items) (itemMap[it.pembelian_id] = itemMap[it.pembelian_id] || []).push(it);
  return { items: rows.map((r) => ({ ...r, detail: itemMap[r.id] || [] })) };
}

export async function getPembelianStok(db, request, ctx, idStr) {
  const id = asInt(idStr, { required: true, field: 'id' });
  const row = await db.one('SELECT * FROM pembelian_stok WHERE id = ? AND deleted_at IS NULL', id);
  if (!row) throw err(404, 'not_found', 'Pembelian stok tidak ditemukan');
  const detail = await db.many(
    `SELECT psi.*, p.nama AS produk_nama, p.kode AS produk_kode
       FROM pembelian_stok_item psi LEFT JOIN produk p ON p.id = psi.produk_id
      WHERE psi.pembelian_id = ? ORDER BY psi.id`,
    id
  );
  const mutasi = await db.many(
    "SELECT id, nama_akun, jumlah, sumber_tipe, kategori, created_at FROM mutasi_saldo WHERE sumber_tipe = 'penyesuaian' AND sumber_id = ? AND kategori = ? ORDER BY id",
    id, KATEGORI
  );
  return { ...row, detail, mutasi_saldo: mutasi };
}

export async function createPembelianStok(db, body, ctx, request) {
  const { user } = ctx.auth;
  if (!body.akun_sumber) throw err(400, 'missing_field', 'akun_sumber wajib diisi');
  const akun = await resolveMoneyAccount(db, body.akun_sumber);
  const { tanggal, catatan } = validateHeader(body);
  const { items, total } = await buildItems(db, body.items);

  const sesi = await requireSessionForToday(db);
  const idempotencyKey = request.headers.get('Idempotency-Key') || null;
  if (idempotencyKey) {
    const existing = await db.one('SELECT sumber_id FROM mutasi_saldo WHERE mutation_key = ?', mutationKey(idempotencyKey, null, akun));
    if (existing && existing.sumber_id) {
      return db.one('SELECT * FROM pembelian_stok WHERE id = ?', existing.sumber_id);
    }
  }

  const now = nowIso();
  const res = await db.exec(
    `INSERT INTO pembelian_stok (tanggal, akun_sumber, total, catatan, dibuat_oleh, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    tanggal, akun, total, catatan, user.id, now
  );
  const id = res.lastRowId;

  const stmts = [
    db.raw.prepare(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
       VALUES (?, ?, ?, 'penyesuaian', ?, ?, ?, ?)`
    ).bind(sesi.id, akun, -total, id, mutationKey(idempotencyKey, id, akun), KATEGORI, now),
  ];
  for (const it of items) {
    stmts.push(
      db.raw.prepare(
        `INSERT INTO pembelian_stok_item (pembelian_id, produk_id, qty, harga_modal_satuan, subtotal)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, it.produk_id, it.qty, it.harga_modal_satuan, it.subtotal)
    );
    stmts.push(...stockStatements(db, [it], 1, now));
    stmts.push(
      db.raw.prepare('UPDATE produk SET harga_modal = ?, updated_at = ? WHERE id = ?').bind(it.harga_modal_satuan, now, it.produk_id)
    );
  }

  const { results } = await db.batch(stmts);
  if (!results.every((r) => r.success)) throw err(500, 'purchase_failed', 'Gagal menyimpan pembelian stok');

  for (const it of items) await maybePriceAlert(db, it);

  const saved = await db.one('SELECT * FROM pembelian_stok WHERE id = ?', id);
  await writeAudit(db, {
    userId: user.id, aksi: 'create', tabel: 'pembelian_stok', recordId: id,
    dataAfter: { tanggal, akun_sumber: akun, total, items: items.map((i) => ({ produk_id: i.produk_id, qty: i.qty, harga_modal_satuan: i.harga_modal_satuan })) },
  });
  return { ...saved, detail: items };
}

export async function updatePembelianStok(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM pembelian_stok WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Pembelian stok tidak ditemukan');

  if (!body.akun_sumber) throw err(400, 'missing_field', 'akun_sumber wajib diisi');
  const akun = await resolveMoneyAccount(db, body.akun_sumber);
  const { tanggal, catatan } = validateHeader(body);
  const { items, total } = await buildItems(db, body.items);
  const sesi = await requireSessionForToday(db);
  const actionKey = ctx.idempotencyKey || `ups-${id}-${Date.now()}`;
  const now = nowIso();

  const oldItems = await db.many('SELECT produk_id, qty FROM pembelian_stok_item WHERE pembelian_id = ?', id);

  // Batalkan efek lama (mutasi + stok) lalu tulis yang baru.
  await reverseFullSource(db, { sumberTipe: 'penyesuaian', sumberId: id, kasirSesiId: sesi.id, actionKey });

  const stmts = [
    db.raw.prepare('UPDATE pembelian_stok SET tanggal = ?, akun_sumber = ?, total = ?, catatan = ?, updated_at = ? WHERE id = ?')
      .bind(tanggal, akun, total, catatan, now, id),
    db.raw.prepare('DELETE FROM pembelian_stok_item WHERE pembelian_id = ?').bind(id),
    ...stockStatements(db, oldItems, -1, now),
    db.raw.prepare(
      `INSERT OR IGNORE INTO mutasi_saldo
         (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, kategori, created_at)
       VALUES (?, ?, ?, 'penyesuaian', ?, ?, ?, ?)`
    ).bind(sesi.id, akun, -total, id, `pembelian_stok:${id}:${akun}:v:${actionKey}`, KATEGORI, now),
  ];
  for (const it of items) {
    stmts.push(
      db.raw.prepare(
        `INSERT INTO pembelian_stok_item (pembelian_id, produk_id, qty, harga_modal_satuan, subtotal)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(id, it.produk_id, it.qty, it.harga_modal_satuan, it.subtotal)
    );
    stmts.push(...stockStatements(db, [it], 1, now));
    stmts.push(db.raw.prepare('UPDATE produk SET harga_modal = ?, updated_at = ? WHERE id = ?').bind(it.harga_modal_satuan, now, it.produk_id));
  }
  const { results } = await db.batch(stmts);
  if (!results.every((r) => r.success)) throw err(500, 'purchase_update_failed', 'Gagal memperbarui pembelian stok');

  await writeAudit(db, {
    userId: user.id, aksi: 'update', tabel: 'pembelian_stok', recordId: id,
    dataBefore: { tanggal: old.tanggal, akun_sumber: old.akun_sumber, total: old.total },
    dataAfter: { tanggal, akun_sumber: akun, total },
  });
  return db.one('SELECT * FROM pembelian_stok WHERE id = ?', id);
}

export async function deletePembelianStok(db, body, ctx, idStr) {
  const { user } = ctx.auth;
  const id = asInt(idStr, { required: true, field: 'id' });
  const old = await db.one('SELECT * FROM pembelian_stok WHERE id = ? AND deleted_at IS NULL', id);
  if (!old) throw err(404, 'not_found', 'Pembelian stok tidak ditemukan');

  const sesi = await requireSessionForToday(db);
  const actionKey = ctx.idempotencyKey || `dps-${id}-${Date.now()}`;
  const now = nowIso();
  const items = await db.many('SELECT produk_id, qty FROM pembelian_stok_item WHERE pembelian_id = ?', id);

  await reverseFullSource(db, { sumberTipe: 'penyesuaian', sumberId: id, kasirSesiId: sesi.id, actionKey });

  const stmts = stockStatements(db, items, -1, now);
  if (stmts.length) await db.batch(stmts);

  const reason = body.deleted_reason || 'dihapus dari halaman Beli Stok';
  await db.exec(
    'UPDATE pembelian_stok SET deleted_at = ?, deleted_by = ?, deleted_reason = ?, updated_at = ? WHERE id = ?',
    nowIso(), user.id, reason, nowIso(), id
  );
  await writeAudit(db, {
    userId: user.id, aksi: 'soft_delete', tabel: 'pembelian_stok', recordId: id,
    dataBefore: { tanggal: old.tanggal, akun_sumber: old.akun_sumber, total: old.total },
    dataAfter: { deleted_reason: reason },
  });
  return { id, status: 'soft_deleted' };
}
