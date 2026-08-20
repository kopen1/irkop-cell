// Payments route — POST /api/payments, GET /api/payments
// Mendukung: Split Payment, Bayar Kurang, Cicilan, Multi-Akun
import { json, err } from '../lib/errors.js';
import { requireAuth } from '../lib/auth.js';
import { writeAudit } from '../lib/audit.js';
import { nowIso } from '../lib/time.js';

export async function handlePayments(request, env, ctx) {
  const url = new URL(request.url);
  const method = request.method;
  const db = env.DB;

  if (method === 'GET') {
    return listPayments(request, db);
  }
  if (method === 'POST') {
    return createPayment(request, db, ctx);
  }
  return err(405, 'method_not_allowed', 'Method tidak valid');
}

async function listPayments(request, db) {
  const url = new URL(request.url);
  const transaksiId = url.searchParams.get('transaksi_id');
  
  if (!transaksiId) {
    return err(400, 'missing_field', 'transaksi_id wajib diisi');
  }

  const payments = await db.prepare(
    'SELECT * FROM payments WHERE transaksi_id = ? ORDER BY created_at ASC'
  ).bind(transaksiId).all();

  return json({ items: payments });
}

async function createPayment(request, db, ctx) {
  const { user } = ctx.auth;
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return err(400, 'invalid_json', 'Body request bukan JSON valid');
  }
  if (!body) return err(400, 'missing_field', 'Body request kosong');

  // Validasi input
  if (!body.transaksi_id) {
    return err(400, 'missing_field', 'transaksi_id wajib diisi');
  }
  if (!body.metode || !['tunai', 'transfer', 'bon'].includes(body.metode)) {
    return err(400, 'invalid_value', 'metode harus tunai, transfer, atau bon');
  }
  if (!body.nominal || body.nominal <= 0) {
    return err(400, 'invalid_value', 'nominal harus > 0');
  }

  // Cek transaksi
  const tx = await db.prepare(
    'SELECT * FROM transaksi WHERE id = ? AND deleted_at IS NULL'
  ).bind(body.transaksi_id).first();
  
  if (!tx) {
    return err(404, 'not_found', 'Transaksi tidak ditemukan');
  }

  // Cek sisa tagihan
  const sisa = tx.sisa || 0;
  if (sisa <= 0) {
    return err(400, 'already_paid', 'Transaksi sudah lunas');
  }
  if (body.nominal > sisa) {
    return err(400, 'overpay', `Nominal melebihi sisa tagihan (${sisa})`);
  }

  // Validasi akun untuk transfer
  let akunId = null;
  if (body.metode === 'transfer') {
    if (!body.akun_id) {
      return err(400, 'missing_field', 'Transfer wajib menyertakan akun_id');
    }
    const akun = await db.prepare(
      'SELECT * FROM akun_master WHERE nama_akun = ?'
    ).bind(body.akun_id).first();
    if (!akun) {
      return err(404, 'not_found', 'Akun tidak ditemukan');
    }
    akunId = akun.nama_akun;
  }

  // Insert payment
  const now = nowIso();
  const result = await db.prepare(
    `INSERT INTO payments (transaksi_id, metode, akun_id, nominal, catatan, dibuat_oleh, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    body.transaksi_id,
    body.metode,
    akunId,
    body.nominal,
    body.catatan || null,
    user.id,
    now
  ).run();

  // Update sisa dan status bayar transaksi
  const newSisa = sisa - body.nominal;
  const newStatus = newSisa <= 0 ? 'lunas' : 'sebagian';
  
  await db.prepare(
    'UPDATE transaksi SET sisa = ?, status_bayar = ?, updated_at = ? WHERE id = ?'
  ).bind(newSisa, newStatus, now, body.transaksi_id).run();

  // Buat mutasi sesuai metode
  await createPaymentMutasi(db, tx, body, user);

  // Audit log (optional — d1adapter tidak support exec)
  try {
    await writeAudit(db, {
      userId: user.id,
      aksi: 'create_payment',
      tabel: 'payments',
      recordId: result.lastRowId,
      dataAfter: {
        transaksi_id: body.transaksi_id,
        metode: body.metode,
        nominal: body.nominal,
        sisa_baru: newSisa
      }
    });
  } catch (e) {
    // audit optional
  }

  return json({
    id: result.lastRowId,
    transaksi_id: body.transaksi_id,
    metode: body.metode,
    akun_id: akunId,
    nominal: body.nominal,
    sisa_baru: newSisa,
    status_baru: newStatus,
    created_at: now
  });
}

async function createPaymentMutasi(db, tx, body, user) {
  const now = nowIso();
  
  // Insert mutasi sesuai metode pembayaran
  const kasirSesiId = tx.kasir_sesi_id;
  const mutationKey = `payment:${body.transaksi_id}:${body.metode}:${now}`;
  if (body.metode === 'tunai') {
    await db.prepare(
      `INSERT INTO mutasi_saldo (kasir_sesi_id, nama_akun, jumlah, kategori, sumber_tipe, sumber_id, mutation_key, created_at)
       VALUES (?, 'Tunai Laci', ?, 'pendapatan', 'transaksi', ?, ?, ?)`
    ).bind(kasirSesiId, body.nominal, tx.id, mutationKey, now).run();
  } else if (body.metode === 'transfer') {
    await db.prepare(
      `INSERT INTO mutasi_saldo (kasir_sesi_id, nama_akun, jumlah, kategori, sumber_tipe, sumber_id, mutation_key, created_at)
       VALUES (?, ?, ?, 'pendapatan_transfer', 'transaksi', ?, ?, ?)`
    ).bind(kasirSesiId, body.akun_id, body.nominal, tx.id, mutationKey, now).run();
  }
  // bon tidak membuat mutasi baru (hutang)
}