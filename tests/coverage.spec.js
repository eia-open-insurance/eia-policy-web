import { test, expect } from '@playwright/test';
import { mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const COVERAGE_ID = '77777777-7777-7777-8777-777777777777';
const LIMIT_ID = '88888888-8888-7888-8888-888888888888';

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000001',
    productCode: 'CGL',
    insuredPartyId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    status: 'IN_FORCE',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '120000.0000',
    premiumCurrency: 'USD',
    limitAmount: '5000000.0000',
    limitCurrency: 'USD',
    version: 4,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides
  };
}

function envelope(items, pageNumber = 0, total = items.length) {
  return {
    items,
    page: pageNumber,
    size: 20,
    total,
    _links: {
      self: { href: `/api/v1/policies?page=${pageNumber}&size=20` }
    }
  };
}

function coverageRow(remaining) {
  return {
    coverage: {
      id: COVERAGE_ID,
      tenantId: TENANT,
      policyId: POLICY_ID,
      coverageCode: 'GL_PRODUCTS',
      coverageName: 'Products liability',
      coveragePart: 'A',
      occurrenceBasis: 'OCCURRENCE',
      coinsurancePct: '0.100000',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2027-01-01',
      status: 'ACTIVE',
      sequence: 1,
      createdAt: '2026-01-01T00:00:00Z'
    },
    limit: {
      id: LIMIT_ID,
      tenantId: TENANT,
      policyId: POLICY_ID,
      coverageId: COVERAGE_ID,
      perOccurrenceAmount: '2000000.0000',
      aggregateAmount: '5000000.0000',
      aggregateBasis: 'PER_COVERAGE',
      sublimitAmount: '1000000.0000',
      deductibleAmount: '5000.0000',
      coinsurancePct: '0.100000',
      currency: 'USD',
      erosionBasis: 'PAID_PLUS_RESERVED',
      effectiveFrom: '2026-01-01',
      effectiveTo: '2027-01-01',
      sequence: 1,
      createdAt: '2026-01-01T00:00:00Z'
    },
    state: {
      id: '99999999-9999-7999-8999-999999999999',
      tenantId: TENANT,
      policyId: POLICY_ID,
      limitId: LIMIT_ID,
      asOf: '2026-10-19T12:00:00Z',
      originalAmount: '5000000.0000',
      paidAmount: '0.0000',
      reservedAmount: '0.0000',
      incurredAmount: '0.0000',
      recoveredAmount: '0.0000',
      remainingAmount: remaining,
      erodedPct: '0.000000',
      reinstatedAmount: '0.0000',
      sourceVersion: 0,
      computedAt: '2026-10-19T12:00:00Z',
      reconciliationStatus: 'CURRENT',
      version: 0
    }
  };
}

function itemPage(items) {
  return {
    items,
    page: 0,
    size: 50,
    total: items.length,
    _links: { self: { href: '/api/v1/policies/x/coverages?page=0&size=50' } }
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
});

test('adds a coverage with limits and applies aggregate erosion', async ({ page }) => {
  let coverages = [];
  let coveragePost = null;
  let erosionPost = null;
  let policyVersion = 4;

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([policy({ version: policyVersion })]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, policy({ version: policyVersion }), { ETag: `"${policyVersion}"` });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, {
        version: {
          id: '44444444-4444-7444-8444-444444444444',
          policyVersionNumber: 'POL-2026-0000001-01',
          changeType: 'ISSUE',
          status: 'ISSUED',
          effectiveFrom: '2026-01-01'
        },
        current: true,
        hashVerified: true
      });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/coverages`) {
      await json(route, 200, itemPage(coverages));
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/coverages`) {
      coveragePost = {
        headers: route.request().headers(),
        body: route.request().postDataJSON()
      };
      policyVersion = 5;
      coverages = [coverageRow('5000000.0000')];
      await json(route, 201, coverages[0], { ETag: '"5"', 'Idempotent-Replayed': 'false' });
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/erosion`) {
      erosionPost = route.request().postDataJSON();
      policyVersion = 6;
      coverages = [coverageRow('4700000.0000')];
      await json(route, 201, coverages[0].state, { ETag: '"6"', 'Idempotent-Replayed': 'false' });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open record POL-2026-0000001' }).click();
  await expect(page.getByRole('heading', { name: 'POL-2026-0000001' })).toBeVisible();
  await page.getByRole('tab', { name: 'Coverages & Limits' }).click();

  await expect(page.getByText('No coverages yet.')).toBeVisible();
  await page.getByLabel('Coverage code').fill('GL_PRODUCTS');
  await page.getByLabel('Coverage name').fill('Products liability');
  await page.getByLabel('Per occurrence').fill('2000000.00');
  await page.getByLabel('Aggregate (optional)').fill('5000000.00');
  await page.getByLabel('Sublimit (optional)').fill('1000000.00');
  await page.getByLabel('Deductible').fill('5000.00');
  await page.getByRole('button', { name: 'Add coverage' }).click();

  await expect(page.getByRole('status')).toContainText('Coverage GL_PRODUCTS added.');
  await expect(page.getByRole('cell', { name: 'GL_PRODUCTS' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '$5,000,000.00' }).first()).toBeVisible();

  expect(coveragePost.headers['if-match']).toBe('"4"');
  expect(coveragePost.headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(coveragePost.body.coverageCode).toBe('GL_PRODUCTS');
  expect(coveragePost.body.limit).toMatchObject({
    perOccurrenceAmount: '2000000.00',
    aggregateAmount: '5000000.00',
    sublimitAmount: '1000000.00',
    deductibleAmount: '5000.00',
    currency: 'USD'
  });

  await page.getByLabel('Claim ID').fill('99999999-9999-7999-8999-999999999999');
  await page.getByLabel('Allocation ID').fill('aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa');
  await page.getByLabel('Paid').fill('250000.00');
  await page.getByLabel('Reserved').fill('50000.00');
  await page.getByRole('button', { name: 'Apply erosion' }).click();

  await expect(page.getByRole('status')).toContainText('Erosion fact applied.');
  await expect(page.getByRole('cell', { name: '$4,700,000.00' })).toBeVisible();
  expect(erosionPost).toMatchObject({
    limitId: LIMIT_ID,
    claimId: '99999999-9999-7999-8999-999999999999',
    allocationId: 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa',
    sourceVersion: 1,
    paidAmount: '250000.00',
    reservedAmount: '50000.00'
  });
});

test('renders a canonical problem when a coverage violates a limit rule', async ({ page }) => {
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([policy()]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, policy(), { ETag: '"4"' });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, { version: null, current: false, hashVerified: false });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/coverages`) {
      await json(route, 200, itemPage([]));
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/coverages`) {
      await route.fulfill({
        status: 422,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.eia-open-insurance.example/policy/limit-exceeds-aggregate',
          title: 'Limit exceeds aggregate',
          status: 422,
          detail: 'The each-occurrence limit must not exceed the aggregate limit (SPEC POL-03).',
          instance: `/api/v1/policies/${POLICY_ID}/coverages`,
          code: 'LIMIT_EXCEEDS_AGGREGATE',
          category: 'BUSINESS_RULE',
          retryable: false,
          errors: [
            {
              field: 'limit.perOccurrenceAmount',
              code: 'LIMIT_EXCEEDS_AGGREGATE',
              message: 'must not exceed the aggregate limit'
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open record POL-2026-0000001' }).click();
  await page.getByRole('tab', { name: 'Coverages & Limits' }).click();
  await page.getByLabel('Per occurrence').fill('9000000.00');
  await page.getByRole('button', { name: 'Add coverage' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('must not exceed the aggregate limit');
  await expect(alert).toContainText('limit.perOccurrenceAmount: must not exceed the aggregate limit');
});
