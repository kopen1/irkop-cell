import { nowIso } from '../lib/time.js';

// Akru bonus penjualan untuk produk/kategori yang punya aturan aktif.
// Dipanggil SESUDAH transaksi + transaksi_item tersimpan (dari
// routes/transaksi.js), sehingga qty dan produk yang dipakai adalah
// yang benar-benar ada di database.
//
// Idempoten: UNIQUE(transaksi_id, aturan_id, produk_id). Bila baris
// sudah ada tapi pernah dibatalkan (deleted_at terisi) dan belum
// dibayar, baris itu dihidupkan kembali dengan nilai terbaru.
export async function accrualBonusPenjualan(db, { transaksiId, transaksiKode, userId, itemRows, dibuatOleh }) {
  const aturan = await db.many('SELECT * FROM bonus_aturan WHERE aktif = 1');
  if (!aturan.length) return 0;

  const itemNyata = (itemRows || []).filter((it) => it && it.produk_id);
  if (!itemNyata.length) return 0;

  const produkIds = [...new Set(itemNyata.map((it) => Number(it.produk_id)))];
  const placeholders = produkIds.map(() => '?').join(',');
  const produk = await db.many(
    `SELECT id, kategori_id FROM produk WHERE id IN (${placeholders})`,
    ...produkIds
  );
  const kategoriMap = new Map(produk.map((p) => [Number(p.id), p.kategori_id]));

  const stmts = [];
  for (const a of aturan) {
    for (const it of itemNyata) {
      const pid = Number(it.produk_id);
      const cocok = a.jenis_target === 'produk'
        ? pid === Number(a.target_id)
        : kategoriMap.get(pid) === Number(a.target_id);
      if (!cocok) continue;
      const qty = Number(it.qty) || 1;
      stmts.push(
        db.raw.prepare(
          `INSERT INTO bonus_penjualan
             (transaksi_id, transaksi_kode, user_id, aturan_id, produk_id, nama_produk, qty, jumlah, dibuat_oleh, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(transaksi_id, aturan_id, produk_id) DO UPDATE SET
             deleted_at  = NULL,
             qty         = excluded.qty,
             jumlah      = excluded.jumlah,
             nama_produk = excluded.nama_produk
           WHERE bonus_penjualan.dibayar_at IS NULL`
        ).bind(transaksiId, transaksiKode, userId, a.id, pid, it.nama, qty, a.jumlah * qty, dibuatOleh, nowIso())
      );
    }
  }
  if (stmts.length) await db.batch(stmts);
  return stmts.length;
}

// Batalkan akru bonus milik satu transaksi (soft delete, hanya yang
// BELUM dibayar). Baris yang sudah dibayar tidak disentuh: uangnya
// sudah keluar lewat pengeluaran, jadi pembatalan harus lewat
// penghapusan pengeluaran itu sendiri.
export async function voidBonusTransaksi(db, transaksiId) {
  await db.exec(
    'UPDATE bonus_penjualan SET deleted_at = ? WHERE transaksi_id = ? AND deleted_at IS NULL AND dibayar_at IS NULL',
    nowIso(), transaksiId
  );
}

// Apakah transaksi ini punya bonus yang SUDAH dibayar?
// Dipakai softDeleteTransaksi: bila ya, transaksi tidak boleh
// dihapus sebelum pengeluaran bonus-nya dihapus dulu.
export async function adaBonusDibayar(db, transaksiId) {
  const row = await db.one(
    'SELECT COUNT(*) AS n FROM bonus_penjualan WHERE transaksi_id = ? AND deleted_at IS NULL AND dibayar_at IS NOT NULL',
    transaksiId
  );
  return Number(row?.n || 0) > 0;
}
