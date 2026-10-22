/**
 * Product catalog helpers for the Policy workbench.
 *
 * A product is the policy/submission product taxonomy record. The workbench
 * only needs a code and a human label: the create commands carry `productCode`,
 * while the UI shows the catalog name so an operator does not have to remember
 * the code.
 *
 * Wire contract used by both create forms and the Product catalog panel:
 *   GET /api/v1/products?q={term}&status=ACTIVE -> {items:[Product]} | [Product]
 *
 * A Product carries `id`, a code (`code` or `productCode`), a name (`name`,
 * `productName`, or `displayName`), and `status`. The response may be a bare
 * array or an `items`/`products` envelope; both shapes are normalized so a
 * partial catalog rollout cannot break the pickers.
 */

export const PRODUCT_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

/** Mirrors the create-command cap on `productCode`. */
export const MAX_PRODUCT_CODE_LENGTH = 64;

export const PRODUCT_PICKER_PLACEHOLDER = 'Search products by code or name…';

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

/**
 * `status` is fixed to ACTIVE because a policy or submission may only start
 * from a product that is currently offered.
 */
export function productsEndpoint(term = '', status = PRODUCT_STATUS.ACTIVE) {
  const params = new URLSearchParams();
  params.set('q', String(term || '').trim());
  if (status) params.set('status', String(status).trim().toUpperCase());
  return `/api/v1/products?${params.toString()}`;
}

export function normalizeProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const code = String(firstPresent(
    raw.code,
    raw.productCode,
    raw.product_code,
    raw.key
  )).trim();
  const name = String(firstPresent(
    raw.name,
    raw.productName,
    raw.product_name,
    raw.displayName,
    raw.display_name,
    raw.label,
    raw.title
  )).trim();
  if (!code && !name) return null;
  const id = String(firstPresent(raw.id, raw.productId, raw.product_id, code));
  return {
    id,
    key: id || code || name,
    code: code || name,
    name: name || code,
    status: String(firstPresent(raw.status, PRODUCT_STATUS.ACTIVE))
      .trim()
      .toUpperCase(),
    description: String(firstPresent(
      raw.description,
      raw.summary,
      raw.details
    )).trim(),
    productType: String(firstPresent(raw.productType, raw.product_type, raw.type)).trim(),
    raw
  };
}

export function normalizeProductList(body) {
  const rawItems = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.products)
        ? body.products
        : Array.isArray(body?.content)
          ? body.content
          : [];
  return rawItems.map(normalizeProduct).filter(Boolean);
}

/** The code stored on the policy or submission command. */
export function productCode(product) {
  return String(product?.code || '').trim();
}

/** Human name first: the picker and selected-product card read better by name. */
export function productLabel(product) {
  if (!product) return '—';
  return product.name || product.code || product.id || '—';
}

/** Catalog identity plus name, for headings and accessible option names. */
export function productDisplayLabel(product) {
  if (!product) return '—';
  const code = product.code || '';
  const name = product.name || '';
  const parts = [code, name].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : product.id || '—';
}

export function productKey(product) {
  return String(product?.key || product?.id || product?.code || product?.name || '');
}

export function productStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === PRODUCT_STATUS.ACTIVE) return 'green';
  if (normalized === PRODUCT_STATUS.INACTIVE) return 'amber';
  return 'blue';
}
