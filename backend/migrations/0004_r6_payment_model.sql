-- =====================================================================
-- R6 — PAYMENT MODEL (Local only; never applied to remote D1)
-- Idempoten: menjalankan ulang migrasi ini aman (ALTER ADD COLUMN
-- dilewati dengan error yang diabaikan oleh runner; INSERT Guard).
-- =====================================================================

-- 1. transaksi: jenis, admin_type, mitra
ALTER TABLE transaksi ADD COLUMN jenis TEXT;
ALTER TABLE transaksi ADD COLUMN admin_type TEXT CHECK (admin_type IN ('dalam', 'luar'));
ALTER TABLE transaksi ADD COLUMN mitra TEXT;

-- 2. alokasi pembayaran (split tunai / transfer per 1 transaksi)
CREATE TABLE IF NOT EXISTS transaksi_pembayaran (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  transaksi_id  INTEGER NOT NULL REFERENCES transaksi(id) ON DELETE CASCADE,
  metode        TEXT NOT NULL CHECK (metode IN ('tunai', 'transfer')),
  akun_id       TEXT REFERENCES akun_master(nama_akun),  -- nullable: tunai tidak butuh akun
  nominal       INTEGER NOT NULL CHECK (nominal > 0),
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tp_transaksi ON transaksi_pembayaran(transaksi_id);

-- 3. kategori mutasi untuk laporan per akun
ALTER TABLE mutasi_saldo ADD COLUMN kategori TEXT;

-- 4. akun ledger baru (Saldo Akun + Laba) — jangan duplikasi akun existing
INSERT INTO akun_master (nama_akun, tipe)
SELECT 'Saldo Akun', 'digital'
WHERE NOT EXISTS (SELECT 1 FROM akun_master WHERE nama_akun = 'Saldo Akun');
INSERT INTO akun_master (nama_akun, tipe)
SELECT 'Laba', 'lainnya'
WHERE NOT EXISTS (SELECT 1 FROM akun_master WHERE nama_akun = 'Laba');

-- 5. tarif admin sebagai DATA / CONFIG TERSTRUKTUR
CREATE TABLE IF NOT EXISTS tarif_admin (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  provider      TEXT NOT NULL,
  min_nominal   INTEGER NOT NULL,
  max_nominal   INTEGER NOT NULL,
  admin         INTEGER NOT NULL,
  keterangan    TEXT,
  UNIQUE(provider, min_nominal)
);
CREATE INDEX IF NOT EXISTS idx_tarif_provider ON tarif_admin(provider, min_nominal);

INSERT INTO tarif_admin (provider, min_nominal, max_nominal, admin, keterangan)
SELECT 'DANA', 1000,   30000,  2000, 'DANA 1k-30k'
WHERE NOT EXISTS (SELECT 1 FROM tarif_admin WHERE provider='DANA' AND min_nominal=1000);
INSERT INTO tarif_admin (provider, min_nominal, max_nominal, admin, keterangan)
SELECT 'DANA', 31000,  94000,  3000, 'DANA 31k-94k'
WHERE NOT EXISTS (SELECT 1 FROM tarif_admin WHERE provider='DANA' AND min_nominal=31000);
INSERT INTO tarif_admin (provider, min_nominal, max_nominal, admin, keterangan)
SELECT 'DANA', 95000,  900000, 5000, 'DANA 95k-900k'
WHERE NOT EXISTS (SELECT 1 FROM tarif_admin WHERE provider='DANA' AND min_nominal=95000);
INSERT INTO tarif_admin (provider, min_nominal, max_nominal, admin, keterangan)
SELECT 'BANK', 10000,  900000, 5000, 'BANK 10k-900k'
WHERE NOT EXISTS (SELECT 1 FROM tarif_admin WHERE provider='BANK' AND min_nominal=10000);
INSERT INTO tarif_admin (provider, min_nominal, max_nominal, admin, keterangan)
SELECT 'OVO',  10000,  94000,  3000, 'OVO 10k-94k'
WHERE NOT EXISTS (SELECT 1 FROM tarif_admin WHERE provider='OVO' AND min_nominal=10000);
INSERT INTO tarif_admin (provider, min_nominal, max_nominal, admin, keterangan)
SELECT 'GOPAY', 10000, 94000,  3000, 'GOPAY 10k-94k'
WHERE NOT EXISTS (SELECT 1 FROM tarif_admin WHERE provider='GOPAY' AND min_nominal=10000);
