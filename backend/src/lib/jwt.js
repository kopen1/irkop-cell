const enc = new TextEncoder();
const b64url = (buf) =>
  btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const b64urlDecode = (s) => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = t.length % 4 === 0 ? 0 : 4 - (t.length % 4);
  return Uint8Array.from(atob(t + '='.repeat(padLen)), (c) => c.charCodeAt(0));
};

async function hmacSign(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', key, enc.encode(data));
}

async function hmacVerify(secret, data, sig) {
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify']
  );
  return crypto.subtle.verify('HMAC', key, sig, enc.encode(data));
}

const signB64 = (obj) => b64url(enc.encode(JSON.stringify(obj)));

export async function signToken(payload, secret, ttlSeconds = 2592000) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const body = { ...payload, iat: now, exp: now + ttlSeconds };
  const unsigned = `${signB64(header)}.${signB64(body)}`;
  const sig = await hmacSign(secret, unsigned);
  return `${unsigned}.${b64url(sig)}`;
}

export async function verifyToken(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) return null;
  const [h, b, s] = parts;
  const ok = await hmacVerify(secret, `${h}.${b}`, b64urlDecode(s));
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(dec.decode(b64urlDecode(b)));
  } catch {
    return null;
  }
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}

const enc2 = new TextEncoder();
const dec = new TextDecoder();

export async function sha256Hex(input) {
  const digest = await crypto.subtle.digest('SHA-256', enc2.encode(String(input)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}