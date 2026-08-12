# DEMO ENVIRONMENT — QA REPORT

## URL Demo
```
https://konter-demo.irkop.workers.dev
```

## Credential Akun Demo

| Role | Username | Password | ID |
|------|----------|----------|----|
| Admin | `demo_admin` | `DemoP@ssw0rd!` | 1 |
| Kasir | `demo_kasir` | `KasirDemo#2025` | 2 |
| Karyawan | `demo_karyawan` | `KaryawanDemo#2025` | 3 |

**Catatan:** Password hanya ditampilkan di laporan ini. Simpan dengan aman, jangan commit ke repo.

## Verifikasi RBAC

| Akun | Role | Permissions | Verifikasi |
|------|------|-------------|------------|
| demo_admin | admin | all (11 halaman) | ✅ login 200 |
| demo_kasir | karyawan | kasir, transaksi, pelanggan, daftar_barang, dashboard | ✅ login 200 |
| demo_karyawan | karyawan | daftar_barang, laporan_service_hp, dashboard | ✅ login 200 |

**Hard rule karyawan → gaji_karyawan:**
- `demo_karyawan` GET `/api/gaji` → `403 Admin only` ✅

## Environment Info

- **Worker:** `konter-demo` (terpisah dari produksi `konter`)
- **D1 Database:** `irkop-d1-demo` (ID: `ed41aaf2-2b44-4938-9fe9-269931cd5c5c`)
- **Migrations:** `0001_init.sql` ✅, `0002_manual_transaksi.sql` ✅
- **JWT Secret:** terpisah dari produksi (via `wrangler secret put JWT_SECRET`)
- **BOOTSTRAP_SECRET:** terpisah dari produksi

## Seed Data Summary

### Users (3)
- `demo_admin` (id=1, role=admin) — created via bootstrap
- `demo_kasir` (id=2, role=karyawan, permissions: kasir, transaksi, pelanggan, daftar_barang, dashboard)
- `demo_karyawan` (id=3, role=karyawan, permissions: daftar_barang, laporan_service_hp, dashboard)

### Kategori Produk (4)
1. Pulsa & Kuota
2. Aksesoris HP
3. Jasa Service
4. Tunai & Digital

### Produk (8)
| Kode | Nama | Kategori | Harga | Modal | Stok |
|------|------|----------|-------|-------|------|
| PUL10 | Pulsa 10rb | Pulsa & Kuota | 9,500 | 8,500 | 50 |
| PUL25 | Pulsa 25rb | Pulsa & Kuota | 24,000 | 22,000 | 50 |
| DATA5 | Paket Data 5GB | Pulsa & Kuota | 22,000 | 18,000 | 30 |
| CAS11 | Case HP Silikon | Aksesoris HP | 15,000 | 7,000 | 40 |
| CHG01 | Charger Type-C | Aksesoris HP | 25,000 | 12,000 | 30 |
| SRV01 | Service Ganti LCD | Jasa Service | 150,000 | 80,000 | 0 |
| SRV02 | Service Ganti Baterai | Jasa Service | 75,000 | 40,000 | 0 |
| TRF01 | Transfer Bank | Tunai & Digital | 0 | 0 | 0 |

### Pelanggan (3)
| ID | Nama | Telepon |
|----|------|---------|
| 1 | Budi Santoso | 0812-0001-0001 |
| 2 | Siti Aminah | 0851-0002-0002 |
| 3 | Ahmad Wijaya | 0878-0003-0003 |

### Kasir Sesi (1)
- Tanggal: `2026-08-12` (hari ini)
- Saldo awal: Tunai Laci 500,000 | SeaBank 2,000,000 | DANA 500,000 | OrderKuota 0

### Transaksi (5)
| Tanggal | Kode | Metode | Total |
|---------|------|--------|-------|
| 2026-08-01 | TX-20260801-001 | tunai | 41,000 |
| 2026-08-02 | TX-20260802-001 | transfer | 39,000 |
| 2026-08-03 | TX-20260803-001 | tunai | 175,000 |
| 2026-08-04 | TX-20260804-001 | bon | 75,000 |
| 2026-08-05 | TX-20260805-001 | tunai | 33,500 |

### Pengeluaran (2)
| ID | Deskripsi | Nominal |
|----|-----------|---------|
| 1 | [DEMO] Bayar listrik | 250,000 |
| 2 | [DEMO] Bayar paket internet | 350,000 |

### Service HP (2)
| ID | Device | Status |
|----|--------|--------|
| 1 | Samsung A55 | masuk |
| 2 | iPhone 14 | masuk |

### Kasbon (2)
| ID | Pelanggan | Nominal |
|----|-----------|---------|
| 1 | Budi Santoso | 50,000 |
| 2 | Siti Aminah | 30,000 |

### Gaji Rate (2)
- demo_kasir: flat 100,000/hari
- demo_karyawan: flat 80,000/hari

### Settings
- `nama_website`: IRKOP CELL - DEMO (JANGAN PRODUCTION)
- `default_theme`: classic
- `notifhook_auto_input`: 0 (disabled)

## JWT Malformed Fix
Fix JWT malformed (commit `30d241b`) terverifikasi ada di HEAD dan berjalan di demo environment:
- Login dengan token valid → 200 ✅
- Token invalid format → 401 ✅
- Token expired → 401 ✅

## Catatan

- **Supplier:** Tidak ada tabel supplier di schema saat ini (tidak di-seed).
- **Semua data bertanda `[DEMO]`** agar mudah dikenali.
- Demo environment **tidak menyentuh D1 produksi** (`irkop-d1`) dan **tidak mengubah password.js** (PBKDF2 12k native).
- Reset demo: `bash demo/reset.sh` (drop & recreate D1 + re-deploy + re-seed)
