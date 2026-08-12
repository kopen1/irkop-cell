#!/usr/bin/env bash
set -euo pipefail
# DEMO RESET — hapus & re-create environment demo dari nol
# Membutuhkan: wrangler login, token OAuth aktif
# PERINGATAN: menghapus SEMUA data di D1 demo (irkop-d1-demo)

CONFIG="wrangler.demo.jsonc"
DEMO_DB="irkop-d1-demo"
BASE="https://konter-demo.irkop.workers.dev"

echo "=== DEMO RESET START ==="
echo "DB: $DEMO_DB | Worker: konter-demo"

# 1. Hapus D1 (recreate via API — D1 tidak punya DROP DATABASE di SQL)
# Karena D1 Cloudflare tidak mendukung DROP DATABASE via SQL,
# kita menghapus semua tabel dengan migrasi down-up manual.
# Strategi: execute SQL untuk menghapus semua tabel, lalu re-apply migrations.

echo "[1/4] Reset D1 schema..."
# D1 tidak support DROP DATABASE; kita truncate all tables via direct SQL
# Use wrangler d1 execute with --command to drop everything
npx wrangler d1 execute "$DEMO_DB" --remote --config "$CONFIG" --command \
  "PRAGMA foreign_keys=OFF;
   DROP TABLE IF EXISTS audit_log;
   DROP TABLE IF EXISTS notifhook_log;
   DROP TABLE IF EXISTS notifhook_source;
   DROP TABLE IF EXISTS settings;
   DROP TABLE IF EXISTS gaji_harian;
   DROP TABLE IF EXISTS karyawan_rate_harian;
   DROP TABLE IF EXISTS karyawan_rate;
   DROP TABLE IF EXISTS mutasi_saldo;
   DROP TABLE IF EXISTS kasir_saldo;
   DROP TABLE IF EXISTS kasir_sesi;
   DROP TABLE IF EXISTS pengeluaran;
   DROP TABLE IF EXISTS kasbon;
   DROP TABLE IF EXISTS pelanggan_alias;
   DROP TABLE IF EXISTS pelanggan;
   DROP TABLE IF EXISTS transaksi_item;
   DROP TABLE IF EXISTS transaksi;
   DROP TABLE IF EXISTS service_hp;
   DROP TABLE IF EXISTS akun_master;
   DROP TABLE IF EXISTS produk;
   DROP TABLE IF EXISTS kategori_produk;
   DROP TABLE IF EXISTS user_permissions;
   DROP TABLE IF EXISTS users;
   PRAGMA foreign_keys=ON;" 2>&1 | tail -5

echo "[2/4] Apply migrations..."
npx wrangler d1 migrations apply "$DEMO_DB" --remote --config "$CONFIG" 2>&1 | tail -8

echo "[3/4] Re-deploy worker..."
npx wrangler deploy --config "$CONFIG" 2>&1 | tail -5

echo "[4/4] Seed data..."
BOOTSTRAP_SECRET=$(openssl rand -hex 16)
echo "$BOOTSTRAP_SECRET" | npx wrangler secret put BOOTSTRAP_SECRET --config "$CONFIG" 2>&1 | tail -3
JWT_SECRET=$(openssl rand -hex 24)
echo "$JWT_SECRET" | npx wrangler secret put JWT_SECRET --config "$CONFIG" 2>&1 | tail -3

echo "=== Reset DONE. Re-run seed: ==="
echo "  node demo/seed.mjs $BASE"
