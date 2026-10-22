import { test, expect } from '@playwright/test';
import {
  mockPartySearch,
  mockProducts,
  mockRelated,
  selectParty,
  selectProduct,
  PARTY_ID
} from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const API = '**/api/v1/policies**';
const VERSION_ID = '44444444-4444-7444-8444-444444444444';

function existingPolicy(overrides = {}) {
  return {
    id: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
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

function versionEnvelope(overrides = {}) {
  return {
    version: {
      id: VERSION_ID,
      policyVersionNumber: 'POL-2026-0000001-01',
      changeType: 'ISSUE',
      status: 'ISSUED',
      effectiveFrom: '2026-01-01'
    },
    current: true,
    hashVerified: true,
    ...overrides
  };
}

function envelope(items, page, total, links = {}) {
  return {
    items,
    page,
    size: 20,
    total,
    _links: {
      self: { href: `/api/v1/policies?page=${page}&size=20` },
      ...links
    }
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

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
  await mockPartySearch(page);
  await mockProducts(page);
});

test('renders the operational record layout and creates a policy with an Idempotency-Key', async ({ page }) => {
  const existing = existingPolicy();
  let policies = [existing];
  let idempotencyKey = null;
  let createBody = null;

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope(policies, 0, policies.length));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${existing.id}`) {
      await json(route, 200, existing, { ETag: `"${existing.version}"` });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${existing.id}/versions/current`) {
      await json(route, 200, versionEnvelope());
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/policies') {
      idempotencyKey = route.request().headers()['idempotency-key'];
      const body = route.request().postDataJSON();
      createBody = body;
      const created = existingPolicy({
        ...body,
        id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
        policyNumber: body.policyNumber || 'POL-2026-0000002',
        status: 'DRAFT',
        version: 0
      });
      policies = [created, ...policies];
      await json(route, 201, created, { 'Idempotent-Replayed': 'false', ETag: '"0"' });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Policy', exact: true })).toBeVisible();
  await expect(page.getByText('Policy · Direct book')).toBeVisible();
  await expect(page.getByText('Direct policies, versions, coverages and limits')).toBeVisible();
  await expect(page.locator('.eia-record-layout')).toBeVisible();
  await expect(page.locator('.eia-record-list')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toBeVisible();
  await expect(page.getByText('Page 1 · 1 policy')).toBeVisible();

  await page.getByRole('button', { name: 'Open record POL-2026-0000001' }).click();
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(page.locator('.eia-record-panel')).toBeVisible();
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('policy-etag')).toHaveText('"0"');

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues).toHaveCount(4);
  await expect(summaryValues.nth(0)).toHaveText('$125,000.00');
  await expect(summaryValues.nth(1)).toHaveText('$2,000,000.00');
  await expect(summaryValues.nth(2)).toHaveText('2026-01-01');
  await expect(summaryValues.nth(3)).toHaveText('2027-01-01');

  const policyTabs = page.getByRole('tablist', { name: 'Policy sections' }).getByRole('tab');
  await expect(policyTabs).toHaveCount(12);
  await expect(page.getByRole('tab', { name: 'Submissions' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
  await expect(policyTabs.nth(1)).toHaveText('Program');
  await expect(policyTabs.nth(2)).toHaveText('Legal entity');
  await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Billing' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Coverages & Limits' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Rating' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Mass tort' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Insureds & Locations' })).toBeVisible();

  await page.getByRole('button', { name: 'New policy' }).click();
  await expect(page.getByRole('region', { name: 'Create policy' })).toBeVisible();

  await selectProduct(page, 'CGL');
  await expect(page.getByTestId('product-picker-selected'))
    .toContainText('Commercial General Liability');
  await selectParty(page);
  await expect(page.getByRole('link', { name: 'Open party record' }))
    .toHaveAttribute('href', `/party?record=${PARTY_ID}`);
  await page.getByRole('button', { name: 'Create policy' }).click();

  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000002' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('Created POL-2026-0000002');
  expect(idempotencyKey).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(createBody.insuredPartyId).toBe(PARTY_ID);
  expect(createBody.productCode).toBe('CGL');
  expect(createBody).not.toHaveProperty('productLabel');
});

test('follows next and previous links from the page envelope', async ({ page }) => {
  const first = existingPolicy();
  const second = existingPolicy({
    id: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
    policyNumber: 'POL-2026-0000002'
  });
  const requestedPages = [];

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET' || url.pathname !== '/api/v1/policies') {
      await route.fulfill({ status: 404, body: 'unexpected route' });
      return;
    }
    const requested = url.searchParams.get('page');
    requestedPages.push(requested);
    if (requested === '1') {
      await json(route, 200, envelope([second], 1, 2, {
        prev: { href: '/api/v1/policies?page=0&size=20' }
      }));
      return;
    }
    await json(route, 200, envelope([first], 0, 2, {
      next: { href: '/api/v1/policies?page=1&size=20' }
    }));
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toBeVisible();
  await expect(page.getByText('Page 1 · 2 policies')).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000002' })).toBeVisible();
  await expect(page.getByText('Page 2 · 2 policies')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Previous' })).toBeEnabled();

  await page.getByRole('button', { name: 'Previous' }).click();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toBeVisible();
  expect(requestedPages).toEqual(['0', '1', '0']);
});

test('renders a canonical problem+json create failure', async ({ page }) => {
  const existing = existingPolicy();

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([existing], 0, 1));
      return;
    }
    if (route.request().method() === 'POST' && url.pathname === '/api/v1/policies') {
      await route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.eia-open-insurance.example/policy/idempotency-conflict',
          title: 'Idempotency key conflict',
          status: 409,
          detail: 'Idempotency-Key was already used with a different request.',
          instance: '/api/v1/policies',
          code: 'IDEMPOTENCY_CONFLICT',
          category: 'CONFLICT',
          retryable: false,
          errors: [
            {
              field: 'Idempotency-Key',
              code: 'IDEMPOTENCY_CONFLICT',
              message: 'different request'
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'New policy' }).click();
  await selectProduct(page, 'CGL');
  await selectParty(page);
  await page.getByRole('button', { name: 'Create policy' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Idempotency-Key was already used with a different request.');
  await expect(alert).toContainText('Idempotency-Key: different request');
});

test('advances status with the detail ETag as If-Match', async ({ page }) => {
  let current = existingPolicy();
  let patchHeaders = null;
  let patchBody = null;

  await page.route(API, async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const detailPath = `/api/v1/policies/${current.id}`;

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([current], 0, 1));
      return;
    }
    if (method === 'GET' && url.pathname === detailPath) {
      await json(route, 200, current, { ETag: `"${current.version}"` });
      return;
    }
    if (method === 'GET' && url.pathname === `${detailPath}/versions/current`) {
      await json(route, 200, versionEnvelope());
      return;
    }
    if (method === 'PATCH' && url.pathname === `${detailPath}/status`) {
      patchHeaders = route.request().headers();
      patchBody = route.request().postDataJSON();
      current = { ...current, status: 'QUOTED', version: 1 };
      await json(route, 200, current, { ETag: '"1"' });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open record POL-2026-0000001' }).click();
  await expect(page.getByTestId('policy-etag')).toHaveText('"0"');
  await page.getByRole('button', { name: /advance to QUOTED/i }).click();

  await expect(page.getByRole('status')).toContainText('advanced to QUOTED');
  await expect(page.getByTestId('policy-status')).toHaveText('QUOTED');
  await expect(page.getByTestId('policy-etag')).toHaveText('"1"');

  expect(patchHeaders['if-match']).toBe('"0"');
  expect(patchBody).toEqual({ status: 'QUOTED', expectedVersion: 0 });
});
