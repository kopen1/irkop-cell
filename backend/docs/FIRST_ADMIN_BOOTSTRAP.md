# IRKOP CELL — First Admin Bootstrap (Provisioning Produksi)

Status: final untuk Team 1. Dibuat untuk menutup BLOCKER-2 Release Agent.
Prinsip: **tidak ada bypass login, tidak ada password hardcode di source, credential produksi lewat secret Cloudflare.**

## Masalah

- Production D1 sudah ter-deploy dan tabel `users` kosong.
- `POST /api/users` membutuhkan admin (`requireAdmin`), sehingga tidak ada cara membuat admin pertama lewat API biasa.
- Akibatnya login produksi & financial gates belum bisa diverifikasi.

## Solusi

Endpoint `POST /api/auth/bootstrap` membuat **admin pertama** hanya jika tabel `users` kosong. Dijaga oleh:
1. Secret env `BOOTSTRAP_SECRET` (dibandingkan constant-time) — di-provision lewat `wrangler secret put`, **tidak pernah** di source/repo.
2. Insert atomik `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM users)` → hanya berhasil sekali.
3. `role` dipaksa `admin` (nilai lain → 400), password di-hash PBKDF2 210k, `aktif=1`.
4. Admin mendapat semua permission via `loadPagePermissions` (role `admin`), termasuk `gaji_karyawan`.
5. Setelah berhasil, pemanggilan berikutnya → 409 `bootstrap_done`. Tidak ada cara mem-bootstrap ulang lewat API (perlu hapus manual baris users di DB).

Tidak melemahkan apa pun: login tetap wajib, `requireAdmin`/`requirePage`/hard rule `gaji_karyawan` untuk karyawan tidak berubah.

## Provisioning (Production)

Jangan pernah menaruh nilai secret/password asli di repository, chat.log, atau issue tracker.

```bash
# 1. Generate secret yang kuat (sekali)
openssl rand -base64 32          # simpan di password manager

# 2. Set secret di Worker (bukan di wrangler.jsonc)
wrangler secret put BOOTSTRAP_SECRET
#   → masukkan hasil openssl rand

# 3. Pastikan BOOTSTRAP_SECRET tersedia di CI bila deploy via GitHub Actions:
#   Settings → Secrets → Actions → BOOTSTRAP_SECRET (nilai sama, base64-encoded)
```

### Menjalankan bootstrap

Hanya boleh SEKALI, saat tabel `users` masih kosong:

```bash
# Ganti <BOOTSTRAP_SECRET> dengan nilai dari langkah 2.
# Ganti <PASSWORD> dengan password acak kuat (min 8 karakter). JANGAN commit.
curl -X POST https://<worker>/api/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -H 'X-Bootstrap-Secret: <BOOTSTRAP_SECRET>' \
  -d '{"nama":"Admin Utama","username":"admin","password":"<PASSWORD>","role":"admin"}'
```

Respons sukses: `200 {"message":"...","user":{"role":"admin",...}}`.

### Setelah bootstrap

1. Verifikasi login: `POST /api/auth/login` dengan username/password di atas → 200 + token.
2. Verifikasi `GET /api/auth/me` → `permissions.gaji_karyawan === true`.
3. Hapus/arsipkan nilai `BOOTSTRAP_SECRET` dari password manager bila tidak dibutuhkan lagi, ATAU rotate dengan `wrangler secret put BOOTSTRAP_SECRET` (nilai baru). Endpoint tetap mati selama tabel users tidak kosong, jadi aman dibiarkan ter-set.
4. Buat user karyawan lain via `POST /api/users` (admin) dan set permission via `PUT /api/users/:id/permissions`. Hard rule `gaji_karyawan` tetap berlaku otomatis.

## Pemulihan / re-bootstrap

Jika semua user terhapus secara manual dari DB (tabel `users` kosong), endpoint aktif kembali. Ini disengaja: dengan `BOOTSTRAP_SECRET` yang tidak bocor, hanya orang yang memiliki secret yang bisa mem-bootstrap ulang.

## Uji

- `tests/bootstrap.test.js`: sukses+login+permission, sekali-saja (409), secret salah/tanpa header (403), belum dikonfigurasi (503), validasi body, tidak-eskalasi + karyawan tetap tanpa `gaji_karyawan`.
