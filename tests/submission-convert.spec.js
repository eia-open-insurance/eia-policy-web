import { test, expect } from '@playwright/test';
import {
  mockPartyDetail,
  mockPartySearch,
  mockRelated,
  PARTY_ID
} from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const SUBMISSION_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const POLICY_NUMBER = 'POL-2026-0000001';
const LIST_PATH = '/api/v1/policies/submissions';

function submission(overrides = {}) {
  return {
    submissionId: SUBMISSION_ID,
    tenantId: TENANT,
    submissionNumber: 'SUB-2026-0000001',
    applicantPartyId: PARTY_ID,
    productCode: 'CGL',
    requestedEffectiveDate: '2026-11-01',
    requestedLimitAmount: '5000000.0000',
    requestedLimitCurrency: 'USD',
    tortCodes: ['ASBESTOS'],
    notes: 'Mass tort referral.',
    status: 'QUOTED',
    version: 1,
    receivedAt: '2026-10-20T12:00:00Z',
    createdAt: '2026-10-20T12:00:00Z',
    updatedAt: '2026-10-21T09:30:00Z',
    ...overrides
  };
}

function policy(overrides = {}) {
  return {
    id: POLICY_ID,
    tenantId: TENANT,
    policyNumber: POLICY_NUMBER,
    productCode: 'CGL',
    insuredPartyId: PARTY_ID,
    status: 'DRAFT',
    effectiveDate: '2026-11-01',
    expirationDate: '2027-11-01',
    premiumAmount: '125000.00',
    premiumCurrency: 'USD',
    limitAmount: '5000000.00',
    limitCurrency: 'USD',
    version: 0,
    createdAt: '2026-10-22T12:00:00Z',
    updatedAt: '2026-10-22T12:00:00Z',
    ...overrides
  };
}

function envelope(items) {
  return {
    items,
    page: 0,
    size: 20,
    total: items.length,
    _links: { self: { href: `${LIST_PATH}?page=0&size=20` } }
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

async function problem(route, status, body) {
  await route.fulfill({
    status,
    contentType: 'application/problem+json',
    body: JSON.stringify(body)
  });
}

function createState(overrides = {}) {
  const items = overrides.items || [submission()];
  return {
    items,
    current: overrides.current || items[0],
    policy: overrides.policy || policy(),
    listReads: 0,
    detailReads: 0,
    policyReads: 0,
    policyPosts: 0,
    convertPosts: [],
    onConvert: null,
    ...overrides
  };
}

/**
 * Serves the submissions API, the created policy, and the read-only policy
 * context lookups. The submissions route is registered last so it wins over
 * the broader policies route, exactly as the app's URLs nest.
 */
async function installApi(page, state) {
  await page.route('**/api/v1/documents**', async (route) => {
    await json(route, 200, { items: [], page: 0, size: 20, total: 0 });
  });
  await page.route('**/api/v1/events/**', async (route) => {
    await json(route, 200, { items: [], page: 0, size: 50, total: 0 });
  });

  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([state.policy]));
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/policies') {
      state.policyPosts += 1;
      await problem(route, 405, {
        status: 405,
        code: 'UNEXPECTED_CREATE',
        detail: 'A conversion must not post directly to the policy collection.'
      });
      return;
    }
    if (method === 'GET' && /\/versions\/current$/.test(url.pathname)) {
      await problem(route, 404, {
        status: 404,
        code: 'VERSION_NOT_FOUND',
        detail: 'The new draft policy has no current version yet.'
      });
      return;
    }
    const detail = url.pathname.match(/^\/api\/v1\/policies\/([^/]+)$/);
    if (method === 'GET' && detail) {
      state.policyReads += 1;
      if (detail[1] === state.policy.id) {
        await json(route, 200, state.policy, { ETag: '"0"' });
        return;
      }
      await problem(route, 404, {
        status: 404,
        code: 'POLICY_NOT_FOUND',
        detail: `Policy ${detail[1]} was not found.`
      });
      return;
    }
    await problem(route, 404, {
      status: 404,
      code: 'NOT_FOUND',
      detail: `unexpected policy route ${method} ${url.pathname}`
    });
  });

  await page.route('**/api/v1/policies/submissions**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const convertMatch = url.pathname.match(
      /^\/api\/v1\/policies\/submissions\/([^/]+)\/convert$/
    );
    const statusMatch = url.pathname.match(
      /^\/api\/v1\/policies\/submissions\/([^/]+)\/status$/
    );
    const referralsMatch = url.pathname.match(
      /^\/api\/v1\/policies\/submissions\/([^/]+)\/referrals$/
    );
    const detailMatch = url.pathname.match(/^\/api\/v1\/policies\/submissions\/([^/]+)$/);

    if (method === 'GET' && url.pathname === LIST_PATH) {
      state.listReads += 1;
      await json(route, 200, envelope(state.items));
      return;
    }

    if (method === 'GET' && referralsMatch) {
      await json(route, 200, { items: [], page: 0, size: 0, total: 0 });
      return;
    }

    if (method === 'POST' && convertMatch) {
      const body = route.request().postDataJSON();
      state.convertPosts.push({
        path: url.pathname,
        headers: route.request().headers(),
        body
      });
      if (state.onConvert) {
        await state.onConvert(route, body);
        return;
      }
      const id = convertMatch[1];
      const bound = {
        ...(state.current?.submissionId === id
          ? state.current
          : submission({ submissionId: id })),
        status: 'BOUND',
        version: (state.current?.version ?? 0) + 1,
        updatedAt: '2026-10-22T12:00:00Z'
      };
      state.current = bound;
      state.items = state.items.map((item) => (
        item.submissionId === id ? bound : item
      ));
      await json(
        route,
        201,
        { policy: state.policy, submission: bound },
        { ETag: '"0"', Location: `/api/v1/policies/${state.policy.id}` }
      );
      return;
    }

    if (method === 'GET' && detailMatch) {
      state.detailReads += 1;
      const id = detailMatch[1];
      const found = state.items.find((item) => item.submissionId === id);
      const record = found
        || (state.current?.submissionId === id ? state.current : submission({ submissionId: id }));
      await json(route, 200, record, { ETag: `"${record.version ?? 0}"` });
      return;
    }

    if (method === 'PATCH' && statusMatch) {
      await problem(route, 409, {
        status: 409,
        code: 'UNEXPECTED_STATUS',
        detail: 'Conversion tests do not move the submission through the status endpoint.'
      });
      return;
    }

    await problem(route, 404, {
      status: 404,
      code: 'NOT_FOUND',
      detail: `unexpected submission route ${method} ${url.pathname}`
    });
  });
}

async function openSubmissions(page) {
  await page.getByRole('tab', { name: 'Submissions' }).click();
  await expect(page.getByRole('heading', { name: 'Submissions', exact: true })).toBeVisible();
}

async function openSubmission(page, number) {
  await page.getByRole('button', { name: `Open submission ${number}` }).click();
  await expect(page.getByTestId('submission-number')).toHaveText(number);
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
  await mockPartySearch(page);
  await mockPartyDetail(page);
});

test('converts a QUOTED submission into a selected DRAFT policy and refreshes the submission', async ({ page }) => {
  const state = createState();
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openSubmission(page, 'SUB-2026-0000001');

  const panel = page.getByTestId('submission-convert-panel');
  await expect(panel).toContainText('creates a DRAFT policy');
  await expect(panel).toContainText('binds the submission');
  await expect(page.getByTestId('submission-convert')).toBeVisible();
  await expect(page.getByTestId('submission-convert-unavailable')).toHaveCount(0);

  await page.getByTestId('submission-convert').click();
  const dialog = page.getByTestId('submission-convert-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Convert to policy · SUB-2026-0000001');
  await expect(dialog).toContainText('creates a DRAFT policy');
  await expect(dialog).toContainText('binds the submission');

  const summary = page.getByTestId('submission-convert-summary');
  await expect(summary).toContainText('Acme Manufacturing · PTY-000000001');
  await expect(summary).toContainText('CGL');
  await expect(summary).toContainText('$5,000,000.00');
  await expect(summary).toContainText('2026-11-01');
  await expect(summary).toContainText('QUOTED');

  await expect(dialog.getByLabel('Premium amount')).toHaveValue('');
  await expect(dialog.getByLabel('Premium currency')).toHaveValue('USD');
  await expect(dialog.getByLabel('Expiration date (optional)')).toHaveValue('2027-11-01');

  await dialog.getByLabel('Premium amount').fill('125000');
  await dialog.getByRole('button', { name: 'Convert to policy' }).click();

  await expect(page.getByTestId('policy-notice'))
    .toContainText('Converted submission SUB-2026-0000001 to DRAFT policy POL-2026-0000001.');
  await expect(page.getByRole('tab', { name: 'Policies' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  await expect(page.getByRole('heading', { name: POLICY_NUMBER, exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`record=${POLICY_ID}`));
  await expect(page.getByTestId('submission-convert-dialog')).toHaveCount(0);

  expect(state.convertPosts).toHaveLength(1);
  expect(state.convertPosts[0].path)
    .toBe(`/api/v1/policies/submissions/${SUBMISSION_ID}/convert`);
  expect(state.convertPosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.convertPosts[0].headers['idempotency-key'])
    .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(state.convertPosts[0].body).toEqual({
    premiumAmount: '125000',
    premiumCurrency: 'USD',
    expirationDate: '2027-11-01'
  });
  expect(state.policyPosts).toBe(0);
  expect(state.policyReads).toBe(1);
  expect(state.detailReads).toBe(2);

  // The conversion binds the submission server-side. The tab refreshed before
  // handing over, and a return to the queue reads the server's BOUND status.
  await page.getByRole('tab', { name: 'Submissions' }).click();
  await expect(page.getByTestId('submission-row')).toContainText('BOUND');
  await openSubmission(page, 'SUB-2026-0000001');
  await expect(page.getByTestId('submission-status')).toHaveText('BOUND');
  await expect(page.getByTestId('submission-convert')).toBeVisible();
});

test('converts a BOUND submission and omits a blank optional expiration', async ({ page }) => {
  const bound = submission({ status: 'BOUND' });
  const state = createState({ items: [bound], current: bound });
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openSubmission(page, 'SUB-2026-0000001');

  await expect(page.getByTestId('submission-convert')).toBeVisible();
  await page.getByTestId('submission-convert').click();
  const dialog = page.getByTestId('submission-convert-dialog');
  await expect(dialog.getByLabel('Expiration date (optional)')).toHaveValue('2027-11-01');

  await dialog.getByLabel('Premium amount').fill('87500.50');
  await dialog.getByLabel('Expiration date (optional)').fill('');
  await dialog.getByRole('button', { name: 'Convert to policy' }).click();

  await expect(page.getByTestId('policy-notice')).toContainText(POLICY_NUMBER);
  expect(state.convertPosts).toHaveLength(1);
  expect(state.convertPosts[0].body).toEqual({
    premiumAmount: '87500.50',
    premiumCurrency: 'USD'
  });
  expect(state.convertPosts[0].body.expirationDate).toBeUndefined();
});

test('uses the Location header when the conversion response omits the policy record', async ({ page }) => {
  const state = createState();
  state.onConvert = async (route) => {
    state.items = state.items.map((item) => ({ ...item, status: 'BOUND' }));
    state.current = { ...state.current, status: 'BOUND' };
    await json(
      route,
      201,
      { submission: state.current },
      { Location: `/api/v1/policies/${POLICY_ID}` }
    );
  };
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openSubmission(page, 'SUB-2026-0000001');

  await page.getByTestId('submission-convert').click();
  const dialog = page.getByTestId('submission-convert-dialog');
  await dialog.getByLabel('Premium amount').fill('125000');
  await dialog.getByRole('button', { name: 'Convert to policy' }).click();

  // The command returned only the bound submission and a Location; the shell
  // still opens the created policy and reads its number from the record.
  await expect(page.getByTestId('policy-notice')).toContainText(POLICY_NUMBER);
  await expect(page.getByTestId('policy-status')).toHaveText('DRAFT');
  expect(state.policyReads).toBe(1);
});

test('offers Convert to policy only for QUOTED and BOUND submissions', async ({ page }) => {
  const items = [
    submission({
      submissionId: 'eeeeeeee-eeee-7eee-8eee-000000000001',
      submissionNumber: 'SUB-2026-0000011',
      status: 'RECEIVED'
    }),
    submission({
      submissionId: 'eeeeeeee-eeee-7eee-8eee-000000000002',
      submissionNumber: 'SUB-2026-0000012',
      status: 'QUOTED'
    }),
    submission({
      submissionId: 'eeeeeeee-eeee-7eee-8eee-000000000003',
      submissionNumber: 'SUB-2026-0000013',
      status: 'BOUND'
    }),
    submission({
      submissionId: 'eeeeeeee-eeee-7eee-8eee-000000000004',
      submissionNumber: 'SUB-2026-0000014',
      status: 'DECLINED'
    })
  ];
  const state = createState({ items, current: items[0] });
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);

  await openSubmission(page, 'SUB-2026-0000011');
  await expect(page.getByTestId('submission-convert')).toHaveCount(0);
  await expect(page.getByTestId('submission-convert-unavailable'))
    .toContainText('once the submission is quoted or bound');

  await openSubmission(page, 'SUB-2026-0000012');
  await expect(page.getByTestId('submission-convert')).toBeVisible();
  await expect(page.getByTestId('submission-convert-unavailable')).toHaveCount(0);

  await openSubmission(page, 'SUB-2026-0000013');
  await expect(page.getByTestId('submission-convert')).toBeVisible();

  await openSubmission(page, 'SUB-2026-0000014');
  await expect(page.getByTestId('submission-convert')).toHaveCount(0);
  await expect(page.getByTestId('submission-convert-unavailable'))
    .toContainText('closed and cannot be converted');
  expect(state.convertPosts).toHaveLength(0);
});

test('validates the premium and the optional expiration before posting', async ({ page }) => {
  const state = createState();
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openSubmission(page, 'SUB-2026-0000001');

  await page.getByTestId('submission-convert').click();
  const dialog = page.getByTestId('submission-convert-dialog');
  await dialog.getByRole('button', { name: 'Convert to policy' }).click();
  await expect(page.getByTestId('submission-convert-error'))
    .toContainText('Enter the policy premium amount.');

  await dialog.getByLabel('Premium amount').fill('125000');
  await dialog.getByLabel('Expiration date (optional)').fill('2026-10-01');
  await dialog.getByRole('button', { name: 'Convert to policy' }).click();
  await expect(page.getByTestId('submission-convert-error'))
    .toContainText('Expiration date must be after the requested effective date.');

  expect(state.convertPosts).toHaveLength(0);
  await expect(dialog).toBeVisible();
});

test('contains a 400 conversion problem in the dialog', async ({ page }) => {
  const state = createState();
  state.onConvert = async (route) => {
    await problem(route, 400, {
      type: 'https://errors.eia-open-insurance.example/policy/submission-convert-invalid',
      title: 'Submission cannot be converted',
      status: 400,
      detail: 'The quoted submission is missing a rating worksheet.',
      code: 'SUBMISSION_CONVERT_INVALID',
      errors: [
        {
          field: 'premiumCurrency',
          code: 'CURRENCY_INVALID',
          message: 'must be a supported settlement currency'
        }
      ]
    });
  };
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openSubmission(page, 'SUB-2026-0000001');

  await page.getByTestId('submission-convert').click();
  const dialog = page.getByTestId('submission-convert-dialog');
  await dialog.getByLabel('Premium amount').fill('125000');
  await dialog.getByRole('button', { name: 'Convert to policy' }).click();

  await expect(page.getByTestId('submission-convert-error'))
    .toContainText('The quoted submission is missing a rating worksheet.');
  await expect(page.getByTestId('submission-convert-error'))
    .toContainText('premiumCurrency: must be a supported settlement currency');
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Policies' })).toHaveAttribute('aria-selected', 'false');
  await expect(page.getByTestId('policy-status')).toHaveCount(0);
  expect(state.convertPosts).toHaveLength(1);
  expect(state.policyReads).toBe(0);
  expect(state.detailReads).toBe(1);
});

test('contains a 409 conversion conflict and re-reads the submission', async ({ page }) => {
  const state = createState();
  state.onConvert = async (route) => {
    state.items = state.items.map((item) => ({ ...item, status: 'WITHDRAWN' }));
    state.current = { ...state.current, status: 'WITHDRAWN' };
    await problem(route, 409, {
      type: 'https://errors.eia-open-insurance.example/policy/submission-convert-conflict',
      title: 'Submission changed',
      status: 409,
      detail: 'The submission was withdrawn before it could be converted.',
      code: 'STALE_SUBMISSION',
      retryable: false
    });
  };
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openSubmission(page, 'SUB-2026-0000001');

  await expect(page.getByTestId('submission-status')).toHaveText('QUOTED');
  await page.getByTestId('submission-convert').click();
  const dialog = page.getByTestId('submission-convert-dialog');
  await dialog.getByLabel('Premium amount').fill('125000');
  await dialog.getByRole('button', { name: 'Convert to policy' }).click();

  await expect(page.getByTestId('submission-convert-error'))
    .toContainText('The submission was withdrawn before it could be converted.');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('submission-status')).toHaveText('WITHDRAWN');
  await expect(page.getByRole('tab', { name: 'Policies' })).toHaveAttribute('aria-selected', 'false');
  expect(state.convertPosts).toHaveLength(1);
  expect(state.detailReads).toBe(2);
  expect(state.policyReads).toBe(0);
});
