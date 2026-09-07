import { err } from '../lib/errors.js';
import { readBody } from '../lib/validate.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

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
export async function perbandinganHarga(db, request, ctx) {
  const rows = await db.many(`
    SELECT 
      hs.*,
      p.nama AS nama_produk_daftar,
      p.harga_modal AS modal_daftar,
      p.harga AS harga_jual_daftar,
      (hs.harga_server - COALESCE(p.harga_modal, 0)) AS selisih,
      CASE 
        WHEN p.harga_modal IS NULL THEN 'baru'
        WHEN hs.harga_server > p.harga_modal THEN 'naik'
        WHEN hs.harga_server < p.harga_modal THEN 'turun'
        ELSE 'sama'
      END AS status
    FROM harga_server hs
    LEFT JOIN produk p ON p.kode = hs.kode_produk AND p.deleted_at IS NULL
    ORDER BY 
      CASE 
        WHEN p.harga_modal IS NULL THEN 1
        WHEN hs.harga_server > p.harga_modal THEN 0
        ELSE 2
      END,
      hs.kode_produk
  `);

  const summary = {
    total: rows.length,
    naik: rows.filter(r => r.status === 'naik').length,
    turun: rows.filter(r => r.status === 'turun').length,
    sama: rows.filter(r => r.status === 'sama').length,
    baru: rows.filter(r => r.status === 'baru').length,
  };

  return { items: rows, summary };
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
