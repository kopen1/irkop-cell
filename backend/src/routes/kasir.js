import { readBody } from '../lib/validate.js';
import { opening, revisiOpening, closing, reopen, sessionStatus, sesiAktif, reminderKasirBelumClosing } from '../financial/kasir.js';

export async function doOpening(db, request, ctx) {
  const body = await readBody(request);
  return opening(db, { body, user: ctx.auth.user, ip: clientIp(request) });
}

export async function doRevisiOpening(db, request, ctx) {
  const body = await readBody(request);
  return revisiOpening(db, { body, user: ctx.auth.user, ip: clientIp(request) });
}

export async function doSesiAktif(db, request, ctx) {
  return sesiAktif(db);
}

export async function doClosing(db, request, ctx) {
  const body = await readBody(request);
  return closing(db, { body, user: ctx.auth.user, ip: clientIp(request) });
}

export async function doReopen(db, request, ctx) {
  const body = await readBody(request).catch(() => ({}));
  return reopen(db, { body, user: ctx.auth.user, ip: clientIp(request) });
}

export async function current(db, request, ctx) {
  const url = new URL(request.url);
  const tanggal = url.searchParams.get('tanggal') || undefined;
  const kasirSesiId = url.searchParams.get('kasir_sesi_id');
  if (tanggal || kasirSesiId) {
    return sessionStatus(db, { date: tanggal, kasirSesiId: kasirSesiId ? Number(kasirSesiId) : null });
  }
  // Tanpa parameter: pakai sesiAktif(), bukan selalu hari ini. Kalau sesi
  // lampau sengaja dibuka ulang (mis. tambah transaksi 1 Okt pada 2 Okt), halaman
  // harus tetap menampilkan SESI ITU — bukan form Opening hari ini. Kalau tidak,
  // sesi yang masih 'buka' jadi tidak terlihat dan tidak bisa ditutup.
  const aktif = await sesiAktif(db);
  if (aktif.reopened) return sessionStatus(db, { kasirSesiId: aktif.kasir_sesi_id });
  return sessionStatus(db, { date: aktif.tanggal });
}

export async function reminderClosing(db, request, ctx) {
  return reminderKasirBelumClosing(db, { user: ctx.auth.user, ip: clientIp(request) });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for')?.split(',')[0] || null;
}