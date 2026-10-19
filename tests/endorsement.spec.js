import { test, expect } from '@playwright/test';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = '44444444-4444-7444-8444-444444444444';

function policy(version = 4, status = 'IN_FORCE') {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: 'POL-2026-0000001',
    productCode: 'CGL',
    insuredPartyId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    status,
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount: '120000.0000',
    premiumCurrency: 'USD',
    limitAmount: '5000000.0000',
    limitCurrency: 'USD',
    version,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z'
  };
}

function envelope(items) {
  return { items, page: 0, size: 20, total: items.length, _links: { self: { href: '/api/v1/policies?page=0&size=20' } } };
}

function itemPage(items) {
  return { items, page: 0, size: 50, total: items.length, _links: { self: { href: '/x' } } };
}

function endorsement() {
  return {
    id: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    tenantId: TENANT,
    policyId: POLICY_ID,
    policyVersionId: VERSION_ID,
    endorsementNumber: 'END-0002',
    sequence: 2,
    formNumber: null,
    formEdition: null,
    endorsementType: 'LIMIT',
    effectiveDate: '2026-06-01',
    description: 'Increase the general aggregate to 5,000,000',
    premiumDeltaAmount: '5000.0000',
    premiumDeltaCurrency: 'USD',
    coverageImpact: 'BROADEN',
    coverageChanges: [],
    manuscriptFlag: false,
    backdateReason: null,
    approvalRef: null,
    approvedBy: null,
    status: 'ISSUED',
    issuedAt: '2026-06-01T00:00:00Z',
    createdAt: '2026-06-01T00:00:00Z'
  };
}

function version(number, changeType, status, effectiveFrom, effectiveTo = null) {
  return {
    id: number === 1 ? VERSION_ID : `44444444-4444-7444-8444-44444444444${number}`,
    tenantId: TENANT,
    policyId: POLICY_ID,
    versionNumber: number,
    policyVersionNumber: `POL-2026-0000001-0${number}`,
    changeType,
    status,
    effectiveFrom,
    effectiveTo,
    issuedAt: '2026-06-01T00:00:00Z',
    immutableHash: 'a'.repeat(64),
    createdAt: '2026-06-01T00:00:00Z'
  };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

test('issues an endorsement with If-Match and Idempotency-Key and shows the new version', async ({ page }) => {
  const versions = [
    version(1, 'ISSUE', 'SUPERSEDED', '2026-01-01', '2026-06-01'),
    version(2, 'ENDORSEMENT', 'ISSUED', '2026-06-01')
  ];
  let endorsements = [];
  let policyVersion = 4;
  let post = null;

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([policy(policyVersion)]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, policy(policyVersion), { ETag: `"${policyVersion}"` });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, {
        version: versions[1], current: true, hashVerified: true
      });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions`) {
      await json(route, 200, itemPage(versions));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/endorsements`) {
      await json(route, 200, itemPage(endorsements));
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/endorsements`) {
      post = { headers: route.request().headers(), body: route.request().postDataJSON() };
      policyVersion = 5;
      endorsements = [endorsement()];
      await json(route, 201, endorsement(), { ETag: '"5"', 'Idempotent-Replayed': 'false' });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open POL-2026-0000001' }).click();
  await page.getByRole('tab', { name: 'Endorsements' }).click();
  await expect(page.getByText('No endorsements yet.')).toBeVisible();

  const form = page.getByRole('region', { name: 'Endorsements' });
  await form.getByLabel('Type').selectOption('LIMIT');
  await form.getByLabel('Effective date').fill('2026-06-01');
  await form.getByLabel('Description').fill('Increase the general aggregate to 5,000,000');
  await form.getByLabel('Premium delta').fill('5000.00');
  await page.getByRole('button', { name: 'Add endorsement' }).click();

  await expect(page.getByRole('status')).toContainText('Endorsement END-0002 issued.');
  await expect(page.getByRole('cell', { name: 'END-0002' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '$5,000.00' })).toBeVisible();

  expect(post.headers['if-match']).toBe('"4"');
  expect(post.headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(post.body).toMatchObject({
    endorsementType: 'LIMIT',
    effectiveDate: '2026-06-01',
    premiumDeltaAmount: '5000.00',
    premiumDeltaCurrency: 'USD',
    coverageImpact: 'BROADEN'
  });

  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.getByRole('cell', { name: 'POL-2026-0000001-02' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ENDORSEMENT' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'SUPERSEDED' })).toBeVisible();
  await expect(page.getByRole('cell', { name: '2026-06-01' }).first()).toBeVisible();
});

test('renders the 428 approval problem for a backdated endorsement', async ({ page }) => {
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
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/endorsements`) {
      await json(route, 200, itemPage([]));
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/endorsements`) {
      await route.fulfill({
        status: 428,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'https://errors.eia-open-insurance.example/policy/approval-required',
          title: 'Approval required',
          status: 428,
          detail: 'An endorsement backdated before policy inception requires approval.',
          instance: `/api/v1/policies/${POLICY_ID}/endorsements`,
          code: 'APPROVAL_REQUIRED',
          category: 'APPROVAL_REQUIRED',
          retryable: false,
          errors: [
            {
              field: 'approvalRef',
              code: 'APPROVAL_REQUIRED',
              message: 'requires an approval reference'
            }
          ]
        })
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open POL-2026-0000001' }).click();
  await page.getByRole('tab', { name: 'Endorsements' }).click();
  const form = page.getByRole('region', { name: 'Endorsements' });
  await form.getByLabel('Effective date').fill('2025-12-01');
  await form.getByLabel('Backdate reason (required before inception)').fill('Retroactive binder');
  await page.getByRole('button', { name: 'Add endorsement' }).click();

  const alert = page.getByRole('alert');
  await expect(alert).toContainText('An endorsement backdated before policy inception requires approval.');
  await expect(alert).toContainText('approvalRef: requires an approval reference');
});

