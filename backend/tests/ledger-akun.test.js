import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setupEnv, call, login, createUserRaw } from './helpers.js';

async function bootstrap() {
  const { env } = setupEnv();
  await createUserRaw(env, { nama: 'Admin', username: 'admin', password: 'admin1234', role: 'admin' });
  const token = await login(env, 'admin', 'admin1234');
  return { env, token };
}

test('akun ledger (Laba/Total Saldo/Saldo Akun) tidak muncul di Master Akun', async () => {
  const { env, token } = await bootstrap();
  const r = await call(env, '/api/akun?include_inactive=true', { token });
  const names = (r.data.items || []).map((a) => a.nama_akun);
  assert.ok(!names.includes('Laba'), 'Laba tidak boleh di daftar akun');
  assert.ok(!names.includes('Total Saldo'), 'Total Saldo tidak boleh di daftar akun');
  assert.ok(!names.includes('Saldo Akun'), 'Saldo Akun tidak boleh di daftar akun');
  // akun uang seed tetap ada
  assert.ok(names.includes('Tunai Laci'));
});

test('opening & closing kasir tetap jalan walau akun ledger tidak ada di master', async () => {
  const { env, token } = await bootstrap();

  const open = await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 500000 }, { nama_akun: 'SeaBank', saldo: 1000000 }] },
  });
  assert.equal(open.status, 200);

  // payload menyertakan akun ledger (mis. dari klien lama) -> harus diabaikan, bukan error
  const close = await call(env, '/api/kasir/closing', {
    method: 'POST', token,
    body: {
      saldo_real: [
        { nama_akun: 'Tunai Laci', saldo_real: 500000 },
        { nama_akun: 'SeaBank', saldo_real: 1000000 },
        { nama_akun: 'Total Saldo', saldo_real: 0 },
        { nama_akun: 'Laba', saldo_real: 0 },
      ],
    },
  });
  assert.equal(close.status, 200);
  const names = close.data.rekonsiliasi.map((x) => x.nama_akun);
  assert.deepEqual(names.sort(), ['SeaBank', 'Tunai Laci']);
});

test('kasir sessionStatus: Total Saldo hanya dari akun uang (Laba dikecualikan)', async () => {
  const { env, token } = await bootstrap();
  await call(env, '/api/kasir/opening', {
    method: 'POST', token,
    body: { saldo_awal: [{ nama_akun: 'Tunai Laci', saldo: 500000 }, { nama_akun: 'SeaBank', saldo: 1000000 }] },
  });

  // transaksi tunai tunai -> menambah Tunai Laci + Laba
  const k = await env.DB.prepare("INSERT INTO kategori_produk (nama, lacak_stok, created_at) VALUES ('Fisik', 1, ?)").bind(new Date().toISOString()).run();
  const katId = k.meta.last_row_id;
  const p = await env.DB.prepare('INSERT INTO produk (kode, nama, kategori_id, harga, harga_modal, stok, stok_minimum, satuan, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)')
    .bind('P-1', 'Toner', katId, 100000, 70000, 10, 'pcs', new Date().toISOString()).run();
  const produkId = p.meta.last_row_id;

  const tx = await call(env, '/api/transaksi', { method: 'POST', token, body: { items: [{ produk_id: produkId, qty: 1 }], metode_bayar: 'tunai' } });
  assert.equal(tx.status, 200);

  const cur = await call(env, '/api/kasir/current', { token });
  const names = cur.data.saldo.map((s) => s.nama_akun);
  assert.ok(!names.includes('Laba'), 'Laba tidak boleh tampil di saldo kasir');
  const total = cur.data.saldo.find((s) => s.nama_akun === 'Total Saldo');
  // Total = akun uang non-Tunai Laci (SeaBank 1.000.000), tanpa Laba
  assert.equal(total.saldo_sistem, 1000000);
});
