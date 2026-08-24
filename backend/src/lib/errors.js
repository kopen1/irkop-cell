export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = 'ApiError';
  }
}

export const err = (status, code, message) => new ApiError(status, code, message);

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...extraHeaders },
  });
}

export function handleError(e, extraHeaders = {}) {
  if (e instanceof ApiError) {
    return json({ error: { code: e.code, message: e.message } }, e.status, extraHeaders);
  }
  console.error('UNHANDLED ERROR', e);
  return json({ error: { code: 'internal', message: 'Internal server error' } }, 500, extraHeaders);
}