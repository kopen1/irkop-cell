import { readBody } from '../lib/validate.js';
import { opening, closing, sessionStatus, reminderKasirBelumClosing } from '../financial/kasir.js';

export async function doOpening(db, request, ctx) {
  const body = await readBody(request);
  return opening(db, { body, user: ctx.auth.user, ip: clientIp(request) });
}

export async function doClosing(db, request, ctx) {
  const body = await readBody(request);
  return closing(db, { body, user: ctx.auth.user, ip: clientIp(request) });
}

export async function current(db, request, ctx) {
  const url = new URL(request.url);
  const tanggal = url.searchParams.get('tanggal') || undefined;
  const kasirSesiId = url.searchParams.get('kasir_sesi_id');
  return sessionStatus(db, { date: tanggal, kasirSesiId: kasirSesiId ? Number(kasirSesiId) : null });
}

export async function reminderClosing(db, request, ctx) {
  return reminderKasirBelumClosing(db, { user: ctx.auth.user, ip: clientIp(request) });
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for')?.split(',')[0] || null;
}