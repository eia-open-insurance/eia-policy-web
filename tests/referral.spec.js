import { test, expect } from '@playwright/test';
import {
  mockDirectory,
  mockPartyDetail,
  mockPartySearch,
  mockProducts,
  mockRelated,
  PARTY_ID
} from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const SUBMISSION_ID = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const REFERRAL_ID = '99999999-9999-7999-8999-999999999999';
const REFERRED_TO_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const DECIDED_BY_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const OTHER_PERSON_ID = 'aaaaaaaa-bbbb-7ccc-8ddd-eeeeeeeeeeee';
const LIST_PATH = '/api/v1/policies/submissions';
const REFERRAL_PATH = `${LIST_PATH}/${SUBMISSION_ID}/referral`;
const DECISION_PATH = `${REFERRAL_PATH}/decision`;

const DIRECTORY_PEOPLE = [
  {
    id: REFERRED_TO_ID,
    displayName: 'Riley Underwriter',
    email: 'riley.underwriter@example.com',
    role: 'Underwriter',
    teams: ['UW']
  },
  {
    id: DECIDED_BY_ID,
    displayName: 'Dana Manager',
    email: 'dana.manager@example.com',
    role: 'Underwriting Manager',
    teams: ['UW']
  },
  {
    id: OTHER_PERSON_ID,
    displayName: 'Alex Adjuster',
    email: 'alex.adjuster@example.com',
    role: 'Senior Adjuster',
    teams: ['DIRECT']
  }
];

const REASON_CODES = [
  'LIMIT', 'PREMIUM', 'TORT', 'APPETITE', 'MANUSCRIPT', 'SANCTIONS', 'CONFLICT', 'OTHER'
];

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

function pendingReferral(overrides = {}) {
  return {
    referralId: REFERRAL_ID,
    status: 'PENDING',
    reason: 'LIMIT',
    authority: 'Chief Underwriting Officer',
    referredTo: REFERRED_TO_ID,
    notes: 'Limits exceed the treaty capacity.',
    decidedBy: null,
    referredAt: '2026-10-21T15:30:00Z',
    at: '2026-10-21T15:30:00Z',
    decidedAt: null,
    ...overrides
  };
}

function approvedReferral(overrides = {}) {
  return pendingReferral({
    status: 'APPROVED',
    notes: 'Approved up to the treaty capacity.',
    decidedBy: DECIDED_BY_ID,
    decidedAt: '2026-10-22T14:00:00Z',
    at: '2026-10-22T14:00:00Z',
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
    referralPosts: [],
    decisionPosts: [],
    directoryGets: 0,
    directoryRequest: null,
    onReferral: null,
    onDecision: null,
    ...overrides
  };
}

function seededState(record, overrides = {}) {
  return createState({ items: [record], current: record, ...overrides });
}

function currentRecord(state, id) {
  const found = state.items.find((item) => item.submissionId === id);
  if (found) return found;
  if (state.current?.submissionId === id) return state.current;
  return submission({ submissionId: id });
}

/** Serves the submission API and an empty policy register. */
async function installApi(page, state) {
  await page.route('**/api/v1/policies**', async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, { items: [], page: 0, size: 20, total: 0, _links: {} });
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
    const decisionMatch = url.pathname.match(
      /^\/api\/v1\/policies\/submissions\/([^/]+)\/referral\/decision$/
    );
    const referralMatch = url.pathname.match(
      /^\/api\/v1\/policies\/submissions\/([^/]+)\/referral$/
    );
    const statusMatch = url.pathname.match(
      /^\/api\/v1\/policies\/submissions\/([^/]+)\/status$/
    );
    const detailMatch = url.pathname.match(/^\/api\/v1\/policies\/submissions\/([^/]+)$/);

    if (method === 'GET' && url.pathname === LIST_PATH) {
      state.listReads += 1;
      state.listHeaders.push(route.request().headers());
      await json(route, 200, envelope(state.items));
      return;
    }

    if (method === 'POST' && referralMatch) {
      const id = referralMatch[1];
      const body = route.request().postDataJSON();
      state.referralPosts.push({
        path: url.pathname,
        headers: route.request().headers(),
        body
      });
      if (state.onReferral) {
        await state.onReferral(route, body, id);
        return;
      }
      const current = currentRecord(state, id);
      const updated = {
        ...current,
        status: current.status === 'RECEIVED' ? 'REFERRED' : current.status,
        referral: pendingReferral({
          reason: body.reason,
          authority: body.authority,
          referredTo: body.referredTo,
          notes: body.notes || null
        }),
        version: (current.version || 0) + 1,
        updatedAt: '2026-10-22T12:00:00Z'
      };
      state.current = updated;
      state.items = state.items.map((item) => (
        item.submissionId === id ? updated : item
      ));
      await json(route, 200, updated, { ETag: `"${updated.version}"` });
      return;
    }

    if (method === 'POST' && decisionMatch) {
      const id = decisionMatch[1];
      const body = route.request().postDataJSON();
      state.decisionPosts.push({
        path: url.pathname,
        headers: route.request().headers(),
        body
      });
      if (state.onDecision) {
        await state.onDecision(route, body, id);
        return;
      }
      const current = currentRecord(state, id);
      const updated = {
        ...current,
        referral: {
          ...(current.referral || pendingReferral()),
          status: body.decision,
          decidedBy: body.decidedBy,
          notes: body.notes || current.referral?.notes || null,
          decidedAt: '2026-10-22T13:00:00Z',
          at: '2026-10-22T13:00:00Z'
        },
        version: (current.version || 0) + 1,
        updatedAt: '2026-10-22T13:00:00Z'
      };
      state.current = updated;
      state.items = state.items.map((item) => (
        item.submissionId === id ? updated : item
      ));
      await json(route, 200, updated, { ETag: `"${updated.version}"` });
      return;
    }

    if (method === 'GET' && detailMatch) {
      state.detailReads += 1;
      const id = detailMatch[1];
      const record = currentRecord(state, id);
      await json(route, 200, record, { ETag: `"${record.version ?? 0}"` });
      return;
    }

    if (method === 'PATCH' && statusMatch) {
      const id = statusMatch[1];
      const body = route.request().postDataJSON();
      const current = currentRecord(state, id);
      const updated = {
        ...current,
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

async function installDirectory(page, state, { fail = false } = {}) {
  await mockDirectory(page, {
    items: DIRECTORY_PEOPLE,
    status: () => (state.directoryFailure ?? fail ? 503 : 200),
    onRequest: ({ url, headers }) => {
      state.directoryGets += 1;
      state.directoryRequest = { path: url.pathname, headers };
    }
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

async function chooseDirectoryPerson(scope, personId, term) {
  await scope.getByTestId('directory-person-search').fill(term);
  await scope.getByTestId(`directory-person-option-${personId}`).click();
}

async function fillReferralForm(page, overrides = {}) {
  const dialog = page.getByTestId('submission-referral-dialog');
  await dialog.getByLabel('Reason').selectOption(overrides.reason || 'LIMIT');
  await dialog.getByLabel('Authority').fill(
    overrides.authority || 'Chief Underwriting Officer'
  );
  if (overrides.referredTo !== null) {
    await chooseDirectoryPerson(
      dialog,
      overrides.referredTo || REFERRED_TO_ID,
      overrides.referredToTerm || 'Riley'
    );
  }
  if (overrides.notes !== undefined) {
    await dialog.getByLabel('Notes (optional)').fill(overrides.notes);
  }
  return dialog;
}

test.beforeEach(async ({ page }) => {
  await mockRelated(page);
  await mockPartySearch(page);
  await mockPartyDetail(page);
  await mockProducts(page);
});

test('shows the recorded referral status and decision fields on the detail', async ({ page }) => {
  const referred = submission({ status: 'REFERRED', referral: approvedReferral() });
  const state = seededState(referred);
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await expect(page.getByTestId('submission-status')).toHaveText('REFERRED');
  const panel = page.getByRole('region', { name: 'Submission referral' });
  await expect(panel.getByTestId('referral-status')).toHaveText('APPROVED');
  await expect(panel.getByTestId('referral-reason'))
    .toHaveText('Limit exceeds authority (LIMIT)');
  await expect(panel.getByTestId('referral-authority'))
    .toHaveText('Chief Underwriting Officer');
  await expect(panel.getByTestId('referral-referred-to')).toHaveText('Riley Underwriter');
  await expect(panel.getByTestId('referral-notes'))
    .toHaveText('Approved up to the treaty capacity.');
  await expect(panel.getByTestId('referral-decided-by')).toHaveText('Dana Manager');
  await expect(panel.getByTestId('referral-at')).not.toHaveText('—');
  await expect(panel.getByTestId('referral-approve')).toHaveCount(0);
  await expect(panel.getByTestId('referral-decline')).toHaveCount(0);
  await expect(panel.getByTestId('submission-refer')).toHaveCount(0);
  await expect(panel.getByTestId('referral-unavailable'))
    .toContainText('The referral has been approved');

  // The directory is platform master data, so its read is not tenant scoped.
  expect(state.directoryGets).toBe(1);
  expect(state.directoryRequest.path).toBe('/api/v1/directory');
  expect(state.directoryRequest.headers['x-eia-tenant']).toBeUndefined();
});

test('opens a referral with the closed reason vocabulary, authority, directory person, and notes', async ({ page }) => {
  const received = submission();
  const state = seededState(received);
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  const panel = page.getByRole('region', { name: 'Submission referral' });
  await expect(panel.getByTestId('referral-empty'))
    .toContainText('No referral has been opened');
  const refer = panel.getByTestId('submission-refer');
  await expect(refer).toHaveText('Refer');
  await expect(state.directoryGets).toBe(0);

  await refer.click();
  const dialog = page.getByTestId('submission-referral-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Refer submission · SUB-2026-0000001');
  await expect(dialog).toContainText('starts PENDING');

  const reason = dialog.getByLabel('Reason');
  await expect(reason.locator('option')).toHaveCount(REASON_CODES.length + 1);
  for (const code of REASON_CODES) {
    await expect(reason.locator(`option[value="${code}"]`)).toHaveCount(1);
  }

  await dialog.getByRole('button', { name: 'Refer submission' }).click();
  await expect(dialog.getByTestId('referral-form-error'))
    .toContainText('Select a referral reason.');
  expect(state.referralPosts).toHaveLength(0);
  expect(state.directoryGets).toBe(1);

  await fillReferralForm(page, {
    reason: 'LIMIT',
    authority: 'Chief Underwriting Officer',
    notes: 'Limits exceed the treaty capacity; decision requested before quote.'
  });
  await expect(dialog.getByTestId('directory-person-selected-name'))
    .toHaveText('Riley Underwriter');
  await dialog.getByRole('button', { name: 'Refer submission' }).click();

  await expect(page.getByTestId('submissions-notice'))
    .toContainText('Referral opened for SUB-2026-0000001');
  await expect(page.getByTestId('submissions-notice'))
    .toContainText('The submission is REFERRED and the referral is PENDING.');
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId('submission-status')).toHaveText('REFERRED');
  await expect(panel.getByTestId('referral-status')).toHaveText('PENDING');
  await expect(panel.getByTestId('referral-reason'))
    .toHaveText('Limit exceeds authority (LIMIT)');
  await expect(panel.getByTestId('referral-authority'))
    .toHaveText('Chief Underwriting Officer');
  await expect(panel.getByTestId('referral-referred-to')).toHaveText('Riley Underwriter');
  await expect(panel.getByTestId('referral-notes'))
    .toHaveText('Limits exceed the treaty capacity; decision requested before quote.');
  await expect(panel.getByTestId('referral-decided-by')).toHaveText('—');
  await expect(panel.getByTestId('referral-approve')).toBeVisible();
  await expect(panel.getByTestId('referral-decline')).toBeVisible();
  await expect(panel.getByTestId('submission-refer')).toHaveCount(0);

  // Both the submission detail and the queue are re-read with the new state.
  expect(state.referralPosts).toHaveLength(1);
  expect(state.referralPosts[0].path).toBe(REFERRAL_PATH);
  expect(state.referralPosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.referralPosts[0].headers['idempotency-key'])
    .toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
  expect(state.referralPosts[0].body).toEqual({
    reason: 'LIMIT',
    authority: 'Chief Underwriting Officer',
    referredTo: REFERRED_TO_ID,
    notes: 'Limits exceed the treaty capacity; decision requested before quote.'
  });
  expect(state.detailReads).toBe(2);
  expect(state.listReads).toBe(2);
  await expect(page.getByTestId('submission-row').first()).toContainText('REFERRED');
});

test('omits blank notes from the referral payload', async ({ page }) => {
  const received = submission();
  const state = seededState(received);
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await page.getByTestId('submission-refer').click();
  await fillReferralForm(page, {
    reason: 'TORT',
    authority: 'Underwriting Committee'
  });
  await page.getByTestId('submission-referral-dialog')
    .getByRole('button', { name: 'Refer submission' })
    .click();

  await expect(page.getByTestId('submissions-notice'))
    .toContainText('Referral opened for SUB-2026-0000001');
  expect(state.referralPosts).toHaveLength(1);
  expect(state.referralPosts[0].body).toEqual({
    reason: 'TORT',
    authority: 'Underwriting Committee',
    referredTo: REFERRED_TO_ID
  });
});

test('approves a pending referral with a directory decidedBy and notes', async ({ page }) => {
  const referred = submission({ status: 'REFERRED', referral: pendingReferral() });
  const state = seededState(referred);
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  const panel = page.getByRole('region', { name: 'Submission referral' });
  await expect(panel.getByTestId('referral-status')).toHaveText('PENDING');
  await expect(panel.getByTestId('referral-decided-by')).toHaveText('—');
  await expect(panel.getByTestId('submission-refer')).toHaveCount(0);

  await panel.getByTestId('referral-approve').click();
  const dialog = page.getByTestId('referral-decision-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Approve referral · SUB-2026-0000001');
  await expect(dialog).toContainText('recorded as APPROVED');
  await expect(dialog).toContainText('keeps its current status (REFERRED)');

  await dialog.getByTestId('referral-decision-submit').click();
  await expect(dialog.getByTestId('referral-decision-error'))
    .toContainText('Select the person who decided the referral.');
  expect(state.decisionPosts).toHaveLength(0);

  await chooseDirectoryPerson(dialog, DECIDED_BY_ID, 'Dana');
  await expect(dialog.getByTestId('directory-person-selected-name')).toHaveText('Dana Manager');
  await dialog.getByLabel('Notes (optional)').fill('Approved within treaty capacity.');
  await dialog.getByTestId('referral-decision-submit').click();

  await expect(page.getByTestId('submissions-notice'))
    .toContainText('Referral approved for SUB-2026-0000001 by Dana Manager.');
  await expect(dialog).toHaveCount(0);

  await expect(page.getByTestId('submission-status')).toHaveText('REFERRED');
  await expect(panel.getByTestId('referral-status')).toHaveText('APPROVED');
  await expect(panel.getByTestId('referral-decided-by')).toHaveText('Dana Manager');
  await expect(panel.getByTestId('referral-notes')).toHaveText('Approved within treaty capacity.');
  await expect(panel.getByTestId('referral-at')).not.toHaveText('—');
  await expect(panel.getByTestId('referral-approve')).toHaveCount(0);
  await expect(panel.getByTestId('referral-unavailable'))
    .toContainText('The referral has been approved');

  expect(state.decisionPosts).toHaveLength(1);
  expect(state.decisionPosts[0].path).toBe(DECISION_PATH);
  expect(state.decisionPosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.decisionPosts[0].body).toEqual({
    decision: 'APPROVED',
    decidedBy: DECIDED_BY_ID,
    notes: 'Approved within treaty capacity.'
  });
  expect(state.detailReads).toBe(2);
  expect(state.listReads).toBe(2);
});

test('declines a pending referral without notes and offers a new referral after it', async ({ page }) => {
  const referred = submission({ status: 'REFERRED', referral: pendingReferral() });
  const state = seededState(referred);
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  const panel = page.getByRole('region', { name: 'Submission referral' });
  await panel.getByTestId('referral-decline').click();
  const dialog = page.getByTestId('referral-decision-dialog');
  await expect(dialog).toContainText('Decline referral · SUB-2026-0000001');
  await expect(dialog).toContainText('recorded as DECLINED');

  await chooseDirectoryPerson(dialog, DECIDED_BY_ID, 'Dana');
  await dialog.getByTestId('referral-decision-submit').click();

  await expect(page.getByTestId('submissions-notice'))
    .toContainText('Referral declined for SUB-2026-0000001 by Dana Manager.');
  await expect(panel.getByTestId('referral-status')).toHaveText('DECLINED');
  await expect(panel.getByTestId('referral-decided-by')).toHaveText('Dana Manager');
  await expect(panel.getByTestId('referral-notes'))
    .toHaveText('Limits exceed the treaty capacity.');
  await expect(page.getByTestId('submission-status')).toHaveText('REFERRED');
  await expect(panel.getByTestId('submission-refer')).toHaveText('Refer again');

  expect(state.decisionPosts).toHaveLength(1);
  expect(state.decisionPosts[0].body).toEqual({
    decision: 'DECLINED',
    decidedBy: DECIDED_BY_ID
  });
  expect(state.detailReads).toBe(2);
});

test('keeps a 400 referral problem inside the dialog and leaves the submission unchanged', async ({ page }) => {
  const received = submission();
  const state = seededState(received);
  state.onReferral = async (route) => {
    await problem(route, 400, {
      type: 'https://errors.eia-open-insurance.example/policy/referral-invalid',
      title: 'Referral is not valid',
      status: 400,
      detail: 'The authority is not valid for this referral reason.',
      code: 'REFERRAL_INVALID',
      errors: [
        {
          field: 'authority',
          code: 'AUTHORITY_INVALID',
          message: 'must name an underwriting authority'
        }
      ]
    });
  };
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await page.getByTestId('submission-refer').click();
  await fillReferralForm(page, { notes: 'Requires a decision.' });
  await page.getByTestId('submission-referral-dialog')
    .getByRole('button', { name: 'Refer submission' })
    .click();

  const dialog = page.getByTestId('submission-referral-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('referral-form-error'))
    .toContainText('The authority is not valid for this referral reason.');
  await expect(dialog.getByTestId('referral-form-error'))
    .toContainText('authority: must name an underwriting authority');
  await expect(dialog.getByLabel('Authority')).toHaveValue('Chief Underwriting Officer');
  await expect(dialog.getByTestId('directory-person-selected-name'))
    .toHaveText('Riley Underwriter');
  await expect(page.getByTestId('submission-status')).toHaveText('RECEIVED');
  await expect(page.getByTestId('referral-empty'))
    .toContainText('No referral has been opened');
  await expect(page.getByTestId('submissions-notice')).toHaveCount(0);
  expect(state.referralPosts).toHaveLength(1);
  expect(state.detailReads).toBe(1);
  expect(state.listReads).toBe(1);
});

test('contains a 409 referral conflict and re-reads the submission and queue', async ({ page }) => {
  const received = submission();
  const state = seededState(received);
  state.onReferral = async (route) => {
    const conflicting = submission({
      status: 'REFERRED',
      referral: pendingReferral({
        authority: 'Another Underwriting Authority',
        notes: 'Referral opened by another operator.'
      }),
      version: 1
    });
    state.current = conflicting;
    state.items = [conflicting];
    await problem(route, 409, {
      type: 'https://errors.eia-open-insurance.example/policy/referral-conflict',
      title: 'Referral already exists',
      status: 409,
      detail: 'A pending referral was opened by another operator.',
      code: 'REFERRAL_CONFLICT',
      retryable: false
    });
  };
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await page.getByTestId('submission-refer').click();
  await fillReferralForm(page, { notes: 'My referral.' });
  await page.getByTestId('submission-referral-dialog')
    .getByRole('button', { name: 'Refer submission' })
    .click();

  const dialog = page.getByTestId('submission-referral-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('referral-form-error'))
    .toContainText('A pending referral was opened by another operator.');
  await expect(dialog.getByLabel('Authority')).toHaveValue('Chief Underwriting Officer');

  // The 409 re-reads the domain position behind the open dialog.
  await expect(page.getByTestId('submission-status')).toHaveText('REFERRED');
  await expect(page.getByTestId('referral-status')).toHaveText('PENDING');
  await expect(page.getByTestId('referral-authority'))
    .toHaveText('Another Underwriting Authority');
  await expect(page.getByTestId('referral-notes'))
    .toHaveText('Referral opened by another operator.');
  expect(state.referralPosts).toHaveLength(1);
  expect(state.detailReads).toBe(2);
  expect(state.listReads).toBe(2);
});

test('contains a 409 decision conflict and re-reads the decided referral', async ({ page }) => {
  const referred = submission({ status: 'REFERRED', referral: pendingReferral() });
  const state = seededState(referred);
  state.onDecision = async (route) => {
    const conflicting = submission({
      status: 'REFERRED',
      referral: pendingReferral({
        status: 'APPROVED',
        decidedBy: OTHER_PERSON_ID,
        notes: 'Approved by another manager.',
        decidedAt: '2026-10-22T13:30:00Z',
        at: '2026-10-22T13:30:00Z'
      }),
      version: 1
    });
    state.current = conflicting;
    state.items = [conflicting];
    await problem(route, 409, {
      type: 'https://errors.eia-open-insurance.example/policy/referral-decided',
      title: 'Referral already decided',
      status: 409,
      detail: 'The referral was already approved by another manager.',
      code: 'REFERRAL_ALREADY_DECIDED',
      retryable: false
    });
  };
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  await page.getByTestId('referral-approve').click();
  const dialog = page.getByTestId('referral-decision-dialog');
  await chooseDirectoryPerson(dialog, DECIDED_BY_ID, 'Dana');
  await dialog.getByTestId('referral-decision-submit').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('referral-decision-error'))
    .toContainText('The referral was already approved by another manager.');
  await expect(dialog.getByTestId('directory-person-selected-name')).toHaveText('Dana Manager');
  await expect(page.getByTestId('referral-status')).toHaveText('APPROVED');
  await expect(page.getByTestId('referral-decided-by')).toHaveText('Alex Adjuster');
  await expect(page.getByTestId('referral-notes')).toHaveText('Approved by another manager.');
  expect(state.decisionPosts).toHaveLength(1);
  expect(state.detailReads).toBe(2);
  expect(state.listReads).toBe(2);
});

test('contains a directory outage and retries the people lookup', async ({ page }) => {
  const referred = submission({ status: 'REFERRED', referral: pendingReferral() });
  const state = seededState(referred);
  state.directoryFailure = true;
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  const panel = page.getByRole('region', { name: 'Submission referral' });
  await expect(panel.getByTestId('referral-directory-unavailable'))
    .toContainText('The people directory is unavailable');
  await expect(panel.getByTestId('referral-referred-to')).toContainText('cccccccc');

  await panel.getByTestId('referral-approve').click();
  const dialog = page.getByTestId('referral-decision-dialog');
  await expect(dialog.getByTestId('referral-directory-error'))
    .toContainText('The people directory is temporarily unavailable.');
  const retry = dialog.getByTestId('referral-directory-retry');
  await expect(retry).toBeVisible();

  state.directoryFailure = false;
  await retry.click();
  await chooseDirectoryPerson(dialog, DECIDED_BY_ID, 'Dana');
  await expect(dialog.getByTestId('directory-person-selected-name')).toHaveText('Dana Manager');
  await expect(dialog.getByTestId('referral-directory-error')).toHaveCount(0);
});

test('offers no referral action once the submission is quoted', async ({ page }) => {
  const quoted = submission({ status: 'QUOTED' });
  const state = seededState(quoted);
  await installApi(page, state);
  await installDirectory(page, state);
  await page.goto('/');
  await openSubmissions(page);
  await openFirstSubmission(page);

  const panel = page.getByRole('region', { name: 'Submission referral' });
  await expect(panel.getByTestId('referral-empty'))
    .toContainText('No referral has been opened');
  await expect(panel.getByTestId('submission-refer')).toHaveCount(0);
  await expect(panel.getByTestId('referral-unavailable'))
    .toContainText('Referral is available only while the submission is RECEIVED or REFERRED.');
  await expect(page.getByTestId('submission-status')).toHaveText('QUOTED');
  await expect(state.directoryGets).toBe(0);
});
