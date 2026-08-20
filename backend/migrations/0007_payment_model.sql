-- =====================================================================
-- IRKOP CELL — Payment Model Redesign (audit.md)
-- Mendukung: Split Payment, Bayar Kurang, Cicilan, Multi-Akun
-- =====================================================================

-- 1. Tabel payments — catatan pembayaran individual per transaksi
CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  transaksi_id    INTEGER NOT NULL REFERENCES transaksi(id),
  metode          TEXT NOT NULL CHECK (metode IN ('tunai','transfer','bon')),
  akun_id         TEXT REFERENCES akun_master(nama_akun),  -- akun tujuan (BCA, DANA, SeaBank, dst)
  nominal         INTEGER NOT NULL CHECK (nominal > 0),
  catatan         TEXT,
  dibuat_oleh     INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payments_transaksi ON payments(transaksi_id);
CREATE INDEX IF NOT EXISTS idx_payments_metode ON payments(metode);

-- 2. Tambah kolom ke transaksi untuk tracking sisa tagihan
ALTER TABLE transaksi ADD COLUMN sisa INTEGER NOT NULL DEFAULT 0;
ALTER TABLE transaksi ADD COLUMN status_bayar TEXT NOT NULL DEFAULT 'lunas' CHECK (status_bayar IN ('belum_bayar','sebagian','lunas'));

-- 3. Update data existing: semua transaksi lama dianggap lunas (sisa=0)
-- Tidak perlu update karena default sisa=0 dan status_bayar='lunas'

-- 4. Tabel piutang — tracking hutang pelanggan (opsional, untuk fitur lanjutan)
CREATE TABLE IF NOT EXISTS piutang (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pelanggan_id    INTEGER NOT NULL REFERENCES pelanggan(id),
  transaksi_id    INTEGER REFERENCES transaksi(id),
  nominal         INTEGER NOT NULL,
  sisa            INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'belum_lunas' CHECK (status IN ('belum_lunas','sebagian','lunas')),
  jatuh_tempo     TEXT,
  lunas_at        TEXT,
  catatan         TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);
CREATE INDEX IF NOT EXISTS idx_piutang_pelanggan ON piutang(pelanggan_id);
CREATE INDEX IF NOT EXISTS idx_piutang_status ON piutang(status);