-- =====================================================================
-- IRKOP CELL — Harga Server (Price Comparison)
-- Tabel untuk menyimpan harga dari OrderKuota/DANA dan membandingkan
-- =====================================================================

-- 1. Tabel harga_server — harga terakhir dari server
CREATE TABLE IF NOT EXISTS harga_server (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_produk     TEXT NOT NULL,           -- kode di Daftar Barang (Vi01005, pi10, D100)
  sumber          TEXT NOT NULL,           -- 'orderkuota' / 'dana' / 'manual'
  kategori        TEXT NOT NULL,           -- 'cetak_voucher' / 'pulsa' / 'dana' / 'gopay' / 'ovo' / 'token'
  operator        TEXT,                    -- 'indosat' / 'tri' / 'xl' / 'smartfren' / 'axis' / 'telkomsel' / null
  nama_produk     TEXT,                    -- nama dari server
  harga_server    INTEGER NOT NULL,        -- harga terakhir dari server
  harga_sebelumnya INTEGER,                -- harga sebelumnya (untuk deteksi perubahan)
  admin_fee       INTEGER DEFAULT 0,       -- admin fee dari server
  updated_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_harga_server_kode ON harga_server(kode_produk);
CREATE INDEX IF NOT EXISTS idx_harga_server_kategori ON harga_server(kategori);
CREATE UNIQUE INDEX IF NOT EXISTS idx_harga_server_kode_unique ON harga_server(kode_produk);

-- 2. Tabel harga_server_log — log perubahan harga
CREATE TABLE IF NOT EXISTS harga_server_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_produk     TEXT NOT NULL,
  nama_produk     TEXT,
  harga_lama      INTEGER,
  harga_baru      INTEGER NOT NULL,
  selisih         INTEGER NOT NULL,        -- positif = naik, negatif = turun
  tipe            TEXT NOT NULL,           -- 'create' / 'update' / 'delete'
  fetched_at      TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_harga_server_log_kode ON harga_server_log(kode_produk);
CREATE INDEX IF NOT EXISTS idx_harga_server_log_tanggal ON harga_server_log(created_at DESC);

-- 3. Tabel harga_alert — notifikasi harga naik
CREATE TABLE IF NOT EXISTS harga_alert (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_produk     TEXT NOT NULL,
  nama_produk     TEXT,
  harga_lama      INTEGER,
  harga_baru      INTEGER NOT NULL,
  selisih         INTEGER NOT NULL,
  is_read         INTEGER DEFAULT 0,       -- 0 = belum dibaca, 1 = sudah dibaca
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_harga_alert_unread ON harga_alert(is_read, created_at DESC);
