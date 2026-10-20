import { test, expect } from '@playwright/test';
import { mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const SOURCE_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const SUCCESSOR_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_NUMBER = 'POL-2026-0000001';
const SUCCESSOR_NUMBER = 'POL-2027-0000002';

const RENEWABLE = ['ISSUED', 'IN_FORCE', 'ENDORSED', 'REINSTATED'];
const NOT_RENEWABLE = ['DRAFT', 'QUOTED', 'BOUND', 'RENEWED', 'CANCELLED', 'EXPIRED', 'NON_RENEWED', 'VOID'];

function sourcePolicy(overrides = {}) {
  return {
    id: SOURCE_ID,
    tenantId: TENANT,
    policyNumber: SOURCE_NUMBER,
    productCode: 'CGL',
    insuredPartyId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    status: 'IN_FORCE',
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '120000.0000',
    premiumCurrency: 'USD',
    limitAmount: '5000000.0000',
    limitCurrency: 'USD',
    version: 4,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
    ...overrides
  };
}

function successorPolicy(overrides = {}) {
  return {
    id: SUCCESSOR_ID,
    tenantId: TENANT,
    policyNumber: SUCCESSOR_NUMBER,
    productCode: 'CGL',
    insuredPartyId: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    status: 'ISSUED',
    effectiveDate: '2027-01-02',
    expirationDate: '2028-01-02',
    premiumAmount: '130000.0000',
    premiumCurrency: 'USD',
    limitAmount: '5000000.0000',
    limitCurrency: 'USD',
    version: 0,
    renewedFromPolicyId: SOURCE_ID,
    createdAt: '2026-10-20T00:00:00Z',
    updatedAt: '2026-10-20T00:00:00Z',
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

function noVersion() {
  return { version: null, current: false, hashVerified: false };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
});

test('offers renewal only while the policy is in a renewable status', async ({ page }) => {
  let currentStatus = 'IN_FORCE';

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([sourcePolicy({ status: currentStatus })]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${SOURCE_ID}`) {
      await json(route, 200, sourcePolicy({ status: currentStatus }), { ETag: '"4"' });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${SOURCE_ID}/versions/current`) {
      await json(route, 200, noVersion());
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  const renew = page.getByTestId('renew-policy');

  for (const status of RENEWABLE) {
    currentStatus = status;
    await page.getByRole('button', { name: `Open record ${SOURCE_NUMBER}` }).click();
    await expect(page.getByTestId('policy-status')).toHaveText(status);
    await expect(renew).toBeEnabled();
    await expect(renew).toHaveAttribute('title', 'Create the next term as a new policy record');
  }

  for (const status of NOT_RENEWABLE) {
    currentStatus = status;
    await page.getByRole('button', { name: `Open record ${SOURCE_NUMBER}` }).click();
    await expect(page.getByTestId('policy-status')).toHaveText(status);
    await expect(renew).toBeDisabled();
    // The disabled action explains why it cannot renew, both as a tooltip and
    // as the record's context.
    await expect(renew).toHaveAttribute('title', new RegExp(`This policy is ${status}\\.$`));
  }

  await expect(page.getByTestId('renew-dialog')).toHaveCount(0);
});

test('renews with term defaults and the current premium/limit, then selects the new record', async ({ page }) => {
  let queue = [sourcePolicy()];
  let listCalls = 0;
  let renewalPost = null;

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      listCalls += 1;
      await json(route, 200, envelope(queue));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${SOURCE_ID}`) {
      await json(route, 200, sourcePolicy(), { ETag: '"4"' });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${SUCCESSOR_ID}`) {
      await json(route, 200, successorPolicy(), { ETag: '"0"' });
      return;
    }
    if (method === 'GET' && url.pathname.endsWith('/versions/current')) {
      await json(route, 200, noVersion());
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${SOURCE_ID}/renew`) {
      renewalPost = {
        headers: route.request().headers(),
        body: route.request().postDataJSON()
      };
      queue = [
        successorPolicy(),
        sourcePolicy({ status: 'RENEWED', version: 5 })
      ];
      await json(route, 201, successorPolicy(), {
        ETag: '"0"',
        'Idempotent-Replayed': 'false'
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${SOURCE_NUMBER}` }).click();
  await page.getByTestId('renew-policy').click();

  const dialog = page.getByRole('dialog', { name: `Renew ${SOURCE_NUMBER}` });
  await expect(dialog).toBeVisible();

  await expect(dialog.getByLabel('Effective date')).toHaveValue('2027-01-02');
  await expect(dialog.getByLabel('Expiration date')).toHaveValue('2028-01-02');
  await expect(dialog.getByLabel('Premium', { exact: true })).toHaveValue('120000.0000');
  await expect(dialog.getByLabel('Premium currency', { exact: true })).toHaveValue('USD');
  await expect(dialog.getByLabel('Limit', { exact: true })).toHaveValue('5000000.0000');
  await expect(dialog.getByLabel('Limit currency', { exact: true })).toHaveValue('USD');
  await expect(dialog.getByTestId('renewal-carry-forward')).toContainText(
    'Coverages and limits are carried forward');
  await expect(dialog.getByTestId('renewal-context')).toContainText(
    /prior policy remains intact/i);

  await dialog.getByLabel('Premium', { exact: true }).fill('130000.00');
  await dialog.getByRole('button', { name: 'Create renewal' }).click();

  await expect(page.getByRole('status')).toContainText(`Renewed as ${SUCCESSOR_NUMBER}`);
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: SUCCESSOR_NUMBER })).toBeVisible();
  await expect(page.getByTestId('policy-status')).toHaveText('ISSUED');
  await expect(page.getByRole('button', { name: `Open record ${SUCCESSOR_NUMBER}` })).toBeVisible();
  await expect(page.getByRole('button', { name: `Open record ${SOURCE_NUMBER}` })).toBeVisible();
  expect(listCalls).toBeGreaterThanOrEqual(2);

  expect(renewalPost.headers['if-match']).toBe('"4"');
  expect(renewalPost.headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(renewalPost.body).toEqual({
    effectiveDate: '2027-01-02',
    expirationDate: '2028-01-02',
    premiumAmount: '130000.00',
    premiumCurrency: 'USD',
    limitAmount: '5000000.0000',
    limitCurrency: 'USD'
  });
});

test('links a renewal record to its predecessor and navigates to it', async ({ page }) => {
  const renewed = successorPolicy({ status: 'IN_FORCE' });

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([renewed]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${SUCCESSOR_ID}`) {
      await json(route, 200, renewed, { ETag: '"0"' });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${SOURCE_ID}`) {
      await json(route, 200, sourcePolicy(), { ETag: '"4"' });
      return;
    }
    if (method === 'GET' && url.pathname.endsWith('/versions/current')) {
      await json(route, 200, noVersion());
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${SUCCESSOR_NUMBER}` }).click();

  const link = page.getByTestId('renewed-from-link');
  await expect(page.getByTestId('renewed-from')).toContainText(`Renewed from ${SOURCE_NUMBER}`);
  await expect(link).toHaveAttribute('href', `/policy?record=${SOURCE_ID}`);
  await expect(link).toHaveText(SOURCE_NUMBER);

  await link.click();
  await expect(page).toHaveURL(new RegExp(`/policy\\?record=${SOURCE_ID}$`));
  await expect(page.getByRole('heading', { name: SOURCE_NUMBER, exact: true })).toBeVisible();
  // The predecessor response does not know its successor, so the source record
  // intentionally has no forward link.
  await expect(page.getByTestId('renewed-from')).toHaveCount(0);
});

test('renders a 409 renewal conflict inside the modal and keeps the source selected', async ({ page }) => {
  let listCalls = 0;

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      listCalls += 1;
      await json(route, 200, envelope([sourcePolicy()]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${SOURCE_ID}`) {
      await json(route, 200, sourcePolicy(), { ETag: '"4"' });
      return;
    }
    if (method === 'GET' && url.pathname.endsWith('/versions/current')) {
      await json(route, 200, noVersion());
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${SOURCE_ID}/renew`) {
      await route.fulfill({
        status: 409,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.eia-open-insurance.example/policy/already-renewed',
          title: 'Renewal conflict',
          status: 409,
          detail: 'Policy POL-2026-0000001 already has a renewal for the 2027 term.',
          instance: `/api/v1/policies/${SOURCE_ID}/renew`,
          code: 'ALREADY_RENEWED',
          category: 'CONFLICT',
          retryable: false,
          errors: [
            {
              field: 'effectiveDate',
              code: 'ALREADY_RENEWED',
              message: 'a successor policy already covers this term'
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${SOURCE_NUMBER}` }).click();
  await page.getByTestId('renew-policy').click();

  const dialog = page.getByRole('dialog', { name: `Renew ${SOURCE_NUMBER}` });
  await dialog.getByRole('button', { name: 'Create renewal' }).click();

  await expect(dialog).toBeVisible();
  const alert = page.getByTestId('renewal-error');
  await expect(alert).toContainText('Policy POL-2026-0000001 already has a renewal for the 2027 term.');
  await expect(alert).toContainText('effectiveDate: a successor policy already covers this term');
  await expect(page.getByRole('heading', { name: SOURCE_NUMBER, exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(listCalls).toBe(1);
});
