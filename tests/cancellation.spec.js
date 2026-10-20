import { test, expect } from '@playwright/test';
import { mockRelated } from './support.js';

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
    updatedAt: '2026-10-20T00:00:00Z'
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

function itemPage(items) {
  return { items, page: 0, size: 50, total: items.length, _links: { self: { href: '/x' } } };
}

function cancellation() {
  return {
    id: 'cccccccc-cccc-7ccc-8ccc-cccccccccccc',
    tenantId: TENANT,
    policyId: POLICY_ID,
    cancellationType: 'SHORT_RATE',
    reason: 'Insured sold the business',
    effectiveDate: '2026-10-20',
    noticeDays: 0,
    returnPremiumAmount: '90000.0000',
    premiumCurrency: 'USD',
    proRataPct: '0.720000',
    status: 'POSTED'
  };
}

function reinstatement() {
  return {
    id: 'dddddddd-dddd-7ddd-8ddd-dddddddddddd',
    tenantId: TENANT,
    policyId: POLICY_ID,
    effectiveDate: '2026-10-21',
    reason: 'Premium received in full',
    approvedBy: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
    approvalRef: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
    premiumEvidenceRef: 'RCPT-2026-0001',
    premiumEvidenceAmount: '1500.0000',
    premiumEvidenceCurrency: 'USD',
    status: 'APPROVED'
  };
}

async function json(route, status, body, headers = {}) {
  await route.fulfill({ status, contentType: 'application/json', headers, body: JSON.stringify(body) });
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
});

test('cancels and reinstates a policy with If-Match and Idempotency-Key', async ({ page }) => {
  let current = policy();
  let cancellations = [];
  let reinstatements = [];
  let cancelPost = null;
  let reinstatePost = null;

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([current]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, current, { ETag: `"${current.version}"` });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, {
        version: {
          id: VERSION_ID,
          policyVersionNumber: 'POL-2026-0000001-04',
          changeType: 'ISSUE',
          status: 'ISSUED',
          effectiveFrom: '2026-01-01'
        },
        current: true,
        hashVerified: true
      });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions`) {
      await json(route, 200, itemPage([]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/cancellations`) {
      await json(route, 200, itemPage(cancellations));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/reinstatements`) {
      await json(route, 200, itemPage(reinstatements));
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/cancel`) {
      cancelPost = {
        headers: route.request().headers(),
        body: route.request().postDataJSON()
      };
      current = policy(5, 'CANCELLED');
      cancellations = [cancellation()];
      await json(route, 201, cancellation(), { ETag: '"5"', 'Idempotent-Replayed': 'false' });
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/reinstate`) {
      reinstatePost = {
        headers: route.request().headers(),
        body: route.request().postDataJSON()
      };
      current = policy(6, 'REINSTATED');
      reinstatements = [reinstatement()];
      await json(route, 201, reinstatement(), { ETag: '"6"', 'Idempotent-Replayed': 'false' });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'Open record POL-2026-0000001' }).click();
  await expect(page.getByTestId('policy-etag')).toHaveText('"4"');

  await page.getByRole('tab', { name: 'Cancellation' }).click();
  const cancellationPanel = page.getByRole('tabpanel', { name: 'Cancellation' });
  await expect(cancellationPanel.getByText('No cancellations.')).toBeVisible();
  await expect(cancellationPanel.getByText('No reinstatements.')).toBeVisible();

  const cancelForm = cancellationPanel.getByRole('region', { name: 'Cancel policy' });
  await cancelForm.getByLabel('Cancellation type').selectOption('SHORT_RATE');
  await cancelForm.getByLabel('Reason').fill('Insured sold the business');
  await cancelForm.getByRole('button', { name: 'Cancel policy' }).click();

  await expect(page.getByRole('status')).toContainText('Policy cancelled (SHORT_RATE)');
  await expect(page.getByRole('status')).toContainText('$90,000.00');
  await expect(page.getByTestId('policy-status')).toHaveText('CANCELLED');
  await expect(page.getByTestId('policy-etag')).toHaveText('"5"');
  await expect(cancellationPanel.getByRole('cell', { name: 'SHORT_RATE' })).toBeVisible();
  await expect(cancellationPanel.getByRole('cell', { name: '$90,000.00' })).toBeVisible();
  await expect(cancellationPanel.getByRole('cell', { name: '72.00%' })).toBeVisible();

  expect(cancelPost.headers['if-match']).toBe('"4"');
  expect(cancelPost.headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(cancelPost.body).toMatchObject({
    cancellationType: 'SHORT_RATE',
    reason: 'Insured sold the business',
    noticeDays: 0
  });

  const reinstateForm = cancellationPanel.getByRole('region', { name: 'Reinstate policy' });
  await reinstateForm.getByLabel('Approver ID').fill('eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee');
  await reinstateForm.getByLabel('Approval reference').fill('ffffffff-ffff-7fff-8fff-ffffffffffff');
  await reinstateForm.getByRole('button', { name: 'Reinstate policy' }).click();

  await expect(page.getByRole('status')).toContainText('Policy reinstated after approval and premium evidence.');
  await expect(page.getByTestId('policy-status')).toHaveText('REINSTATED');
  await expect(page.getByTestId('policy-etag')).toHaveText('"6"');
  await expect(cancellationPanel.getByRole('cell', { name: 'RCPT-2026-0001' })).toBeVisible();
  await expect(cancellationPanel.getByRole('cell', { name: 'APPROVED' })).toBeVisible();

  expect(reinstatePost.headers['if-match']).toBe('"5"');
  expect(reinstatePost.headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(reinstatePost.body).toMatchObject({
    reason: 'Premium received in full',
    approvedBy: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
    approvalRef: 'ffffffff-ffff-7fff-8fff-ffffffffffff',
    premiumEvidenceRef: 'RCPT-2026-0001',
    premiumEvidenceAmount: '1500.00',
    premiumEvidenceCurrency: 'USD'
  });
});
