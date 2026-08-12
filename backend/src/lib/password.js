// PBKDF2-HMAC-SHA256 dengan parameter untuk Workers Free (10ms CPU/request).
// Jalur utama: crypto.subtle native (BoringSSL) pada iterasi <= 100.000.
// Iterasi final 12.000 diukur langsung di Workers runtime via Metrics cpuTimeMs
// (~5.2ms p50 => margin ~48% dari budget 10ms). Lihat docs/PBKDF2_WORKERS.md.
// Fallback pure-JS HANYA untuk memverifikasi hash legacy ber-iterasi >100k
// (era 210k) yang ditolak crypto.subtle di workerd (NotSupportedError).
const PBKDF2_ITERATIONS = 12000;
const MAX_NATIVE_ITER = 100000;
const MAX_LEGACY_ITER = 1000000;
const KEY_LEN = 32;
const enc = new TextEncoder();

const b64encode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function pbkdf2Native(password, salt, iterations) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    keyMaterial,
    KEY_LEN * 8
  );
  return new Uint8Array(bits);
}

// ---- SHA-256 (FIPS 180-4) murni JS, dipakai hanya oleh fallback legacy ----
const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const rotr = (x, n) => ((x >>> n) | (x << (32 - n))) | 0;

function sha256(msg /* Uint8Array */) {
  const h = new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const l = msg.length;
  const lenBitsHi = Math.floor((l * 8) / 0x100000000);
  const lenBitsLo = (l * 8) >>> 0;
  const pad = (56 - ((l + 1) % 64) + 64) % 64;
  const total = l + 1 + pad + 8;
  const buf = new Uint8Array(total);
  buf.set(msg);
  buf[l] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, lenBitsHi);
  dv.setUint32(total - 4, lenBitsLo);
  const w = new Int32Array(64);
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getInt32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let A = a, B = b, C = c, D = d, E = e, F = f, G = g, H = hh;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const ch = (E & F) ^ (~E & G);
      const t1 = (H + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const maj = (A & B) ^ (A & C) ^ (B & C);
      const t2 = (S0 + maj) | 0;
      H = G; G = F; F = E; E = (D + t1) | 0; D = C; C = B; B = A; A = (t1 + t2) | 0;
    }
    a = (a + A) | 0; b = (b + B) | 0; c = (c + C) | 0; d = (d + D) | 0;
    e = (e + E) | 0; f = (f + F) | 0; g = (g + G) | 0; hh = (hh + H) | 0;
  }
  const out = new Uint8Array(32);
  const dvOut = new DataView(out.buffer);
  [a, b, c, d, e, f, g, hh].forEach((v, i) => dvOut.setInt32(i * 4, v));
  return out;
}

function hmacSha256(key, msg) {
  if (key.length > 64) key = sha256(key);
  const kp = new Uint8Array(64);
  kp.set(key);
  const oKey = new Uint8Array(64);
  const iKey = new Uint8Array(64);
  for (let i = 0; i < 64; i++) { oKey[i] = kp[i] ^ 0x5c; iKey[i] = kp[i] ^ 0x36; }
  const inner = new Uint8Array(64 + msg.length);
  inner.set(iKey);
  inner.set(msg, 64);
  const outer = new Uint8Array(64 + 32);
  outer.set(oKey);
  outer.set(sha256(inner), 64);
  return sha256(outer);
}

function pbkdf2Js(password, salt, iterations) {
  const pw = enc.encode(password);
  const block = new Uint8Array(salt.length + 4);
  block.set(salt);
  new DataView(block.buffer).setUint32(salt.length, 1, false);
  let t = hmacSha256(pw, block);
  const out = new Uint8Array(t);
  for (let i = 1; i < iterations; i++) {
    t = hmacSha256(pw, t);
    for (let j = 0; j < out.length; j++) out[j] ^= t[j];
  }
  return out;
}

async function pbkdf2(password, salt, iterations) {
  if (iterations <= MAX_NATIVE_ITER) return pbkdf2Native(password, salt, iterations);
  return pbkdf2Js(password, salt, iterations);
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$v1$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'v1') return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1 || iterations > MAX_LEGACY_ITER) return false;
  let salt, expected;
  try {
    salt = b64decode(parts[3]);
    expected = b64decode(parts[4]);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i += 1) diff |= actual[i] ^ expected[i];
  return diff === 0;
}

export const randomToken = (bytes = 32) =>
  b64encode(crypto.getRandomValues(new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
