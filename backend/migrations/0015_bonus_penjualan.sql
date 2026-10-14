-- Bonus penjualan: berikan bonus kepada kasir bila produk atau
-- kategori tertentu terjual.
--
-- bonus_aturan    = aturannya (target + nominal bonus per unit).
-- bonus_penjualan = akru per kejadian: satu baris per
--   (transaksi, aturan, produk). Dibayar lewat pengeluaran
--   kategori 'bonus' (jalur yang sama seperti gaji), bukan
--   mutasi langsung, sehingga bisa dibatalkan sebelum dibayar.
--
-- Akru dievaluasi di routes/transaksi.js SESUDAH transaksi dan
-- transaksi_item tersimpan, supaya qty dan produk yang dipakai
-- adalah yang benar-benar masuk database.

CREATE TABLE IF NOT EXISTS bonus_aturan (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nama         TEXT NOT NULL,
  jenis_target TEXT NOT NULL CHECK (jenis_target IN ('produk','kategori')),
  target_id    INTEGER NOT NULL,  -- produk.id atau kategori_produk.id
  jumlah       INTEGER NOT NULL CHECK (jumlah > 0),  -- bonus per unit (rupiah)
  aktif        INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT
);

CREATE TABLE IF NOT EXISTS bonus_penjualan (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  transaksi_id   INTEGER NOT NULL REFERENCES transaksi(id),
  transaksi_kode TEXT,
  user_id        INTEGER NOT NULL REFERENCES users(id),  -- kasir penjual (transaksi.dibuat_oleh)
  aturan_id      INTEGER NOT NULL REFERENCES bonus_aturan(id),
  produk_id      INTEGER,
  nama_produk    TEXT,
  qty            INTEGER NOT NULL DEFAULT 1,
  jumlah         INTEGER NOT NULL CHECK (jumlah >= 0),  -- jumlah × qty
  dibayar_at     TEXT,
  dibayar_oleh   INTEGER REFERENCES users(id),
  dibuat_oleh    INTEGER REFERENCES users(id),
  deleted_at     TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(transaksi_id, aturan_id, produk_id)
);

CREATE INDEX idx_bonus_penjualan_user ON bonus_penjualan(user_id);
CREATE INDEX idx_bonus_penjualan_transaksi ON bonus_penjualan(transaksi_id);
CREATE INDEX idx_bonus_penjualan_belum_bayar ON bonus_penjualan(dibayar_at);
