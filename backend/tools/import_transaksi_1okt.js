// Import transaksi 1 Oktober (data produksi) ke SQLite lokal lewat API dev
// server, supaya mutasi_saldo & stok ikut terhitung dengan benar.
//
// Data diambil dari daftar transaksi produksi yang dicatat manual sebagai
// [nama item, total, laba]. Laba dipakai untuk menurunkan harga modal snapshot
// (modal = total - laba) supaya Laba dan COGS identik dengan produksi.
//
//   node backend/tools/import_transaksi_1okt.js
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.DEV_HOST || 'http://localhost:8787';
const USER = process.env.DEV_USER || 'admin';
const PASS = process.env.DEV_PASS || 'admin1234';
const TANGGAL = '2026-10-01';

const PENJUALAN = [
  ['Voucher Telkomsel 7GB 5Hari', 18000, 2000],
  ['Sm 10 GB | 7 HARI', 21000, 2000],
  ['3GB + 7GB Lokal 28 Hari', 50000, 4000],
  ['Act Mini Happy 6GB 3 Hari', 15000, 1400],
  ['Voucher Indosat 13GB 7Hari', 25000, 2500],
  ['Sm 10 GB | 7 HARI', 42000, 4000],
  ['Voucher Smartfren 6GB 2Hari', 12000, 1500],
  ['Smartfren 7gb/ 28h', 36000, 3000],
  ['Voucher Indosat 4GB 3HARI', 14000, 1299],
  ['Freedom Mini 10GB 5 Hari', 20000, 2672],
  ['2GB + Unlimited Apps 10 Hari', 15000, 1500],
  ['Indosat 7GB/28Hari', 70000, 4650],
  ['Smart 10Gb/30H', 44000, 3000],
  ['Tsel Kuota 7GB 2 Hari', 13000, 1800],
];

const DIGITAL = [
  ['Ovo 100k', 105000, 4200],
  ['Bank', 210000, 8000],
  ['Dana 60.000', 63000, 3000],
  ['Dana 100.000', 105000, 5000],
  ['Dana 30.000', 32000, 2000],
  ['Dana H2H 300.000', 305000, 5000],
  ['Dana 15.000', 15000, 0],
  ['Bank', 410000, 10000],
  ['Dana H2H 250.000', 255000, 5000],
  ['Dana 1 Juta', 1010000, 10000],
  ['Dana 80.000', 83000, 3000],
  ['Dana 25.000', 27000, 2000],
  ['Dana 50.000', 53000, 3000],
  ['Dana 150.000', 155000, 5000],
  ['Dana', 485000, 5000],
  ['Dana 100.000', 210000, 10000],
  ['Dana 30.000', 64000, 4000],
  ['Dana 50.000', 159000, 9000],
  ['token Listrik 20k', 46000, 2300],
];

// [nominal, fee admin] — dana keluar dariSeaBank ke Tunai Laci.
const TARIK_TUNAI = [
  [100000, 5000],
  [53000, 3000],
];

// Nama di daftar produksi yang berbeda dari nama produk di DB lokal.
const ALIAS = { 'Tsel Kuota 7GB 2 Hari': 'Voucher Telkomsel 7GB 2HARI' };

function akunSumber(nama) {
  const n = nama.toLowerCase();
  if (n === 'bank') return { akun: 'SeaBank', sub: 'transfer' };
  if (n.includes('dana') || n.includes('ovo')) return { akun: 'DANA', sub: 'dana' };
  return { akun: 'OrderKuota', sub: 'pulsa' };
}

async function login() {
  const r = await fetch(`${HOST}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.token) throw new Error(`login gagal: ${r.status} ${JSON.stringify(d)}`);
  return d.token;
}

async function call(path, token, method, body, key) {
  const r = await fetch(`${HOST}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(key ? { 'Idempotency-Key': key } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${JSON.stringify(d)}`);
  return d;
}

const rupiah = (n) => `Rp${Number(n).toLocaleString('id-ID')}`;

async function main() {
  // Kunci idempotency harus unik PER JALANKAN. Kalau sama seperti run
  // sebelumnya, API menganggapnya duplikat transaksi lama (yang sudah dihapus)
  // dan tidak membuat baris baru.
  const runTag = Date.now().toString(36);
  const token = await login();
  const list = await call('/produk?limit=1000', token, 'GET');
  const byName = new Map((list.items || []).map((p) => [p.nama, p]));
  const cari = (nama) => {
    const asli = ALIAS[nama] || nama;
    const p = byName.get(asli);
    if (!p) throw new Error(`produk tidak ditemukan: "${asli}"`);
    return p;
  };

  const aktif = await call('/kasir/aktif', token, 'GET');
  if (aktif.tanggal !== TANGGAL || aktif.reopened !== true) {
    throw new Error(`sesi aktif bukan ${TANGGAL} (dapat ${aktif.tanggal}, reopened=${aktif.reopened}). `
      + 'Buka dulu lewat "Buka Ulang Sesi Tanggal Lain".');
  }

  // Idempoten: hapus dulu transaksi tanggal tsb.
  const lama = await call(`/transaksi?date=${TANGGAL}&limit=200`, token, 'GET');
  for (const t of lama.items || []) {
    await call(`/transaksi/${t.id}`, token, 'DELETE', { alasan: 'reimport data produksi 1 Oktober' });
  }
  if ((lama.items || []).length) console.log(`  hapus ${lama.items.length} transaksi lama`);

  let no = 0;
  const cetak = (label, nama, total, laba) => {
    no += 1;
    console.log(`  ${String(no).padStart(2)}. ${label} ${nama} — total ${rupiah(total)} laba ${rupiah(laba)}`);
  };

  for (let i = 0; i < PENJUALAN.length; i += 1) {
    const [nama, total, laba] = PENJUALAN[i];
    const p = cari(nama);
    cetak('JUAL  ', nama, total, laba);
    await call('/transaksi', token, 'POST', {
      jenis: 'penjualan',
      metode_bayar: 'tunai',
      tanggal_transaksi: TANGGAL,
      items: [{ produk_id: p.id, qty: 1, harga_jual: total, harga_modal: total - laba }],
    }, `${runTag}-jual-${i}`);
  }

  for (let i = 0; i < DIGITAL.length; i += 1) {
    const [nama, total, laba] = DIGITAL[i];
    const p = cari(nama);
    const { akun, sub } = akunSumber(nama);
    cetak('DIGITAL', nama, total, laba);
    await call('/transaksi', token, 'POST', {
      jenis: 'produkdigital',
      metode_bayar: 'tunai',
      tanggal_transaksi: TANGGAL,
      akun_sumber: akun,
      sub_jenis: sub,
      // Untuk produk digital, laba dihitung dari admin_fee (bukan harga-modal).
      admin_fee: laba,
      items: [{ produk_id: p.id, qty: 1, harga_jual: total, harga_modal: total - laba, admin_fee: laba }],
    }, `${runTag}-dig-${i}`);
  }

  for (let i = 0; i < TARIK_TUNAI.length; i += 1) {
    const [nominal, fee] = TARIK_TUNAI[i];
    cetak('TARIK ', 'SeaBank → Tunai Laci', nominal, fee);
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

  console.log(`\n  selesai: ${no} baris (14 jual + 19 digital + 2 tarik tunai)`);
}

main().catch((e) => {
  console.error('  GAGAL:', e.message);
  process.exit(1);
});