import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated, PARTY_ID, TENANT } from './support.js';

const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const SECOND_POLICY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const DOC_ONE_ID = '99999999-9999-7999-8999-999999999991';
const DOC_TWO_ID = '99999999-9999-7999-8999-999999999992';
const DOCUMENTS = '**/api/v1/documents**';

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

function documentRow(overrides = {}) {
  return {
    id: DOC_ONE_ID,
    tenantId: TENANT,
    documentNumber: 'DOC-2026-0000001',
    title: 'Signed policy declarations',
    documentType: 'POLICY',
    classification: 'INTERNAL',
    status: 'ACTIVE',
    retentionUntil: '2033-12-31',
    version: 1,
    createdAt: '2026-10-19T12:00:00Z',
    updatedAt: '2026-10-19T12:00:00Z',
    ...overrides
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

async function mockPolicies(page, policies) {
  const byId = new Map(policies.map((row) => [row.id, row]));

  await page.route('**/api/v1/policies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, {
        items: policies,
        page: 0,
        size: 20,
        total: policies.length,
        _links: { self: { href: '/api/v1/policies?page=0&size=20' } }
      });
      return;
    }
    if (method === 'GET' && url.pathname.endsWith('/versions/current')) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    const match = url.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/);
    if (method === 'GET' && match && byId.has(match[1])) {
      const record = byId.get(match[1]);
      await json(route, 200, record, { ETag: `"${record.version}"` });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected ${method} ${url.pathname}` });
  });
}

test('loads linked documents for the selected policy with tenant query/header and working links', async ({ page }) => {
  const first = policy();
  const second = policy({
    id: SECOND_POLICY_ID,
    policyNumber: 'POL-2026-0000002',
    version: 1
  });
  const requests = [];

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [first, second]);
  await page.route(DOCUMENTS, async (route) => {
    const request = route.request();
    requests.push({
      method: request.method(),
      url: new URL(request.url()),
      headers: request.headers()
    });
    await json(route, 200, [
      documentRow(),
      documentRow({
        id: DOC_TWO_ID,
        documentNumber: 'DOC-2026-0000002',
        title: 'Endorsement 001',
        documentType: 'ENDORSEMENT',
        status: 'RECEIVED'
      })
    ]);
  });

  await page.goto(`/?record=${POLICY_ID}`);
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();

  const card = page.getByTestId('linked-documents');
  await expect(card).toBeVisible();
  await expect(card.getByRole('heading', { name: 'Documents' })).toBeVisible();
  await expect(page.getByTestId('linked-documents-count')).toHaveText('2 documents');
  await expect(card.getByTestId('documents-evidence-note')).toContainText('evidence');

  const firstRow = card.getByRole('row', { name: /DOC-2026-0000001/ });
  await expect(firstRow).toContainText('Signed policy declarations');
  await expect(firstRow).toContainText('POLICY');
  await expect(firstRow).toContainText('ACTIVE');
  await expect(firstRow.getByRole('link', { name: 'DOC-2026-0000001' }))
    .toHaveAttribute('href', `/document?record=${DOC_ONE_ID}`);

  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].method).toBe('GET');
  expect(requests[0].url.pathname).toBe('/api/v1/documents');
  expect(requests[0].url.searchParams.get('linkedType')).toBe('POLICY');
  expect(requests[0].url.searchParams.get('linkedId')).toBe(POLICY_ID);
  expect(requests[0].headers['x-eia-tenant']).toBe(TENANT);

  await page.getByRole('button', { name: 'Open record POL-2026-0000002' }).click();
  await expect(page.getByRole('heading', { name: 'POL-2026-0000002' })).toBeVisible();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].url.searchParams.get('linkedType')).toBe('POLICY');
  expect(requests[1].url.searchParams.get('linkedId')).toBe(SECOND_POLICY_ID);
  expect(requests[1].headers['x-eia-tenant']).toBe(TENANT);

  await card.getByRole('link', { name: 'DOC-2026-0000001' }).click();
  await expect(page).toHaveURL(new RegExp(`/document\\?record=${DOC_ONE_ID}$`));
});

test('shows the linked-documents empty state without disturbing the policy record', async ({ page }) => {
  const existing = policy();

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [existing]);
  await page.route(DOCUMENTS, async (route) => {
    await json(route, 200, { items: [], page: 0, size: 20, total: 0 });
  });

  await page.goto(`/?record=${POLICY_ID}`);

  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('policy-etag')).toHaveText('"0"');
  await expect(
    page.getByText('This policy is the source of coverage for Direct Claims and Cessions.')
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Related records' })).toBeVisible();

  const card = page.getByTestId('linked-documents');
  await expect(page.getByTestId('linked-documents-count')).toHaveText('0 documents');
  await expect(card.getByText('No documents are linked to this policy.')).toBeVisible();
  await expect(card.getByRole('table')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('keeps the policy record usable when the linked-document lookup fails', async ({ page }) => {
  const existing = policy();

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [existing]);
  await page.route(DOCUMENTS, async (route) => {
    await route.fulfill({
      status: 503,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        title: 'Document expert unavailable',
        status: 503,
        code: 'EXPERT_UNAVAILABLE',
        detail: 'The Document expert is unavailable; retry later.'
      })
    });
  });

  await page.goto(`/?record=${POLICY_ID}`);

  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  await expect(page.getByTestId('policy-etag')).toHaveText('"0"');
  const card = page.getByTestId('linked-documents');
  await expect(card).toContainText('Linked documents are temporarily unavailable.');
  await expect(page.getByTestId('linked-documents-count')).toHaveText('0 documents');
  await expect(page.getByRole('heading', { name: 'Related records' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('renders the policy before linked documents resolve', async ({ page }) => {
  const existing = policy();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });

  await mockRelated(page);
  await mockPartyDetail(page);
  await mockPolicies(page, [existing]);
  await page.route(DOCUMENTS, async (route) => {
    await gate;
    await json(route, 200, [documentRow()]);
  });

  try {
    await page.goto(`/?record=${POLICY_ID}`);
    await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
    await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
    await expect(page.getByTestId('policy-etag')).toHaveText('"0"');
    await expect(page.getByTestId('linked-documents')).toContainText('Loading documents…');
    await expect(page.getByTestId('linked-documents-count')).toHaveText('…');
  } finally {
    release();
  }

  await expect(page.getByTestId('linked-documents-count')).toHaveText('1 document');
  await expect(page.getByTestId('linked-documents').getByRole('link', { name: 'DOC-2026-0000001' }))
    .toBeVisible();
});
