-- Pemetaan kode harga server (OrderKuota) ke kode produk lokal. Kode server
-- (mis. Vindosat7) sering beda dari kode produk aplikasi (mis. Vi7), sehingga
-- perbandingan/Update Modal tidak ketemu. kode_lokal diisi manual (link) atau
-- hasil auto-match.
ALTER TABLE harga_server ADD COLUMN kode_lokal TEXT;
CREATE INDEX IF NOT EXISTS idx_harga_server_kode_lokal ON harga_server(kode_lokal);
