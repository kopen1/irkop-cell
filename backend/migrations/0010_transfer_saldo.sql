-- Transfer antar akun internal (isi saldo), mis. SeaBank -> OrderKuota.
-- Bukan penjualan/pengeluaran: menghasilkan 2 mutasi (asal -nominal, tujuan +nominal)
-- di mutasi_saldo dengan sumber_tipe='penyesuaian', kategori='transfer_internal'.
CREATE TABLE transfer_saldo (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  dari_akun      TEXT NOT NULL,
  ke_akun        TEXT NOT NULL,
  nominal        INTEGER NOT NULL,
  tanggal        TEXT NOT NULL,
  catatan        TEXT,
  dibuat_oleh    INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  deleted_at     TEXT,
  deleted_by     INTEGER REFERENCES users(id),
  deleted_reason TEXT
);
CREATE INDEX idx_transfer_saldo_tanggal ON transfer_saldo(tanggal);
