import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = '44444444-4444-7444-8444-444444444444';
const CANCELLATION_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const ZERO_PREMIUM_ID = 'edededed-eded-7ded-8ded-edededededed';
const APPROVED_ID = 'abababab-abab-7bab-8bab-abababababab';
const CANCELLATION_NUMBER = 'CXL-2026-0000001';
const NOTE_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const CREATED_NOTE_ID = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const NOTE_NUMBER = 'CRN-2026-0000001';
const CREATED_NOTE_NUMBER = 'CRN-2026-0000009';
const CREATED_REASON = `Cancellation ${CANCELLATION_NUMBER} return premium`;

const POLICY = {
  id: POLICY_ID,
  tenantId: TENANT,
  policyNumber: 'POL-2026-0000001',
  productCode: 'CGL',
  insuredPartyId: 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb',
  status: 'CANCELLED',
  effectiveDate: '2026-01-01',
  expirationDate: '2027-01-01',
  premiumAmount: '120000.0000',
  premiumCurrency: 'USD',
  limitAmount: '5000000.0000',
  limitCurrency: 'USD',
  version: 5,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-10-21T00:00:00Z'
};

function cancellation(overrides = {}) {
  return {
    id: CANCELLATION_ID,
    tenantId: TENANT,
    policyId: POLICY_ID,
    cancellationType: 'SHORT_RATE',
    cancellationNumber: CANCELLATION_NUMBER,
    reason: 'Insured sold the business',
    effectiveDate: '2026-10-20',
    noticeDays: 0,
    returnPremiumAmount: '90000.0000',
    premiumCurrency: 'USD',
    proRataPct: '0.720000',
    status: 'POSTED',
    ...overrides
  };
}

function creditNote(overrides = {}) {
  return {
    id: NOTE_ID,
    tenantId: TENANT,
    policyId: POLICY_ID,
    creditNoteNumber: NOTE_NUMBER,
    amount: '90000.00',
    currency: 'USD',
    reason: CREATED_REASON,
    status: 'DRAFT',
    issuedDate: null,
    appliedDate: null,
    createdAt: '2026-10-21T10:00:00Z',
    cancellationId: CANCELLATION_ID,
    cancellationNumber: CANCELLATION_NUMBER,
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

function problem(status, detail, code) {
  return {
    type: `https://errors.eia-open-insurance.example/policy/${String(code).toLowerCase()}`,
    title: status === 409 ? 'Credit note conflict' : 'Credit notes unavailable',
    status,
    detail,
    code,
    category: status === 409 ? 'CONFLICT' : 'BUSINESS_RULE',
    retryable: false
  };
}

/**
 * Mocks the record, the cancellation list, and the credit-note ledger. The
 * mutable `notes` array makes the ledger refresh after a POST visible to the
 * cancellation row.
 */
async function installMocks(page, options = {}) {
  const state = {
    cancellations: (options.cancellations || [cancellation()]).map((row) => ({ ...row })),
    notes: (options.notes || []).map((row) => ({ ...row })),
    creditNoteGets: 0,
    creditNotePosts: [],
    postStatus: options.postStatus || 201,
    postError: options.postError || null
  };

  await page.route('**/api/v1/policies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([POLICY]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, POLICY, { ETag: '"5"' });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, {
        version: {
          id: VERSION_ID,
          policyVersionNumber: 'POL-2026-0000001-05',
          changeType: 'CANCELLATION',
          status: 'ISSUED',
          effectiveFrom: '2026-10-20'
        },
        current: true,
        hashVerified: true
      });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/cancellations`) {
      await json(route, 200, itemPage(state.cancellations));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/reinstatements`) {
      await json(route, 200, itemPage([]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/billing`) {
      await json(route, 404, problem(404, 'No billing plan.', 'BILLING_PLAN_NOT_FOUND'));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/credit-notes`) {
      state.creditNoteGets += 1;
      await json(route, 200, { items: state.notes });
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/credit-notes`) {
      const body = request.postDataJSON();
      state.creditNotePosts.push({ headers: request.headers(), body });
      if (state.postStatus >= 400) {
        await json(route, state.postStatus, state.postError || problem(
          state.postStatus,
          'The credit note could not be created.',
          'CREDIT_NOTE_CONFLICT'
        ));
        return;
      }
      const cancellation = state.cancellations.find((row) => row.id === body.cancellationId);
      const created = creditNote({
        id: CREATED_NOTE_ID,
        creditNoteNumber: CREATED_NOTE_NUMBER,
        amount: Number(body.amount).toFixed(2),
        currency: body.currency,
        reason: body.reason,
        cancellationId: body.cancellationId,
        cancellationNumber: cancellation ? CANCELLATION_NUMBER : undefined,
        status: 'DRAFT'
      });
      state.notes.push(created);
      await json(route, 201, created, { ETag: '"1"', 'Idempotent-Replayed': 'false' });
      return;
    }

    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await mockRelated(page);
  await mockPartyDetail(page);
  await page.route('**/api/v1/documents**', async (route) => {
    await json(route, 200, { items: [] });
  });
  await page.route('**/api/v1/events/**', async (route) => {
    await json(route, 200, { items: [] });
  });

  return state;
}

async function openCancellationTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${POLICY.policyNumber}` }).click();
  await expect(page.getByRole('heading', { name: POLICY.policyNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Cancellation' }).click();
  await expect(page.getByRole('tabpanel', { name: 'Cancellation' })).toBeVisible();
  await expect(page.getByTestId(`cancellation-row-${CANCELLATION_ID}`)).toBeVisible();
}

test('creates a return-premium credit note without leaving the cancellation tab', async ({ page }) => {
  const state = await installMocks(page, {
    cancellations: [
      cancellation(),
      cancellation({
        id: ZERO_PREMIUM_ID,
        cancellationType: 'FLAT',
        returnPremiumAmount: '0.0000'
      }),
      cancellation({
        id: APPROVED_ID,
        cancellationType: 'PRO_RATA',
        returnPremiumAmount: '5000.0000',
        status: 'APPROVED'
      })
    ]
  });
  await openCancellationTab(page);

  // Only the POSTED cancellation with a positive return premium offers the action.
  await expect(page.getByTestId(/^create-credit-note-/)).toHaveCount(1);
  const create = page.getByTestId(`create-credit-note-${CANCELLATION_ID}`);
  await expect(create).toHaveText('Create credit note');
  await expect(page.getByTestId(`cancellation-row-${ZERO_PREMIUM_ID}`)).toContainText('—');
  await expect(page.getByTestId(`cancellation-row-${APPROVED_ID}`)).toContainText('—');

  await create.click();

  const dialog = page.getByTestId('credit-note-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'New credit note' })).toBeVisible();

  // The return premium and its currency are pre-filled and locked.
  const amount = dialog.getByLabel('Amount');
  await expect(amount).toHaveValue('90000.00');
  await expect(amount).toHaveAttribute('readonly', '');
  const currency = dialog.getByLabel('Currency');
  await expect(currency).toHaveValue('USD');
  await expect(currency).toHaveAttribute('readonly', '');
  const reason = dialog.getByLabel('Reason');
  await expect(reason).toHaveValue(CREATED_REASON);
  await expect(reason).toHaveAttribute('readonly', '');
  await expect(dialog.getByLabel('Cancellation')).toHaveValue(CANCELLATION_NUMBER);
  await expect(dialog.getByTestId('credit-note-cancellation-context')).toContainText(
    CANCELLATION_NUMBER
  );
  await expect(dialog.getByTestId('credit-note-cancellation-context')).toContainText('POSTED');
  await expect(dialog.getByTestId('credit-note-source-cancellation')).toHaveValue(
    CANCELLATION_NUMBER
  );

  await dialog.getByTestId('save-credit-note').click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    `${CREATED_NOTE_NUMBER} saved as draft.`
  );

  const source = page.getByTestId(`cancellation-credit-note-${CANCELLATION_ID}`);
  await expect(source.getByRole('link', { name: 'Credit note created' })).toBeVisible();
  await expect(source).toContainText(CREATED_NOTE_NUMBER);
  await expect(page.getByTestId(`create-credit-note-${CANCELLATION_ID}`)).toHaveCount(0);

  expect(state.creditNotePosts).toHaveLength(1);
  expect(state.creditNotePosts[0].body).toEqual({
    amount: 90000,
    currency: 'USD',
    reason: CREATED_REASON,
    cancellationId: CANCELLATION_ID
  });
  expect(state.creditNotePosts[0].headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(state.creditNotePosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.creditNoteGets).toBe(2);

  // The created link opens the Billing ledger and keeps the source cancellation.
  await source.getByRole('link', { name: 'Credit note created' }).click();
  await expect(page.getByRole('tab', { name: 'Billing', exact: true }))
    .toHaveAttribute('aria-selected', 'true');
  const noteRow = page.getByTestId(`credit-note-row-${CREATED_NOTE_ID}`);
  await expect(noteRow).toBeVisible();
  await expect(noteRow).toContainText(CREATED_REASON);
  await expect(page.getByTestId(`credit-note-cancellation-${CREATED_NOTE_ID}`))
    .toHaveText(CANCELLATION_NUMBER);
});

test('links a cancellation to an existing ledger note and shows its source number', async ({ page }) => {
  const state = await installMocks(page, {
    // The note read carries only the source id; the ledger resolves the number
    // from the cancellation list it reads alongside the credit notes.
    notes: [creditNote({ cancellationId: CANCELLATION_ID, cancellationNumber: undefined })]
  });
  await openCancellationTab(page);

  await expect(page.getByTestId(`create-credit-note-${CANCELLATION_ID}`)).toHaveCount(0);
  const source = page.getByTestId(`cancellation-credit-note-${CANCELLATION_ID}`);
  const link = source.getByRole('link', { name: 'Credit note created' });
  await expect(link).toBeVisible();
  await expect(source).toContainText(NOTE_NUMBER);

  await link.click();
  await expect(page.getByRole('tabpanel', { name: 'Billing' })).toBeVisible();

  const noteRow = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await expect(noteRow).toBeVisible();
  await expect(page.getByTestId(`credit-note-cancellation-${NOTE_ID}`))
    .toHaveText(CANCELLATION_NUMBER);
  expect(state.creditNotePosts).toHaveLength(0);
});

test('keeps the prefill open with the canonical 409 when a duplicate note exists', async ({ page }) => {
  const state = await installMocks(page, {
    postStatus: 409,
    postError: problem(
      409,
      'A credit note already exists for this cancellation.',
      'CREDIT_NOTE_CONFLICT'
    )
  });
  await openCancellationTab(page);

  await page.getByTestId(`create-credit-note-${CANCELLATION_ID}`).click();
  const dialog = page.getByTestId('credit-note-dialog');
  await dialog.getByTestId('save-credit-note').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('credit-note-form-error')).toContainText(
    'A credit note already exists for this cancellation.'
  );
  await expect(dialog.getByLabel('Amount')).toHaveValue('90000.00');
  await expect(dialog.getByLabel('Amount')).toHaveAttribute('readonly', '');
  await expect(page.getByTestId(`create-credit-note-${CANCELLATION_ID}`)).toBeVisible();
  await expect(page.getByTestId(`cancellation-credit-note-${CANCELLATION_ID}`)).toHaveCount(0);

  expect(state.creditNotePosts).toHaveLength(1);
  expect(state.creditNotePosts[0].body).toMatchObject({
    amount: 90000,
    currency: 'USD',
    cancellationId: CANCELLATION_ID
  });
  // The 409 re-reads the ledger in case the winning note is now visible.
  expect(state.creditNoteGets).toBe(2);
});

test('contains a non-duplicate creation failure in the dialog and sends no success notice', async ({ page }) => {
  const state = await installMocks(page, {
    postStatus: 500,
    postError: problem(
      500,
      'The credit note service is temporarily unavailable.',
      'CREDIT_NOTES_UNAVAILABLE'
    )
  });
  await openCancellationTab(page);

  await page.getByTestId(`create-credit-note-${CANCELLATION_ID}`).click();
  const dialog = page.getByTestId('credit-note-dialog');
  await dialog.getByTestId('save-credit-note').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('credit-note-form-error')).toContainText(
    'The credit note service is temporarily unavailable.'
  );
  await expect(dialog.getByLabel('Reason')).toHaveValue(CREATED_REASON);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByTestId(`create-credit-note-${CANCELLATION_ID}`)).toBeVisible();
  expect(state.creditNotePosts).toHaveLength(1);
  expect(state.creditNoteGets).toBe(1);
});
