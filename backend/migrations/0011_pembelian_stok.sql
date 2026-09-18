-- Pembelian / inject stok (voucher & aksesoris). Bukan penjualan & bukan
-- biaya operasional: memindahkan nilai dari akun uang (mis. OrderKuota) ke
-- stok fisik. Mutasi akun sumber ditandai sumber_tipe='penyesuaian',
-- kategori='pembelian_stok'; stok produk bertambah; harga_modal diperbarui.
CREATE TABLE pembelian_stok (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal        TEXT NOT NULL,
  akun_sumber    TEXT NOT NULL,
  total          INTEGER NOT NULL,
  catatan        TEXT,
  dibuat_oleh    INTEGER NOT NULL REFERENCES users(id),
  created_at     TEXT NOT NULL,
  updated_at     TEXT,
  deleted_at     TEXT,
  deleted_by     INTEGER REFERENCES users(id),
  deleted_reason TEXT
);
CREATE TABLE pembelian_stok_item (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  pembelian_id       INTEGER NOT NULL REFERENCES pembelian_stok(id),
  produk_id          INTEGER NOT NULL REFERENCES produk(id),
  qty                INTEGER NOT NULL,
  harga_modal_satuan INTEGER NOT NULL,
  subtotal           INTEGER NOT NULL
);
CREATE INDEX idx_pembelian_stok_tanggal ON pembelian_stok(tanggal);
CREATE INDEX idx_pembelian_stok_item_pembelian ON pembelian_stok_item(pembelian_id);
