# PRD — Irkop Cell
**Product Requirement Document**
Sistem POS & Buku Kas Digital berbasis NotifHook untuk konter PPOB & Service HP

Status: Perencanaan (belum masuk fase build — menunggu perintah **"go play"**)
Terakhir diperbarui: 11 Agustus 2026 (Revisi 6.2 — Final Planning Lock; PRD, schema, API, UI/UX, financial flow, timezone, CRUD, NotifHook, dan go-live criteria disinkronkan)

> Skema database lengkap (kolom-per-kolom) tersedia terpisah di `schema_d1_revisi6.sql`.

---

## 1. Ringkasan Produk

Irkop Cell adalah aplikasi web (kemudian APK) untuk mengelola operasional konter yang menjalankan dua lini usaha:
1. **Penjualan PPOB** — pulsa, paket data, token listrik, top up e-wallet, dll.
2. **Jasa Service HP**

Fitur andalan: **NotifHook** — auto-input transaksi dengan membaca notifikasi dari aplikasi pembayaran (DANA, SeaBank, OrderKuota — daftar aplikasi sumber fleksibel/bisa dikustom).

Urutan pengembangan: **Web app dibangun & dirilis (go-live) dulu → baru APK Android dibangun setelahnya.**

---

## 2. Tech Stack & Arsitektur

| Layer | Teknologi |
|---|---|
| Frontend | React + Vite |
| Tema UI | Classic |
| Hosting | Cloudflare Pages (plan free) |
| Database | Cloudflare D1 (SQLite, relational) — bukan Firebase |
| Auth | Native, dibangun sendiri di atas Cloudflare (JWT + password hash), supaya satu platform |
| API / Webhook | Cloudflare Workers |
| Deploy | Repo di GitHub → build & deploy otomatis ke Cloudflare |
| Sumber data transaksi otomatis | App Android **NotifHook** (Kotlin, NotificationListenerService) — sudah berjalan, saat ini masih menulis ke Google Sheets via Apps Script; akan diarahkan ke endpoint Cloudflare Worker |

**Catatan riwayat:** Sempat dibuat project Firebase ("konter-irkop-cell" — Firestore + Auth email/password) di awal perencanaan, namun keputusan final memakai Cloudflare penuh (D1 + Auth native), bukan Firebase.

### Prinsip arsitektur
- **Single konter** (bukan multi-cabang) → skema DB tidak perlu kolom `cabang_id`.
- Semua halaman **wajib responsif** (mobile & desktop).
- **Timezone aplikasi resmi: `Asia/Jakarta` (WIB).** Semua tanggal/jam yang ditampilkan kepada pengguna, filter tanggal, sesi kasir, Closing, Pengeluaran, Service HP, Kasbon, audit log, dan proses NotifHook harus mengikuti timezone ini.
- Timestamp teknis di database boleh disimpan dalam UTC/ISO 8601, tetapi backend wajib melakukan konversi dari/ke `Asia/Jakarta` saat menerima filter tanggal atau menampilkan waktu. Developer tidak boleh menggunakan timezone server sebagai sumber kebenaran bisnis.

---

## 3. Role & Akses

| Role | Akses |
|---|---|
| **Admin** | Semua halaman & fitur, termasuk Pengaturan |
| **Karyawan** | Default: hanya **Transaksi** & **Kasir**. Bisa diperluas per-individu (lihat 3.2) |

**Fitur monitoring kehadiran:** saat Karyawan klik **Opening** (buka kasir), sistem otomatis mengirim notifikasi ke Admin — mencatat jam masuk karyawan sehingga bisa dipantau (telat/tidak) di kemudian hari.

### 3.1 Manajemen User (di halaman Pengaturan)
- **CRUD karyawan**: tambah (nama, username/email, password awal, role), edit, **nonaktifkan** (bukan hapus permanen — riwayat transaksi karyawan tetap tersimpan).
- **Session login**: otomatis tetap login selama user tidak klik logout manual — tidak ada auto-logout/expired paksa.

### 3.2 Permission Granular per Halaman
- Akses tiap karyawan **bisa diatur per halaman** secara individual di Pengaturan → Manajemen User (bukan role Karyawan yang fixed sama untuk semua).
- Contoh: Karyawan A hanya Transaksi & Kasir (default), Karyawan B (lebih senior) bisa dikasih tambahan akses ke Laporan atau Daftar Barang.
- **Pengecualian tetap (hard rule):** data **nominal gaji** tidak boleh terlihat oleh Karyawan dalam kondisi apa pun — ini exclude permanen dari sistem permission, tidak bisa di-toggle-on ke karyawan meskipun dia diberi akses ke halaman Gaji Karyawan. Hanya Admin yang bisa melihat & mengedit nominal gaji.

---

## 4. Struktur Navigasi

**Nav utama (selalu terlihat):**
- Dashboard
- Transaksi
- Kasir
- Laporan

**Nav burger (menu lainnya):**
- Daftar Barang
- Laporan Service HP
- Kasbon
- Pelanggan
- Pengeluaran
- Gaji Karyawan
- Pengaturan

---

## 5. Spesifikasi per Halaman

### 5.1 Dashboard
Ringkasan harian: omzet, jumlah transaksi, kasbon aktif, saldo kasir, transaksi terbaru.

### 5.2 Transaksi
- Auto-isi harga, kategori, dll saat klik/pilih produk.
- **Input pencarian produk** (berdasarkan kode & nama).
- Mendukung **banyak produk sekaligus** dalam satu transaksi (keranjang multi-item).
- Metode pembayaran: **Tunai, Transfer, Bon, Cash & Tunai**.
- **Format ID transaksi:** `TX-YYYYMMDD-XXX` (`XXX` = nomor urut 3 digit, reset ke `001` tiap hari).
- **Struk:** preview di layar + opsi print via dialog print browser biasa (bukan printer thermal khusus — modul thermal bisa ditambah belakangan tanpa ubah skema).
- **Rekonsiliasi pembayaran Transfer:** saat metode bayar = Transfer, transaksi menunggu pencocokan otomatis dengan notifikasi masuk via NotifHook (kolom `konfirmasi_pembayaran`: `menunggu` → `otomatis`/`manual`). Admin/kasir selalu bisa lepas & pasang ulang pencocokan secara manual kalau ada salah cocok atau delay notif — setiap perubahan tercatat di `audit_log`.
- **Filter & riwayat transaksi berdasarkan tanggal:** halaman Transaksi menyediakan filter tanggal untuk melihat transaksi pada tanggal tertentu atau rentang tanggal.
  - Mode tanggal tunggal: pilih satu tanggal (mis. `10/08/2026`) untuk menampilkan seluruh transaksi yang terjadi pada tanggal tersebut.
  - Mode rentang tanggal: pilih tanggal mulai dan tanggal akhir untuk menampilkan transaksi dalam periode tersebut.
  - Filter dapat dikombinasikan dengan pencarian berdasarkan ID transaksi, pelanggan, kode/nama produk, dan metode pembayaran.
  - Hasil menampilkan daftar transaksi secara detail (ID, tanggal/jam, pelanggan, item, total, metode pembayaran, status konfirmasi pembayaran).
  - Menampilkan ringkasan hasil filter: jumlah transaksi dan total nilai transaksi pada tanggal/rentang yang dipilih.
  - Klik transaksi membuka detail transaksi dan struk/riwayat lengkapnya.
  - **Catatan scope:** fitur ini berada di halaman **Transaksi** untuk pencarian/pengecekan transaksi per tanggal. Halaman **Laporan** tetap hanya menyediakan periode **Bulanan dan Tahunan**, sehingga tidak mengubah aturan laporan pada §5.4.

#### 5.2.1 Jasa Transfer Bank / Kirim Uang
Produk PPOB khusus di kategori "Pulsa & Saldo" (non-stok): pelanggan titip uang tunai, karyawan eksekusi transfer ke rekening tujuan lewat DANA/SeaBank, konter dapat biaya admin.

- **Harga jual produk = biaya admin saja** (mis. Rp5.000) — inilah yang dihitung sebagai omzet & laba. `harga_modal` untuk produk ini default Rp0, jadi laba = penuh biaya admin.
- **Nominal yang ditransfer dicatat terpisah** (`transaksi_item.nominal_referensi`) — murni informasi/bukti, **tidak masuk omzet atau laba sama sekali**.
- **Efek ke saldo per akun (bukan cuma omzet):**
  - Akun tunai (laci) bertambah sebesar **total uang diterima dari pelanggan** (nominal transfer + biaya admin).
  - Akun sumber eksekusi (mis. DANA — dicatat di `transaksi_item.akun_sumber`) berkurang sebesar **nominal yang ditransfer**.
  - Saat Closing kasir, saldo sistem tiap akun otomatis memperhitungkan pergerakan ini, supaya pencocokan saldo real vs sistem tetap akurat walau ada uang yang cuma "numpang lewat" konter.
- **Kalau notif konfirmasi transfer keluar tidak muncul di NotifHook:** transaksi tetap tersimpan (dibuat manual duluan, bukan hasil notif), statusnya tetap "menunggu konfirmasi". Karyawan/admin bisa cek manual di app DANA lalu tandai terkonfirmasi manual. Kalau terlewat sama sekali, akan ketahuan otomatis saat Closing karena saldo sistem vs saldo real DANA akan selisih.

### 5.3 Kasir
- **Opening (buka kasir):** setup saldo awal keuangan. Input saldo bersifat **multi/dinamis** — admin/karyawan bisa menambahkan nama bank/e-wallet baru sendiri, tidak terbatas field tetap.
- **Closing (tutup kasir):** mencocokkan (rekonsiliasi) saldo sistem vs saldo real dari tiap aplikasi (DANA, SeaBank, OrderKuota, tunai laci, dll).
- **Aturan penting saldo:** setiap kejadian keuangan hanya boleh menghasilkan **satu pencatatan mutasi saldo** untuk setiap akun yang terdampak. Closing **tidak boleh mengurangi/menambah saldo lagi** berdasarkan Pengeluaran atau Transaksi yang sebelumnya sudah tercatat sebagai mutasi. Closing hanya menghitung saldo sistem dari saldo awal + seluruh mutasi valid, lalu menyimpan saldo real dan selisih.
- **Mutasi saldo wajib idempotent:** retry API, refresh halaman, retry NotifHook, atau proses ulang tidak boleh menggandakan mutasi keuangan. Gunakan `mutation_key`/idempotency key unik pada setiap mutasi.
- **Sesi kasir:** 1x per hari (bukan per karyawan/shift individual).
- Saat Karyawan melakukan Opening → notifikasi otomatis terkirim ke Admin (lihat bagian 3).
- **Opening (buka kasir):** setup saldo awal keuangan. Input saldo bersifat **multi/dinamis** — admin/karyawan bisa menambahkan nama bank/e-wallet baru sendiri, tidak terbatas field tetap.
- **Closing (tutup kasir):** mencocokkan (rekonsiliasi) saldo sistem vs saldo real dari tiap aplikasi (DANA, SeaBank, OrderKuota, tunai laci, dll).
- Sesi kasir: **1x per hari** (bukan per karyawan/shift individual).
- Saat Karyawan melakukan Opening → notifikasi otomatis terkirim ke Admin (lihat bagian 3).

### 5.4 Laporan
- **Tidak ada tampilan/filter Harian** (dihapus dari scope).
- **Periode yang tersedia: Bulanan dan Tahunan.**
- **Laporan Bulanan:** omzet total & jumlah transaksi, laba total, rekap per kategori produk (omzet & qty), kasbon (baru/lunas/belum lunas), pengeluaran total, net (laba − pengeluaran), perbandingan vs bulan sebelumnya.
- **Laporan Tahunan:** semua metrik di atas direkap per tahun + breakdown 12 bulan (untuk grafik tren) + ranking kategori produk terlaris sepanjang tahun.
- **Tambah / Edit / Hapus data transaksi manual** — untuk kasus kasir lupa mencatat transaksi di hari sebelumnya.
- **Export Laporan ke PDF/Excel** — untuk keperluan eksternal (pinjam modal, laporan ke mitra usaha, dll).

### 5.5 Daftar Barang
- **CRUD penuh**: tambah, lihat, edit, hapus produk.
- **Kategori produk juga bisa ditambah/dikelola sendiri** (tidak fixed/hardcode).
- **Kategori non-stok:** saat bikin kategori, ada toggle "Lacak stok?" — kategori seperti "Pulsa & Saldo" (bersifat saldo/digital, bukan barang fisik) diset **tidak lacak stok**, jadi produk di bawahnya tidak punya field Stok sama sekali di form maupun di list, dan tidak pernah muncul "stok habis".
- **Field harga_modal** (opsional) — dipakai untuk hitung laba di Laporan.
- **Stok minimum & alert** — tiap produk (yang lacak stok) bisa diset ambang stok minimum; sistem kasih peringatan kalau stok sudah di bawah/sama dengan ambang itu, sebelum benar-benar habis.

### 5.6 Laporan Service HP
- Alur status: **Masuk → Proses → Selesai → Diambil**.
- **Notifikasi ke pelanggan tiap ganti status: manual** (admin telepon/chat sendiri, bukan otomatis via WA/SMS gateway). Sistem cuma bantu mengingatkan lewat penanda "belum dihubungi" tiap kali status berubah, admin tinggal centang setelah beneran menghubungi.
- **Tidak ada SLA/batas waktu otomatis** per status di fase ini — cukup timestamp per status (`tanggal_masuk`, `tanggal_selesai`, `tanggal_diambil`) yang bisa dicek manual.
- **Foto kondisi HP saat masuk — opsional.** Berguna sebagai bukti kalau ada sengketa soal kondisi fisik HP sebelum/sesudah service.

### 5.7 Kasbon
- Daftar hutang pelanggan & status pelunasan.
- **Jatuh tempo (opsional):** tiap kasbon bisa diset target tanggal pelunasan, buat bantu proses nagih.

### 5.8 Pelanggan
- Riwayat belanja per pelanggan.
- **Tujuan fitur ini murni untuk ranking pelanggan setia** (identifikasi siapa yang paling sering/banyak belanja, untuk keperluan hadiah/THR) — bukan CRM lengkap.
- **Grouping nama pelanggan (1 nama bisa punya banyak rekening/nomor):** kombinasi otomatis (sistem menebak nama mirip) + manual (admin bisa gabungkan sendiri) + **otomatis via NotifHook** — kalau notifikasi transfer dari app sumber menampilkan nomor rekening/HP pengirim, sistem cocokkan by nomor (lebih akurat dari sekadar nama mirip) dan otomatis kaitkan ke pelanggan yang sudah ada. Riwayat gabungan (alias) tetap tersimpan, tidak menimpa data lama.
- **Ranking pelanggan setia** (untuk keperluan THR dll): kombinasi total nominal belanja + frekuensi transaksi, bisa difilter per periode. Transaksi tunai tanpa data pelanggan masuk sebagai baris "Umum/Tanpa Nama" terpisah (informatif saja, tidak ikut dinilai untuk hadiah).

### 5.9 Pengeluaran
- Catat biaya operasional konter di luar transaksi penjualan.
- Setiap baris pengeluaran wajib memiliki **Metode Bayar** dan **Akun Sumber**, sehingga sumber uang yang dipakai untuk membayar biaya dapat dilacak dengan jelas.
- Metode bayar yang didukung:
  - **Tunai** → mengurangi saldo sistem akun tunai/laci saat Closing.
  - **Transfer** → mengurangi saldo sistem akun sumber yang dipilih (contoh: SeaBank, DANA, atau akun bank/e-wallet lain).
- Contoh pencatatan biaya yang pembayarannya terpisah:
  - Beli sparepart LCD iPhone 11 — Rp300.000 — Transfer — SeaBank.
  - Ongkir Maxim — Rp15.000 — Tunai — Tunai/Laci.
- Kedua baris tetap dihitung sebagai **Pengeluaran** pada Laporan Bulanan dan mengurangi **Net (laba − pengeluaran)**.
- Saat Closing, pergerakan pengeluaran harus otomatis diperhitungkan dalam saldo sistem masing-masing akun, sehingga saldo sistem dapat dibandingkan dengan saldo real.
- **Catatan stok:** mencatat pembelian sparepart di Pengeluaran **belum otomatis menambah stok produk**. Untuk sparepart yang akan dijual kembali, stok masih diperbarui manual melalui Edit Produk. Otomatisasi pembelian → stok menjadi item planning terpisah.

### 5.10 Gaji Karyawan
- Gaji **fleksibel bila telat diisi** — boleh diisi di hari berikutnya.
- Setiap karyawan default punya **1 rate harian flat**.
- **Opsional per karyawan**: rate bisa dibuat **custom per hari dalam seminggu** — tidak berlaku untuk semua karyawan, hanya yang memang punya pola kerja/bayaran beda tiap hari (contoh: karyawan dengan rate berbeda khusus Selasa/Kamis/Jumat dibanding hari lain).
- **Auto-input saat Opening**: begitu karyawan klik Opening (buka kasir), nominal gaji hari itu otomatis terhitung & tercatat di sistem berdasarkan rate hari tersebut (flat atau custom) — admin tinggal cek/konfirmasi.
- **Karyawan tidak bisa melihat nominal gajinya sendiri** di mana pun dalam aplikasi (lihat 3.2 — hard rule permission).
- **Admin bisa edit nominal gaji manual** — dipakai untuk kasus karyawan cuti tidak dibayar (mengoreksi hasil auto-input).

### 5.11 Pengaturan
Pusat semua konfigurasi aplikasi:
- **Nama Website**
- **Setting NotifHook**: toggle auto-input, endpoint webhook (Cloudflare Worker), API key (generate/regenerate), daftar sumber notifikasi (DANA/SeaBank/OrderKuota — bisa dikustom)
- **Rule Admin & Karyawan**: manajemen role/akses user
- **Log / Console Log**: menu untuk melihat log aktivitas sistem
- Pengaturan lain sesuai kebutuhan ke depan

---

## 6. Keputusan Bisnis Lain (dari PRD awal)

1. **Provider PPOB** yang didukung saat ini: OrderKuota, DANA, SeaBank (fleksibel, bisa ditambah).
2. Grouping pelanggan & ranking THR — lihat 5.8.
3. Gaji karyawan — lihat 5.10.
4. Sesi kasir 1x per hari — lihat 5.3.

---

## 7. Riwayat Keputusan Penting (Log Perubahan Arsitektur)

- Awalnya rencana backend pakai **Firebase** (Firestore + Auth) → diganti final ke **Cloudflare D1 + Auth native**, alasan: satu platform/server, tetap di plan free.
- NotifHook awalnya menulis ke **Google Sheets via Apps Script** → akan diarahkan ke **endpoint Cloudflare Worker** dengan API key, dikonfigurasi dari halaman Pengaturan.
- Mockup visual UI (tema Classic — navy & emas, angka pakai font mono ala buku kas) sudah dibuat dan disetujui sebagai arah desain awal.

---

## 8. Urutan Eksekusi yang Disepakati

1. ~~Diskusi & PRD~~ ✅ (dokumen ini)
2. ~~Mockup visual UI~~ ✅
3. Scaffold project (repo GitHub, routing, layout nav) — **menunggu perintah "go play"**
4. Finalisasi skema database Cloudflare D1 (sinkron dengan `schema_d1_revisi6.sql`)
5. Build halaman inti: Transaksi, Kasir, Dashboard, Laporan
6. Build halaman sekunder: Daftar Barang, Service HP, Kasbon, Pelanggan, Pengeluaran, Gaji Karyawan, Pengaturan
7. Integrasi NotifHook → Worker endpoint
8. Testing input manual dulu, baru sambungkan NotifHook
9. Deploy & go-live web app
10. Baru setelah itu: build APK Android

---

## 8.1 Fitur Tambahan (Revisi 3)

Disetujui untuk masuk scope, di luar spesifikasi awal per halaman:

1. **Reminder kasir belum closing** — kalau sampai akhir hari sesi kasir masih berstatus "buka" (karyawan lupa closing), sistem kirim notifikasi ke Admin. Tujuannya supaya rekonsiliasi tidak numpuk berhari-hari. Tidak butuh tabel baru — cukup cek `kasir_sesi` dengan `status='buka'` dan `tanggal` bukan hari ini.
2. **Backup/export data berkala** — mengingat Cloudflare D1 plan free ada limit baca/tulis, perlu fitur export data (transaksi, laporan) ke CSV/Excel minimal bulanan, sebagai cadangan sekaligus bahan pembukuan/pajak di luar sistem.

## 9. Rekomendasi Teknis (Disetujui)

1. **Offline-first / PWA** untuk halaman Transaksi — installable, cache offline, simpan transaksi sementara di IndexedDB kalau koneksi drop, auto-sync saat online lagi. Konter fisik tidak boleh macet transaksi hanya karena internet putus.
2. **Idempotency key pada NotifHook** — hash dari isi notif + timestamp, supaya notif yang kebaca dobel (retry sistem, HP reboot, dll) tidak menghasilkan transaksi dobel.
3. **Status kesehatan NotifHook di Pengaturan** — tampilkan "terakhir terima notif jam berapa" + alert kalau sudah lama tidak ada aktivitas padahal toggle aktif (mendeteksi service Android yang mati sendiri karena battery optimization).
4. **Rate limit & validasi schema ketat di endpoint Worker** — API key saja tidak cukup untuk endpoint yang menerima transaksi otomatis; payload harus divalidasi strict.
5. **Audit trail, bukan hard-delete** — untuk fitur edit/hapus transaksi & produk manual, gunakan soft-delete + log "siapa ubah apa jam berapa". Fitur **Log/Console Log** di Pengaturan dijadikan audit trail sungguhan, bukan sekadar log teknis.
6. **Hashing password yang benar** untuk auth native — pakai Argon2/PBKDF2 via Web Crypto di Cloudflare Workers, bukan SHA-256 polos. Ini titik kritis karena kebobolan akun Admin = seluruh data keuangan konter terbuka.
7. **Masa uji paralel 1 minggu** sebelum full go-live NotifHook — setelah NotifHook nyala, staff tetap cross-check manual selama ±1 minggu sebelum sepenuhnya mengandalkan otomatisasi.

## 10. Skema Database (Cloudflare D1)

Fondasi data — semua AI/dev wajib mengikuti struktur ini persis, tidak membuat asumsi field sendiri.

**Skema lengkap kolom-per-kolom (dengan constraint, index, dan komentar penjelasan tiap keputusan) ada di file terpisah: `schema_d1.sql`.** Ringkasan tabel di bawah ini disederhanakan untuk gambaran cepat saja.

```sql
-- USER & PERMISSION
users (id, nama, username, password_hash, role ENUM('admin','karyawan'), aktif BOOLEAN, created_at)
user_permissions (id, user_id FK, halaman TEXT)  -- daftar halaman yang boleh diakses karyawan tsb
  -- HARD RULE: halaman "gaji" tidak pernah boleh diberikan ke role karyawan, dicek di level API bukan cuma UI

-- PRODUK
kategori_produk (id, nama)
produk (id, kode UNIQUE, nama, kategori_id FK, harga, stok, deleted_at NULLABLE)

-- TRANSAKSI
kasir_sesi (id, tanggal, dibuka_oleh FK users, dibuka_at, ditutup_oleh FK NULLABLE, ditutup_at NULLABLE, status ENUM('buka','tutup'))
kasir_saldo (id, kasir_sesi_id FK, nama_akun TEXT, saldo_sistem, saldo_real NULLABLE, tipe ENUM('opening','closing'))
  -- nama_akun dinamis: user bisa tambah nama bank/e-wallet baru sendiri

transaksi (id, kode_transaksi UNIQUE, pelanggan_id FK NULLABLE, metode_bayar ENUM('tunai','transfer','bon','cash_tunai'),
           total, kasir_sesi_id FK, dibuat_oleh FK users, manual_entry BOOLEAN, created_at, deleted_at NULLABLE)
transaksi_item (id, transaksi_id FK, produk_id FK, nama_produk_snapshot, harga_snapshot, qty, subtotal)

-- PELANGGAN & KASBON
pelanggan (id, nama, nama_alias TEXT NULLABLE, total_belanja, frekuensi_transaksi)
kasbon (id, pelanggan_id FK, transaksi_id FK NULLABLE, nominal, status ENUM('belum_lunas','lunas'), tanggal, lunas_at NULLABLE)

-- SERVICE HP
service_hp (id, pelanggan_id FK, deskripsi_kerusakan, status ENUM('masuk','proses','selesai','diambil'), biaya, tanggal_masuk, tanggal_selesai NULLABLE)

-- PENGELUARAN
pengeluaran (
  id, deskripsi, kategori, nominal,
  metode_bayar ENUM('tunai','transfer'),
  akun_sumber,
  tanggal, dicatat_oleh FK users,
  deleted_at, deleted_by, deleted_reason, created_at, updated_at
)
  -- metode_bayar menentukan jalur pembayaran.
  -- akun_sumber menentukan akun yang berkurang saat Closing.
  -- tunai → akun tunai/laci; transfer → bank/e-wallet yang dipilih.
  -- Pembelian sparepart belum otomatis mengubah stok.

-- GAJI (akses ketat, lihat hard rule di atas)
karyawan_rate (id, user_id FK, tipe ENUM('flat','custom_harian'), rate_flat NULLABLE)
karyawan_rate_harian (id, user_id FK, hari ENUM('senin'..'minggu'), rate)  -- dipakai bila tipe='custom_harian'
gaji_harian (id, user_id FK, tanggal, nominal, sumber ENUM('auto','manual_edit'), catatan NULLABLE, created_at)
  -- 'catatan' dipakai admin untuk kasus cuti tidak dibayar

-- PENGATURAN & LOG
settings (key TEXT PRIMARY KEY, value TEXT)  -- nama website, notifhook config, dll
notifhook_log (id, idempotency_key UNIQUE, payload_raw, status, diterima_at, transaksi_id FK NULLABLE)
audit_log (id, user_id FK, aksi, tabel_terkait, record_id, data_before JSON, data_after JSON, created_at)
```

**Prinsip:** tidak ada kolom `cabang_id` (single konter). `deleted_at` dipakai untuk soft-delete (produk, transaksi) — tidak ada hard-delete untuk data transaksi/keuangan, semua perubahan tercatat di `audit_log`.

---

## 11. Kontrak API (Cloudflare Workers)

Semua request butuh header `Authorization` (kecuali login & webhook NotifHook yang pakai API key terpisah).

| Endpoint | Method | Keterangan |
|---|---|---|
| `/api/auth/login` | POST | `{username, password}` → `{token, user}` |
| `/api/auth/logout` | POST | Invalidate session |
| `/api/produk` | GET/POST | List & tambah produk |
| `/api/produk/:id` | PUT/DELETE | Edit / soft-delete produk |
| `/api/kategori` | GET/POST | CRUD kategori produk |
| `/api/transaksi` | GET/POST | List & buat transaksi (multi-item). GET wajib mendukung filter `date` atau `date_from` + `date_to`, serta pencarian `q`, `pelanggan_id`, `metode_bayar`, dan `status_konfirmasi`. Semua filter tanggal ditafsirkan dalam `Asia/Jakarta`. |
| `/api/transaksi/:id` | PUT/DELETE | Edit/hapus manual (kasus lupa catat) — tercatat di audit_log |
| `/api/kasir/opening` | POST | Buka kasir, kirim saldo awal (multi akun) → trigger notif ke Admin |
| `/api/kasir/closing` | POST | Tutup kasir, kirim saldo real per akun untuk rekonsiliasi |
| `/api/kasir/current` | GET | Status sesi kasir hari ini |
| `/api/pelanggan` | GET/POST | List & tambah pelanggan |
| `/api/pelanggan/merge` | POST | Gabung manual dua data pelanggan |
| `/api/kasbon` | GET/POST/PUT | Kelola kasbon |
| `/api/service-hp` | GET/POST/PUT | Kelola laporan service HP |
| `/api/pengeluaran` | GET/POST | List & catat pengeluaran; POST wajib menerima `deskripsi`, `nominal`, `metode_bayar`, `akun_sumber`, dan `tanggal` |
| `/api/pengeluaran/:id` | PUT/DELETE | Edit / soft-delete pengeluaran; setiap perubahan wajib tercatat di `audit_log` dan tidak boleh menggandakan/meninggalkan mutasi saldo lama |
| `/api/gaji` | GET/POST/PUT | **Admin only** — lihat/edit gaji harian |
| `/api/users` | GET/POST/PUT | Manajemen user (Admin only) |
| `/api/users/:id/permissions` | PUT | Set halaman yang boleh diakses user tsb |
| `/api/notifhook` | POST | Webhook dari app NotifHook — header `X-API-Key`, body wajib sertakan `idempotency_key` |
| `/api/settings` | GET/PUT | Baca/ubah pengaturan (Admin only) |
| `/api/logs` | GET | Audit trail (Admin only) |

**Contract GET transaksi — filter tanggal:**
```
GET /api/transaksi?date=2026-08-10
GET /api/transaksi?date_from=2026-08-01&date_to=2026-08-10
GET /api/transaksi?date=2026-08-10&q=TX-028&metode_bayar=transfer
```
- `date` = satu tanggal kalender dalam `Asia/Jakarta`.
- `date_from` + `date_to` = rentang inklusif berdasarkan tanggal kalender `Asia/Jakarta`.
- `date` tidak boleh dipakai bersamaan dengan `date_from`/`date_to`.
- Backend mengubah batas tanggal WIB ke timestamp penyimpanan sebelum query `created_at`.
- Data dengan `deleted_at IS NOT NULL` tidak ditampilkan secara default.
- Response harus mengembalikan `items`, `total_items`, `total_nilai`, dan metadata filter yang digunakan.

**Contoh contract detail — buat transaksi:**
```
POST /api/transaksi
Request:
{
  "items": [{ "produk_id": 12, "qty": 2 }],
  "metode_bayar": "tunai",
  "pelanggan_id": null
}
Response 200:
{
  "id": "TX-20260810-001",
  "total": 126500,
  "status": "sukses"
}
```

---

## 11.1 Revisi 6.1 — Financial Flow, Mutasi Saldo & Closing

Perubahan dan penegasan setelah audit PRD + schema + kebutuhan filter transaksi:

1. **Pengeluaran tetap data terpisah dari Transaksi penjualan.**
2. Setiap pengeluaran wajib memiliki `metode_bayar`, `akun_sumber`, `nominal`, dan `tanggal`.
3. Pengeluaran Transfer membuat **satu mutasi saldo negatif** pada akun sumber.
4. Pengeluaran Tunai membuat **satu mutasi saldo negatif** pada akun tunai/laci.
5. Transaksi penjualan dan Jasa Transfer Bank juga menghasilkan mutasi saldo sesuai alur bisnisnya; jangan dihitung ulang saat Closing.
6. **Closing tidak melakukan mutasi ulang.** Closing menghitung saldo sistem = saldo awal akun pada Opening + total mutasi saldo valid sejak Opening.
7. Closing kemudian menerima `saldo_real` dari pengguna, menghitung `selisih = saldo_real - saldo_sistem`, dan menyimpan hasil rekonsiliasi.
8. Setiap mutasi wajib mempunyai `mutation_key` unik/idempotent agar retry tidak menggandakan perubahan saldo.
9. Edit/soft-delete transaksi atau pengeluaran yang sudah menghasilkan mutasi wajib membuat proses koreksi/reversal yang tercatat, bukan menghapus histori mutasi secara diam-diam.
10. Semua perubahan finansial wajib tercatat di `audit_log`.
11. Semua pengeluaran masuk Laporan Bulanan sebagai Total Pengeluaran dan mengurangi Net = laba − pengeluaran.
12. Pembelian sparepart melalui Pengeluaran **belum otomatis menambah stok**; update stok tetap manual.
13. Contoh: LCD iPhone 11 Rp300.000 Transfer SeaBank → satu mutasi `-300000` SeaBank. Ongkir Maxim Rp15.000 Tunai → satu mutasi `-15000` Tunai Laci. Closing hanya membaca hasil mutasi tersebut.

### 11.2 Revisi 6.1 — Timezone & Filter Transaksi

- Timezone bisnis resmi: **`Asia/Jakarta` (WIB)**.
- Filter tanggal berada di halaman **Transaksi**, bukan Laporan.
- `GET /api/transaksi?date=YYYY-MM-DD` untuk satu tanggal.
- `GET /api/transaksi?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD` untuk rentang tanggal.
- Backend wajib menerjemahkan tanggal kalender WIB ke batas timestamp penyimpanan sebelum query.
- Index `transaksi.created_at` wajib dipertahankan.
- Laporan tetap hanya Bulanan dan Tahunan.

### 11.3 Revisi 6.1 — Konsistensi CRUD & Soft Delete

- UI yang menyediakan Edit/Hapus wajib memiliki endpoint backend yang sesuai.
- Hapus data transaksi/keuangan **selalu soft-delete**, tidak hard-delete.
- Setelah soft-delete data yang pernah menghasilkan mutasi saldo, backend wajib membuat reversal/koreksi mutasi secara atomik dan mencatat audit.
- Pengeluaran: `GET/POST /api/pengeluaran` + `PUT/DELETE /api/pengeluaran/:id`.
- Produk: `GET/POST /api/produk` + `PUT/DELETE /api/produk/:id`.
- Setiap PUT/DELETE yang memengaruhi data finansial harus mencatat `data_before` dan `data_after` di `audit_log`.

### 11.4 Revisi 6.1 — NotifHook Configuration Contract

Halaman Pengaturan harus menyediakan konfigurasi sumber NotifHook yang dapat dikustom. Nilai sumber tidak boleh di-hardcode hanya di frontend. Minimal konfigurasi per sumber: `source_name`, `enabled`, dan aturan/identifier yang dibutuhkan implementasi Android untuk mengenali sumber notifikasi. Jika implementasi memakai package Android, `package_name` boleh disimpan sebagai identifier teknis; jika memakai target/rule lain, simpan sebagai konfigurasi rule. Nilai spesifik DANA/SeaBank/OrderKuota diisi berdasarkan aplikasi yang benar-benar dipakai dan **tidak boleh ditebak oleh developer**.

Pengaturan juga harus menampilkan: auto-input toggle, endpoint Worker, API key generate/regenerate, status kesehatan (terakhir menerima notif), serta log NotifHook. Webhook tetap `POST /api/notifhook`, menggunakan `X-API-Key` dan `idempotency_key`.

## 12. Revisi 6.2 — Final Planning Lock (Tidak Ada Open Item)

Bagian ini adalah keputusan final yang wajib dipatuhi developer. Tidak boleh ada asumsi baru yang mengubah perilaku bisnis tanpa revisi PRD.

### 12.1 Finalisasi timezone
- Timezone bisnis resmi: `Asia/Jakarta` (WIB).
- Semua tanggal/jam bisnis pada UI, filter Transaksi, Kasir, Pengeluaran, Service HP, Kasbon, Gaji, Audit Log, Laporan, dan NotifHook mengikuti `Asia/Jakarta`.
- Timestamp teknis boleh disimpan UTC/ISO 8601; server timezone bukan sumber kebenaran bisnis.
- Filter `date`, `date_from`, dan `date_to` adalah tanggal kalender WIB dan backend wajib mengubahnya menjadi batas timestamp penyimpanan sebelum query.

### 12.2 Finalisasi sumber kebenaran saldo
- `mutasi_saldo` adalah **single source of truth** untuk perubahan saldo setelah Opening.
- Opening mencatat saldo awal per akun.
- Transaksi finansial menghasilkan mutasi sesuai akun yang terdampak.
- Pengeluaran Transfer menghasilkan satu mutasi negatif pada `akun_sumber`.
- Pengeluaran Tunai menghasilkan satu mutasi negatif pada akun tunai/laci.
- Closing **tidak membuat mutasi baru** dan tidak boleh mengurangi saldo untuk kedua kalinya.
- `saldo_sistem = saldo_opening + SUM(mutasi_saldo valid sejak Opening)` per akun.
- `saldo_real` dimasukkan saat Closing dan `selisih = saldo_real - saldo_sistem` disimpan sebagai hasil rekonsiliasi.
- Setiap mutasi wajib memiliki `mutation_key` unik/idempotent.

### 12.3 Koreksi, soft-delete, dan audit
- Data finansial tidak di-hard-delete.
- Edit/soft-delete transaksi atau pengeluaran yang sudah menghasilkan mutasi harus melakukan reversal/koreksi secara atomik.
- Histori mutasi lama tidak boleh dihapus diam-diam.
- Semua perubahan finansial wajib masuk `audit_log` dengan data sebelum/sesudah bila relevan.
- Retry request yang sama tidak boleh menggandakan mutasi.

### 12.4 Finalisasi Pengeluaran
Setiap baris Pengeluaran wajib mempunyai:
- `deskripsi`
- `nominal`
- `metode_bayar`
- `akun_sumber`
- `tanggal`
- pencatat

Contoh final:
- LCD iPhone 11 — Rp300.000 — Transfer — SeaBank → SeaBank `-300000`.
- Ongkir Maxim — Rp15.000 — Tunai — Tunai Laci → Tunai Laci `-15000`.

Pengeluaran tetap terpisah dari transaksi penjualan, masuk Total Pengeluaran Laporan Bulanan, dan mengurangi Net. Pembelian sparepart belum otomatis menambah stok; update stok masih manual.

### 12.5 Finalisasi filter Transaksi
Filter berada di halaman **Transaksi**, bukan Laporan.
- Satu tanggal: `GET /api/transaksi?date=YYYY-MM-DD`.
- Rentang: `GET /api/transaksi?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD`.
- Pencarian/filter tambahan: `q`, `pelanggan_id`, `metode_bayar`, `status_konfirmasi`.
- `date` tidak boleh digabung dengan `date_from/date_to`.
- Default hanya menampilkan data yang belum soft-delete.
- Response filter wajib menyediakan `items`, `total_items`, `total_nilai`, dan metadata filter.
- Laporan tetap hanya **Bulanan dan Tahunan**.

### 12.6 Finalisasi NotifHook
- Endpoint: `POST /api/notifhook`.
- Header: `X-API-Key`.
- Body wajib memiliki `idempotency_key`.
- Sumber NotifHook tidak boleh di-hardcode hanya di frontend.
- Sumber disimpan pada `notifhook_source` dengan `source_name`, `enabled`, `matcher_type`, dan `matcher_value`.
- `matcher_type` final yang didukung schema: `package_name` atau `custom_rule`.
- Developer **tidak boleh menebak** package name atau rule DANA/SeaBank/OrderKuota; nilai tersebut dikonfigurasi berdasarkan aplikasi nyata yang digunakan.
- Pengaturan harus menyediakan auto-input toggle, endpoint Worker, generate/regenerate API key, status kesehatan, dan log NotifHook.

### 12.7 Finalisasi akun uang
- Akun uang menggunakan tabel `akun_master`.
- Akun awal yang disediakan schema hanya seed contoh: `Tunai Laci`, `SeaBank`, `DANA`, `OrderKuota`.
- Admin dapat mengelola akun melalui Pengaturan sesuai kebutuhan.
- Frontend/backend tidak boleh menganggap daftar akun seed sebagai daftar permanen yang hardcoded.

### 12.8 Finalisasi CRUD/API
UI tidak boleh menyediakan tombol CRUD yang tidak mempunyai endpoint backend yang sesuai.
- Produk: GET/POST + PUT/DELETE.
- Kategori: GET/POST sesuai scope PRD.
- Transaksi: GET/POST + PUT/DELETE dengan audit/reversal bila finansial.
- Kasir: Opening/Closing/Current.
- Pelanggan: GET/POST + merge.
- Kasbon: GET/POST/PUT.
- Service HP: GET/POST/PUT.
- Pengeluaran: GET/POST + PUT/DELETE dengan audit/reversal.
- Gaji: GET/POST/PUT, Admin only.
- Users: GET/POST/PUT, Admin only.
- Permissions: PUT per user.
- Settings: GET/PUT, Admin only.
- Logs: GET, Admin only.

### 12.9 Finalisasi UI/UX
- Semua halaman wajib responsif mobile dan desktop.
- Arah visual utama: **Classic** dengan tampilan buku kas modern, navy + emas, angka bergaya mono untuk nominal.
- Navigasi desktop menggunakan sidebar; mobile wajib memiliki navigasi yang nyaman (hamburger/bottom navigation sesuai implementasi UI).
- Tema dapat dipilih dari Pengaturan; pilihan tema tidak mengubah aturan bisnis/data.
- Dashboard, Transaksi, Kasir, Laporan, Daftar Barang, Service HP, Kasbon, Pelanggan, Pengeluaran, Gaji, dan Pengaturan harus mengikuti role/permission.

### 12.10 Finalisasi schema sinkron
File schema pendamping adalah `schema_d1_revisi6.2.sql`. Tabel yang menjadi bagian final schema:

`users`, `user_permissions`, `kategori_produk`, `produk`, `akun_master`, `kasir_sesi`, `kasir_saldo`, `transaksi`, `transaksi_item`, `pelanggan`, `pelanggan_alias`, `kasbon`, `service_hp`, `pengeluaran`, `mutasi_saldo`, `karyawan_rate`, `karyawan_rate_harian`, `gaji_harian`, `settings`, `notifhook_source`, `notifhook_log`, `audit_log`.

Developer tidak boleh membuat tabel pengganti dengan nama berbeda untuk fitur yang sudah memiliki tabel final di atas tanpa revisi PRD.

### 12.11 Kriteria sebelum "go live"
Sebelum deploy production minimal harus lulus:
1. Login + role/permission.
2. Opening dan Closing satu sesi per hari.
3. Transaksi manual menghasilkan data dan mutasi yang benar.
4. Pengeluaran Transfer/Tunai menghasilkan tepat satu mutasi.
5. Closing tidak menggandakan mutasi.
6. Koreksi/soft-delete finansial menghasilkan reversal dan audit.
7. Filter Transaksi satu tanggal dan rentang tanggal benar terhadap `Asia/Jakarta`.
8. NotifHook idempotency mencegah duplikasi.
9. CRUD UI ↔ API ↔ database konsisten.
10. Responsive mobile/desktop.
11. Backup/export data berkala tersedia sesuai scope yang disepakati.
12. Testing manual dan integration test utama lulus.

### 12.12 Status planning
**Tidak ada open item.** Planning Revisi 6.2 dianggap **FINAL LOCK**. Tahap berikutnya hanya implementasi/build setelah perintah **"go play"**. Perubahan terhadap keputusan di bagian ini harus menghasilkan revisi PRD baru dan tidak boleh dilakukan diam-diam di kode.
