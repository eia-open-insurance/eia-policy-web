import { test, expect } from '@playwright/test';
import { mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const POLICY_NUMBER = 'POL-2026-0000001';
const VERSION_ID = '44444444-4444-7444-8444-444444444444';
const AUDIT_VERSION_ID = '55555555-5555-7555-8555-555555555555';
const APPROVER_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const APPROVAL_REF = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const ACTION_TITLE = 'Record the audited premium and issue a PREMIUM_AUDIT version';
const AUDITABLE = ['ISSUED', 'IN_FORCE', 'ENDORSED', 'REINSTATED'];
const NOT_AUDITABLE = [
  'DRAFT', 'QUOTED', 'BOUND', 'RENEWED', 'CANCELLED', 'EXPIRED', 'NON_RENEWED', 'VOID'
];

function policy({ premiumAmount = '120000.0000', version = 4, status = 'IN_FORCE' } = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: POLICY_NUMBER,
    productCode: 'CGL',
    insuredPartyId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
    status,
    effectiveDate: '2026-01-01',
    expirationDate: '2027-01-01',
    premiumAmount,
    premiumCurrency: 'USD',
    limitAmount: '5000000.0000',
    limitCurrency: 'USD',
    version,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-10-22T00:00:00Z'
  };
}

function version(number, changeType, status, effectiveFrom) {
  return {
    id: number === 5 ? AUDIT_VERSION_ID : VERSION_ID,
    tenantId: TENANT,
    policyId: POLICY_ID,
    versionNumber: number,
    policyVersionNumber: `${POLICY_NUMBER}-0${number}`,
    changeType,
    status,
    effectiveFrom,
    effectiveTo: null,
    issuedAt: '2026-10-22T00:00:00Z',
    immutableHash: 'a'.repeat(64),
    createdAt: '2026-10-22T00:00:00Z'
  };
}

function currentVersionEnvelope(current) {
  return { version: current, current: true, hashVerified: true };
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

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

function createApiState(overrides = {}) {
  const seeded = policy();
  return {
    currentPolicy: seeded,
    currentVersion: currentVersionEnvelope(
      version(4, 'ENDORSEMENT', 'ISSUED', '2026-06-01')
    ),
    versions: [version(4, 'ENDORSEMENT', 'ISSUED', '2026-06-01')],
    endorsements: [],
    onPost: null,
    ...overrides
  };
}

async function installPolicyApi(page, state) {
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const detail = `/api/v1/policies/${POLICY_ID}`;

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([state.currentPolicy]));
      return;
    }
    if (method === 'GET' && url.pathname === detail) {
      await json(route, 200, state.currentPolicy, {
        ETag: `"${state.currentPolicy.version}"`
      });
      return;
    }
    if (method === 'GET' && url.pathname === `${detail}/versions/current`) {
      await json(route, 200, state.currentVersion);
      return;
    }
    if (method === 'GET' && url.pathname === `${detail}/versions`) {
      await json(route, 200, itemPage(state.versions));
      return;
    }
    if (method === 'GET' && url.pathname === `${detail}/endorsements`) {
      await json(route, 200, itemPage(state.endorsements));
      return;
    }
    if (method === 'POST' && url.pathname === `${detail}/premium-audit` && state.onPost) {
      await state.onPost(route);
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });
}

async function openEndorsements(page, status) {
  await page.getByRole('button', { name: `Open record ${POLICY_NUMBER}` }).click();
  await expect(page.getByTestId('policy-status')).toHaveText(status);
  await page.getByRole('tab', { name: 'Endorsements' }).click();
}

async function openAuditDialog(page, status = 'IN_FORCE') {
  await openEndorsements(page, status);
  await page.getByTestId('record-premium-audit').click();
  const dialog = page.getByRole('dialog', {
    name: `Record premium audit for ${POLICY_NUMBER}`
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
});

test('offers the premium audit action only while the policy is in force', async ({ page }) => {
  const state = createApiState();
  await installPolicyApi(page, state);
  await page.goto('/');

  for (const status of AUDITABLE) {
    state.currentPolicy = policy({ status });
    await openEndorsements(page, status);
    const action = page.getByTestId('record-premium-audit');
    await expect(action).toBeEnabled();
    await expect(action).toHaveAttribute('title', ACTION_TITLE);
    await expect(page.getByTestId('premium-audit-unavailable')).toHaveCount(0);
  }

  for (const status of NOT_AUDITABLE) {
    state.currentPolicy = policy({ status });
    await openEndorsements(page, status);
    const action = page.getByTestId('record-premium-audit');
    await expect(action).toBeDisabled();
    await expect(action).toHaveAttribute('title', new RegExp(`This policy is ${status}\\.$`));
    const reason = page.getByTestId('premium-audit-unavailable');
    await expect(reason).toBeVisible();
    await expect(reason).toHaveText(
      'Premium audit is available only when the policy is ISSUED, IN_FORCE, ENDORSED, or '
      + `REINSTATED. This policy is ${status}.`
    );
  }

  await expect(page.getByTestId('premium-audit-dialog')).toHaveCount(0);
});

test('records an increased premium with If-Match and issues a PREMIUM_AUDIT version', async ({ page }) => {
  const state = createApiState();
  let auditPost = null;
  state.onPost = async (route) => {
    auditPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    state.currentPolicy = policy({ premiumAmount: '132000.0000', version: 5 });
    state.currentVersion = currentVersionEnvelope(
      version(5, 'PREMIUM_AUDIT', 'ISSUED', '2026-10-22')
    );
    state.versions = [
      version(5, 'PREMIUM_AUDIT', 'ISSUED', '2026-10-22'),
      version(4, 'ENDORSEMENT', 'SUPERSEDED', '2026-06-01')
    ];
    await json(route, 201, state.currentPolicy, {
      ETag: '"5"',
      'Idempotent-Replayed': 'false'
    });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  const dialog = await openAuditDialog(page);
  await expect(dialog.getByTestId('premium-audit-current')).toHaveText('$120,000.00');
  await expect(dialog.getByLabel('Audited premium')).toHaveValue('120000.0000');
  await expect(dialog.getByTestId('premium-audit-delta'))
    .toHaveText('No change to written premium');
  await expect(dialog).toContainText('Coverage grants and policy limits are unchanged.');
  await expect(dialog.getByTestId('premium-audit-context')).toContainText(
    'Coverage grants, limits, and the insured and location schedules stay as issued.'
  );

  await dialog.getByLabel('Audited premium').fill('132000.00');
  await expect(dialog.getByTestId('premium-audit-delta')).toHaveText('Increase of $12,000.00');
  await dialog.getByLabel('Effective date').fill('2026-10-22');
  await dialog.getByLabel('Reason').fill('Annual payroll audit - reported exposure increased');
  await dialog.getByLabel('Approver ID (optional)').fill(APPROVER_ID);
  await dialog.getByLabel('Approval reference (optional)').fill(APPROVAL_REF);
  await dialog.getByRole('button', { name: 'Record audit' }).click();

  await expect(page.getByRole('status')).toContainText('Premium audit recorded');
  await expect(page.getByRole('status')).toContainText('$120,000.00 → $132,000.00');
  await expect(page.getByRole('status')).toContainText('PREMIUM_AUDIT version issued');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId('policy-etag')).toHaveText('"5"');

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues.nth(0)).toHaveText('$132,000.00');
  await expect(summaryValues.nth(1)).toHaveText('$5,000,000.00');

  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.getByRole('cell', { name: `${POLICY_NUMBER}-05` })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'PREMIUM_AUDIT' })).toBeVisible();

  await page.getByRole('tab', { name: 'Overview' }).click();
  const currentVersion = page.getByRole('region', { name: 'Current version' });
  await expect(currentVersion).toContainText(`${POLICY_NUMBER}-05`);
  await expect(currentVersion).toContainText('PREMIUM_AUDIT');

  expect(auditPost.headers['if-match']).toBe('"4"');
  expect(auditPost.headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(auditPost.body).toEqual({
    auditedPremium: '132000.00',
    effectiveDate: '2026-10-22',
    reason: 'Annual payroll audit - reported exposure increased',
    approvedBy: APPROVER_ID,
    approvalRef: APPROVAL_REF
  });
});

test('previews and records a decrease without optional approval references', async ({ page }) => {
  const state = createApiState();
  let auditPost = null;
  state.onPost = async (route) => {
    auditPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    state.currentPolicy = policy({ premiumAmount: '115000.0000', version: 5 });
    state.currentVersion = currentVersionEnvelope(
      version(5, 'PREMIUM_AUDIT', 'ISSUED', '2026-10-22')
    );
    state.versions = [
      version(5, 'PREMIUM_AUDIT', 'ISSUED', '2026-10-22'),
      version(4, 'ENDORSEMENT', 'SUPERSEDED', '2026-06-01')
    ];
    // Cancellation-style result: the audit record identifies the issued version
    // and the caller re-reads the policy and current version.
    await json(route, 201, {
      id: '66666666-6666-7666-8666-666666666666',
      tenantId: TENANT,
      policyId: POLICY_ID,
      auditedPremium: '115000.0000',
      previousPremiumAmount: '120000.0000',
      premiumDeltaAmount: '-5000.0000',
      effectiveDate: '2026-10-22',
      reason: 'Payroll audit - reported exposure decreased',
      policyVersionNumber: `${POLICY_NUMBER}-05`,
      status: 'FINALIZED'
    }, { ETag: '"5"', 'Idempotent-Replayed': 'false' });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  const dialog = await openAuditDialog(page);
  await dialog.getByLabel('Audited premium').fill('115000.00');
  await expect(dialog.getByTestId('premium-audit-delta')).toHaveText('Decrease of $5,000.00');
  await dialog.getByLabel('Effective date').fill('2026-10-22');
  await dialog.getByLabel('Reason').fill('Payroll audit - reported exposure decreased');
  await dialog.getByRole('button', { name: 'Record audit' }).click();

  await expect(page.getByRole('status')).toContainText('Premium audit recorded');
  await expect(page.getByRole('status')).toContainText('$120,000.00 → $115,000.00');
  await expect(page.getByRole('status')).toContainText(
    `PREMIUM_AUDIT version ${POLICY_NUMBER}-05 issued.`
  );
  await expect(dialog).toHaveCount(0);

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues.nth(0)).toHaveText('$115,000.00');
  await expect(summaryValues.nth(1)).toHaveText('$5,000,000.00');
  await expect(page.getByTestId('policy-etag')).toHaveText('"5"');

  expect(auditPost.headers['if-match']).toBe('"4"');
  expect(auditPost.body).toEqual({
    auditedPremium: '115000.00',
    effectiveDate: '2026-10-22',
    reason: 'Payroll audit - reported exposure decreased'
  });
});

test('records a confirming no-change audit without touching coverage or limits', async ({ page }) => {
  const state = createApiState();
  let auditPost = null;
  state.onPost = async (route) => {
    auditPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    state.currentPolicy = policy({ version: 5 });
    state.currentVersion = currentVersionEnvelope(
      version(5, 'PREMIUM_AUDIT', 'ISSUED', '2026-10-22')
    );
    state.versions = [
      version(5, 'PREMIUM_AUDIT', 'ISSUED', '2026-10-22'),
      version(4, 'ENDORSEMENT', 'SUPERSEDED', '2026-06-01')
    ];
    await json(route, 201, state.currentPolicy, {
      ETag: '"5"',
      'Idempotent-Replayed': 'false'
    });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  const dialog = await openAuditDialog(page);
  await expect(dialog.getByTestId('premium-audit-delta'))
    .toHaveText('No change to written premium');
  await dialog.getByLabel('Effective date').fill('2026-10-22');
  await dialog.getByLabel('Reason').fill('Annual audit confirms reported exposure');
  await dialog.getByRole('button', { name: 'Record audit' }).click();

  await expect(page.getByRole('status')).toContainText('Premium audit recorded');
  await expect(page.getByRole('status')).toContainText('$120,000.00 → $120,000.00');
  await expect(dialog).toHaveCount(0);

  const summaryValues = page.locator('.eia-summary-grid .value');
  await expect(summaryValues.nth(0)).toHaveText('$120,000.00');
  await expect(summaryValues.nth(1)).toHaveText('$5,000,000.00');
  await expect(page.getByTestId('policy-etag')).toHaveText('"5"');

  await page.getByRole('tab', { name: 'Versions' }).click();
  await expect(page.getByRole('cell', { name: 'PREMIUM_AUDIT' })).toBeVisible();

  expect(auditPost.headers['if-match']).toBe('"4"');
  expect(auditPost.body).toEqual({
    auditedPremium: '120000.0000',
    effectiveDate: '2026-10-22',
    reason: 'Annual audit confirms reported exposure'
  });
});

test('contains a 400 validation problem in the dialog and keeps the form', async ({ page }) => {
  const state = createApiState();
  let postCalls = 0;
  state.onPost = async (route) => {
    postCalls += 1;
    await route.fulfill({
      status: 400,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/policy/premium-audit-invalid',
        title: 'Premium audit rejected',
        status: 400,
        detail: 'Audited premium is outside the policy rating tolerance.',
        instance: `/api/v1/policies/${POLICY_ID}/premium-audit`,
        code: 'VALIDATION_FAILED',
        category: 'VALIDATION',
        retryable: false,
        errors: [
          {
            field: 'auditedPremium',
            code: 'OUT_OF_TOLERANCE',
            message: 'the increase exceeds 25% of written premium'
          }
        ]
      })
    });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  const dialog = await openAuditDialog(page);
  await dialog.getByLabel('Audited premium').fill('150000.00');
  await dialog.getByLabel('Effective date').fill('2026-10-22');
  await dialog.getByLabel('Reason').fill('   ');
  await dialog.getByRole('button', { name: 'Record audit' }).click();

  const error = page.getByTestId('premium-audit-error');
  await expect(error).toHaveText('Reason is required.');
  expect(postCalls).toBe(0);

  await dialog.getByLabel('Reason').fill('Annual payroll audit - exposure increased');
  await dialog.getByRole('button', { name: 'Record audit' }).click();

  await expect(error).toContainText('Audited premium is outside the policy rating tolerance.');
  await expect(error).toContainText(
    'auditedPremium: the increase exceeds 25% of written premium'
  );
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('premium-audit-current')).toHaveText('$120,000.00');
  await expect(page.getByTestId('policy-etag')).toHaveText('"4"');
  await expect(page.locator('.eia-summary-grid .value').nth(0)).toHaveText('$120,000.00');
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(postCalls).toBe(1);

  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: POLICY_NUMBER, exact: true })).toBeVisible();
});

test('contains a 409 audit conflict and keeps the selected policy', async ({ page }) => {
  const state = createApiState();
  let auditPost = null;
  state.onPost = async (route) => {
    auditPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    await route.fulfill({
      status: 409,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'https://errors.eia-open-insurance.example/policy/premium-audit-conflict',
        title: 'Premium audit conflict',
        status: 409,
        detail: 'Policy POL-2026-0000001 changed since version 4; reload before recording the audit.',
        instance: `/api/v1/policies/${POLICY_ID}/premium-audit`,
        code: 'VERSION_CONFLICT',
        category: 'CONFLICT',
        retryable: true,
        errors: [
          {
            field: 'If-Match',
            code: 'STALE_VERSION',
            message: 'expected version 4 but the policy is now version 5'
          }
        ]
      })
    });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  const dialog = await openAuditDialog(page);
  await dialog.getByLabel('Audited premium').fill('130000.00');
  await dialog.getByLabel('Effective date').fill('2026-10-22');
  await dialog.getByLabel('Reason').fill('Annual payroll audit - exposure increased');
  await dialog.getByRole('button', { name: 'Record audit' }).click();

  const error = page.getByTestId('premium-audit-error');
  await expect(error).toContainText(
    'Policy POL-2026-0000001 changed since version 4; reload before recording the audit.'
  );
  await expect(error).toContainText(
    'If-Match: expected version 4 but the policy is now version 5'
  );
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('heading', { name: POLICY_NUMBER, exact: true })).toBeVisible();
  await expect(page.getByTestId('policy-etag')).toHaveText('"4"');
  await expect(page.locator('.eia-summary-grid .value').nth(0)).toHaveText('$120,000.00');
  await expect(page.getByRole('status')).toHaveCount(0);

  expect(auditPost.headers['if-match']).toBe('"4"');
  expect(auditPost.body.auditedPremium).toBe('130000.00');
});
