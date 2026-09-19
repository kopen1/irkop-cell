import { err } from '../lib/errors.js';
import { readBody } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

// Biaya tambahan pembelian voucher FISIK (cetak) di atas harga server digital.
// Beda per operator; nilai default bisa diubah di Pengaturan.
export const BIAYA_VOUCHER_DEFAULT_MAP = { Telkomsel: 800, Three: 600, default: 500 };

export function operatorDariKode(kode) {
  const k = String(kode || '').toUpperCase();
  if (k.startsWith('VSM')) return 'Smartfren';
  if (k.startsWith('VT')) return 'Three';
  if (k.startsWith('VS')) return 'Telkomsel';
  if (k.startsWith('VX')) return 'XL';
  if (k.startsWith('VI')) return 'Indosat';
  if (k.startsWith('VA')) return 'Axis';
  return '';
}

// Hanya cetak voucher (fisik) yang punya biaya tambahan.
export function biayaVoucher(kode, kategori, map = BIAYA_VOUCHER_DEFAULT_MAP) {
  if (String(kategori || '').toLowerCase() !== 'cetak_voucher') return 0;
  const op = operatorDariKode(kode);
  return map[op] != null ? map[op] : map.default;
}

// Baca biaya dari settings (kalau ada), fallback ke default.
export async function getBiayaVoucherMap(db) {
  const rows = await db.many(
    "SELECT key, value FROM settings WHERE key IN ('biaya_voucher_telkomsel','biaya_voucher_three','biaya_voucher_default')"
  );
  const m = {};
  for (const r of rows) m[r.key] = Number(r.value);
  const pick = (v, d) => (Number.isFinite(v) && v >= 0 ? v : d);
  return {
    Telkomsel: pick(m.biaya_voucher_telkomsel, BIAYA_VOUCHER_DEFAULT_MAP.Telkomsel),
    Three: pick(m.biaya_voucher_three, BIAYA_VOUCHER_DEFAULT_MAP.Three),
    default: pick(m.biaya_voucher_default, BIAYA_VOUCHER_DEFAULT_MAP.default),
  };
}

// GET /api/harga-server
export async function listHargaServer(db, request, ctx) {
  const url = new URL(request.url);
  const kategori = url.searchParams.get('kategori');
  const operator = url.searchParams.get('operator');
  const sumber = url.searchParams.get('sumber');

  const where = ['1=1'];
  const bind = [];

  if (kategori) { where.push('kategori = ?'); bind.push(kategori); }
  if (operator) { where.push('operator = ?'); bind.push(operator); }
  if (sumber) { where.push('sumber = ?'); bind.push(sumber); }

  const rows = await db.many(
    `SELECT * FROM harga_server WHERE ${where.join(' AND ')} ORDER BY kategori, operator, nama_produk`,
    ...bind
  );
  return { items: rows };
}

// GET /api/harga-server/perbandingan
// Harga server = harga digital; untuk cetak voucher ditambah biaya fisik per
// operator, lalu dibandingkan dengan modal Daftar Barang.
export async function perbandinganHarga(db, request, ctx) {
  const rows = await db.many(`
    SELECT hs.*, p.nama AS nama_produk_daftar, p.harga_modal AS modal_daftar, p.harga AS harga_jual_daftar
      FROM harga_server hs
      LEFT JOIN produk p ON p.kode = COALESCE(hs.kode_lokal, hs.kode_produk) AND p.deleted_at IS NULL
     ORDER BY hs.kode_produk
  `);

  const biayaMap = await getBiayaVoucherMap(db);
  const items = rows.map((r) => {
    const biaya = biayaVoucher(r.kode_produk, r.kategori, biayaMap);
    const efektif = Number(r.harga_server) + biaya;
    const modal = r.modal_daftar == null ? null : Number(r.modal_daftar);
    let status;
    if (modal == null) status = 'baru';
    else if (efektif > modal) status = 'naik';
    else if (efektif < modal) status = 'turun';
    else status = 'sama';
    return {
      ...r,
      biaya,
      harga_server_efektif: efektif,
      selisih: modal == null ? null : efektif - modal,
      status,
    };
  });

  const order = { naik: 0, baru: 1, turun: 2, sama: 3 };
  items.sort((a, b) => (order[a.status] - order[b.status]) || String(a.kode_produk).localeCompare(String(b.kode_produk)));

  const summary = {
    total: items.length,
    naik: items.filter((r) => r.status === 'naik').length,
    turun: items.filter((r) => r.status === 'turun').length,
    sama: items.filter((r) => r.status === 'sama').length,
    baru: items.filter((r) => r.status === 'baru').length,
  };

  return { items, summary };
}

// GET /api/harga-server/alerts
export async function listAlerts(db, request, ctx) {
  const rows = await db.many(
    'SELECT * FROM harga_alert WHERE is_read = 0 ORDER BY created_at DESC LIMIT 50'
  );
  return { items: rows, count: rows.length };
}

// PUT /api/harga-server/alerts/read
export async function markAlertsRead(db, request, ctx) {
  await db.exec('UPDATE harga_alert SET is_read = 1 WHERE is_read = 0');
  return { message: 'Semua notifikasi ditandai sudah dibaca' };
}

// POST /api/harga-server/import
export async function importHargaServer(db, request, ctx) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');

  const body = await readBody(request);
  const items = body.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw err(400, 'missing_field', 'items wajib berupa array');
  }

  const now = nowIso();
  let imported = 0;
  let updated = 0;

  for (const item of items) {
    if (!item.kode || !item.nama) continue;

    const existing = await db.one('SELECT * FROM harga_server WHERE kode_produk = ?', item.kode);

    if (existing) {
      // Update
      await db.exec(
        `UPDATE harga_server 
         SET harga_sebelumnya = harga_server, harga_server = ?, admin_fee = ?, updated_at = ?
         WHERE kode_produk = ?`,
        item.harga || 0, item.admin_fee || 0, now, item.kode
      );

      // Log perubahan harga
      if (existing.harga_server !== item.harga) {
        const selisih = (item.harga || 0) - existing.harga_server;
        await db.exec(
          `INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at)
           VALUES (?, ?, ?, ?, ?, 'update', ?)`,
          item.kode, item.nama, existing.harga_server, item.harga || 0, selisih, now
        );

        // Alert jika naik
        if (selisih > 0) {
          await db.exec(
            `INSERT INTO harga_alert (kode_produk, nama_produk, harga_lama, harga_baru, selisih)
             VALUES (?, ?, ?, ?, ?)`,
            item.kode, item.nama, existing.harga_server, item.harga || 0, selisih
          );
        }
      }
      updated++;
    } else {
      // Insert baru
      await db.exec(
        `INSERT INTO harga_server (kode_produk, sumber, kategori, operator, nama_produk, harga_server, admin_fee, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        item.kode, item.sumber || 'manual', item.kategori || 'lainnya', item.operator || null,
        item.nama, item.harga || 0, item.admin_fee || 0, now
      );
      await db.exec(
        `INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at)
         VALUES (?, ?, NULL, ?, ?, 'create', ?)`,
        item.kode, item.nama, item.harga || 0, item.harga || 0, now
      );
      imported++;
    }
  }

  await writeAudit(db, { userId: user.id, aksi: 'import_harga_server', tabel: 'harga_server', dataAfter: { imported, updated } });
  return { imported, updated, message: `${imported} ditambahkan, ${updated} diperbarui` };
}

// PUT /api/harga-server/:id
export async function updateHargaServer(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');

  const id = parseInt(idStr);
  if (!id) throw err(400, 'invalid_value', 'ID tidak valid');

  const old = await db.one('SELECT * FROM harga_server WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Harga server tidak ditemukan');

  const body = await readBody(request);
  const now = nowIso();

  if (body.harga_server !== undefined) {
    await db.exec(
      'UPDATE harga_server SET harga_sebelumnya = harga_server, harga_server = ?, updated_at = ? WHERE id = ?',
      body.harga_server, now, id
    );

    if (old.harga_server !== body.harga_server) {
      const selisih = body.harga_server - old.harga_server;
      await db.exec(
        `INSERT INTO harga_server_log (kode_produk, nama_produk, harga_lama, harga_baru, selisih, tipe, fetched_at)
         VALUES (?, ?, ?, ?, ?, 'update', ?)`,
        old.kode_produk, old.nama_produk, old.harga_server, body.harga_server, selisih, now
      );
      if (selisih > 0) {
        await db.exec(
          `INSERT INTO harga_alert (kode_produk, nama_produk, harga_lama, harga_baru, selisih)
           VALUES (?, ?, ?, ?, ?)`,
          old.kode_produk, old.nama_produk, old.harga_server, body.harga_server, selisih
        );
      }
    }
  }

  return { message: 'Harga server diperbarui' };
}

// DELETE /api/harga-server/:id
export async function deleteHargaServer(db, request, ctx, idStr) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');

  const id = parseInt(idStr);
  if (!id) throw err(400, 'invalid_value', 'ID tidak valid');

  const old = await db.one('SELECT * FROM harga_server WHERE id = ?', id);
  if (!old) throw err(404, 'not_found', 'Harga server tidak ditemukan');

  await db.exec('DELETE FROM harga_server WHERE id = ?', id);
  await writeAudit(db, { userId: user.id, aksi: 'delete_harga_server', tabel: 'harga_server', dataBefore: old });
  return { message: 'Harga server dihapus' };
}

// GET /api/harga-server/log
export async function listHargaLog(db, request, ctx) {
  const rows = await db.many(
    'SELECT * FROM harga_server_log ORDER BY created_at DESC LIMIT 100'
  );
  return { items: rows };
}

// POST /api/harga-server/link  { id, kode_lokal } — hubungkan baris harga server
// ke produk lokal (kode_lokal null untuk melepas).
export async function linkProduk(db, request, ctx) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');
  const body = await readBody(request);
  const id = Number(body.id);
  if (!Number.isInteger(id)) throw err(400, 'invalid_value', 'id tidak valid');
  const hs = await db.one('SELECT * FROM harga_server WHERE id = ?', id);
  if (!hs) throw err(404, 'not_found', 'Harga server tidak ditemukan');
  const kodeLokal = body.kode_lokal == null || body.kode_lokal === '' ? null : String(body.kode_lokal).trim();
  if (kodeLokal) {
    const p = await db.one('SELECT id FROM produk WHERE lower(kode) = lower(?) AND deleted_at IS NULL', kodeLokal);
    if (!p) throw err(400, 'invalid_produk', 'Produk lokal tidak ditemukan');
  }
  await db.exec('UPDATE harga_server SET kode_lokal = ?, updated_at = ? WHERE id = ?', kodeLokal, nowIso(), id);
  await writeAudit(db, { userId: user.id, aksi: 'link_harga_server', tabel: 'harga_server', recordId: id, dataAfter: { kode_lokal: kodeLokal } });
  return { id, kode_lokal: kodeLokal };
}

const OP_LABEL = { indosat: 'Indosat', tri: 'Three', telkomsel: 'Telkomsel', xl: 'XL', axis: 'Axis', smartfren: 'Smartfren', smart: 'Smartfren' };
function operatorLabel(hs) {
  const fromOp = OP_LABEL[String(hs.operator || '').toLowerCase()];
  if (fromOp) return fromOp;
  const n = String(hs.nama_produk || '').toLowerCase();
  if (/\bindosat\b/.test(n)) return 'Indosat';
  if (/\btri\b|\bthree\b/.test(n)) return 'Three';
  if (/\btelkomsel\b|\btsel\b/.test(n)) return 'Telkomsel';
  if (/\bxl\b/.test(n)) return 'XL';
  if (/\baxis\b/.test(n)) return 'Axis';
  if (/\bsmartfren\b|\bsmart\b/.test(n)) return 'Smartfren';
  return '';
}
function parseGBHari(nama) {
  const s = String(nama || '');
  const gbM = s.match(/(\d+(?:[.,]\d+)?)\s*gb/i);
  const gb = gbM ? Math.floor(parseFloat(gbM[1].replace(',', '.'))) : null;
  let hari = null;
  const hM = s.match(/(\d+)\s*hari/i);
  if (hM) hari = parseInt(hM[1]);
  else if (/harian/i.test(s)) hari = 1;
  return { gb, hari };
}
function namaPunyaOperator(nama, op) {
  const n = String(nama || '').toLowerCase();
  const o = op.toLowerCase();
  if (o === 'three') return /\bthree\b|\btri\b/.test(n);
  if (o === 'indosat') return /\bindosat\b|\bisat\b/.test(n);
  if (o === 'telkomsel') return /\btelkomsel\b|\btsel\b/.test(n);
  if (o === 'xl') return /\bxl\b/.test(n);
  if (o === 'axis') return /\baxis\b/.test(n);
  if (o === 'smartfren') return /\bsmartfren\b|\bsmart\b|\bsm\b/.test(n);
  return n.includes(o);
}

// POST /api/harga-server/auto-link — cocokkan otomatis server ↔ produk lokal
// berdasarkan operator + kapasitas (GB) + masa aktif (hari). Hanya yang unik.
export async function autoLinkProduk(db, request, ctx) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');
  const rows = await db.many(
    `SELECT hs.* FROM harga_server hs
       LEFT JOIN produk p ON p.kode = COALESCE(hs.kode_lokal, hs.kode_produk) AND p.deleted_at IS NULL
      WHERE p.id IS NULL AND hs.kategori = 'cetak_voucher'`
  );
  const prods = await db.many('SELECT kode, nama FROM produk WHERE deleted_at IS NULL');
  let linked = 0;
  const detail = [];
  for (const hs of rows) {
    const op = operatorLabel(hs);
    const { gb, hari } = parseGBHari(hs.nama_produk);
    if (!op || gb == null) continue;
    const cands = prods.filter((p) => {
      if (!namaPunyaOperator(p.nama, op)) return false;
      const pg = parseGBHari(p.nama);
      if (pg.gb !== gb) return false;
      if (hari == null) return true;
      if (pg.hari === hari) return true;
      if ((hari === 28 || hari === 30) && (pg.hari === 28 || pg.hari === 30)) return true;
      return false;
    });
    if (cands.length === 1) {
      await db.exec('UPDATE harga_server SET kode_lokal = ?, updated_at = ? WHERE id = ?', cands[0].kode, nowIso(), hs.id);
      linked += 1;
      detail.push({ id: hs.id, kode_produk: hs.kode_produk, kode_lokal: cands[0].kode });
    }
  }
  await writeAudit(db, { userId: user.id, aksi: 'auto_link_harga_server', tabel: 'harga_server', dataAfter: { linked } });
  return { linked, total_belum: rows.length, detail };
}

// POST /api/harga-server/update-modal
// Body:
//   { kode }            -> update 1 produk
//   { kode_list: [...] }-> update banyak produk
//   { all_naik: true }  -> update semua yang harga_server > harga_modal
// Logic: harga_modal := harga_server, harga jual dipertahankan margin lama.
export async function updateModalFromServer(db, request, ctx) {
  const { user } = ctx.auth;
  if (user.role !== 'admin') throw err(403, 'forbidden', 'Admin only');

  const body = await readBody(request);
  const now = nowIso();

  let targets = null; // null = semua naik
  if (Array.isArray(body.kode_list) && body.kode_list.length) {
    targets = body.kode_list.map((k) => String(k));
  } else if (body.kode) {
    targets = [String(body.kode)];
  } else if (!body.all_naik) {
    throw err(400, 'missing_field', 'Sertakan kode, kode_list, atau all_naik');
  }

  // Ambil baris harga_server sesuai target
  let serverRows;
  if (targets) {
    const placeholders = targets.map(() => '?').join(',');
    serverRows = await db.many(
      `SELECT * FROM harga_server WHERE kode_produk IN (${placeholders})`,
      ...targets
    );
  } else {
    // all_naik: ambil semua yang punya produk, filter efektif > modal di bawah.
    serverRows = await db.many(
      `SELECT hs.* FROM harga_server hs
         JOIN produk p ON p.kode = COALESCE(hs.kode_lokal, hs.kode_produk) AND p.deleted_at IS NULL`
    );
  }

  const updated = [];
  const skipped = [];
  const biayaMap = await getBiayaVoucherMap(db);

  for (const hs of serverRows) {
    const p = await db.one(
      'SELECT * FROM produk WHERE kode = ? AND deleted_at IS NULL',
      hs.kode_lokal || hs.kode_produk
    );
    if (!p) {
      skipped.push({ kode: hs.kode_produk, reason: 'Produk tidak ada di Daftar Barang' });
      continue;
    }
    // Modal = harga server + biaya fisik (khusus cetak voucher).
    const biaya = biayaVoucher(hs.kode_produk, hs.kategori, biayaMap);
    const newModal = Number(hs.harga_server) + biaya;

    if (targets === null && newModal <= (p.harga_modal || 0)) {
      skipped.push({ kode: hs.kode_produk, reason: 'Tidak naik' });
      continue;
    }
    if (p.harga_modal === newModal) {
      skipped.push({ kode: hs.kode_produk, reason: 'Harga modal sudah sama' });
      continue;
    }

    // Pertahankan margin lama: harga_jual - harga_modal
    const margin = (p.harga || 0) - (p.harga_modal || 0);
    const newHarga = newModal + margin;

    await db.exec(
      'UPDATE produk SET harga_modal = ?, harga = ?, updated_at = ? WHERE id = ?',
      newModal, newHarga, now, p.id
    );
    await writeAudit(db, {
      userId: user.id,
      aksi: 'update_modal_from_server',
      tabel: 'produk',
      recordId: p.id,
      dataBefore: { kode: p.kode, harga_modal: p.harga_modal, harga: p.harga },
      dataAfter: { kode: p.kode, harga_modal: newModal, harga: newHarga },
    });

    updated.push({
      kode: hs.kode_produk,
      nama: p.nama,
      biaya,
      modal_lama: p.harga_modal,
      modal_baru: newModal,
      harga_jual: newHarga,
    });
  }

  return {
    updated_count: updated.length,
    skipped_count: skipped.length,
    updated,
    skipped,
    message: `${updated.length} produk diperbarui, ${skipped.length} dilewati`,
  };
}
