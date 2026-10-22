import { test, expect } from '@playwright/test';
import {
  mockPartyDetail,
  mockPartySearch,
  mockProducts,
  mockRelated,
  selectParty,
  selectProduct,
  PARTY_ID
} from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const SUBMISSION_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const SECOND_ID = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const CREATED_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
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
    tortCodes: ['ASBESTOS', 'PFAS'],
    notes: 'New mass tort program referral.',
    status: 'RECEIVED',
    version: 0,
    receivedAt: '2026-10-20T12:00:00Z',
    createdAt: '2026-10-20T12:00:00Z',
    updatedAt: '2026-10-21T09:30:00Z',
    ...overrides
  };
}

function secondSubmission(overrides = {}) {
  return submission({
    submissionId: SECOND_ID,
    submissionNumber: 'SUB-2026-0000002',
    productCode: 'EXCESS',
    requestedEffectiveDate: '2026-12-01',
    requestedLimitAmount: '7500000.0000',
    tortCodes: ['PFAS'],
    status: 'QUOTED',
    notes: 'Excess layer for the same applicant.',
    ...overrides
  });
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
  return {
    items: [submission()],
    current: submission(),
    listReads: 0,
    listHeaders: [],
    detailReads: 0,
    createPosts: [],
    statusPatches: [],
    policyPosts: 0,
    listFailure: null,
    detailFailure: null,
    onCreate: null,
    onStatus: null,
    ...overrides
  };
}

/**
 * Serves the submission API and an empty policy register. The specific
 * submissions route is registered last, so Playwright checks it before the
 * broader /api/v1/policies route.
 */
async function installApi(page, state) {
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, {
        items: [],
        page: 0,
        size: 20,
        total: 0,
        _links: {}
      });
      return;
    }
    if (method === 'POST' && url.pathname === '/api/v1/policies') {
      state.policyPosts += 1;
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
    const statusMatch = url.pathname.match(
      /^\/api\/v1\/policies\/submissions\/([^/]+)\/status$/
    );
    const detailMatch = url.pathname.match(/^\/api\/v1\/policies\/submissions\/([^/]+)$/);

    if (method === 'GET' && url.pathname === LIST_PATH) {
      state.listReads += 1;
      state.listHeaders.push(route.request().headers());
      if (state.listFailure) {
        await problem(route, state.listFailure.status, state.listFailure.body);
        return;
      }
      await json(route, 200, envelope(state.items));
      return;
    }

    if (method === 'POST' && url.pathname === LIST_PATH) {
      const body = route.request().postDataJSON();
      state.createPosts.push({ headers: route.request().headers(), body });
      if (state.onCreate) {
        await state.onCreate(route, body);
        return;
      }
      const created = submission({
        submissionId: CREATED_ID,
        submissionNumber: 'SUB-2026-0000002',
        applicantPartyId: body.applicantPartyId,
        productCode: body.productCode,
        requestedEffectiveDate: body.requestedEffectiveDate,
        requestedLimitAmount: body.requestedLimitAmount,
        requestedLimitCurrency: body.requestedLimitCurrency,
        tortCodes: body.tortCodes,
        notes: body.notes || '',
        status: 'RECEIVED'
      });
      state.items = [created, ...state.items];
      state.current = created;
      await json(route, 201, created, { ETag: '"0"' });
      return;
    }

    if (method === 'GET' && detailMatch) {
      state.detailReads += 1;
      const id = detailMatch[1];
      if (state.detailFailure) {
        await problem(route, state.detailFailure.status, state.detailFailure.body);
        return;
      }
      const found = state.items.find((item) => item.submissionId === id);
      const record = found
        || (state.current?.submissionId === id ? state.current : submission({ submissionId: id }));
      await json(route, 200, record, { ETag: `"${record.version ?? 0}"` });
      return;
    }

    if (method === 'PATCH' && statusMatch) {
      const id = statusMatch[1];
      const body = route.request().postDataJSON();
      state.statusPatches.push({
        path: url.pathname,
        headers: route.request().headers(),
        body
      });
      if (state.onStatus) {
        await state.onStatus(route, body);
        return;
      }
      const updated = {
        ...(state.current?.submissionId === id
          ? state.current
          : submission({ submissionId: id })),
        status: body.status,
        updatedAt: '2026-10-22T10:00:00Z'
      };
      state.current = updated;
      state.items = state.items.map((item) => (
        item.submissionId === id ? updated : item
      ));
      await json(route, 200, updated, { ETag: `"${updated.version ?? 1}"` });
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

async function openFirstSubmission(page) {
  await page.getByRole('button', { name: 'Open submission SUB-2026-0000001' }).click();
  await expect(page.getByTestId('submission-number')).toHaveText('SUB-2026-0000001');
}

async function fillCreateForm(page, overrides = {}) {
  await selectParty(page);
  await selectProduct(page, overrides.productCode || 'CGL');
  if (overrides.requestedEffectiveDate !== undefined) {
    await page.getByLabel('Requested effective date').fill(overrides.requestedEffectiveDate);
  }
  if (overrides.requestedLimitAmount !== undefined) {
    await page.getByLabel('Requested limit').fill(overrides.requestedLimitAmount);
  }
  if (overrides.requestedLimitCurrency !== undefined) {
    await page.getByLabel('Limit currency').fill(overrides.requestedLimitCurrency);
  }
  if (overrides.tortCodes !== undefined) {
    await page.getByLabel('Tort codes').fill(overrides.tortCodes);
  }
  if (overrides.notes !== undefined) {
    await page.getByLabel('Notes').fill(overrides.notes);
  }
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
  await mockPartySearch(page);
  await mockPartyDetail(page);
  await mockProducts(page);
});

test('lists the submission queue, filters it, and opens a detail with the applicant party link', async ({ page }) => {
  const state = createState({ items: [submission(), secondSubmission()] });
  await installApi(page, state);
  await page.goto('/');

  await openSubmissions(page);

  await expect(page.getByTestId('submissions-context')).toContainText('Submissions precede policies');
  await expect(page.getByTestId('submissions-context'))
    .toContainText('Quoting or binding a submission does not create a policy yet');
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000001' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000002' })).toBeVisible();
  await expect(page.getByTestId('submissions-filter-meta')).toContainText('2 submissions in the queue');
  expect(state.listReads).toBe(1);
  expect(state.listHeaders[0]['x-eia-tenant']).toBe(TENANT);

  const applicantLinks = page.getByTestId('submission-applicant-link');
  await expect(applicantLinks).toHaveCount(2);
  await expect(applicantLinks.first()).toHaveAttribute('href', `/party?record=${PARTY_ID}`);
  await expect(applicantLinks.first()).toContainText('Acme Manufacturing');

  const search = page.getByRole('searchbox', { name: 'Search submissions' });
  await expect(search).toHaveAttribute(
    'placeholder',
    'Search submissions by number, applicant, product, tort, or status…'
  );
  await search.fill('EXCESS');
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000001' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000002' })).toBeVisible();
  await expect(page.getByTestId('submissions-filter-meta')).toContainText('1 of 2 on this page match');

  await search.fill('no-such-submission');
  await expect(page.getByTestId('submissions-empty'))
    .toContainText('No submissions match the current search and status filter.');
  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000001' })).toBeVisible();

  await page.getByLabel('Filter submissions by status').selectOption('QUOTED');
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000001' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000002' })).toBeVisible();
  await page.getByLabel('Filter submissions by status').selectOption('');

  await openFirstSubmission(page);
  await expect(page.getByTestId('submission-status')).toHaveText('RECEIVED');
  await expect(page.getByTestId('submission-detail-applicant-link'))
    .toHaveAttribute('href', `/party?record=${PARTY_ID}`);
  await expect(page.getByText('$5,000,000.00').first()).toBeVisible();
  await expect(page.getByText('ASBESTOS', { exact: true })).toBeVisible();
  await expect(page.getByText('PFAS', { exact: true })).toBeVisible();
  await expect(page.getByText('New mass tort program referral.')).toBeVisible();
  await expect(page.getByTestId('submission-action-referred')).toHaveText('Refer');
  await expect(page.getByTestId('submission-action-quoted')).toHaveText('Quote');
  await expect(page.getByTestId('submission-action-declined')).toHaveText('Decline');
  await expect(page.getByTestId('submission-action-withdrawn')).toHaveText('Withdraw');
  await expect(page.getByTestId('submission-action-bound')).toHaveCount(0);
  await expect(page.getByTestId('submission-no-policy'))
    .toContainText('Quoting or binding does not create a policy yet');
  expect(state.detailReads).toBe(1);

  await page.getByTestId('refresh-submission').click();
  await expect(page.getByTestId('submissions-notice')).toContainText('Submission refreshed.');
  expect(state.detailReads).toBe(2);
});

test('renders exactly the expert status graph from every status', async ({ page }) => {
  const graph = [
    { status: 'RECEIVED', actions: ['REFERRED', 'QUOTED', 'DECLINED', 'WITHDRAWN'] },
    { status: 'REFERRED', actions: ['QUOTED', 'DECLINED', 'WITHDRAWN'] },
    { status: 'QUOTED', actions: ['BOUND', 'DECLINED', 'WITHDRAWN'] },
    { status: 'BOUND', actions: [] },
    { status: 'DECLINED', actions: [] },
    { status: 'WITHDRAWN', actions: [] }
  ];
  const allTargets = ['REFERRED', 'QUOTED', 'BOUND', 'DECLINED', 'WITHDRAWN'];
  const items = graph.map((entry, index) => submission({
    submissionId: `eeeeeeee-eeee-7eee-8eee-${String(index + 1).padStart(12, '0')}`,
    submissionNumber: `SUB-2026-000001${index + 1}`,
    status: entry.status
  }));
  const state = createState({ items, current: items[0] });
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);

  const filter = page.getByLabel('Filter submissions by status');
  await expect(filter.locator('option')).toHaveCount(7);
  for (const status of ['RECEIVED', 'REFERRED', 'QUOTED', 'BOUND', 'DECLINED', 'WITHDRAWN']) {
    await expect(filter.locator(`option[value="${status}"]`)).toHaveCount(1);
  }

  for (const entry of graph) {
    const record = items.find((item) => item.status === entry.status);
    await page.getByRole('button', { name: `Open submission ${record.submissionNumber}` }).click();
    await expect(page.getByTestId('submission-status')).toHaveText(entry.status);

    const actionRegion = page.getByRole('region', { name: 'Submission status actions' });
    await expect(actionRegion.getByRole('button')).toHaveCount(entry.actions.length);
    for (const target of allTargets) {
      const action = page.getByTestId(`submission-action-${target.toLowerCase()}`);
      if (entry.actions.includes(target)) {
        await expect(action).toBeVisible();
      } else {
        await expect(action).toHaveCount(0);
      }
    }

    if (entry.actions.length) {
      await expect(page.getByTestId('submission-terminal')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('submission-terminal')).toContainText('This submission is closed');
    }
  }
});

test('creates a submission with an idempotency key and does not create a policy', async ({ page }) => {
  const state = createState({ items: [], current: null });
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);

  await expect(page.getByTestId('submissions-empty'))
    .toContainText('Create a submission to start underwriting');

  await page.getByTestId('new-submission').click();
  const dialog = page.getByTestId('submission-create-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Submissions precede policies');
  await expect(dialog).toContainText('does not create a policy');

  await page.getByRole('button', { name: 'Create submission' }).click();
  await expect(page.getByTestId('submission-form-error'))
    .toContainText('Select the applicant party before creating the submission.');

  await fillCreateForm(page, {
    productCode: 'EXCESS',
    requestedEffectiveDate: '2026-12-01',
    requestedLimitAmount: '7500000',
    requestedLimitCurrency: 'usd',
    tortCodes: 'asbestos, pfas',
    notes: 'Excess layer referral.'
  });
  await expect(page.getByRole('link', { name: 'Open party record' }))
    .toHaveAttribute('href', `/party?record=${PARTY_ID}`);
  await expect(page.getByTestId('product-picker-selected')).toContainText('Excess Liability');
  await expect(page.getByTestId('product-picker-selected')).toContainText('EXCESS');
  await expect(page.getByLabel('Limit currency')).toHaveValue('USD');

  await page.getByRole('button', { name: 'Create submission' }).click();

  await expect(page.getByTestId('submissions-notice'))
    .toContainText('Created SUB-2026-0000002');
  await expect(page.getByTestId('submissions-notice'))
    .toContainText('No policy was created');
  await expect(page.getByTestId('submission-number')).toHaveText('SUB-2026-0000002');
  await expect(page.getByTestId('submission-status')).toHaveText('RECEIVED');
  await expect(page.getByTestId('submission-create-dialog')).toHaveCount(0);

  expect(state.createPosts).toHaveLength(1);
  expect(state.createPosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.createPosts[0].headers['idempotency-key'])
    .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(state.createPosts[0].body).toEqual({
    applicantPartyId: PARTY_ID,
    productCode: 'EXCESS',
    requestedEffectiveDate: '2026-12-01',
    requestedLimitAmount: '7500000',
    requestedLimitCurrency: 'USD',
    tortCodes: ['ASBESTOS', 'PFAS'],
    notes: 'Excess layer referral.'
  });
  expect(state.policyPosts).toBe(0);
});

test('moves a quoted submission to BOUND with a reason and never creates a policy', async ({ page }) => {
  const quoted = submission({ status: 'QUOTED' });
  const state = createState({ items: [quoted], current: quoted });
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await expect(page.getByTestId('submission-status')).toHaveText('QUOTED');
  await expect(page.getByTestId('submission-action-bound')).toHaveText('Bind');
  await expect(page.getByTestId('submission-action-referred')).toHaveCount(0);
  await expect(page.getByTestId('submission-action-quoted')).toHaveCount(0);

  await page.getByTestId('submission-action-bound').click();
  const dialog = page.getByTestId('submission-status-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Move this submission from QUOTED to BOUND');
  await expect(dialog.getByTestId('submission-action-no-policy'))
    .toContainText('No policy is created by this action');

  await page.getByLabel('Reason (optional)').fill('Terms accepted; bind effective 2026-11-01.');
  await page.getByRole('button', { name: 'Move to BOUND' }).click();

  await expect(page.getByTestId('submissions-notice'))
    .toContainText('Submission SUB-2026-0000001 moved to BOUND.');
  await expect(page.getByTestId('submissions-notice'))
    .toContainText('No policy was created');
  await expect(page.getByTestId('submission-status')).toHaveText('BOUND');
  await expect(page.getByTestId('submission-summary-status')).toHaveText('BOUND');
  await expect(page.getByTestId('submission-terminal')).toContainText('This submission is closed');

  expect(state.statusPatches).toHaveLength(1);
  expect(state.statusPatches[0].path)
    .toBe('/api/v1/policies/submissions/eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee/status');
  expect(state.statusPatches[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.statusPatches[0].body).toEqual({
    status: 'BOUND',
    reason: 'Terms accepted; bind effective 2026-11-01.'
  });
  expect(state.detailReads).toBe(2);
  expect(state.policyPosts).toBe(0);
});

test('omits a blank reason and keeps a status problem inside the dialog', async ({ page }) => {
  const received = submission();
  const state = createState({ items: [received], current: received });
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await page.getByTestId('submission-action-referred').click();
  await page.getByRole('button', { name: 'Move to REFERRED' }).click();
  await expect(page.getByTestId('submission-status')).toHaveText('REFERRED');
  expect(state.statusPatches[0].body).toEqual({ status: 'REFERRED' });

  state.onStatus = async (route) => {
    await problem(route, 400, {
      type: 'https://errors.eia-open-insurance.example/policy/submission-status-invalid',
      title: 'Submission status is not allowed',
      status: 400,
      detail: 'The submission cannot move to DECLINED until underwriting review completes.',
      code: 'SUBMISSION_STATUS_INVALID',
      errors: [
        { field: 'status', code: 'SUBMISSION_STATUS_INVALID', message: 'review notes are required' }
      ]
    });
  };
  await page.getByTestId('submission-action-declined').click();
  await page.getByLabel('Reason (optional)').fill('Appetite miss.');
  await page.getByRole('button', { name: 'Move to DECLINED' }).click();

  await expect(page.getByTestId('submission-action-error'))
    .toContainText('The submission cannot move to DECLINED until underwriting review completes.');
  await expect(page.getByTestId('submission-action-error'))
    .toContainText('status: review notes are required');
  await expect(page.getByTestId('submission-status-dialog')).toBeVisible();
  await expect(page.getByTestId('submission-status')).toHaveText('REFERRED');
});

test('contains a submission list failure and retries', async ({ page }) => {
  const state = createState({
    listFailure: {
      status: 503,
      body: {
        status: 503,
        title: 'Submission service unavailable',
        detail: 'The submission service is temporarily unavailable.',
        code: 'SUBMISSION_SERVICE_UNAVAILABLE',
        retryable: true
      }
    }
  });
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);

  await expect(page.getByTestId('submissions-load-error'))
    .toContainText('The submission service is temporarily unavailable.');
  await expect(page.getByTestId('submissions-empty'))
    .toContainText('No submissions yet');

  state.listFailure = null;
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByTestId('submissions-load-error')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open submission SUB-2026-0000001' })).toBeVisible();
  expect(state.listReads).toBe(2);
});

test('keeps a create rejection in the modal and shows created values only on success', async ({ page }) => {
  const state = createState({ items: [], current: null });
  state.onCreate = async (route) => {
    await problem(route, 422, {
      type: 'https://errors.eia-open-insurance.example/policy/submission-invalid',
      title: 'Submission is not valid',
      status: 422,
      detail: 'The requested effective date is outside the product filing window.',
      code: 'SUBMISSION_INVALID',
      errors: [
        {
          field: 'requestedEffectiveDate',
          code: 'OUTSIDE_FILING_WINDOW',
          message: 'must be within the filed period'
        }
      ]
    });
  };
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);

  await page.getByTestId('new-submission').click();
  await fillCreateForm(page);
  await page.getByRole('button', { name: 'Create submission' }).click();

  const dialog = page.getByTestId('submission-create-dialog');
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId('submission-form-error'))
    .toContainText('The requested effective date is outside the product filing window.');
  await expect(page.getByTestId('submission-form-error'))
    .toContainText('requestedEffectiveDate: must be within the filed period');
  await expect(page.getByTestId('submission-number')).toHaveCount(0);
  expect(state.createPosts).toHaveLength(1);
  expect(state.createPosts[0].body.notes).toBeUndefined();
  expect(state.policyPosts).toBe(0);
});

test('refreshes the detail after a 409 status conflict', async ({ page }) => {
  const quoted = submission({ status: 'QUOTED' });
  const state = createState({ items: [quoted], current: quoted });
  state.onStatus = async (route) => {
    await problem(route, 409, {
      type: 'https://errors.eia-open-insurance.example/policy/stale-submission',
      title: 'Submission changed',
      status: 409,
      detail: 'The submission moved to WITHDRAWN while this action was prepared.',
      code: 'STALE_SUBMISSION',
      retryable: false
    });
  };
  await installApi(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await expect(page.getByTestId('submission-status')).toHaveText('QUOTED');
  await page.getByTestId('submission-action-bound').click();
  await page.getByRole('button', { name: 'Move to BOUND' }).click();

  await expect(page.getByTestId('submission-action-error'))
    .toContainText('The submission moved to WITHDRAWN while this action was prepared.');
  await expect(page.getByTestId('submission-status-dialog')).toBeVisible();
  await expect(page.getByTestId('submission-status')).toHaveText('QUOTED');
  expect(state.detailReads).toBe(2);
  expect(state.statusPatches[0].body).toEqual({ status: 'BOUND' });
  expect(state.policyPosts).toBe(0);
});
