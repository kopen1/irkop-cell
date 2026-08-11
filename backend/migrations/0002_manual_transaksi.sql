-- IRKOP-T1-010: justifikasi transaksi manual / backdate untuk laporan
-- tanggal_transaksi = tanggal bisnis WIB (YYYY-MM-DD) yang dipakai laporan & ID
-- Untuk data lama: backfill dari created_at (UTC) -> WIB.
ALTER TABLE transaksi ADD COLUMN tanggal_transaksi TEXT;
UPDATE transaksi SET tanggal_transaksi = date(created_at, '+7 hours') WHERE tanggal_transaksi IS NULL;
CREATE INDEX idx_transaksi_tanggal ON transaksi(tanggal_transaksi);