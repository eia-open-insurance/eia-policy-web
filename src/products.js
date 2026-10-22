/**
 * Product catalog helpers for the Policy workbench.
 *
 * A product is the policy/submission product taxonomy record. The workbench
 * needs a code and a human label for selection: the create commands carry
 * `productCode`, while the UI shows the catalog name so an operator does not
 * have to remember the code. The catalog tab additionally manages the lifecycle
 * (ACTIVE <-> RETIRED) of the same records.
 *
 * Wire contract used by the create forms and the Product catalog panel:
 *   GET   /api/v1/products?q={term}&status={ACTIVE|RETIRED} -> [Product]
 *   POST  /api/v1/products                                  -> 201 Product
 *   PATCH /api/v1/products/{productId}/status               -> 200 Product
 *
 * The list `status` parameter is optional: omitting it returns every product,
 * which is what the catalog's "All" filter does. The policy and submission
 * pickers always pass ACTIVE so a retired product can never be selected on a
 * new record.
 *
 * A Product carries `id`/`productId`, a code (`code` or `productCode`), a name
 * (`name`, `productName`, or `displayName`), a `productLine`, a two-letter
 * `jurisdiction`, and `status`. The list response may be a bare array or an
 * `items`/`products` envelope; both shapes are normalized so a partial catalog
 * rollout cannot break the pickers.
 */

export const PRODUCT_STATUS = {
  ACTIVE: 'ACTIVE',
  RETIRED: 'RETIRED',
  /** Legacy catalog value still tolerated by the read normalizer. */
  INACTIVE: 'INACTIVE'
};

/**
 * Catalog tab filter options. The empty value means "no server-side status
 * filter", i.e. the complete catalog including retired products.
 */
export const PRODUCT_STATUS_FILTERS = [
  { value: '', label: 'All' },
  { value: PRODUCT_STATUS.ACTIVE, label: 'ACTIVE' },
  { value: PRODUCT_STATUS.RETIRED, label: 'RETIRED' }
];

/** The product-line vocabulary accepted by POST /api/v1/products. */
export const PRODUCT_LINES = [
  { value: 'CGL', label: 'CGL' },
  { value: 'PRODUCTS_LIABILITY', label: 'Products Liability' },
  { value: 'UMBRELLA', label: 'Umbrella' },
  { value: 'EXCESS', label: 'Excess' },
  { value: 'OTHER', label: 'Other' }
];

const PRODUCT_LINE_LABELS = Object.fromEntries(
  PRODUCT_LINES.map((entry) => [entry.value, entry.label])
);

/** Mirrors the create-command cap on `productCode`. */
export const MAX_PRODUCT_CODE_LENGTH = 32;
/** Mirrors the catalog cap on `productName`. */
export const MAX_PRODUCT_NAME_LENGTH = 200;
/** ISO 3166-1 alpha-2 jurisdiction length. */
export const PRODUCT_JURISDICTION_LENGTH = 2;

export const PRODUCT_PICKER_PLACEHOLDER = 'Search products by code or name…';

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

/**
 * `status` defaults to ACTIVE so every picker is safe by default: a policy or
 * submission may only start from a product that is currently offered. Passing
 * an empty status explicitly lists the whole catalog.
 */
export function productsEndpoint(term = '', status = PRODUCT_STATUS.ACTIVE) {
  const params = new URLSearchParams();
  params.set('q', String(term || '').trim());
  const normalizedStatus = String(status || '').trim().toUpperCase();
  if (normalizedStatus) params.set('status', normalizedStatus);
  return `/api/v1/products?${params.toString()}`;
}

export function productCreateEndpoint() {
  return '/api/v1/products';
}

export function productStatusEndpoint(productId) {
  return `/api/v1/products/${encodeURIComponent(productId)}/status`;
}

export function productLineLabel(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return PRODUCT_LINE_LABELS[normalized]
    || (normalized ? normalized.replace(/_/g, ' ') : '—');
}

/** The create form starts blank; every catalog field is operator-entered. */
export function defaultProductForm() {
  return {
    productCode: '',
    productName: '',
    productLine: '',
    jurisdiction: ''
  };
}

/**
 * The create command normalizes the code, line, and jurisdiction to upper case
 * server-side; sending the normalized values keeps the request and the UI
 * consistent and makes the duplicate check unambiguous.
 */
export function productCreatePayload(form) {
  return {
    productCode: String(form?.productCode || '').trim().toUpperCase(),
    productName: String(form?.productName || '').trim(),
    productLine: String(form?.productLine || '').trim().toUpperCase(),
    jurisdiction: String(form?.jurisdiction || '').trim().toUpperCase()
  };
}

/**
 * Client-side mirror of ProductRules.validateCreate. The server remains the
 * authority; this keeps an obviously invalid body from leaving the dialog and
 * gives the operator a field-specific message before the round trip.
 */
export function validateProductCreateForm(form) {
  const code = String(form?.productCode || '').trim();
  if (!code) {
    return 'Enter the product code before creating the product.';
  }
  if (code.length > MAX_PRODUCT_CODE_LENGTH) {
    return `Product code must be at most ${MAX_PRODUCT_CODE_LENGTH} characters.`;
  }
  const name = String(form?.productName || '').trim();
  if (!name) {
    return 'Enter the product name before creating the product.';
  }
  if (name.length > MAX_PRODUCT_NAME_LENGTH) {
    return `Product name must be at most ${MAX_PRODUCT_NAME_LENGTH} characters.`;
  }
  const productLine = String(form?.productLine || '').trim().toUpperCase();
  if (!productLine) {
    return 'Select the product line before creating the product.';
  }
  if (!PRODUCT_LINES.some((entry) => entry.value === productLine)) {
    return 'Select a valid product line.';
  }
  const jurisdiction = String(form?.jurisdiction || '').trim();
  if (!jurisdiction) {
    return 'Enter the jurisdiction before creating the product.';
  }
  if (!/^[A-Za-z]{2}$/.test(jurisdiction)) {
    return 'Enter a two-letter jurisdiction code, e.g. US.';
  }
  return '';
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
  const version = Number(raw.version);
  return {
    id,
    key: id || code || name,
    code: code || name,
    name: name || code,
    status: String(firstPresent(raw.status, PRODUCT_STATUS.ACTIVE))
      .trim()
      .toUpperCase(),
    productLine: String(firstPresent(raw.productLine, raw.product_line, raw.line))
      .trim()
      .toUpperCase(),
    jurisdiction: String(firstPresent(raw.jurisdiction, raw.jurisdictionCode))
      .trim()
      .toUpperCase(),
    version: Number.isFinite(version) ? version : null,
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
  if (normalized === PRODUCT_STATUS.RETIRED || normalized === PRODUCT_STATUS.INACTIVE) {
    return 'amber';
  }
  return 'blue';
}
