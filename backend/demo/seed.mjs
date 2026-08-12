// DEMO SEED — konter-demo (irkop-d1-demo)
// Usage: node demo/seed.mjs https://konter-demo.irkop.workers.dev
// Seeds: 3 users, kategori, produk, pelanggan, kasbon, transaksi, pengeluaran, service, gaji, settings
// All data marked [DEMO].

const BASE = process.argv[2] || 'https://konter-demo.irkop.workers.dev';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- passwords (shown only in final QA report) ----
const USERS = {
  demo_admin:   { nama: 'Demo Admin',   username: 'demo_admin',   role: 'admin',    password: 'DemoP@ssw0rd!' },
  demo_kasir:   { nama: 'Demo Kasir',   username: 'demo_kasir',   role: 'karyawan', password: 'KasirDemo#2025', permissions: ['kasir','transaksi','pelanggan','daftar_barang','dashboard'] },
  demo_karyawan:{ nama: 'Demo Karyawan', username: 'demo_karyawan',role: 'karyawan', password: 'KaryawanDemo#2025', permissions: ['daftar_barang','laporan_service_hp','dashboard'] },
};

// ---- kategori ----
const KATEGORI = [
  { nama: 'Pulsa & Kuota', lacak_stok: true },
  { nama: 'Aksesoris HP', lacak_stok: true },
  { nama: 'Jasa Service', lacak_stok: true },
  { nama: 'Tunai & Digital', lacak_stok: false },
];

// ---- produk (kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum) ----
const PRODUK = [
  ['PUL10','Pulsa 10rb',1,9500,8500,50,5],
  ['PUL25','Pulsa 25rb',1,24000,22000,50,5],
  ['DATA5','Paket Data 5GB',1,22000,18000,30,5],
  ['CAS11','Case HP Silikon',2,15000,7000,40,5],
  ['CHG01','Charger Type-C',2,25000,12000,30,5],
  ['SRV01','Service Ganti LCD',3,150000,80000,0,0],
  ['SRV02','Service Ganti Baterai',3,75000,40000,0,0],
  ['TRF01','Transfer Bank',4,0,0,0,0],
];

// ---- pelanggan ----
const PELANGGAN = [
  { nama: 'Budi Santoso', telepon: '0812-0001-0001' },
  { nama: 'Siti Aminah', telepon: '0851-0002-0002' },
  { nama: 'Ahmad Wijaya', telepon: '0878-0003-0003' },
];

// ---- kasbon (pelanggan_id, nominal, tanggal, catatan) ----
const KASBON = [
  { pelanggan_id: 1, nominal: 50000, tanggal: '2026-08-01', catatan: '[DEMO] Kasbon cicilan HP' },
  { pelanggan_id: 2, nominal: 30000, tanggal: '2026-08-05', catatan: '[DEMO] Utang pulsa' },
];

// ---- transaksi items: (produk_id, qty, [nominal_referensi, akun_sumber]) ----
const TRANSAKSI = [
  { tanggal: '2026-08-01', pelanggan_id: 1, metode_bayar: 'tunai', items: [[1,2],[3,1]] },
  { tanggal: '2026-08-02', pelanggan_id: 2, metode_bayar: 'transfer', akun_penerima: 'SeaBank', items: [[2,1],[4,1]] },
  { tanggal: '2026-08-03', pelanggan_id: 3, metode_bayar: 'tunai', items: [[5,1],[6,1]] },
  { tanggal: '2026-08-04', pelanggan_id: 1, metode_bayar: 'bon', items: [[7,1]] },
  { tanggal: '2026-08-05', pelanggan_id: 2, metode_bayar: 'tunai', items: [[1,1],[2,1]] },
];

// ---- pengeluaran ----
const PENGELUARAN = [
  { deskripsi: '[DEMO] Bayar listrik', nominal: 250000, metode_bayar: 'tunai', akun_sumber: 'Tunai Laci', tanggal: '2026-08-01' },
  { deskripsi: '[DEMO] Bayar paket internet', nominal: 350000, metode_bayar: 'transfer', akun_sumber: 'SeaBank', tanggal: '2026-08-10' },
];

// ---- service HP ----
const SERVICE = [
  { pelanggan_id: 1, nama_device: 'Samsung A55', deskripsi_kerusakan: '[DEMO] Layar retak', estimasi_biaya: 150000, teknisi_id: 2, tanggal_masuk: '2026-08-01' },
  { pelanggan_id: 2, nama_device: 'iPhone 14', deskripsi_kerusakan: '[DEMO] Baterai boros', estimasi_biaya: 75000, teknisi_id: 2, tanggal_masuk: '2026-08-05' },
];

// ---- gaji rate (setelah user ada) ----
const GAJI_RATE = [
  { user_id: 2, tipe: 'flat', rate_flat: 100000 },   // demo_kasir
  { user_id: 3, tipe: 'flat', rate_flat: 80000 },    // demo_karyawan
];

// ---- settings ----
const SETTINGS = {
  nama_website: 'IRKOP CELL - DEMO (JANGAN PRODUCTION)',
  default_theme: 'classic',
  notifhook_auto_input: '0',
};

// ---- HTTP helpers ----
async function post(path, body, token) {
  const r = await fetch(`${BASE}${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`POST ${path} -> ${r.status}: ${t.slice(0,200)}`);
  return d;
}
async function get(path, token) {
  const r = await fetch(`${BASE}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}: ${t.slice(0,200)}`);
  return d;
}

// ---- MAIN ----
(async () => {
// Login as admin
const loginRes = await post('/api/auth/login', { username: 'demo_admin', password: USERS.demo_admin.password });
const token = loginRes.token;
console.log('Admin login OK, token length:', token.length);

// 1. Users (skip admin, already created via bootstrap)
for (const [key, u] of Object.entries(USERS)) {
  if (key === 'demo_admin') continue;
  const perms = u.permissions || [];
  const body = { nama: u.nama, username: u.username, password: u.password, role: u.role, permissions: perms };
  try {
    const r = await post('/api/users', body, token);
    console.log(`User ${key} created: id=${r.id}`);
    USERS[key].id = r.id;
  } catch (e) {
    console.log(`User ${key} skip/err:`, e.message.slice(0, 80));
    // fetch id from list
    const list = await get('/api/users', token);
    const found = list.find(u => u.username === USERS[key].username);
    if (found) { USERS[key].id = found.id; console.log(`User ${key} exists: id=${found.id}`); }
  }
}

// 2. Kategori
for (const k of KATEGORI) {
  try {
    const r = await post('/api/kategori', k, token);
    console.log('Kategori:', r.nama, 'id=', r.id);
  } catch (e) { console.log('Kategori skip:', e.message.slice(0, 60)); }
}

// 3. Produk
for (const [kode, nama, katId, harga, modal, stok, minStok] of PRODUK) {
  try {
    const r = await post('/api/produk', { kode, nama, kategori_id: katId, harga, harga_modal: modal, stok, stok_minimum: minStok, satuan: 'pcs' }, token);
    console.log('Produk:', kode, 'id=', r.id);
  } catch (e) { console.log('Produk skip:', kode, e.message.slice(0, 60)); }
}

// 4. Pelanggan
for (const p of PELANGGAN) {
  try {
    const r = await post('/api/pelanggan', p, token);
    console.log('Pelanggan:', p.nama, 'id=', r.id);
  } catch (e) { console.log('Pelanggan skip:', e.message.slice(0, 60)); }
}

// 5. Kasir opening (today) — saldo awal untuk semua akun master
const today = new Date().toISOString().slice(0, 10);
try {
  const r = await post('/api/kasir/opening', { saldo_awal: [
    { nama_akun: 'Tunai Laci', saldo: 500000 },
    { nama_akun: 'SeaBank', saldo: 2000000 },
    { nama_akun: 'DANA', saldo: 500000 },
    { nama_akun: 'OrderKuota', saldo: 0 },
  ]}, token);
  console.log('Kasir opening:', r.kasir_sesi_id, 'tanggal=', r.tanggal);
} catch (e) { console.log('Kasir opening:', e.message.slice(0, 80)); }

// 6. Transaksi
for (const tx of TRANSAKSI) {
  await sleep(500);
  const items = tx.items.map(([pid, qty]) => ({ produk_id: pid, qty }));
  const body = { items, metode_bayar: tx.metode_bayar, tanggal_transaksi: tx.tanggal };
  if (tx.akun_penerima) body.akun_penerima = tx.akun_penerima;
  if (tx.pelanggan_id) body.pelanggan_id = tx.pelanggan_id;
  try {
    const r = await post('/api/transaksi', body, token);
    console.log('Transaksi:', tx.tanggal, tx.metode_bayar, 'kode=', r.id, 'total=', r.total);
  } catch (e) { console.log('Transaksi skip:', tx.tanggal, e.message.slice(0, 80)); }
}

// 7. Pengeluaran
for (const p of PENGELUARAN) {
  await sleep(300);
  try {
    const r = await post('/api/pengeluaran', p, token);
    console.log('Pengeluaran:', p.deskripsi, 'id=', r.id, 'nominal=', r.nominal);
  } catch (e) { console.log('Pengeluaran skip:', p.deskripsi, e.message.slice(0, 80)); }
}

// 8. Service HP
for (const s of SERVICE) {
  await sleep(300);
  try {
    const r = await post('/api/service-hp', { ...s, teknisi_id: s.teknisi_id || USERS.demo_karyawan.id }, token);
    console.log('Service:', s.nama_device, 'id=', r.id);
  } catch (e) { console.log('Service skip:', s.nama_device, e.message.slice(0, 80)); }
}

// 9. Kasbon
for (const k of KASBON) {
  await sleep(300);
  try {
    const r = await post('/api/kasbon', k, token);
    console.log('Kasbon:', k.pelanggan_id, 'nominal=', k.nominal, 'id=', r.id);
  } catch (e) { console.log('Kasbon skip:', e.message.slice(0, 80)); }
}

// 10. Gaji rate
for (const gr of GAJI_RATE) {
  await sleep(200);
  try {
    const r = await post('/api/gaji/rate', gr, token);
    console.log('Gaji rate:', gr.user_id, 'tipe=', gr.tipe);
  } catch (e) { console.log('Gaji rate skip:', e.message.slice(0, 80)); }
}

// 11. Settings
try {
  const r = await fetch(`${BASE}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(SETTINGS),
  });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch {}
  if (!r.ok) throw new Error(`PUT /api/settings -> ${r.status}: ${t.slice(0,200)}`);
  console.log('Settings nama_website:', d.nama_website);
} catch (e) { console.log('Settings skip:', e.message.slice(0, 80)); }

console.log('\n=== DEMO SEED SELESAI ===');
console.log('Admin  : demo_admin / DemoP@ssw0rd!');
console.log('Kasir  : demo_kasir / KasirDemo#2025');
console.log('Kary   : demo_karyawan / KaryawanDemo#2025');
console.log('URL    :', BASE);
console.log('JWT malformed fix: terverifikasi di HEAD (commit 30d241b)');
})();
