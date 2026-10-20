import { test, expect } from '@playwright/test';
import {
  mockPartyDetail,
  mockRelated,
  PARTY_ID,
  PARTY_RECORD,
  TENANT
} from './support.js';

const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000001',
    productCode: 'CGL',
    insuredPartyId: PARTY_ID,
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

async function mockPolicy(page, detail) {
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([detail]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, detail, { ETag: `"${detail.version}"` });
      return;
    }
    if (method === 'GET' && url.pathname.endsWith('/versions/current')) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });
}

test('resolves the insured party to name · party number in the header and Overview', async ({ page }) => {
  const partyRequests = [];
  await mockRelated(page);
  await mockPolicy(page, policy());
  await mockPartyDetail(page, {
    party: PARTY_RECORD,
    onRequest: ({ url, headers }) => {
      partyRequests.push({ path: url.pathname, tenant: headers['x-eia-tenant'] });
    }
  });

  await page.goto(`/?record=${POLICY_ID}`);

  const label = 'Acme Manufacturing · PTY-000000001';
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();

  const headerLink = page.getByTestId('record-insured-link');
  await expect(headerLink).toHaveText(label);
  await expect(headerLink).toHaveAttribute('href', `/party?record=${PARTY_ID}`);

  const overviewLink = page.getByTestId('overview-insured-link');
  await expect(overviewLink).toHaveText(label);
  await expect(overviewLink).toHaveAttribute('href', `/party?record=${PARTY_ID}`);

  expect(partyRequests).toEqual([
    { path: `/api/v1/parties/${PARTY_ID}`, tenant: TENANT }
  ]);
});

test('falls back to the short insured UUID when the party lookup returns 404', async ({ page }) => {
  await mockRelated(page);
  await mockPolicy(page, policy());
  await mockPartyDetail(page, { status: 404 });

  await page.goto(`/?record=${POLICY_ID}`);

  // The policy still renders while the party lookup fails.
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();

  const headerLink = page.getByTestId('record-insured-link');
  await expect(headerLink).toHaveText('bbbbbbbb…');
  await expect(headerLink).toHaveAttribute('href', `/party?record=${PARTY_ID}`);

  const overviewLink = page.getByTestId('overview-insured-link');
  await expect(overviewLink).toHaveText('bbbbbbbb…');
  await expect(overviewLink).toHaveAttribute('href', `/party?record=${PARTY_ID}`);
});
