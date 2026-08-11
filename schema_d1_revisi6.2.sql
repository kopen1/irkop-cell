-- =====================================================================
-- IRKOP CELL — SKEMA DATABASE CLOUDFLARE D1 (SQLite)
-- Revisi 6.2 — Filter transaksi per tanggal, timezone Asia/Jakarta, mutasi saldo idempotent, dan aturan Closing tanpa double deduction.
-- Pengeluaran transfer mengurangi saldo akun sumber (mis. SeaBank),
-- sedangkan pengeluaran tunai mengurangi saldo akun tunai/laci.
-- Pembelian stok tetap belum otomatis menambah stok; update stok masih manual.
-- Versi lengkap (kolom-per-kolom), turunan dari PRD §10
-- Prinsip: single konter (tidak ada cabang_id), soft-delete untuk data
-- transaksi/keuangan, semua nominal disimpan sebagai INTEGER (rupiah
-- bulat, tanpa desimal — hindari float untuk uang).
-- Semua timestamp teknis disimpan TEXT ISO 8601/UTC; timezone bisnis aplikasi = Asia/Jakarta (WIB).
-- =====================================================================

-- ---------------------------------------------------------------------
-- USER & PERMISSION
-- ---------------------------------------------------------------------
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  nama            TEXT NOT NULL,
  username        TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,               -- Argon2/PBKDF2 via Web Crypto, bukan SHA-256 polos
  role            TEXT NOT NULL CHECK (role IN ('admin','karyawan')),
  aktif           INTEGER NOT NULL DEFAULT 1,  -- boolean 0/1, nonaktifkan bukan hapus
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);

CREATE TABLE user_permissions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  halaman     TEXT NOT NULL CHECK (halaman IN (
                'dashboard','transaksi','kasir','laporan','daftar_barang',
                'laporan_service_hp','kasbon','pelanggan','pengeluaran',
                'gaji_karyawan','pengaturan'
              )),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, halaman)
  -- HARD RULE (dicek di level API, bukan cuma constraint DB):
  -- role='karyawan' TIDAK PERNAH boleh punya baris halaman='gaji_karyawan'
  -- yang membuka akses nominal gaji. Kalaupun ada baris ini untuk keperluan
  -- lain (misal lihat status absensi gaji tanpa nominal), endpoint /api/gaji
  -- tetap wajib menolak role karyawan di level middleware.
);

-- ---------------------------------------------------------------------
-- PRODUK
-- ---------------------------------------------------------------------
CREATE TABLE kategori_produk (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nama        TEXT NOT NULL UNIQUE,
  lacak_stok  INTEGER NOT NULL DEFAULT 1,  -- 0 = kategori saldo/digital (pulsa, transfer, token) → produk di bawahnya tidak pakai field stok
  deleted_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE produk (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode            TEXT NOT NULL UNIQUE,
  nama            TEXT NOT NULL,
  kategori_id     INTEGER REFERENCES kategori_produk(id),
  harga           INTEGER NOT NULL,   -- harga jual (rupiah)
  harga_modal     INTEGER,            -- harga modal, dipakai hitung laba di Laporan
  stok            INTEGER NOT NULL DEFAULT 0,
  stok_minimum    INTEGER NOT NULL DEFAULT 0,  -- alert kalau stok <= nilai ini (0 = tidak ada alert)
  satuan          TEXT DEFAULT 'pcs',
  deleted_at      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);
CREATE INDEX idx_produk_kategori ON produk(kategori_id);
CREATE INDEX idx_produk_nama ON produk(nama);  -- dukung fitur cari produk (5.2)

-- ---------------------------------------------------------------------
-- MASTER AKUN UANG
-- ---------------------------------------------------------------------
-- Nama akun adalah identifier bisnis yang terlihat user. Admin dapat menambah
-- akun dari Pengaturan. Seed di bawah hanya contoh awal dan bukan hardcode
-- yang boleh diasumsikan oleh frontend/backend.
CREATE TABLE akun_master (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nama_akun   TEXT NOT NULL UNIQUE,
  tipe        TEXT NOT NULL CHECK (tipe IN ('tunai','bank','e_wallet','digital','lainnya')),
  aktif       INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);
INSERT INTO akun_master (nama_akun, tipe) VALUES
  ('Tunai Laci', 'tunai'),
  ('SeaBank', 'bank'),
  ('DANA', 'e_wallet'),
  ('OrderKuota', 'digital');

-- ---------------------------------------------------------------------
-- KASIR & SESI
-- ---------------------------------------------------------------------
CREATE TABLE kasir_sesi (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  tanggal         TEXT NOT NULL UNIQUE,   -- 1 sesi per hari (5.3)
  dibuka_oleh     INTEGER NOT NULL REFERENCES users(id),
  dibuka_at       TEXT NOT NULL,
  ditutup_oleh    INTEGER REFERENCES users(id),
  ditutup_at      TEXT,
  status          TEXT NOT NULL DEFAULT 'buka' CHECK (status IN ('buka','tutup')),
  catatan_closing TEXT   -- catatan bebas kalau ada selisih saat rekonsiliasi
);

CREATE TABLE kasir_saldo (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kasir_sesi_id   INTEGER NOT NULL REFERENCES kasir_sesi(id),
  nama_akun       TEXT NOT NULL REFERENCES akun_master(nama_akun),     -- akun aktif dari master akun
  saldo_sistem    INTEGER NOT NULL DEFAULT 0,
  saldo_real      INTEGER,           -- diisi saat closing
  selisih         INTEGER,           -- saldo_real - saldo_sistem (computed saat closing)
  tipe            TEXT NOT NULL CHECK (tipe IN ('opening','closing')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_kasir_saldo_sesi ON kasir_saldo(kasir_sesi_id);

-- ---------------------------------------------------------------------
-- TRANSAKSI
-- ---------------------------------------------------------------------
CREATE TABLE transaksi (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  kode_transaksi  TEXT NOT NULL UNIQUE,     -- format: lihat pembahasan §"Struk & ID" terpisah
  pelanggan_id    INTEGER REFERENCES pelanggan(id),
  metode_bayar    TEXT NOT NULL CHECK (metode_bayar IN ('tunai','transfer','bon','cash_tunai')),
  konfirmasi_pembayaran TEXT NOT NULL DEFAULT 'tidak_perlu' CHECK (konfirmasi_pembayaran IN (
                    'tidak_perlu',        -- metode tunai/bon, tidak butuh cocokkan notif
                    'menunggu',           -- transfer, belum ada notif cocok masuk
                    'otomatis',           -- tercocokkan otomatis oleh sistem via NotifHook
                    'manual'              -- dikonfirmasi/dikoreksi manual oleh admin/kasir
                  )),
  subtotal        INTEGER NOT NULL,
  diskon          INTEGER NOT NULL DEFAULT 0,
  total           INTEGER NOT NULL,
  laba            INTEGER,                  -- total - total harga_modal_snapshot semua item
  kasir_sesi_id   INTEGER NOT NULL REFERENCES kasir_sesi(id),
  dibuat_oleh     INTEGER NOT NULL REFERENCES users(id),
  manual_entry    INTEGER NOT NULL DEFAULT 0,  -- 1 = diinput manual dari halaman Laporan (lupa catat)
  tanggal_transaksi TEXT NOT NULL,             -- tanggal bisnis WIB (YYYY-MM-DD), bisa mundur untuk manual entry; dasar laporan & ID
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT,
  deleted_at      TEXT,                     -- soft-delete
  deleted_by      INTEGER REFERENCES users(id),
  deleted_reason  TEXT
);
CREATE INDEX idx_transaksi_pelanggan ON transaksi(pelanggan_id);
CREATE INDEX idx_transaksi_sesi ON transaksi(kasir_sesi_id);
CREATE INDEX idx_transaksi_created ON transaksi(created_at);  -- dukung filter tanggal/rentang di halaman Transaksi dan periode Laporan
CREATE INDEX idx_transaksi_tanggal ON transaksi(tanggal_transaksi);

CREATE TABLE transaksi_item (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  transaksi_id           INTEGER NOT NULL REFERENCES transaksi(id),
  produk_id              INTEGER REFERENCES produk(id),  -- nullable: produk bisa dihapus, snapshot tetap ada
  nama_produk_snapshot   TEXT NOT NULL,
  harga_snapshot         INTEGER NOT NULL,
  harga_modal_snapshot   INTEGER,
  qty                    INTEGER NOT NULL DEFAULT 1,
  subtotal               INTEGER NOT NULL,
  nominal_referensi      INTEGER, -- khusus produk jasa "Transfer Bank/Kirim Uang": nominal uang yang dititipkan/dikirimkan, BUKAN bagian omzet (omzet tetap dari kolom harga_snapshot = biaya admin saja)
  akun_sumber            TEXT REFERENCES akun_master(nama_akun) -- akun sumber jasa kirim uang; mutasi dibuat saat transaksi, bukan saat Closing
);
CREATE INDEX idx_transaksi_item_transaksi ON transaksi_item(transaksi_id);
CREATE INDEX idx_transaksi_item_produk ON transaksi_item(produk_id);

-- ---------------------------------------------------------------------
-- PELANGGAN & KASBON
-- ---------------------------------------------------------------------
CREATE TABLE pelanggan (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  nama                  TEXT NOT NULL,
  telepon               TEXT,
  total_belanja         INTEGER NOT NULL DEFAULT 0,   -- denormalized, di-update via trigger/job
  frekuensi_transaksi   INTEGER NOT NULL DEFAULT 0,
  merged_into_id        INTEGER REFERENCES pelanggan(id),  -- self-ref: kalau di-merge, arahkan ke record utama
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT
);

CREATE TABLE pelanggan_alias (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  pelanggan_id   INTEGER NOT NULL REFERENCES pelanggan(id),
  tipe           TEXT NOT NULL DEFAULT 'nama' CHECK (tipe IN ('nama','no_rekening','no_hp')),
  nilai          TEXT NOT NULL,   -- isi alias: nama lain, ATAU nomor rekening/HP yang kebaca dari notif
  sumber         TEXT NOT NULL DEFAULT 'manual' CHECK (sumber IN ('manual','notifhook_auto')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_pelanggan_alias_nilai ON pelanggan_alias(tipe, nilai);  -- cari cepat saat notif baru masuk, cek udah pernah tercatat belum
CREATE INDEX idx_pelanggan_alias_pelanggan ON pelanggan_alias(pelanggan_id);

CREATE TABLE kasbon (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  pelanggan_id    INTEGER NOT NULL REFERENCES pelanggan(id),
  transaksi_id    INTEGER REFERENCES transaksi(id),
  nominal         INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'belum_lunas' CHECK (status IN ('belum_lunas','lunas')),
  tanggal         TEXT NOT NULL,
  jatuh_tempo     TEXT,   -- opsional: target tanggal pelunasan, buat bantu nagih
  lunas_at        TEXT,
  dicatat_oleh    INTEGER NOT NULL REFERENCES users(id),
  catatan         TEXT
);
CREATE INDEX idx_kasbon_pelanggan ON kasbon(pelanggan_id);
CREATE INDEX idx_kasbon_status ON kasbon(status);

-- ---------------------------------------------------------------------
-- SERVICE HP
-- ---------------------------------------------------------------------
CREATE TABLE service_hp (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  pelanggan_id          INTEGER NOT NULL REFERENCES pelanggan(id),
  nama_device           TEXT NOT NULL,       -- merk/tipe HP
  deskripsi_kerusakan   TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'masuk' CHECK (status IN ('masuk','proses','selesai','diambil')),
  estimasi_biaya        INTEGER,
  biaya                 INTEGER,             -- biaya final saat selesai
  teknisi_id            INTEGER REFERENCES users(id),
  catatan               TEXT,
  sudah_dihubungi       INTEGER NOT NULL DEFAULT 0,  -- boolean: admin sudah kontak manual pelanggan soal status terbaru?
  foto_masuk            TEXT,  -- opsional: link foto kondisi HP saat masuk (disimpan di Cloudflare R2/storage eksternal, kolom ini cuma URL-nya)
  tanggal_masuk         TEXT NOT NULL,
  tanggal_selesai        TEXT,
  tanggal_diambil       TEXT,
  deleted_at            TEXT
);
CREATE INDEX idx_service_hp_status ON service_hp(status);
CREATE INDEX idx_service_hp_pelanggan ON service_hp(pelanggan_id);

-- ---------------------------------------------------------------------
-- PENGELUARAN
-- ---------------------------------------------------------------------
CREATE TABLE pengeluaran (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  deskripsi       TEXT NOT NULL,
  kategori        TEXT,     -- opsional: listrik, sewa, gaji tambahan, dll
  nominal         INTEGER NOT NULL,
  metode_bayar    TEXT NOT NULL CHECK (metode_bayar IN ('tunai','transfer')),
  akun_sumber     TEXT NOT NULL,  -- nama_akun yang dipakai membayar; contoh: 'Tunai Laci', 'SeaBank', 'DANA'
  tanggal         TEXT NOT NULL,
  dicatat_oleh    INTEGER NOT NULL REFERENCES users(id),
  deleted_at      TEXT,
  deleted_by      INTEGER REFERENCES users(id),
  deleted_reason  TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);
CREATE INDEX idx_pengeluaran_tanggal ON pengeluaran(tanggal);
CREATE INDEX idx_pengeluaran_akun ON pengeluaran(akun_sumber);
CREATE INDEX idx_pengeluaran_metode ON pengeluaran(metode_bayar);

-- ---------------------------------------------------------------------
-- MUTASI SALDO (single source of truth untuk pergerakan uang)
-- ---------------------------------------------------------------------
-- Saldo awal berasal dari kasir_saldo tipe='opening'. Setelah Opening, setiap
-- kejadian keuangan membuat SATU atau beberapa baris mutasi sesuai akun yang
-- terdampak. Closing HANYA membaca mutasi; tidak membuat pengurangan ulang.
CREATE TABLE mutasi_saldo (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  kasir_sesi_id     INTEGER NOT NULL REFERENCES kasir_sesi(id),
  nama_akun         TEXT NOT NULL,
  jumlah            INTEGER NOT NULL, -- positif = saldo bertambah; negatif = berkurang
  sumber_tipe       TEXT NOT NULL CHECK (sumber_tipe IN (
                      'transaksi','pengeluaran','kasbon_pelunasan','penyesuaian','reversal'
                    )),
  sumber_id         INTEGER,
  mutation_key      TEXT NOT NULL UNIQUE, -- idempotency; retry tidak boleh menggandakan saldo
  created_at        TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mutasi_saldo_sesi_akun ON mutasi_saldo(kasir_sesi_id, nama_akun);
CREATE INDEX idx_mutasi_saldo_sumber ON mutasi_saldo(sumber_tipe, sumber_id);

-- ---------------------------------------------------------------------
-- GAJI (akses ketat — hard rule, lihat user_permissions)
-- ---------------------------------------------------------------------
CREATE TABLE karyawan_rate (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL UNIQUE REFERENCES users(id),
  tipe        TEXT NOT NULL DEFAULT 'flat' CHECK (tipe IN ('flat','custom_harian')),
  rate_flat   INTEGER,    -- dipakai bila tipe='flat'
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT
);

CREATE TABLE karyawan_rate_harian (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id),
  hari        TEXT NOT NULL CHECK (hari IN ('senin','selasa','rabu','kamis','jumat','sabtu','minggu')),
  rate        INTEGER NOT NULL,
  UNIQUE (user_id, hari)
);

CREATE TABLE gaji_harian (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL REFERENCES users(id),
  tanggal         TEXT NOT NULL,
  nominal         INTEGER NOT NULL,
  sumber          TEXT NOT NULL DEFAULT 'auto' CHECK (sumber IN ('auto','manual_edit')),
  catatan         TEXT,        -- dipakai admin, misal kasus cuti tidak dibayar
  diedit_oleh     INTEGER REFERENCES users(id),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT,
  UNIQUE (user_id, tanggal)
);

-- ---------------------------------------------------------------------
-- PENGATURAN & LOG
-- ---------------------------------------------------------------------
CREATE TABLE settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TEXT
);
-- Business timezone is fixed by PRD; can be read from settings by the app.
INSERT INTO settings (key, value, updated_at) VALUES ('app_timezone', 'Asia/Jakarta', datetime('now'));
INSERT INTO settings (key, value, updated_at) VALUES ('default_theme', 'classic', datetime('now'));
INSERT INTO settings (key, value, updated_at) VALUES ('account_master_mode', 'admin_configured', datetime('now'));

-- Sumber NotifHook dikonfigurasi Admin; developer tidak menebak package/rule.
CREATE TABLE notifhook_source (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  source_name     TEXT NOT NULL UNIQUE,
  enabled         INTEGER NOT NULL DEFAULT 1,
  matcher_type    TEXT NOT NULL CHECK (matcher_type IN ('package_name','custom_rule')),
  matcher_value   TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT
);

CREATE TABLE notifhook_log (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key   TEXT NOT NULL UNIQUE,   -- hash isi notif + timestamp (§9.2 rekomendasi teknis)
  source_app        TEXT,                   -- DANA / SeaBank / OrderKuota / dll
  payload_raw       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'diterima' CHECK (status IN ('diterima','diproses','gagal','diabaikan')),
  transaksi_id      INTEGER REFERENCES transaksi(id),
  error_message     TEXT,
  diterima_at       TEXT NOT NULL DEFAULT (datetime('now')),
  diproses_at       TEXT
);
CREATE INDEX idx_notifhook_status ON notifhook_log(status);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER REFERENCES users(id),   -- nullable: aksi sistem otomatis
  aksi            TEXT NOT NULL,        -- create / update / soft_delete / login / dll
  tabel_terkait   TEXT NOT NULL,
  record_id       TEXT NOT NULL,
  data_before     TEXT,                 -- JSON string
  data_after      TEXT,                 -- JSON string
  ip_address      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_log_tabel ON audit_log(tabel_terkait, record_id);
CREATE INDEX idx_audit_log_user ON audit_log(user_id);
