import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated, PARTY, PARTY_ID, TENANT } from './support.js';

const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const OTHER_POLICY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const CLAIM_ID = '11111111-2222-7333-8444-555555555555';
const CESSION_ID = '66666666-7777-7888-8999-000000000000';

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000001',
    productCode: 'CGL',
    insuredPartyId: PARTY_ID,
    insuredDisplayName: 'Acme Manufacturing',
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

function envelope(items, pageNumber = 0, total = items.length, links = {}) {
  return {
    items,
    page: pageNumber,
    size: 20,
    total,
    _links: {
      self: { href: `/api/v1/policies?page=${pageNumber}&size=20` },
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

async function routePolicyDetail(page, policiesById) {
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 404, body: 'unexpected route' });
      return;
    }
    if (url.pathname === '/api/v1/policies') {
      const items = [...policiesById.values()];
      await json(route, 200, envelope(items));
      return;
    }
    if (url.pathname.endsWith('/versions/current')) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    const match = url.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/);
    if (match && policiesById.has(match[1])) {
      const detail = policiesById.get(match[1]);
      await json(route, 200, detail, { ETag: `"${detail.version}"` });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });
}

test('selects ?record= on mount and re-applies the URL on popstate', async ({ page }) => {
  const first = policy();
  const second = policy({ id: OTHER_POLICY_ID, policyNumber: 'POL-2026-0000002' });
  const policies = new Map([[first.id, first], [second.id, second]]);

  await mockRelated(page);
  await routePolicyDetail(page, policies);

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');

  await page.evaluate((id) => {
    window.history.pushState({}, '', `/?record=${id}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, OTHER_POLICY_ID);

  await expect(page.getByRole('heading', { name: 'POL-2026-0000002' })).toBeVisible();
});

test('loads a deep-linked policy that is not on the loaded queue page', async ({ page }) => {
  const detail = policy();
  let detailRequests = 0;

  await mockRelated(page);
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([], 0, 0));
      return;
    }
    if (route.request().method() === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      detailRequests += 1;
      await json(route, 200, detail, { ETag: '"0"' });
      return;
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith('/versions/current')) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toHaveCount(0);
  expect(detailRequests).toBe(1);
});

test('opens the create form from ?new=1', async ({ page }) => {
  await mockRelated(page);
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([]));
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/?new=1');
  await expect(page.getByRole('region', { name: 'Create policy' })).toBeVisible();
});

test('filters the loaded policy queue by number, product, and status', async ({ page }) => {
  const draft = policy();
  const quoted = policy({
    id: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    policyNumber: 'POL-2026-0000002',
    productCode: 'PROPERTY',
    status: 'QUOTED'
  });
  const inForce = policy({
    id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    policyNumber: 'POL-2026-0000003',
    productCode: 'CGL',
    status: 'IN_FORCE'
  });

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([draft, quoted, inForce]));
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toBeVisible();
  await expect(page.getByText('Page 1 · 3 policies')).toBeVisible();

  const filter = page.getByPlaceholder('Filter policies by number, product, or status…');
  await filter.fill('property');
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000002' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000003' })).toHaveCount(0);
  await expect(page.getByText('Page 1 · 3 policies')).toBeVisible();

  await filter.fill('0000003');
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000003' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000002' })).toHaveCount(0);

  await filter.fill('in_force');
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000003' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toHaveCount(0);

  await filter.fill('no-such-policy');
  await expect(page.getByText('No matching policies')).toBeVisible();
  const clear = page.getByRole('button', { name: 'Clear' });
  await expect(clear).toBeVisible();
  await clear.click();
  await expect(filter).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000002' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open record POL-2026-0000003' })).toBeVisible();
});

test('resolves the insured party through the typeahead and submits insuredPartyId', async ({ page }) => {
  let policies = [];
  let createBody = null;
  let partyRequest = null;

  await page.route('**/api/v1/parties/search**', async (route) => {
    const url = new URL(route.request().url());
    partyRequest = { url, headers: route.request().headers() };
    await json(route, 200, { query: url.searchParams.get('q') || '', limit: 8, items: [PARTY] });
  });

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope(policies));
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/policies') {
      createBody = route.request().postDataJSON();
      const created = policy({
        ...createBody,
        id: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
        policyNumber: 'POL-2026-0000002'
      });
      policies = [created];
      await json(route, 201, created, { ETag: '"0"', 'Idempotent-Replayed': 'false' });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.goto('/?new=1');
  const createRegion = page.getByRole('region', { name: 'Create policy' });
  await expect(createRegion).toBeVisible();

  await page.getByPlaceholder('Search by number or name…').fill('Acme');
  await page.getByRole('button', { name: /PTY-000000001/ }).click();

  const selectedCard = createRegion.locator('.eia-selected-party');
  await expect(selectedCard).toContainText('PTY-000000001 · Acme Manufacturing · ORGANIZATION');
  await expect(selectedCard.getByRole('link', { name: 'Open party record' }))
    .toHaveAttribute('href', `/party?record=${PARTY_ID}`);

  await page.getByRole('button', { name: 'Create policy' }).click();

  await expect(page.getByRole('status')).toContainText('Created POL-2026-0000002');
  expect(createBody.insuredPartyId).toBe(PARTY_ID);
  expect(createBody).not.toHaveProperty('insuredPartyLabel');
  expect(partyRequest.url.pathname).toBe('/api/v1/parties/search');
  expect(partyRequest.url.searchParams.get('q')).toBe('Acme');
  expect(partyRequest.url.searchParams.get('limit')).toBe('8');
  expect(partyRequest.headers['x-eia-tenant']).toBe(TENANT);
});

test('links the insured party and renders related direct claims and cessions', async ({ page }) => {
  const detail = policy();
  let claimsRequest = null;
  let cessionsRequest = null;

  await mockPartyDetail(page);

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET') {
      await route.fulfill({ status: 404, body: 'unexpected route' });
      return;
    }
    if (url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([detail]));
      return;
    }
    if (url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, detail, { ETag: '"0"' });
      return;
    }
    if (url.pathname.endsWith('/versions/current')) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    await route.fulfill({ status: 404, body: 'unexpected route' });
  });

  await page.route('**/api/v1/claims/search**', async (route) => {
    claimsRequest = { url: new URL(route.request().url()), headers: route.request().headers() };
    await json(route, 200, {
      query: POLICY_ID,
      limit: 5,
      items: [{
        id: CLAIM_ID,
        type: 'DIRECT_CLAIM',
        label: 'CLM-2026-0000001',
        secondary: 'BODILY_INJURY · REGISTERED',
        status: 'REGISTERED',
        href: `/direct-claims?record=${CLAIM_ID}`
      }]
    });
  });

  await page.route('**/api/v1/cessions/search**', async (route) => {
    cessionsRequest = { url: new URL(route.request().url()), headers: route.request().headers() };
    await json(route, 200, {
      query: POLICY_ID,
      limit: 5,
      items: [{
        id: CESSION_ID,
        type: 'CESSION',
        label: 'CES-2026-0000001',
        secondary: 'DIRECT · ACTIVE',
        status: 'ACTIVE',
        href: `/cession?record=${CESSION_ID}`
      }]
    });
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();

  await expect(page.getByTestId('record-insured-link'))
    .toHaveText('Acme Manufacturing · PTY-000000001');
  await expect(page.getByTestId('record-insured-link'))
    .toHaveAttribute('href', `/party?record=${PARTY_ID}`);
  await expect(page.getByRole('link', { name: /CLM-2026-0000001/ }))
    .toHaveAttribute('href', `/direct-claims?record=${CLAIM_ID}`);
  await expect(page.getByRole('link', { name: /CES-2026-0000001/ }))
    .toHaveAttribute('href', `/cession?record=${CESSION_ID}`);

  await expect(page.getByText('Why this matters')).toBeVisible();
  await expect(page.getByText(/source of coverage for Direct Claims and Cessions/)).toBeVisible();
  await expect(page.getByText(/SAP FS-RI remains the system of record for ceded amounts/)).toBeVisible();

  expect(claimsRequest.url.searchParams.get('q')).toBe(POLICY_ID);
  expect(claimsRequest.url.searchParams.get('limit')).toBe('5');
  expect(claimsRequest.headers['x-eia-book']).toBe('DIRECT');
  expect(cessionsRequest.url.searchParams.get('q')).toBe(POLICY_ID);
  expect(cessionsRequest.url.searchParams.get('limit')).toBe('5');
  expect(cessionsRequest.headers['x-eia-book']).toBe('DIRECT');

  await page.getByTestId('record-insured-link').click();
  await expect(page).toHaveURL(new RegExp(`/party\\?record=${PARTY_ID}$`));
});
