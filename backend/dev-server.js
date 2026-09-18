// =====================================================================
// Backend dev server LOKAL (tanpa workerd/wrangler).
// Menjalankan Worker `fetch` langsung di Node + SQLite (node:sqlite).
// Data tersimpan di ./backend/.dev-data/irkop.db (persist antar restart).
//
//   npm run dev:local
//
// Frontend dev arahkan proxy ke http://localhost:8787
// (VITE_API_PROXY=http://localhost:8787)
// =====================================================================
import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import worker from './src/index.js';
import { makeD1 } from './tests/d1adapter.js';
import { hashPassword } from './src/lib/password.js';
import { nowIso } from './src/lib/time.js';
import { seedIfEmpty } from './seed.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '.dev-data');
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, 'irkop.db');

// --fresh: hapus DB lama SEBELUM dibuka (reset bersih). Pakai:
//   npm run dev:local -- --fresh
// (Jangan hapus file .dev-data saat server sedang jalan.)
if (process.argv.includes('--fresh')) {
  rmSync(DB_PATH, { force: true });
  rmSync(`${DB_PATH}-wal`, { force: true });
  rmSync(`${DB_PATH}-shm`, { force: true });
  console.log('[dev] --fresh: data lokal direset');
}

const sqliteDb = new DatabaseSync(DB_PATH);
sqliteDb.exec('PRAGMA foreign_keys = ON');

// ---- Terapkan migrasi (sekali saja, dilacak di _dev_migrations) ----
sqliteDb.exec('CREATE TABLE IF NOT EXISTS _dev_migrations (name TEXT PRIMARY KEY, applied_at TEXT)');
const applied = new Set(sqliteDb.prepare('SELECT name FROM _dev_migrations').all().map((r) => r.name));
const migDir = join(__dirname, 'migrations');
for (const name of readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort()) {
  if (applied.has(name)) continue;
  try {
    sqliteDb.exec(readFileSync(join(migDir, name), 'utf8'));
    sqliteDb.prepare('INSERT INTO _dev_migrations (name, applied_at) VALUES (?, ?)').run(name, nowIso());
    console.log(`[migrate] applied ${name}`);
  } catch (e) {
    console.warn(`[migrate] skip ${name}: ${e.message}`);
  }
}

// ---- Seed admin pertama bila belum ada user ----
const userCount = sqliteDb.prepare('SELECT COUNT(*) AS c FROM users').get().c;
if (!userCount) {
  const hash = await hashPassword('admin1234');
  sqliteDb.prepare(
    'INSERT INTO users (nama, username, password_hash, role, aktif, created_at) VALUES (?, ?, ?, ?, 1, ?)'
  ).run('Admin', 'admin', hash, 'admin', nowIso());
  console.log('[seed] admin dibuat → username: admin, password: admin1234');
}

// ---- Seed daftar barang contoh bila masih kosong ----
seedIfEmpty(sqliteDb, (msg) => console.log(msg));

const env = {
  DB: makeD1(sqliteDb),
  JWT_SECRET: process.env.JWT_SECRET || 'irkop-dev-secret',
  TOKEN_TTL: process.env.TOKEN_TTL || '2592000',
};

const PORT = Number(process.env.PORT || 8787);

const server = http.createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const host = req.headers.host || `localhost:${PORT}`;
    const url = `http://${host}${req.url}`;
    const init = { method: req.method, headers: req.headers };
    if (req.method !== 'GET' && req.method !== 'HEAD' && body.length) init.body = body;
    const request = new Request(url, init);
    const response = await worker.fetch(request, env);
    const headers = {};
    response.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(response.status, headers);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch (e) {
    console.error('[dev-server] error:', e);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'internal', message: String(e?.message || e) } }));
  }
});

server.listen(PORT, () => {
  console.log(`\nBackend dev jalan di http://localhost:${PORT}`);
  console.log(`DB: ${DB_PATH}`);
  console.log('Frontend: VITE_API_PROXY=http://localhost:8787 npm run dev\n');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[dev] Port ${PORT} sudah dipakai proses lain.`);
    console.error('[dev] Matikan dev-server yang lama dulu (mis. Ctrl+C di terminal itu, atau jalankan: pkill -f "node dev-server.js").\n');
  } else {
    console.error('[dev] error:', e);
  }
  process.exit(1);
});
