// Cloudflare Pages Function — Proxy /api/* ke Worker backend
// Alur: Browser -> Pages Function -> Worker Backend (konter.irkop.workers.dev) -> D1
// Same-origin proxy sehingga VITE_API_BASE kosong bekerja di production tanpa CORS di Worker.
// Spesifikasi: backend/docs/PAGES_FUNCTION_COMPAT.md (Team 1).
const BACKEND_BASE = 'https://konter.irkop.workers.dev';

const FORWARD_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'idempotency-key',
  'accept',
  'origin',
  'referer',
  'x-api-key',
  'x-bootstrap-secret',
];

const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'cache-control',
  'expires',
  'etag',
  'set-cookie',
  'access-control-allow-origin',
  'content-disposition',
];

const BODY_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export const onRequest = async (context) => {
  const { request, params } = context;
  const raw = params.path ?? [];
  const segments = Array.isArray(raw) ? raw : [raw];
  const backendPath = `/api/${segments.join('/')}`;

  const targetUrl = new URL(request.url);
  const backendUrl = `${BACKEND_BASE}${backendPath}${targetUrl.search}`;

  const headers = new Headers();
  for (const [key, value] of request.headers) {
    if (FORWARD_REQUEST_HEADERS.includes(key.toLowerCase())) headers.set(key, value);
  }
  headers.set('X-Forwarded-Proto', request.headers.get('x-forwarded-proto') || 'https');
  headers.set('X-Forwarded-Host', request.headers.get('x-forwarded-host') || targetUrl.host);

  const fetchInit = { method: request.method, headers, redirect: 'follow' };
  if (BODY_METHODS.has(request.method.toUpperCase()) && request.body) fetchInit.body = request.body;

  let response;
  try {
    response = await fetch(backendUrl, fetchInit);
  } catch {
    return new Response(
      JSON.stringify({ error: { code: 'network_error', message: 'Tidak dapat terhubung ke server.' } }),
      { status: 502, headers: { 'content-type': 'application/json; charset=UTF-8' } }
    );
  }

  const responseHeaders = new Headers();
  for (const [key, value] of response.headers) {
    if (FORWARD_RESPONSE_HEADERS.includes(key.toLowerCase())) responseHeaders.set(key, value);
  }
  responseHeaders.set('access-control-allow-origin', '*');

  const responseBody = await response.arrayBuffer();
  return new Response(responseBody, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
};
