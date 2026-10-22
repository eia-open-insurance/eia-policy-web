import { test, expect } from '@playwright/test';
import {
  mockPartySearch,
  mockProducts,
  mockRelated,
  PRODUCT_CGL_ID,
  selectParty,
  TENANT
} from './support.js';

const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const CREATED_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const CREATED_PRODUCT_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const RETIRED_PRODUCT_ID = 'ffffffff-ffff-7fff-8fff-ffffffffffff';

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000001',
    productCode: 'CGL',
    insuredPartyId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    status: 'DRAFT',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '125000.0000',
    premiumCurrency: 'USD',
    limitAmount: '2000000.0000',
    limitCurrency: 'USD',
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

function envelope(items) {
  return {
    items,
    page: 0,
    size: 20,
    total: items.length,
    _links: { self: { href: '/api/v1/policies?page=0&size=20' } }
  };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

function installPolicyApi(page, state) {
  return page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope(state.policies));
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/policies') {
      const body = route.request().postDataJSON();
      state.createBody = body;
      state.createHeaders = route.request().headers();
      const created = policy({
        ...body,
        id: CREATED_ID,
        policyNumber: 'POL-2026-0000002'
      });
      state.policies = [created, ...state.policies];
      await json(route, 201, created, { ETag: '"0"', 'Idempotent-Replayed': 'false' });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });
}

function productApi(calls = []) {
  return {
    calls,
    onRequest: ({ url, headers }) => calls.push({ url, headers })
  };
}

/** A catalog ProductView-shaped fixture for the management tests. */
function catalogProduct(overrides = {}) {
  return {
    productId: PRODUCT_CGL_ID,
    productCode: 'CGL',
    productName: 'Commercial General Liability',
    productLine: 'CGL',
    jurisdiction: 'US',
    status: 'ACTIVE',
    version: 0,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
  };
}

/**
 * A mutable catalog API for create/retire/reactivate/filter coverage. GET
 * honors `q` and `status` the way ProductRepository does (omitted status means
 * the whole catalog); POST answers a duplicate with the canonical 409; PATCH
 * moves the status and bumps the version.
 */
async function installCatalogApi(page, state) {
  await page.route('**/api/v1/products**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const path = url.pathname;

    if (method === 'GET' && path === '/api/v1/products') {
      const q = (url.searchParams.get('q') || '').trim().toLowerCase();
      const status = (url.searchParams.get('status') || '').trim().toUpperCase();
      state.getCalls.push({ q, status, headers: route.request().headers() });
      const items = state.products.filter((product) => {
        if (status && String(product.status || '').toUpperCase() !== status) return false;
        if (!q) return true;
        return `${product.productCode} ${product.productName}`.toLowerCase().includes(q);
      });
      await json(route, 200, {
        items,
        page: 0,
        size: items.length,
        total: items.length
      });
      return;
    }

    if (method === 'POST' && path === '/api/v1/products') {
      const body = route.request().postDataJSON();
      state.createBody = body;
      state.createHeaders = route.request().headers();
      const code = String(body.productCode || '').toUpperCase();
      if (state.products.some((product) => product.productCode === code)) {
        await json(route, 409, {
          status: 409,
          code: 'DUPLICATE_PRODUCT_CODE',
          title: 'Product code conflict',
          detail: `Product code already exists for this tenant: ${code}`,
          errors: [{
            field: 'productCode',
            code: 'DUPLICATE_CODE',
            message: `Product code already exists for this tenant: ${code}`
          }]
        });
        return;
      }
      const created = catalogProduct({
        productId: CREATED_PRODUCT_ID,
        productCode: code,
        productName: body.productName,
        productLine: body.productLine,
        jurisdiction: body.jurisdiction,
        status: 'ACTIVE'
      });
      state.products = [created, ...state.products];
      state.createdId = created.productId;
      await json(route, 201, created, { ETag: `"${created.version}"` });
      return;
    }

    const statusMatch = path.match(/^\/api\/v1\/products\/([^/]+)\/status$/);
    if (method === 'PATCH' && statusMatch) {
      const id = decodeURIComponent(statusMatch[1]);
      const body = route.request().postDataJSON();
      state.statusBody = body;
      state.statusId = id;
      const product = state.products.find((entry) => entry.productId === id);
      if (!product) {
        await json(route, 404, {
          status: 404,
          code: 'PRODUCT_NOT_FOUND',
          detail: `Product not found: ${id}`
        });
        return;
      }
      product.status = String(body.status || '').toUpperCase();
      product.version += 1;
      product.updatedAt = '2026-10-20T12:00:00Z';
      await json(route, 200, product, { ETag: `"${product.version}"` });
      return;
    }

    await route.fulfill({
      status: 404,
      body: `unexpected route ${method} ${path}`
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
  await mockPartySearch(page);
});

test('searches the product catalog and creates a policy with the selected code', async ({ page }) => {
  const state = { policies: [], createBody: null, createHeaders: null };
  const products = productApi();
  await mockProducts(page, { onRequest: products.onRequest });
  await installPolicyApi(page, state);

  await page.goto('/?new=1');
  await expect(page.getByRole('region', { name: 'Create policy' })).toBeVisible();

  const search = page.getByPlaceholder('Search products by code or name…');
  await search.click();
  await search.fill('Excess');
  const excessOption = page.getByRole('option', { name: /Excess Liability/ });
  await expect(excessOption).toBeVisible();

  const excessRequest = products.calls.at(-1);
  expect(excessRequest.url.pathname).toBe('/api/v1/products');
  expect(excessRequest.url.searchParams.get('q')).toBe('Excess');
  expect(excessRequest.url.searchParams.get('status')).toBe('ACTIVE');
  expect(excessRequest.headers['x-eia-tenant']).toBe(TENANT);

  await excessOption.click();
  const selected = page.getByTestId('product-picker-selected');
  await expect(selected).toContainText('Excess Liability');
  await expect(selected).toContainText('EXCESS');

  // Switch products through Change: the previous selection is cleared and the
  // picker can search again without a page reload.
  await selected.getByRole('button', { name: 'Change' }).click();
  await search.fill('CGL');
  await page.getByRole('option', { name: /Commercial General Liability/ }).click();
  await expect(page.getByTestId('product-picker-selected'))
    .toContainText('Commercial General Liability');
  await expect(page.getByTestId('product-picker-selected')).toContainText('CGL');

  await selectParty(page);
  await page.getByRole('button', { name: 'Create policy' }).click();

  await expect(page.getByRole('status')).toContainText('Created POL-2026-0000002');
  expect(state.createBody.productCode).toBe('CGL');
  expect(state.createBody).not.toHaveProperty('productLabel');
  expect(state.createHeaders['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
});

test('falls back to manual code entry when the catalog is empty', async ({ page }) => {
  const state = { policies: [], createBody: null, createHeaders: null };
  await mockProducts(page, { items: [] });
  await installPolicyApi(page, state);

  await page.goto('/?new=1');
  const search = page.getByPlaceholder('Search products by code or name…');
  await search.click();

  const fallback = page.getByTestId('product-picker-fallback');
  await expect(fallback).toContainText('No active products are configured yet.');
  await expect(fallback).toContainText('Enter the code manually.');

  const manual = page.locator('#create-product');
  await manual.fill('MANUAL-GL');
  await expect(manual).toHaveValue('MANUAL-GL');
  await expect(fallback).toContainText('Enter the code manually.');

  await selectParty(page);
  await page.getByRole('button', { name: 'Create policy' }).click();

  await expect(page.getByRole('status')).toContainText('Created POL-2026-0000002');
  expect(state.createBody.productCode).toBe('MANUAL-GL');
  expect(state.createBody).not.toHaveProperty('productLabel');
});

test('falls back to manual code entry when the catalog is unavailable', async ({ page }) => {
  const state = { policies: [], createBody: null, createHeaders: null };
  await mockProducts(page, { status: 503 });
  await installPolicyApi(page, state);

  await page.goto('/?new=1');
  await page.getByPlaceholder('Search products by code or name…').click();

  const fallback = page.getByTestId('product-picker-fallback');
  await expect(fallback).toContainText('Product catalog unavailable');
  await expect(fallback).toContainText('Product lookup failed (503)');

  await page.locator('#create-product').fill('FALLBACK-1');
  await selectParty(page);
  await page.getByRole('button', { name: 'Create policy' }).click();

  await expect(page.getByRole('status')).toContainText('Created POL-2026-0000002');
  expect(state.createBody.productCode).toBe('FALLBACK-1');
});

test('lists, filters, and searches the product catalog in its own panel', async ({ page }) => {
  const products = productApi();
  await mockProducts(page, { onRequest: products.onRequest });
  await installPolicyApi(page, { policies: [] });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Product catalog' }).click();

  await expect(page.getByRole('heading', { name: 'Product catalog', exact: true })).toBeVisible();
  await expect(page.getByTestId('products-context')).toContainText('Products are the policy and submission taxonomy');
  await expect(page.getByTestId('products-context')).toContainText('Retiring a product stops new selection');
  await expect(page.getByTestId('products-context')).toContainText('does not change existing records');
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product EXCESS' })).toBeVisible();

  // The default All filter reads the whole catalog (no status parameter).
  const statusFilter = page.getByTestId('products-status-filter');
  await expect(statusFilter).toHaveValue('');
  expect(products.calls.at(-1).url.searchParams.get('status')).toBeNull();

  await statusFilter.selectOption('ACTIVE');
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
  await expect(statusFilter).toHaveValue('ACTIVE');

  // The first active product is selected so the detail panel is useful without
  // an extra click.
  await expect(page.getByTestId('product-detail-code')).toHaveText('CGL');
  await expect(page.getByTestId('product-detail-name')).toHaveText('Commercial General Liability');

  const search = page.getByRole('searchbox', { name: 'Search products' });
  await search.fill('Excess');
  await expect(page.getByRole('button', { name: 'Open product EXCESS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toHaveCount(0);
  await expect(page.getByTestId('product-detail-code')).toHaveText('EXCESS');
  await expect(page.getByTestId('products-filter-meta')).toContainText('1 product');
  await expect(page.getByTestId('products-filter-meta')).toContainText('ACTIVE');
  await expect(page.getByTestId('products-filter-meta')).toContainText('search applied');

  const searchRequest = products.calls.at(-1);
  expect(searchRequest.url.searchParams.get('q')).toBe('Excess');
  expect(searchRequest.url.searchParams.get('status')).toBe('ACTIVE');
  expect(searchRequest.headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
  await expect(statusFilter).toHaveValue('');
});

test('creates a product from the catalog modal and selects it', async ({ page }) => {
  const state = { products: [catalogProduct()], getCalls: [], createBody: null };
  await installCatalogApi(page, state);
  await installPolicyApi(page, { policies: [] });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Product catalog' }).click();
  await page.getByRole('button', { name: 'New product' }).click();

  const dialog = page.getByRole('dialog', { name: 'Create product' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('The new product is ACTIVE');

  // Client-side validation keeps an empty body inside the dialog.
  await dialog.getByRole('button', { name: 'Create product' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Enter the product code');
  await expect(dialog).toBeVisible();
  expect(state.createBody).toBeNull();

  await dialog.getByLabel('Product code').fill('pl-01');
  await dialog.getByLabel('Product name').fill('Products Liability — Small Business');
  await dialog.getByLabel('Product line').selectOption('PRODUCTS_LIABILITY');
  await dialog.getByLabel('Jurisdiction').fill('us');
  await dialog.getByRole('button', { name: 'Create product' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('products-notice')).toContainText('Created PL-01');
  await expect(page.getByTestId('product-detail-code')).toHaveText('PL-01');
  await expect(page.getByTestId('product-detail-name'))
    .toHaveText('Products Liability — Small Business');
  await expect(page.getByTestId('product-detail-line')).toContainText('PRODUCTS_LIABILITY');
  await expect(page.getByTestId('product-detail-jurisdiction')).toHaveText('US');
  await expect(page.getByTestId('product-detail-status')).toHaveText('ACTIVE');

  expect(state.createBody).toEqual({
    productCode: 'PL-01',
    productName: 'Products Liability — Small Business',
    productLine: 'PRODUCTS_LIABILITY',
    jurisdiction: 'US'
  });

  // Creation refreshes the catalog and selects the new ACTIVE product.
  const productRow = page.getByRole('button', { name: 'Open product PL-01' });
  await expect(productRow).toBeVisible();
  await expect(productRow).toHaveAttribute('aria-pressed', 'true');
  expect(state.getCalls.at(-1).status).toBe('');
});

test('contains a duplicate product-code 409 in the create modal', async ({ page }) => {
  const state = { products: [catalogProduct()], getCalls: [], createBody: null };
  await installCatalogApi(page, state);
  await installPolicyApi(page, { policies: [] });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Product catalog' }).click();
  await page.getByRole('button', { name: 'New product' }).click();

  const dialog = page.getByRole('dialog', { name: 'Create product' });
  await dialog.getByLabel('Product code').fill('cgl');
  await dialog.getByLabel('Product name').fill('Duplicate General Liability');
  await dialog.getByLabel('Product line').selectOption('CGL');
  await dialog.getByLabel('Jurisdiction').fill('US');
  await dialog.getByRole('button', { name: 'Create product' }).click();

  await expect(dialog.getByRole('alert')).toContainText('already exists');
  await expect(dialog).toBeVisible();
  expect(state.createBody.productCode).toBe('CGL');
  expect(state.products).toHaveLength(1);

  // The contained error leaves the catalog and the rest of the form intact.
  await expect(dialog.getByLabel('Product name')).toHaveValue('Duplicate General Liability');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('products-filter-meta')).toContainText('1 product');
});

test('retires and reactivates a product with confirmation and refresh', async ({ page }) => {
  const state = {
    products: [catalogProduct()],
    getCalls: [],
    statusBody: null,
    statusId: ''
  };
  await installCatalogApi(page, state);
  await installPolicyApi(page, { policies: [policy()] });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Product catalog' }).click();
  await expect(page.getByTestId('product-detail-code')).toHaveText('CGL');

  await page.getByTestId('retire-product').click();
  const retireDialog = page.getByRole('dialog', { name: 'Retire CGL?' });
  await expect(retireDialog).toBeVisible();
  await expect(retireDialog).toContainText('stops new policies and submissions from selecting it');
  await expect(retireDialog).toContainText('Existing policies and submissions');
  await expect(retireDialog).toContainText('Coverage, limits, premium, billing, lifecycle');
  await retireDialog.getByRole('button', { name: 'Retire product' }).click();

  await expect(retireDialog).toHaveCount(0);
  expect(state.statusId).toBe(PRODUCT_CGL_ID);
  expect(state.statusBody).toEqual({ status: 'RETIRED' });
  await expect(page.getByTestId('products-notice')).toContainText('CGL retired');
  await expect(page.getByTestId('product-detail-status')).toHaveText('RETIRED');
  await expect(page.getByTestId('product-retired-note')).toContainText('cannot be selected');
  await expect(page.getByTestId('product-retired-note')).toContainText('unchanged');
  await expect(page.getByTestId('reactivate-product')).toBeVisible();
  expect(state.products[0].version).toBe(1);
  expect(state.getCalls.length).toBeGreaterThan(1);

  // The existing policy still carries the retired code: its list row is
  // untouched and no policy write was attempted.
  await page.getByRole('tab', { name: 'Policies' }).click();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' }))
    .toContainText('CGL');
  await page.getByRole('tab', { name: 'Product catalog' }).click();
  await expect(page.getByTestId('product-detail-code')).toHaveText('CGL');

  await page.getByTestId('reactivate-product').click();
  const reactivateDialog = page.getByRole('dialog', { name: 'Reactivate CGL?' });
  await expect(reactivateDialog).toBeVisible();
  await expect(reactivateDialog).toContainText('makes it selectable again');
  await reactivateDialog.getByRole('button', { name: 'Reactivate product' }).click();

  await expect(reactivateDialog).toHaveCount(0);
  expect(state.statusBody).toEqual({ status: 'ACTIVE' });
  await expect(page.getByTestId('products-notice')).toContainText('CGL reactivated');
  await expect(page.getByTestId('product-detail-status')).toHaveText('ACTIVE');
  await expect(page.getByTestId('product-retired-note')).toHaveCount(0);
  await expect(page.getByTestId('retire-product')).toBeVisible();
});

test('filters All/ACTIVE/RETIRED and keeps retired products out of pickers', async ({ page }) => {
  const state = {
    products: [
      catalogProduct(),
      catalogProduct({
        productId: RETIRED_PRODUCT_ID,
        productCode: 'LEGACY',
        productName: 'Legacy Umbrella',
        productLine: 'UMBRELLA',
        status: 'RETIRED',
        version: 2
      })
    ],
    getCalls: []
  };
  await installCatalogApi(page, state);
  await installPolicyApi(page, { policies: [] });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Product catalog' }).click();

  // All is the default and includes retired products.
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product LEGACY' })).toBeVisible();
  expect(state.getCalls.at(-1).status).toBe('');

  const statusFilter = page.getByTestId('products-status-filter');
  await statusFilter.selectOption('ACTIVE');
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product LEGACY' })).toHaveCount(0);
  expect(state.getCalls.at(-1).status).toBe('ACTIVE');
  await expect(page.getByTestId('products-filter-meta')).toContainText('1 product');
  await expect(page.getByTestId('products-filter-meta')).toContainText('ACTIVE');

  await statusFilter.selectOption('RETIRED');
  await expect(page.getByRole('button', { name: 'Open product LEGACY' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toHaveCount(0);
  expect(state.getCalls.at(-1).status).toBe('RETIRED');
  await expect(page.getByTestId('product-detail-status')).toHaveText('RETIRED');
  await expect(page.getByTestId('product-retired-note')).toBeVisible();

  await statusFilter.selectOption('');
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product LEGACY' })).toBeVisible();
  expect(state.getCalls.at(-1).status).toBe('');

  // The create-form picker reads ACTIVE only, so a retired product can never be
  // selected on a new policy or submission.
  await page.getByRole('tab', { name: 'Policies' }).click();
  await page.getByRole('button', { name: 'New policy' }).click();
  await page.getByPlaceholder('Search products by code or name…').click();
  await expect(page.getByRole('option', { name: /Commercial General Liability/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Legacy Umbrella/ })).toHaveCount(0);
  expect(state.getCalls.at(-1).status).toBe('ACTIVE');
});
