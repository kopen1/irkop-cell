-- =====================================================================
-- BACKLOG BUG-FIX — additive only (aman; idempoten; tanpa rebuild tabel)
-- Dijalankan seperti 0004: ALTER yang gagal karena kolom sudah ada
-- dilewati runner; CREATE TABLE memakai IF NOT EXISTS.
-- =====================================================================

-- 1. Service HP: Harga Modal opsional (dipakai hitung laba) — item 7
ALTER TABLE service_hp ADD COLUMN harga_modal INTEGER;

-- 2. Kasbon: pembayaran sebagian / pelunasan + histori — item 10
--    status 'sebagian' diwakili status='belum_lunas' + terbayar>0
--    (tidak mengubah CHECK constraint existing).
ALTER TABLE kasbon ADD COLUMN terbayar INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS kasbon_pembayaran (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  kasbon_id     INTEGER NOT NULL REFERENCES kasbon(id) ON DELETE CASCADE,
  nominal       INTEGER NOT NULL CHECK (nominal > 0),
  metode        TEXT NOT NULL DEFAULT 'tunai' CHECK (metode IN ('tunai','transfer','bon')),
  akun_id       TEXT REFERENCES akun_master(nama_akun),
  dicatat_oleh  INTEGER NOT NULL REFERENCES users(id),
  tanggal       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_kasbon_pembayaran_kasbon ON kasbon_pembayaran(kasbon_id);