-- =====================================================================
-- IRKOP CELL — Akun ledger bukan akun uang
-- 'Saldo Akun', 'Total Saldo', 'Laba' BUKAN akun uang dan tidak lagi
-- ditampilkan di Master Akun (lihat financial/akun.js: listActiveAccounts).
--
-- Catatan: baris TIDAK dihapus karena direferensikan FK oleh
-- kasir_saldo.nama_akun, transaksi_item.akun_sumber,
-- transaksi_pembayaran.akun_id, kasbon_pembayaran.akun_id, payments.akun_id.
-- Cukup dinonaktifkan; kode backend sudah mengecualikannya dari daftar akun
-- dan dari rekonsiliasi kasir (opening/closing).
-- =====================================================================

UPDATE akun_master SET aktif = 0 WHERE nama_akun IN ('Saldo Akun', 'Total Saldo', 'Laba');
