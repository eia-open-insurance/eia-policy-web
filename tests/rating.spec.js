import { test, expect } from '@playwright/test';
import { mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const POLICY_NUMBER = 'POL-2026-0000001';
const VERSION_ID = '44444444-4444-7444-8444-444444444444';
const WORKSHEET_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
const FLAT_HASH = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
const CREATED_BY = '00000000-0000-0000-0000-000000000000';
const RATEABLE = ['DRAFT', 'QUOTED'];
const NOT_RATEABLE = [
  'BOUND', 'ISSUED', 'IN_FORCE', 'ENDORSED', 'RENEWED', 'CANCELLED', 'EXPIRED',
  'NON_RENEWED', 'REINSTATED', 'VOID'
];

function policy({ status = 'DRAFT', premiumAmount = '120000.0000', version = 4 } = {}) {
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

function worksheet(overrides = {}) {
  return {
    id: WORKSHEET_ID,
    tenantId: TENANT,
    policyId: POLICY_ID,
    ratingMethod: 'RATE_TIMES_EXPOSURE',
    baseRate: '0.012500',
    exposureAmount: '250000.0000',
    factor: '1.250000',
    computedPremium: '3906.2500',
    currency: 'USD',
    calcHash: HASH,
    status: 'CALCULATED',
    createdAt: '2026-10-22T09:00:00Z',
    createdBy: CREATED_BY,
    ...overrides
  };
}

function flatWorksheet(overrides = {}) {
  return worksheet({
    ratingMethod: 'FLAT',
    baseRate: '5000.000000',
    exposureAmount: null,
    factor: '1.100000',
    computedPremium: '5500.0000',
    calcHash: FLAT_HASH,
    ...overrides
  });
}

function version(number = 4) {
  return {
    id: VERSION_ID,
    tenantId: TENANT,
    policyId: POLICY_ID,
    versionNumber: number,
    policyVersionNumber: `${POLICY_NUMBER}-0${number}`,
    changeType: 'ENDORSEMENT',
    status: 'DRAFT',
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    issuedAt: '2026-10-22T00:00:00Z',
    immutableHash: 'b'.repeat(64),
    createdAt: '2026-10-22T00:00:00Z'
  };
}

function currentVersionEnvelope() {
  return { version: version(4), current: true, hashVerified: true };
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

async function problem(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify(body)
  });
}

function createApiState(overrides = {}) {
  return {
    currentPolicy: policy(),
    currentVersion: currentVersionEnvelope(),
    versions: [version(4)],
    latest: null,
    onPost: null,
    detailReads: 0,
    currentVersionReads: 0,
    versionListReads: 0,
    ratingReads: 0,
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
      state.detailReads += 1;
      await json(route, 200, state.currentPolicy, {
        ETag: `"${state.currentPolicy.version}"`
      });
      return;
    }
    if (method === 'GET' && url.pathname === `${detail}/versions/current`) {
      state.currentVersionReads += 1;
      await json(route, 200, state.currentVersion);
      return;
    }
    if (method === 'GET' && url.pathname === `${detail}/versions`) {
      state.versionListReads += 1;
      await json(route, 200, itemPage(state.versions));
      return;
    }
    if (method === 'GET' && url.pathname === `${detail}/rating`) {
      state.ratingReads += 1;
      if (state.latest) {
        await json(route, 200, state.latest);
      } else {
        await problem(route, 404, {
          type: 'https://errors.eia-open-insurance.example/policy/rating-worksheet-not-found',
          title: 'Rating worksheet not found',
          status: 404,
          detail: `No rating worksheet exists for policy: ${POLICY_ID}`,
          code: 'RATING_WORKSHEET_NOT_FOUND',
          category: 'NOT_FOUND',
          retryable: false
        });
      }
      return;
    }
    if (method === 'POST' && url.pathname === `${detail}/rating` && state.onPost) {
      await state.onPost(route);
      return;
    }
    await problem(route, 404, {
      status: 404,
      code: 'NOT_FOUND',
      detail: `unexpected route ${method} ${url.pathname}`
    });
  });
}

async function openRating(page, status = 'DRAFT') {
  await page.getByRole('button', { name: `Open record ${POLICY_NUMBER}` }).click();
  await expect(page.getByTestId('policy-status')).toHaveText(status);
  await page.getByRole('tab', { name: 'Rating' }).click();
  await expect(page.getByTestId('rating-form')).toBeVisible();
}

async function fillRateTimesExposure(page, {
  baseRate = '0.0125',
  exposureAmount = '250000',
  factor = '1.25'
} = {}) {
  await page.getByLabel('Base rate').fill(baseRate);
  await page.getByLabel('Exposure amount').fill(exposureAmount);
  await page.getByLabel('Factor').fill(factor);
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
});

test('shows the latest worksheet, reproducibility hash, and a live premium preview', async ({ page }) => {
  const state = createApiState({ latest: worksheet() });
  await installPolicyApi(page, state);
  await page.goto('/');

  await openRating(page, 'DRAFT');

  const card = page.getByTestId('rating-worksheet');
  await expect(card).toBeVisible();
  await expect(card.getByTestId('rating-status')).toHaveText('CALCULATED');
  await expect(card.getByTestId('rating-value-method')).toContainText('RATE_TIMES_EXPOSURE');
  await expect(card.getByTestId('rating-value-base-rate')).toHaveText('0.0125 USD');
  await expect(card.getByTestId('rating-value-exposure')).toHaveText('$250,000.00');
  await expect(card.getByTestId('rating-value-factor')).toHaveText('1.25');
  await expect(card.getByTestId('rating-value-premium')).toHaveText('$3,906.25');
  await expect(card.getByTestId('rating-value-hash')).toHaveText(HASH);
  await expect(card.getByTestId('rating-value-created')).toContainText('Oct 22, 2026');
  await expect(card).toContainText('immutable worksheet');

  await expect(page.getByLabel('Rating method')).toHaveValue('RATE_TIMES_EXPOSURE');
  await expect(page.getByLabel('Apply to quote')).not.toBeChecked();
  await expect(page.getByTestId('rating-preview'))
    .toHaveText('Enter the rating inputs to preview the computed premium.');

  await fillRateTimesExposure(page);
  await expect(page.getByTestId('rating-preview')).toHaveText('$3,906.25');
  await expect(page.getByTestId('rating-method-help')).toHaveText(
    'Base rate × exposure amount × factor.'
  );

  const context = page.getByTestId('rating-context');
  await expect(context).toContainText('Rating is reproducible');
  await expect(context).toContainText('canonical SHA-256 hash');
  await expect(context).toContainText('Rating does not change coverage or limits');
  await expect(context).toContainText('Issued premium changes use premium audit');
  expect(state.ratingReads).toBe(1);
});

test('calculates a worksheet without changing the premium, ETag, or versions', async ({ page }) => {
  const state = createApiState();
  let ratingPost = null;
  state.onPost = async (route) => {
    ratingPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    await json(route, 201, {
      worksheet: worksheet({
        id: 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee',
        createdAt: '2026-10-22T10:15:00Z'
      })
    });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  await openRating(page, 'DRAFT');
  await expect(page.getByTestId('rating-empty')).toBeVisible();
  await fillRateTimesExposure(page);
  await page.getByRole('button', { name: 'Rate policy' }).click();

  await expect(page.getByRole('status')).toContainText('Rating worksheet calculated');
  await expect(page.getByRole('status')).toContainText('$3,906.25');
  await expect(page.getByRole('status')).toContainText('unchanged until the rating is applied');

  await expect(page.getByTestId('rating-worksheet')).toBeVisible();
  await expect(page.getByTestId('rating-value-hash')).toHaveText(HASH);
  await expect(page.getByTestId('policy-etag')).toHaveText('"4"');
  await expect(page.locator('.eia-summary-grid .value').nth(0)).toHaveText('$120,000.00');
  expect(state.versionListReads).toBe(0);
  expect(state.currentVersionReads).toBe(1);
  expect(state.detailReads).toBe(1);

  expect(ratingPost.body).toEqual({
    ratingMethod: 'RATE_TIMES_EXPOSURE',
    baseRate: '0.0125',
    exposureAmount: '250000',
    factor: '1.25',
    apply: false
  });
  expect(ratingPost.headers['if-match']).toBeUndefined();
  expect(ratingPost.headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
});

test('applies a rating and refreshes the policy premium, ETag, and versions', async ({ page }) => {
  const state = createApiState();
  let ratingPost = null;
  state.onPost = async (route) => {
    ratingPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    state.currentPolicy = policy({ premiumAmount: '3906.2500', version: 5 });
    state.versions = [version(4)];
    await json(route, 201, {
      worksheet: worksheet(),
      policy: state.currentPolicy
    }, { ETag: '"5"', 'Idempotent-Replayed': 'false' });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  await openRating(page, 'DRAFT');
  await fillRateTimesExposure(page);
  await page.getByLabel('Apply to quote').check();
  await expect(page.getByLabel('Apply to quote')).toBeChecked();
  await page.getByRole('button', { name: 'Rate policy' }).click();

  await expect(page.getByRole('status')).toContainText('Rating applied');
  await expect(page.getByRole('status')).toContainText('$120,000.00 → $3,906.25');
  await expect(page.getByRole('status')).toContainText('Policy version 5');
  await expect(page.getByRole('status')).toContainText('ETag "5"');
  await expect(page.getByRole('status')).toContainText('Worksheet a1b2c3d4e5f6… recorded');

  await expect(page.getByTestId('policy-etag')).toHaveText('"5"');
  await expect(page.locator('.eia-summary-grid .value').nth(0)).toHaveText('$3,906.25');
  await expect(page.getByTestId('rating-value-premium')).toHaveText('$3,906.25');

  await expect.poll(() => state.versionListReads).toBeGreaterThanOrEqual(1);
  await expect.poll(() => state.currentVersionReads).toBeGreaterThanOrEqual(2);
  await expect.poll(() => state.detailReads).toBeGreaterThanOrEqual(2);

  expect(ratingPost.headers['if-match']).toBe('"4"');
  expect(ratingPost.body).toEqual({
    ratingMethod: 'RATE_TIMES_EXPOSURE',
    baseRate: '0.0125',
    exposureAmount: '250000',
    factor: '1.25',
    apply: true
  });
});

test('supports FLAT ratings, ignores exposure, and renders their hash', async ({ page }) => {
  const state = createApiState({ latest: flatWorksheet() });
  let ratingPost = null;
  state.onPost = async (route) => {
    ratingPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    await json(route, 201, { worksheet: flatWorksheet() });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  await openRating(page, 'DRAFT');
  const card = page.getByTestId('rating-worksheet');
  await expect(card.getByTestId('rating-value-method')).toContainText('FLAT');
  await expect(card.getByTestId('rating-value-exposure')).toHaveText('—');
  await expect(card.getByTestId('rating-value-premium')).toHaveText('$5,500.00');
  await expect(card.getByTestId('rating-value-hash')).toHaveText(FLAT_HASH);

  await page.getByLabel('Rating method').selectOption('FLAT');
  await expect(page.getByLabel('Exposure amount')).toBeDisabled();
  await expect(page.getByTestId('rating-method-help')).toHaveText(
    'Base rate × factor; no exposure amount is stored.'
  );
  await page.getByLabel('Base rate').fill('5000');
  await page.getByLabel('Factor').fill('1.1');
  await expect(page.getByTestId('rating-preview')).toHaveText('$5,500.00');

  await page.getByRole('button', { name: 'Rate policy' }).click();
  await expect(page.getByRole('status')).toContainText('Rating worksheet calculated');
  expect(ratingPost.body).toEqual({
    ratingMethod: 'FLAT',
    baseRate: '5000',
    exposureAmount: null,
    factor: '1.1',
    apply: false
  });
});

test('disables rating outside DRAFT and QUOTED with the eligibility reason', async ({ page }) => {
  const state = createApiState();
  await installPolicyApi(page, state);
  await page.goto('/');

  for (const status of RATEABLE) {
    state.currentPolicy = policy({ status });
    await openRating(page, status);
    await expect(page.getByRole('button', { name: 'Rate policy' })).toBeEnabled();
    await expect(page.getByLabel('Rating method')).toBeEnabled();
    await expect(page.getByLabel('Base rate')).toBeEnabled();
    await expect(page.getByLabel('Exposure amount')).toBeEnabled();
    await expect(page.getByTestId('rating-unavailable')).toHaveCount(0);
  }

  for (const status of NOT_RATEABLE) {
    state.currentPolicy = policy({ status });
    await openRating(page, status);
    const submit = page.getByRole('button', { name: 'Rate policy' });
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute(
      'title',
      `Rating is available only when the policy is DRAFT or QUOTED. This policy is ${status}.`
    );
    await expect(page.getByTestId('rating-unavailable')).toHaveText(
      `Rating is available only when the policy is DRAFT or QUOTED. This policy is ${status}.`
    );
    await expect(page.getByLabel('Rating method')).toBeDisabled();
    await expect(page.getByLabel('Base rate')).toBeDisabled();
    await expect(page.getByLabel('Factor')).toBeDisabled();
    await expect(page.getByLabel('Apply to quote')).toBeDisabled();
  }
});

test('keeps a 400 rating problem in the tab and preserves the inputs', async ({ page }) => {
  const state = createApiState({ latest: worksheet() });
  let postCalls = 0;
  state.onPost = async (route) => {
    postCalls += 1;
    await problem(route, 400, {
      type: 'https://errors.eia-open-insurance.example/policy/rating-exposure-invalid',
      title: 'Invalid rating exposure',
      status: 400,
      detail: 'exposureAmount must be greater than zero for RATE_TIMES_EXPOSURE.',
      code: 'RATING_EXPOSURE_INVALID',
      category: 'VALIDATION',
      retryable: false,
      errors: [
        {
          field: 'exposureAmount',
          code: 'RATING_EXPOSURE_INVALID',
          message: 'exposureAmount must be greater than zero for RATE_TIMES_EXPOSURE.'
        }
      ]
    });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  await openRating(page, 'DRAFT');
  await page.getByLabel('Base rate').fill('0.02');
  await page.getByLabel('Exposure amount').fill('0');
  await page.getByLabel('Factor').fill('1.5');
  await page.getByRole('button', { name: 'Rate policy' }).click();

  // The local preview/validation mirrors the domain rule and never posts.
  const error = page.getByTestId('rating-form-error');
  await expect(error).toHaveText(
    'Exposure amount must be greater than zero for RATE_TIMES_EXPOSURE.'
  );
  expect(postCalls).toBe(0);
  await expect(page.getByTestId('rating-value-hash')).toHaveText(HASH);

  await page.getByLabel('Exposure amount').fill('500000');
  await page.getByRole('button', { name: 'Rate policy' }).click();

  await expect(error).toContainText(
    'exposureAmount must be greater than zero for RATE_TIMES_EXPOSURE.'
  );
  await expect(error).toContainText(
    'exposureAmount: exposureAmount must be greater than zero for RATE_TIMES_EXPOSURE.'
  );
  expect(postCalls).toBe(1);
  await expect(page.getByLabel('Base rate')).toHaveValue('0.02');
  await expect(page.getByLabel('Exposure amount')).toHaveValue('500000');
  await expect(page.getByTestId('policy-etag')).toHaveText('"4"');
  await expect(page.locator('.eia-summary-grid .value').nth(0)).toHaveText('$120,000.00');
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('contains a 409 stale-version conflict when applying', async ({ page }) => {
  const state = createApiState();
  let ratingPost = null;
  state.onPost = async (route) => {
    ratingPost = {
      headers: route.request().headers(),
      body: route.request().postDataJSON()
    };
    await problem(route, 409, {
      type: 'https://errors.eia-open-insurance.example/policy/concurrent-modification',
      title: 'Concurrent modification',
      status: 409,
      detail: 'The policy changed concurrently; reload and retry.',
      code: 'CONCURRENT_MODIFICATION',
      category: 'CONFLICT',
      retryable: true,
      errors: [
        {
          field: 'If-Match',
          code: 'STALE_VERSION',
          message: 'expected version 4 but the policy is now version 5'
        }
      ]
    });
  };
  await installPolicyApi(page, state);
  await page.goto('/');

  await openRating(page, 'DRAFT');
  await fillRateTimesExposure(page);
  await page.getByLabel('Apply to quote').check();
  await page.getByRole('button', { name: 'Rate policy' }).click();

  const error = page.getByTestId('rating-form-error');
  await expect(error).toContainText('The policy changed concurrently; reload and retry.');
  await expect(error).toContainText(
    'If-Match: expected version 4 but the policy is now version 5'
  );
  await expect(page.getByTestId('policy-etag')).toHaveText('"4"');
  await expect(page.locator('.eia-summary-grid .value').nth(0)).toHaveText('$120,000.00');
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(ratingPost.headers['if-match']).toBe('"4"');
  expect(ratingPost.body.apply).toBe(true);
});
