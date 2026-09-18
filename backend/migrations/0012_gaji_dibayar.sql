-- Penanda pembayaran gaji. Gaji diakru tiap hari (auto saat opening/closing),
-- dibayar berkala (mis. tiap 15 hari) → baris gaji ditandai lunas saat dibayar.
ALTER TABLE gaji_harian ADD COLUMN dibayar_at TEXT;
ALTER TABLE gaji_harian ADD COLUMN dibayar_oleh INTEGER REFERENCES users(id);
CREATE INDEX idx_gaji_harian_belum_dibayar ON gaji_harian(user_id, dibayar_at);
