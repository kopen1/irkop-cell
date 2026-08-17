import { createDb } from './lib/db.js';
import { handleError, json } from './lib/errors.js';
import { authenticate, buildCtx, requirePage, requireAdmin } from './lib/auth.js';
import { readBody } from './lib/validate.js';

import * as authRoutes from './routes/auth.js';
import * as usersRoutes from './routes/users.js';
import * as kasirRoutes from './routes/kasir.js';
import * as produkRoutes from './routes/produk.js';
import * as transaksiRoutes from './routes/transaksi.js';
import * as pengeluaranRoutes from './routes/pengeluaran.js';
import * as pelangganRoutes from './routes/pelanggan.js';
import * as kasbonRoutes from './routes/kasbon.js';
import * as serviceRoutes from './routes/service.js';
import * as gajiRoutes from './routes/gaji.js';
import * as akunRoutes from './routes/akun.js';
import * as settingsRoutes from './routes/settings.js';
import * as logsRoutes from './routes/logs.js';
import * as notifhookRoutes from './routes/notifhook.js';
import * as laporanRoutes from './routes/laporan.js';
import * as tarifRoutes from './financial/tarif.js';

function method(req) {
  return req.method.toUpperCase();
}

function match(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return null;
  const seg = parts.slice(1);
  if (seg.length && seg[0] === 'auth') {
    return { name: 'auth', param: seg[1] ?? null, rest: seg };
  }
  if (seg.length && seg[0] === 'notifhook') {
    return { name: 'notifhook', param: seg[1] ?? null, rest: seg };
  }
  if (seg.length === 3 && seg[2] === 'permissions') {
    return { name: 'permissions', param: seg[1], rest: seg };
  }
  if (seg.length === 3 && seg[0] === 'transaksi' && seg[2] === 'konfirmasi') {
    return { name: 'transaksi', param: seg[1], rest: seg };
  }
  if (seg.length === 3 && seg[0] === 'kasbon' && seg[2] === 'payment') {
    return { name: 'kasbon', param: seg[1], rest: seg };
  }
  if (seg.length === 2 && seg[1] === 'merge') {
    return { name: 'merge', param: seg[0], rest: seg };
  }
  if (seg.length === 2) {
    return { name: seg[0], param: seg[1], rest: seg };
  }
  if (seg.length === 1) {
    return { name: seg[0], param: null, rest: seg };
  }
  return null;
}

const PAGE_GUARD = {
  transaksi: 'transaksi',
  produk: 'daftar_barang',
  kategori: 'daftar_barang',
  pelanggan: 'pelanggan',
  kasbon: 'kasbon',
  'service-hp': 'laporan_service_hp',
  pengeluaran: 'pengeluaran',
  kasir: 'kasir',
  laporan: 'laporan',
};

async function dispatch(db, request, ctx, route) {
  const m = method(request);
  const { name, param } = route;
  const idKey = request.headers.get('Idempotency-Key');
  ctx.idempotencyKey = idKey;

  switch (name) {
    case 'auth':
      if (m === 'POST' && param === 'login') return authRoutes.login(db, request, ctx.env);
      if (m === 'POST' && param === 'logout') return authRoutes.logout(db, request, ctx);
      if (m === 'GET' && param === 'me') return authRoutes.me(db, request, ctx);
      if (m === 'GET' && param === 'permissions') {
        requireAdmin(ctx);
        return usersRoutes.listUsers(db, request, ctx);
      }
      break;

    case 'notifhook':
      if (m === 'POST' && !param) return notifhookRoutes.webhookNotifHook(db, request, ctx.env);
      break;

    case 'users':
      requireAdmin(ctx);
      if (m === 'GET' && !param) return usersRoutes.listUsers(db, request, ctx);
      if (m === 'POST' && !param) return usersRoutes.createUser(db, request, ctx);
      if (m === 'PUT' && param) return usersRoutes.updateUser(db, request, ctx, param);
      break;

    case 'permissions':
      requireAdmin(ctx);
      if (m === 'PUT') return usersRoutes.setUserPermissions(db, request, ctx, param);
      break;

    case 'kasir':
      requirePage(ctx, 'kasir');
      if (m === 'POST' && param === 'opening') return kasirRoutes.doOpening(db, request, ctx);
      if (m === 'POST' && param === 'closing') return kasirRoutes.doClosing(db, request, ctx);
      if (m === 'GET' && param === 'current') return kasirRoutes.current(db, request, ctx);
      if (m === 'GET' && param === 'reminder-closing') return kasirRoutes.reminderClosing(db, request, ctx);
      break;

    case 'transaksi': {
      requirePage(ctx, 'transaksi');
      if (m === 'GET' && !param) return transaksiRoutes.listTransaksi(db, request, ctx);
      if (m === 'POST' && !param) {
        const body = await readBody(request);
        return transaksiRoutes.createTransaksi(db, body, ctx, request);
      }
      if (m === 'PUT' && param && route.rest?.[2] === 'konfirmasi') {
        const body = await readBody(request);
        return transaksiRoutes.updateKonfirmasi(db, body, ctx, param);
      }
      if (m === 'GET' && param) return transaksiRoutes.getTransaksi(db, request, ctx, param);
      if (m === 'PUT' && param) {
        const body = await readBody(request);
        return transaksiRoutes.updateTransaksi(db, body, ctx, param);
      }
      if (m === 'DELETE' && param) {
        const body = request.bodyUsed ? await readBody(request).catch(() => ({})) : {};
        return transaksiRoutes.softDeleteTransaksi(db, body, ctx, param);
      }
      break;
    }

    case 'pengeluaran': {
      requirePage(ctx, 'pengeluaran');
      if (m === 'GET' && !param) return pengeluaranRoutes.listPengeluaran(db, request, ctx);
      if (m === 'POST' && !param) {
        const body = await readBody(request);
        return pengeluaranRoutes.createPengeluaran(db, body, ctx, request);
      }
      if (m === 'GET' && param) return pengeluaranRoutes.getPengeluaran(db, request, ctx, param);
      if (m === 'PUT' && param) {
        const body = await readBody(request);
        return pengeluaranRoutes.updatePengeluaran(db, body, ctx, param);
      }
      if (m === 'DELETE' && param) {
        const body = request.bodyUsed ? await readBody(request).catch(() => ({})) : {};
        return pengeluaranRoutes.deletePengeluaran(db, body, ctx, param);
      }
      break;
    }

    case 'produk':
      requirePage(ctx, 'daftar_barang');
      if (m === 'GET' && !param) return produkRoutes.listProduk(db, request, ctx);
      if (m === 'POST' && !param) return produkRoutes.createProduk(db, request, ctx);
      if (m === 'PUT' && param) return produkRoutes.updateProduk(db, request, ctx, param);
      if (m === 'DELETE' && param) return produkRoutes.deleteProduk(db, request, ctx, param);
      break;

    case 'kategori':
      requirePage(ctx, 'daftar_barang');
      if (m === 'GET' && !param) return produkRoutes.listKategori(db, request, ctx);
      if (m === 'POST' && !param) return produkRoutes.createKategori(db, request, ctx);
      if (m === 'PUT' && param) return produkRoutes.updateKategori(db, request, ctx, param);
      if (m === 'DELETE' && param) return produkRoutes.deleteKategori(db, request, ctx, param);
      break;

    case 'pelanggan':
      requirePage(ctx, 'pelanggan');
      if (m === 'GET' && !param) return pelangganRoutes.listPelanggan(db, request, ctx);
      if (m === 'POST' && !param) return pelangganRoutes.createPelanggan(db, request, ctx);
      if (m === 'GET' && param) return pelangganRoutes.getPelanggan(db, request, ctx, param);
      break;

    case 'merge':
      requirePage(ctx, 'pelanggan');
      if (m === 'POST') return pelangganRoutes.mergePelanggan(db, request, ctx);
      break;

    case 'kasbon':
      requirePage(ctx, 'kasbon');
      if (m === 'GET' && !param) return kasbonRoutes.listKasbon(db, request, ctx);
      if (m === 'POST' && !param) return kasbonRoutes.createKasbon(db, request, ctx);
      if (m === 'POST' && param && route.rest?.[2] === 'payment') return kasbonRoutes.payKasbon(db, request, ctx, param);
      if (m === 'PUT' && param) return kasbonRoutes.updateKasbon(db, request, ctx, param);
      break;

    case 'service-hp':
      requirePage(ctx, 'laporan_service_hp');
      if (m === 'GET' && !param) return serviceRoutes.listService(db, request, ctx);
      if (m === 'POST' && !param) return serviceRoutes.createService(db, request, ctx);
      if (m === 'PUT' && param) return serviceRoutes.updateService(db, request, ctx, param);
      break;

    case 'gaji':
      requireAdmin(ctx);
      if (m === 'GET' && !param) return gajiRoutes.listGaji(db, request, ctx);
      if (m === 'POST' && !param) return gajiRoutes.createGajiManual(db, request, ctx);
      if (m === 'PUT' && param && param !== 'rate') return gajiRoutes.updateGaji(db, request, ctx, param);
      if (m === 'GET' && param === 'rate') return gajiRoutes.listRateGaji(db, request, ctx);
      if (m === 'POST' && param === 'rate') return gajiRoutes.setRateGaji(db, request, ctx);
      break;

    case 'akun':
      if (m === 'GET' && !param) return akunRoutes.listAkun(db, request, ctx);
      if (m === 'POST' && !param) return akunRoutes.createAkun(db, request, ctx);
      if (m === 'PUT' && param) return akunRoutes.updateAkun(db, request, ctx, param);
      break;

    case 'laporan':
      requirePage(ctx, 'laporan');
      if (m === 'GET' && param === 'bulan') return laporanRoutes.reportBulanan(db, request, ctx);
      if (m === 'GET' && param === 'tahun') return laporanRoutes.reportTahunan(db, request, ctx);
      if (m === 'GET' && param === 'akun') return laporanRoutes.rekapPerAkun(db, request, ctx);
      if (m === 'GET' && param === 'export') return laporanRoutes.exportLaporan(db, request, ctx);
      break;

    case 'tarif': {
      requirePage(ctx, 'transaksi');
      const url = new URL(request.url);
      const provider = url.searchParams.get('provider');
      const nominal = url.searchParams.get('nominal');
      try {
        const admin = await tarifRoutes.hitungAdmin(db, provider, nominal);
        return json({ provider, nominal: Number(nominal), admin });
      } catch (e) {
        return json({ error: { code: e.code || 'error', message: e.message } }, 400);
      }
    }

    case 'settings':
      if (m === 'GET' && !param) return settingsRoutes.getSettings(db, request, ctx);
      if (m === 'PUT' && !param) return settingsRoutes.updateSettings(db, request, ctx);
      if (m === 'POST' && param === 'generate') return settingsRoutes.generateNotifhookKey(db, request, ctx);
      if (m === 'POST' && param === 'notifhook-source') return settingsRoutes.upsertNotifhookSource(db, request, ctx);
      break;

    case 'logs':
      if (m === 'GET') return logsRoutes.listLogs(db, request, ctx);
      break;
  }

  return json({ error: { code: 'not_found', message: 'Endpoint tidak ditemukan' } }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const db = createDb(env);
    const ctx = buildCtx(db, env);
    try {
      if (method(request) === 'POST' && url.pathname === '/api/auth/login') {
        const result = await authRoutes.login(db, request, env);
        return json(result);
      }

      if (method(request) === 'POST' && url.pathname === '/api/auth/bootstrap') {
        const result = await authRoutes.bootstrapFirstAdmin(db, request, env);
        return json(result);
      }

      const route = match(url.pathname);
      if (!route) {
        return json({ error: { code: 'not_found', message: 'Route tidak ditemukan' } }, 404);
      }

      if (route.name === 'notifhook') {
        return json(await dispatch(db, request, ctx, route));
      }

      ctx.auth = await authenticate(db, request, env);
      const result = await dispatch(db, request, ctx, route);
      return result instanceof Response ? result : json(result);
    } catch (e) {
      return handleError(e);
    }
  },
};