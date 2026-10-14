// Import transaksi 2 Oktober (data produksi) ke SQLite lokal lewat API dev server.
//
//   node backend/tools/import_transaksi_2okt.js
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.DEV_HOST || 'http://localhost:8787';
const USER = process.env.DEV_USER || 'admin';
const PASS = process.env.DEV_PASS || 'admin1234';
const TANGGAL = '2026-10-02';

const SERVICE = [
  ['Infinix smart 3 pro', 'Service', 50000, 50000],
];

const PENJUALAN = [
  ['Indosat 7GB/28Hari', 35000, 2325],
  ['Voucher Smartfren 6GB 2Hari', 12000, 1500],
  ['Smart Unlimited FUP 2 GB 7 Hari', 28000, 3500],
  ['perdana indosat 3Gb', 35000, 10000],
  ['Unlimited 5,5GB 30HR', 40000, 3500],
  ['Three 10GB 5 Hari', 20000, 3000],
  ['2GB + Unlimited Apps 10 Hari', 15000, 1500],
  ['Smartfren 7gb/ 28h', 36000, 3000],
  ['Voucher Indosat 4GB 3HARI', 14000, 1299],
  ['6 + 2 GB AON 365 Hari', 35000, 3500],
  ['Freedom Mini 10GB 5 Hari', 20000, 2672],
  ['Sofcase Macaron', 15000, 12000],
  ['Sm 10 GB | 7 HARI', 21000, 2000],
  ['2GB + Unlimited Apps 10 Hari', 15000, 1500],
  ['Robot Usb Micro', 30000, 17800],
  ['Smart 10Gb/30H', 44000, 3000],
  ['Smartfren 7gb/ 28h', 36000, 3000],
];

const DIGITAL = [
  ['Bank', 35000, 3000],
  ['Bank', 53000, 3000],
  ['Gopay', 155000, 4000],
  ['Paket byu', 16000, 1500],
  ['Gopay', 115000, 4000],
  ['Bank', 83000, 3000],
  ['Bank', 1010000, 10000],
  ['Bank', 405000, 5000],
  ['Dana 50.000', 53000, 3000],
  ['Dana 1 Juta', 2020000, 20000],
  ['Dana', 18000, 2000],
  ['Dana 20.000', 22000, 2000],
  ['Dana H2H 300.000', 305000, 5000],
  ['Dana 700k', 705000, 5000],
  ['Dana 70.000', 73000, 3000],
  ['Dana 50.000', 53000, 3000],
  ['Dana 10.000', 12000, 2000],
  ['Dana 50.000', 53000, 3000],
  ['Indosat 7GB/28Hari', 35000, 2325],
  ['Bank', 505000, 5000],
  ['Dana H2H 300.000', 305000, 5000],
  ['Dana', 34000, 2000],
  ['Dana 25.000', 27000, 2000],
  ['Indosat 30.000', 33000, 2150],
  ['token Listrik 20k', 23000, 1150],
];

// [nominal, fee admin].
const TARIK_TUNAI = [
  [500000, 0],
  [520000, 5000],
  [50000, 3000],
  [80000, 3000],
];

function akunSumber(nama) {
  const n = String(nama || '').toLowerCase();
  if (n === 'bank') return { akun: 'SeaBank', sub: 'transfer' };
  if (n.includes('dana') || n.includes('ovo') || n.includes('gopay')) return { akun: 'DANA', sub: 'dana' };
  return { akun: 'OrderKuota', sub: 'pulsa' };
}

async function login() {
  const res = await fetch(`${HOST}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
  return (await res.json()).token;
}

async function call(path, token, method, body, idemp) {
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
  if (idemp) headers['Idempotency-Key'] = idemp;
  const res = await fetch(`${HOST}/api${path}`, { method, headers, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function cari(nama) {
  const res = await fetch(`${HOST}/api/produk?nama=${encodeURIComponent(nama)}`, { headers: { Authorization: `Bearer ${await login()}` } });
  const data = await res.json();
  const p = data.items.find((it) => it.nama === nama && !it.deleted_at);
  if (!p) throw new Error(`Produk tidak ditemukan: ${nama}`);
  return p;
}

const rupiah = (n) => `Rp${Number(n).toLocaleString('id-ID')}`;

async function main() {
  const token = await login();
  let no = 0;
  const runTag = `imp2-${Date.now()}`;

  for (const [nama, deskripsi, biaya, laba] of SERVICE) {
    no += 1;
    console.log(`  ${String(no).padStart(2)}. SERVICE ${nama} — total ${rupiah(biaya)} laba ${rupiah(laba)}`);
    await call('/transaksi', token, 'POST', {
      jenis: 'service',
      metode_bayar: 'tunai',
      tanggal_transaksi: TANGGAL,
      items: [],
      service: {
        nama_device: nama,
        deskripsi_kerusakan: deskripsi,
        biaya,
        harga_modal: biaya - laba,
        tanggal_masuk: TANGGAL,
      },
    }, `${runTag}-svc`);
  }

  for (let i = 0; i < PENJUALAN.length; i += 1) {
    const [nama, total, laba] = PENJUALAN[i];
    const p = await cari(nama);
    no += 1;
    console.log(`  ${String(no).padStart(2)}. JUAL  ${nama} — total ${rupiah(total)} laba ${rupiah(laba)}`);
    await call('/transaksi', token, 'POST', {
      jenis: 'penjualan',
      metode_bayar: 'tunai',
      tanggal_transaksi: TANGGAL,
      items: [{ produk_id: p.id, qty: 1, harga_jual: total, harga_modal: total - laba }],
    }, `${runTag}-jual-${i}`);
  }

  for (let i = 0; i < DIGITAL.length; i += 1) {
    const [nama, total, laba] = DIGITAL[i];
    const p = await cari(nama);
    const { akun, sub } = akunSumber(nama);
    no += 1;
    console.log(`  ${String(no).padStart(2)}. DIG   ${nama} — total ${rupiah(total)} laba ${rupiah(laba)} [${akun}]`);
    await call('/transaksi', token, 'POST', {
      jenis: 'produkdigital',
      metode_bayar: 'tunai',
      tanggal_transaksi: TANGGAL,
      akun_sumber: akun,
      sub_jenis: sub,
      admin_fee: laba,
      items: [{ produk_id: p.id, qty: 1, harga_jual: total, harga_modal: total - laba, admin_fee: laba }],
    }, `${runTag}-dig-${i}`);
  }

  for (let i = 0; i < TARIK_TUNAI.length; i += 1) {
    const [nominal, fee] = TARIK_TUNAI[i];
    no += 1;
    console.log(`  ${String(no).padStart(2)}. TARIK ${rupiah(nominal)} laba ${rupiah(fee)}`);
    await call('/transaksi', token, 'POST', {
      jenis: 'tariktunai',
      tanggal_transaksi: TANGGAL,
      nominal,
      mitra: 'SeaBank',
      admin_type: 'luar',
      admin: fee,
      metode_pembayaran: 'Tunai Laci',
    }, `${runTag}-tarik-${i}`);
  }

  console.log(`\n  selesai: ${no} baris.`);
}

main().catch((e) => {
  console.error('  GAGAL:', e.message);
  process.exit(1);
});
