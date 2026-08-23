// =====================================================================
// Offline Database Layer (Capacitor SQLite)
// Hanya aktif di mobile (Capacitor). Di web, return null.
// =====================================================================

import { Capacitor } from '@capacitor/core';
import { CapacitorSQLite, SQLiteDBConnection } from '@capacitor-community/sqlite';

let db = null;
let isNative = false;

// Cek apakah berjalan di Capacitor (mobile)
export function isMobile() {
  return Capacitor.isNativePlatform();
}

// Inisialisasi database lokal
export async function initLocalDB() {
  if (!isMobile()) return null;

  try {
    const sqlite = new CapacitorSQLite();
    const ret = await sqlite.checkConnectionsConsistency();
    const conn = await sqlite.createConnection('konter', false, 'no-encryption', 1, false);
    db = new SQLiteDBConnection(conn);
    isNative = true;

    // Buat tables (jika belum ada)
    await createTables();
    console.log('[OfflineDB] Local database initialized');
    return db;
  } catch (err) {
    console.error('[OfflineDB] Init failed:', err);
    return null;
  }
}

// Buat tables (schema sama dengan D1)
async function createTables() {
  if (!db) return;

  const schema = `
    CREATE TABLE IF NOT EXISTS produk (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode TEXT NOT NULL UNIQUE,
      nama TEXT NOT NULL,
      harga INTEGER NOT NULL DEFAULT 0,
      harga_modal INTEGER,
      kategori_id INTEGER,
      satuan TEXT DEFAULT 'pcs',
      stok INTEGER DEFAULT 0,
      stok_minimum INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS pelanggan (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nama TEXT NOT NULL,
      telepon TEXT,
      total_belanja INTEGER DEFAULT 0,
      frekuensi_transaksi INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS akun_master (
      nama_akun TEXT PRIMARY KEY,
      tipe TEXT NOT NULL CHECK (tipe IN ('aset','kewajiban','modal','pendapatan','beban','lainnya')),
      saldo_default INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS kasir_sesi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tanggal TEXT NOT NULL,
      dibuka_oleh INTEGER,
      dibuka_at TEXT NOT NULL,
      ditutup_at TEXT,
      status TEXT NOT NULL DEFAULT 'buka' CHECK (status IN ('buka','tutup')),
      catatan_closing TEXT
    );

    CREATE TABLE IF NOT EXISTS kasir_saldo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kasir_sesi_id INTEGER NOT NULL,
      nama_akun TEXT NOT NULL,
      saldo_sistem INTEGER DEFAULT 0,
      saldo_real INTEGER,
      selisih INTEGER DEFAULT 0,
      tipe TEXT NOT NULL CHECK (tipe IN ('opening','adjustment')),
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS transaksi (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kode_transaksi TEXT NOT NULL UNIQUE,
      pelanggan_id INTEGER,
      metode_bayar TEXT NOT NULL,
      konfirmasi_pembayaran TEXT DEFAULT 'tidak_perlu',
      subtotal INTEGER NOT NULL,
      diskon INTEGER DEFAULT 0,
      total INTEGER NOT NULL,
      laba INTEGER,
      kasir_sesi_id INTEGER,
      dibuat_oleh INTEGER,
      manual_entry INTEGER DEFAULT 0,
      jenis TEXT,
      admin_type TEXT,
      mitra TEXT,
      tanggal_transaksi TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transaksi_item (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transaksi_id INTEGER NOT NULL,
      produk_id INTEGER,
      service_hp_id INTEGER,
      nama_produk_snapshot TEXT NOT NULL,
      harga_snapshot INTEGER NOT NULL,
      harga_modal_snapshot INTEGER,
      qty INTEGER DEFAULT 1,
      subtotal INTEGER NOT NULL,
      nominal_referensi INTEGER,
      akun_sumber TEXT
    );

    CREATE TABLE IF NOT EXISTS mutasi_saldo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kasir_sesi_id INTEGER,
      nama_akun TEXT NOT NULL,
      jumlah INTEGER NOT NULL,
      sumber_tipe TEXT NOT NULL,
      sumber_id INTEGER,
      mutation_key TEXT,
      kategori TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pengeluaran (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      deskripsi TEXT NOT NULL,
      nominal INTEGER NOT NULL,
      metode_bayar TEXT NOT NULL,
      akun_sumber TEXT NOT NULL,
      kategori TEXT,
      bukti_url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT,
      deleted_at TEXT
    );

    CREATE TABLE IF NOT EXISTS service_hp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pelanggan_id INTEGER NOT NULL,
      nama_device TEXT NOT NULL,
      deskripsi_kerusakan TEXT,
      biaya INTEGER,
      harga_modal INTEGER,
      tanggal_masuk TEXT DEFAULT (datetime('now')),
      tanggal_selesai TEXT,
      catatan TEXT,
      status TEXT DEFAULT 'menunggu' CHECK (status IN ('menunggu','dikerjakan','selesai','dijemput')),
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS sync_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      record_id TEXT,
      action TEXT NOT NULL CHECK (action IN ('CREATE','UPDATE','DELETE')),
      payload TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','syncing','synced','failed')),
      error_message TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      synced_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status);
    CREATE INDEX IF NOT EXISTS idx_transaksi_kode ON transaksi(kode_transaksi);
    CREATE INDEX IF NOT EXISTS idx_produk_kode ON produk(kode);
  `;

  await db.execute(schema);
  console.log('[OfflineDB] Tables created/verified');
}

// Get database instance
export function getDB() {
  return db;
}

// Close database
export async function closeDB() {
  if (db) {
    await db.close();
    db = null;
  }
}
