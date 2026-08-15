import { err } from './errors.js';

export const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 menit
export const LOGIN_USER_LIMIT = 5;             // max percobaan gagal per username
export const LOGIN_IP_LIMIT = 20;              // max percobaan gagal per IP (termasuk username beda)

export function getClientIp(request) {
  return (
    request.headers.get('CF-Connecting-IP') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    null
  );
}

function windowStart(now = Date.now()) {
  return Math.floor(now / LOGIN_WINDOW_MS) * LOGIN_WINDOW_MS;
}

const userBucket = (username) => `user:${username}`;
const ipBucket = (ip) => `ip:${ip}`;

async function getBucketCount(db, bucket, now = Date.now()) {
  const row = await db.one('SELECT count, window_start FROM login_attempt WHERE bucket = ?', bucket);
  if (!row) return 0;
  if (now - new Date(row.window_start).getTime() >= LOGIN_WINDOW_MS) return 0; // window expired
  return Number(row.count);
}

export async function checkLoginAttempt(db, { username, ip, now = Date.now() }) {
  if (await getBucketCount(db, userBucket(username), now) >= LOGIN_USER_LIMIT) {
    return { limited: true, bucket: userBucket(username), retryAfter: Math.ceil(LOGIN_WINDOW_MS / 1000) };
  }
  if (ip && (await getBucketCount(db, ipBucket(ip), now)) >= LOGIN_IP_LIMIT) {
    return { limited: true, bucket: ipBucket(ip), retryAfter: Math.ceil(LOGIN_WINDOW_MS / 1000) };
  }
  return { limited: false };
}

export async function recordFailure(db, { username, ip, now = Date.now() }) {
  const ws = new Date(windowStart(now)).toISOString();
  const ts = new Date(now).toISOString();
  const buckets = [userBucket(username)];
  if (ip) buckets.push(ipBucket(ip));
  for (const bucket of buckets) {
    await db.exec(
      `INSERT INTO login_attempt (bucket, count, window_start, updated_at)
       VALUES (?, 1, ?, ?)
       ON CONFLICT(bucket) DO UPDATE SET
         count       = CASE WHEN login_attempt.window_start = excluded.window_start
                            THEN login_attempt.count + 1 ELSE 1 END,
         window_start = excluded.window_start,
         updated_at  = excluded.updated_at`,
      bucket, ws, ts
    );
  }
}

export async function resetOnSuccess(db, username) {
  await db.exec('DELETE FROM login_attempt WHERE bucket = ?', userBucket(username));
}

export function assertNotLimited({ limited }) {
  if (limited) {
    throw err(429, 'rate_limited', 'Terlalu banyak percobaan login. Coba lagi nanti.');
  }
}