export const TENANT = '11111111-1111-7111-8111-111111111111';
export const PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
export const PRODUCT_CGL_ID = '11111111-2222-7333-8444-555555555555';
export const PRODUCT_EXCESS_ID = '66666666-7777-7888-8999-aaaaaaaaaaaa';

export const PRODUCT_CGL = {
  id: PRODUCT_CGL_ID,
  productId: PRODUCT_CGL_ID,
  code: 'CGL',
  productCode: 'CGL',
  name: 'Commercial General Liability',
  productName: 'Commercial General Liability',
  status: 'ACTIVE'
};

export const PRODUCT_EXCESS = {
  id: PRODUCT_EXCESS_ID,
  productId: PRODUCT_EXCESS_ID,
  code: 'EXCESS',
  productCode: 'EXCESS',
  name: 'Excess Liability',
  productName: 'Excess Liability',
  status: 'ACTIVE'
};

export const PRODUCTS = [PRODUCT_CGL, PRODUCT_EXCESS];

export const PARTY = {
  id: PARTY_ID,
  type: 'PARTY',
  label: 'PTY-000000001',
  secondary: 'Acme Manufacturing · ORGANIZATION',
  status: 'ACTIVE',
  href: `/party?record=${PARTY_ID}`
};

export const PARTY_RECORD = {
  id: PARTY_ID,
  tenantId: TENANT,
  partyNumber: 'PTY-000000001',
  partyType: 'ORGANIZATION',
  displayName: 'Acme Manufacturing',
  legalName: 'Acme Manufacturing, Inc.',
  status: 'ACTIVE'
};

export async function fulfillJson(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

/**
 * Keeps policy selection independent from the claims/cessions domains in every
 * spec. The notification preview is another read-only lookup triggered by
 * selection, so it defaults to an empty page here; a spec that exercises the
 * card registers its own route afterwards (the last registered route wins).
 */
export async function mockRelated(page, { claims = [], cessions = [] } = {}) {
  await page.route('**/api/v1/claims/search**', async (route) => {
    await fulfillJson(route, 200, { query: '', limit: 5, items: claims });
  });
  await page.route('**/api/v1/cessions/search**', async (route) => {
    await fulfillJson(route, 200, { query: '', limit: 5, items: cessions });
  });
  await page.route('**/api/v1/notifications**', async (route) => {
    await fulfillJson(route, 200, { items: [], page: 0, size: 20, total: 0 });
  });
}

/** Serves the common party search envelope used by EntityPicker. */
export async function mockPartySearch(page, items = [PARTY]) {
  await page.route('**/api/v1/parties/search**', async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, 200, {
      query: url.searchParams.get('q') || '',
      limit: 8,
      items
    });
  });
}

/**
 * Serves the public people directory (`GET /api/v1/directory`) used by the
 * referral person pickers. `status` may be a function so a spec can flip a
 * transient outage off and retry; the read is expected to carry no tenant
 * header because the directory is platform master data.
 */
export async function mockDirectory(page, { items = [], status = 200, onRequest } = {}) {
  await page.route('**/api/v1/directory', async (route) => {
    const url = new URL(route.request().url());
    if (onRequest) onRequest({ url, headers: route.request().headers() });
    const resolvedStatus = typeof status === 'function' ? status() : status;
    if (resolvedStatus !== 200) {
      await fulfillJson(route, resolvedStatus, {
        status: resolvedStatus,
        title: 'People directory unavailable',
        detail: 'The people directory is temporarily unavailable.',
        code: 'DIRECTORY_UNAVAILABLE',
        retryable: true
      });
      return;
    }
    await fulfillJson(route, 200, {
      people: items,
      teams: [{ code: 'UW', label: 'Underwriting' }]
    });
  });
}

/** Drives the EntityPicker typeahead and selects the matching party. */
export async function selectParty(page, label = PARTY.label) {
  await page.getByPlaceholder('Search by number or name…').fill('Acme');
  await page.getByRole('button', { name: new RegExp(label) }).click();
}

/**
 * Serves GET /api/v1/products?q=&status=ACTIVE for the policy and submission
 * product pickers. The query filter mirrors the catalog so a spec can verify
 * that searching by code or name reached the server and narrowed the options.
 * An optional `status` filter mirrors the catalog's ACTIVE/RETIRED filter; the
 * pickers always send ACTIVE, so a retired fixture stays out of their options.
 * Pass `items: []` to exercise the empty-catalog manual-code fallback, or a
 * non-200 `status` to exercise the unavailable-catalog fallback.
 */
export async function mockProducts(page, { items = PRODUCTS, status = 200, onRequest } = {}) {
  await page.route('**/api/v1/products**', async (route) => {
    const url = new URL(route.request().url());
    if (onRequest) onRequest({ url, headers: route.request().headers() });
    if (status !== 200) {
      await fulfillJson(route, status, {
        status,
        title: 'Product catalog unavailable',
        detail: 'The product catalog is temporarily unavailable.',
        code: 'PRODUCT_CATALOG_UNAVAILABLE',
        retryable: true
      });
      return;
    }
    const q = (url.searchParams.get('q') || '').trim().toLowerCase();
    const requestedStatus = (url.searchParams.get('status') || '').trim().toUpperCase();
    const filtered = items.filter((product) => {
      if (requestedStatus && String(product.status || '').toUpperCase() !== requestedStatus) {
        return false;
      }
      if (!q) return true;
      return `${product.code} ${product.name}`.toLowerCase().includes(q);
    });
    await fulfillJson(route, 200, {
      items: filtered,
      page: 0,
      size: filtered.length,
      total: filtered.length
    });
  });
}

/**
 * Drives the ProductPicker typeahead and selects a catalog product. The
 * picker's first focus reads the unfiltered active catalog, so the option
 * appears without typing.
 */
export async function selectProduct(page, code = 'CGL') {
  await page.getByPlaceholder('Search products by code or name…').click();
  await page.getByRole('option', { name: new RegExp(code) }).click();
}

/**
 * Serves GET /api/v1/parties/{id} for record cross-link resolution.
 * Pass `status: 404` to exercise the short-UUID fallback.
 */
export async function mockPartyDetail(page, { status = 200, party = PARTY_RECORD, onRequest } = {}) {
  await page.route(/\/api\/v1\/parties\/[0-9a-f-]+$/i, async (route) => {
    const url = new URL(route.request().url());
    if (onRequest) onRequest({ url, headers: route.request().headers() });
    if (status !== 200) {
      await fulfillJson(route, status, {
        status,
        code: 'PARTY_NOT_FOUND',
        message: `Party ${url.pathname.split('/').pop()} was not found`
      });
      return;
    }
    await fulfillJson(route, 200, {
      ...party,
      id: url.pathname.split('/').pop()
    });
  });
}
