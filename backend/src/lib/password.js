// PBKDF2-HMAC-SHA256, 210,000 iterations — pure-JS (Workers-safe).
//
// Background (BLOCKER-3): Cloudflare Workers Web Crypto menolak PBKDF2 dengan
// iterasi > 100.000 ("NotSupportedError: iteration counts above 100000 are not
// supported"). Node tidak punya limit itu, sehingga test Node tidak menangkap
// kegagalan di Workers. Solusi: implementasi PBKDF2-HMAC-SHA256 murni JavaScript
// (RFC 2898) yang mendukung penuh 210.000 iterasi di runtime mana pun.
//
// Keamanan: parameter PRD dipertahankan (210.000 iterasi, PBKDF2-HMAC-SHA256,
// salt 16 byte acak per password). Output identik dengan crypto.subtle PBKDF2
// (standar yang sama), sehingga hash lama tetap valid tanpa migrasi.
// Performa: state SHA-256 ipad/opad di-precompute agar hanya 2 kompresi per
// iterasi (~550 ms untuk 210.000 iterasi di Node V8 / workerd V8).
const PBKDF2_ITERATIONS = 210000;
const KEY_LEN = 32;
const enc = new TextEncoder();

const b64encode = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const b64decode = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------
// SHA-256 (pure JS) — bekerja tanpa crypto.subtle
// ---------------------------------------------------------------------------
const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5,
  0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa,
  0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
  0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138,
  0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624,
  0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5,
  0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f,
  0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);

const w = new Int32Array(64);
const blk = new Uint8Array(64);
function compress(h, block) {
  blk.set(block);
  const dv = new DataView(blk.buffer);
  let i;
  for (i = 0; i < 16; i++) w[i] = dv.getInt32(i * 4);
  for (; i < 64; i++) {
    const x = w[i - 15], y = w[i - 2];
    const s0 = (x >>> 7) | (x << 25);
    const s1 = (x >>> 18) | (x << 14);
    const xr = x >>> 3;
    const s0b = (y >>> 17) | (y << 15);
    const s1b = (y >>> 19) | (y << 13);
    const yr = y >>> 10;
    w[i] = (w[i - 16] + (s0 ^ s1 ^ xr) + w[i - 7] + (s0b ^ s1b ^ yr)) | 0;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
  for (i = 0; i < 64; i++) {
    const S1 = (e >>> 6) | (e << 26);
    const S1b = (e >>> 11) | (e << 21);
    const S1c = (e >>> 25) | (e << 7);
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + (S1 ^ S1b ^ S1c) + ch + K[i] + w[i]) | 0;
    const S0 = (a >>> 2) | (a << 30);
    const S0b = (a >>> 13) | (a << 19);
    const S0c = (a >>> 22) | (a << 10);
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = ((S0 ^ S0b ^ S0c) + maj) | 0;
    hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
}

const IV = () => new Int32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);

function sha256Once(bytes) {
  const len = bytes.length;
  const padded = new Uint8Array((((len + 8) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[len] = 0x80;
  new DataView(padded.buffer).setUint32(padded.length - 4, (len << 3) >>> 0);
  const h = IV();
  for (let off = 0; off < padded.length; off += 64) compress(h, padded.subarray(off, off + 64));
  const out = new Uint8Array(32);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, h[0] >>> 0); dv.setUint32(4, h[1] >>> 0); dv.setUint32(8, h[2] >>> 0);
  dv.setUint32(12, h[3] >>> 0); dv.setUint32(16, h[4] >>> 0); dv.setUint32(20, h[5] >>> 0);
  dv.setUint32(24, h[6] >>> 0); dv.setUint32(28, h[7] >>> 0);
  return out;
}

// HMAC-SHA256 dengan state ipad/opad di-precompute (2 kompresi per HMAC).
// msg harus <= 60 byte (satu block padding).
function makePrf(keyBytes) {
  let k = keyBytes;
  if (k.length > 64) k = sha256Once(k);
  const ipad = new Uint8Array(64);
  const opad = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    ipad[i] = k[i] ^ 0x36;
    opad[i] = k[i] ^ 0x5c;
  }
  const ipadState = IV();
  const opadState = IV();
  compress(ipadState, ipad);
  compress(opadState, opad);
  const st = new Int32Array(8);
  const msgBlock = new Uint8Array(64);
  const out32 = new Uint8Array(32);
  const dv = new DataView(out32.buffer);
  return (msg) => {
    st.set(ipadState);
    msgBlock.fill(0);
    msgBlock.set(msg);
    msgBlock[msg.length] = 0x80;
    new DataView(msgBlock.buffer).setUint32(60, (64 + msg.length) * 8);
    compress(st, msgBlock);
    dv.setUint32(0, st[0] >>> 0); dv.setUint32(4, st[1] >>> 0); dv.setUint32(8, st[2] >>> 0);
    dv.setUint32(12, st[3] >>> 0); dv.setUint32(16, st[4] >>> 0); dv.setUint32(20, st[5] >>> 0);
    dv.setUint32(24, st[6] >>> 0); dv.setUint32(28, st[7] >>> 0);
    st.set(opadState);
    msgBlock.fill(0);
    msgBlock.set(out32);
    msgBlock[32] = 0x80;
    new DataView(msgBlock.buffer).setUint32(60, 96 * 8);
    compress(st, msgBlock);
    dv.setUint32(0, st[0] >>> 0); dv.setUint32(4, st[1] >>> 0); dv.setUint32(8, st[2] >>> 0);
    dv.setUint32(12, st[3] >>> 0); dv.setUint32(16, st[4] >>> 0); dv.setUint32(20, st[5] >>> 0);
    dv.setUint32(24, st[6] >>> 0); dv.setUint32(28, st[7] >>> 0);
    return out32;
  };
}

// PBKDF2-HMAC-SHA256 (RFC 2898), pure JS.
function pbkdf2(password, salt, iterations) {
  const pw = typeof password === 'string' ? enc.encode(password) : password;
  const sal = typeof salt === 'string' ? enc.encode(salt) : salt;
  const prf = makePrf(pw);
  const saltPlus = new Uint8Array(sal.length + 4);
  saltPlus.set(sal);
  const t = new Uint8Array(32);
  for (let b = 1; b <= 1; b += 1) {
    saltPlus[sal.length] = b >>> 24;
    saltPlus[sal.length + 1] = (b >>> 16) & 0xff;
    saltPlus[sal.length + 2] = (b >>> 8) & 0xff;
    saltPlus[sal.length + 3] = b & 0xff;
    let u = prf(saltPlus.subarray(0, sal.length + 4));
    t.set(u);
    for (let i = 1; i < iterations; i += 1) {
      u = prf(u);
      for (let j = 0; j < 32; j += 1) t[j] ^= u[j];
    }
  }
  return t;
}

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < 8) {
    throw new Error('PASSWORD_TOO_SHORT');
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$v1$${PBKDF2_ITERATIONS}$${b64encode(salt)}$${b64encode(hash)}`;
}

export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'v1') return false;
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  let salt;
  let expected;
  try {
    salt = b64decode(parts[3]);
    expected = b64decode(parts[4]);
  } catch {
    return false;
  }
  const actual = pbkdf2(password, salt, iterations);
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
