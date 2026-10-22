import { test, expect } from '@playwright/test';
import {
  mockPartySearch,
  mockProducts,
  mockRelated,
  selectParty,
  TENANT
} from './support.js';

const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const CREATED_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';

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

test('lists and searches the active product catalog in its own panel', async ({ page }) => {
  const products = productApi();
  await mockProducts(page, { onRequest: products.onRequest });
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([]));
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');
  await page.getByRole('tab', { name: 'Product catalog' }).click();

  await expect(page.getByRole('heading', { name: 'Product catalog', exact: true })).toBeVisible();
  await expect(page.getByTestId('products-context')).toContainText('Products are the policy and submission taxonomy');
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product EXCESS' })).toBeVisible();

  // The first active product is selected so the detail panel is useful without
  // an extra click.
  await expect(page.getByTestId('product-detail-code')).toHaveText('CGL');
  await expect(page.getByTestId('product-detail-name')).toHaveText('Commercial General Liability');

  const search = page.getByRole('searchbox', { name: 'Search products' });
  await search.fill('Excess');
  await expect(page.getByRole('button', { name: 'Open product EXCESS' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toHaveCount(0);
  await expect(page.getByTestId('product-detail-code')).toHaveText('EXCESS');
  await expect(page.getByTestId('products-filter-meta')).toContainText('1 active product match');

  const searchRequest = products.calls.at(-1);
  expect(searchRequest.url.searchParams.get('q')).toBe('Excess');
  expect(searchRequest.url.searchParams.get('status')).toBe('ACTIVE');
  expect(searchRequest.headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('button', { name: 'Open product CGL' })).toBeVisible();
});
