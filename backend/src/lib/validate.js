import { err } from './errors.js';

export function readBody(request) {
  return request.json().catch(() => {
    throw err(400, 'invalid_json', 'Request body harus JSON valid');
  });
}

export function requireFields(body, fields) {
  for (const f of fields) {
    if (body[f] === undefined || body[f] === null || body[f] === '') {
      throw err(400, 'missing_field', `Field '${f}' wajib diisi`);
    }
  }
}

export function asInt(value, { min = -Infinity, max = Infinity, required = false, field } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw err(400, 'missing_field', `Field '${field}' wajib diisi`);
    return null;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw err(400, 'invalid_value', `Field '${field}' harus integer antara ${min} dan ${max}`);
  }
  return n;
}

export function asString(value, { max = 10000, required = false, field } = {}) {
  if (value === undefined || value === null) {
    if (required) throw err(400, 'missing_field', `Field '${field}' wajib diisi`);
    return null;
  }
  const s = String(value).trim();
  if (required && !s) throw err(400, 'missing_field', `Field '${field}' wajib diisi`);
  if (s.length > max) throw err(400, 'invalid_value', `Field '${field}' terlalu panjang`);
  return s;
}

export function asEnum(value, allowed, { required = false, field, defaultVal } = {}) {
  if (value === undefined || value === null) {
    if (required) throw err(400, 'missing_field', `Field '${field}' wajib diisi`);
    return defaultVal ?? null;
  }
  if (!allowed.includes(value)) {
    throw err(400, 'invalid_value', `Field '${field}' harus salah satu dari: ${allowed.join(', ')}`);
  }
  return value;
}

export function asBool(value, { defaultVal = false } = {}) {
  if (value === undefined || value === null) return defaultVal ? 1 : 0;
  return value === true || value === 'true' || value === 1 || value === '1' ? 1 : 0;
}

export function asDate(value, { required = false, field } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) throw err(400, 'missing_field', `Field '${field}' wajib diisi`);
    return null;
  }
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw err(400, 'invalid_value', `Field '${field}' harus format YYYY-MM-DD`);
  }
  return s;
}