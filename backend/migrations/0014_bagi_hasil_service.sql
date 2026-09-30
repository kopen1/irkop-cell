-- Bagi hasil service per orang.
--
-- Terpisah dari karyawan_rate (upah per hari): upah dan bagi hasil itu dua
-- hal berbeda. Orang yang sama boleh punya upah tapi bagi hasil 0%, atau
-- sebaliknya.
--
-- Hitungan: sebuah servis (service_hp) punya teknisi_id. Laba servis itu
-- dibagi ke teknisi sesuai persennya. Sisa persen menjadi bagian toko.
-- Servis tanpa teknisi (technisi_id NULL) tidak ikut dibagi ke siapa pun.
--
-- Kolom persen 0..100. Default user tanpa baris = 0 (tidak dapat bagi hasil).
CREATE TABLE IF NOT EXISTS bagi_hasil_service (
  user_id    INTEGER PRIMARY KEY REFERENCES users(id),
  persen     INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Nominal/upah owner + default awal. Nilai ini menggantikan konstanta
-- GAJI_OWNER di kode supaya bisa diubah dari UI tanpa deploy.
INSERT OR IGNORE INTO settings (key, value, updated_at)
VALUES ('owner_upah_harian', '50000', datetime('now'));

CREATE INDEX IF NOT EXISTS idx_service_hp_technisi ON service_hp(teknisi_id);
