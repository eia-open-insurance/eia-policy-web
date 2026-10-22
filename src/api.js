export const TENANT = '11111111-1111-7111-8111-111111111111';

export function readJson(response) {
  return response.json().catch(() => null);
}

export function problemMessage(body, fallback) {
  if (!body) return fallback;
  const summary = body.detail || body.title || body.message || fallback;
  const errors = Array.isArray(body.errors) ? body.errors : Array.isArray(body.details) ? body.details : [];
  if (errors.length === 0) return summary;
  const details = errors
    .map((error) => `${error.field || 'request'}: ${error.message || error.code || 'is invalid'}`)
    .join('; ');
  return `${summary} (${details})`;
}

export function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `policy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Shared JSON call used by the policy workbench. Every request carries the
 * tenant header; a body adds JSON content type, and the caller can opt into
 * If-Match, Idempotency-Key, and book headers.
 */
export async function api(path, options = {}) {
  // `tenant: false` marks public platform master data (the people directory),
  // which the gateway serves without tenant scoping. Every other call stays
  // tenant scoped.
  const headers = options.tenant === false ? {} : { 'X-EIA-Tenant': TENANT };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.etag) headers['If-Match'] = options.etag;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.book) headers['X-EIA-Book'] = options.book;
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readJson(response);
  return {
    response,
    body,
    etag: response.headers.get('ETag'),
    replayed: response.headers.get('Idempotent-Replayed') === 'true'
  };
}

export function pageItems(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.items) ? body.items : [];
}
