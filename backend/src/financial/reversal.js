import { nowIso } from '../lib/time.js';

export async function reverseFullSource(db, { sumberTipe, sumberId, kasirSesiId, actionKey }) {
  const rows = await db.many(
    `SELECT nama_akun, SUM(jumlah) AS net
       FROM mutasi_saldo
      WHERE (sumber_tipe = ? AND sumber_id = ?)
         OR (sumber_tipe = 'reversal' AND sumber_id = ?)
      GROUP BY nama_akun`,
    sumberTipe,
    sumberId,
    sumberId
  );
  const stmts = [];
  for (const r of rows) {
    const net = Number(r.net);
    if (net === 0) continue;
    stmts.push(
      db.raw.prepare(
        `INSERT OR IGNORE INTO mutasi_saldo
           (kasir_sesi_id, nama_akun, jumlah, sumber_tipe, sumber_id, mutation_key, created_at)
         VALUES (?, ?, ?, 'reversal', ?, ?, ?)`
      ).bind(kasirSesiId, r.nama_akun, -net, sumberId, `reversal:${sumberTipe}:${sumberId}:${r.nama_akun}:${actionKey}`, nowIso())
    );
  }
  let applied = 0;
  if (stmts.length) {
    const { results } = await db.batch(stmts);
    applied = results.filter((r) => r.change !== 0).length;
  }
  return { reversed: stmts.length, applied };
}

export async function currentSourceNet(db, sumberTipe, sumberId) {
  const rows = await db.many(
    `SELECT nama_akun, SUM(jumlah) AS net
       FROM mutasi_saldo
      WHERE (sumber_tipe = ? AND sumber_id = ?)
         OR (sumber_tipe = 'reversal' AND sumber_id = ?)
      GROUP BY nama_akun`,
    sumberTipe,
    sumberId,
    sumberId
  );
  return rows.map((r) => ({ nama_akun: r.nama_akun, net: Number(r.net) }));
}