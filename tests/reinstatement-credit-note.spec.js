import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const VERSION_ID = '44444444-4444-7444-8444-444444444444';
const CANCELLATION_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const NOTE_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const APPROVER = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const APPROVAL_REF = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const CANCELLATION_NUMBER = 'CXL-2026-0000001';
const NOTE_NUMBER = 'CN-2026-0000042';
const DETAIL =
  `Cancellation ${CANCELLATION_NUMBER} has open credit notes ${NOTE_NUMBER} (ISSUED). `
  + 'Cancel or reverse these credit notes first, then reinstate the policy.';

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

function cancellation() {
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
    status: 'POSTED'
  };
}

function creditNote() {
  return {
    id: NOTE_ID,
    tenantId: TENANT,
    policyId: POLICY_ID,
    creditNoteNumber: NOTE_NUMBER,
    amount: '90000.00',
    currency: 'USD',
    reason: `Cancellation ${CANCELLATION_NUMBER} return premium`,
    status: 'ISSUED',
    issuedDate: '2026-10-20',
    appliedDate: null,
    createdAt: '2026-10-20T10:00:00Z',
    cancellationId: CANCELLATION_ID,
    cancellationNumber: CANCELLATION_NUMBER
  };
}

function reinstatement() {
  return {
    id: 'abababab-abab-7bab-8bab-abababababab',
    tenantId: TENANT,
    policyId: POLICY_ID,
    effectiveDate: '2026-10-21',
    reason: 'Premium received in full',
    approvedBy: APPROVER,
    approvalRef: APPROVAL_REF,
    premiumEvidenceRef: 'RCPT-2026-0001',
    premiumEvidenceAmount: '1500.0000',
    premiumEvidenceCurrency: 'USD',
    status: 'APPROVED'
  };
}

function problem(status, detail, code, meta) {
  return {
    type: `https://errors.eia-open-insurance.example/policy/${String(code).toLowerCase()}`,
    title: status === 409 ? 'Cancellation credit note open' : 'Reinstatement rejected',
    status,
    detail,
    code,
    category: status === 409 ? 'CONFLICT' : 'BUSINESS_RULE',
    retryable: false,
    ...(meta ? { meta } : {})
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

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

/**
 * The mutable `reinstateStatus`/`reinstateError` let a test turn the first 409
 * into a later success; the policy detail and reinstatement list then reflect
 * the retry exactly as the domain would.
 */
async function installMocks(page, options = {}) {
  const state = {
    policy: { ...POLICY },
    notes: options.notes || [creditNote()],
    reinstatements: [],
    reinstateStatus: options.reinstateStatus || 201,
    reinstateError: options.reinstateError || null,
    reinstatementPosts: []
  };

  await page.route('**/api/v1/policies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([state.policy]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      await json(route, 200, state.policy, { ETag: `"${state.policy.version}"` });
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
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions`) {
      await json(route, 200, itemPage([]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/cancellations`) {
      await json(route, 200, itemPage([cancellation()]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/reinstatements`) {
      await json(route, 200, itemPage(state.reinstatements));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/credit-notes`) {
      await json(route, 200, { items: state.notes });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/billing`) {
      await json(route, 404, problem(404, 'No billing plan.', 'BILLING_PLAN_NOT_FOUND'));
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/reinstate`) {
      state.reinstatementPosts.push({
        headers: request.headers(),
        body: request.postDataJSON()
      });
      if (state.reinstateStatus >= 400) {
        await json(route, state.reinstateStatus, state.reinstateError || problem(
          state.reinstateStatus,
          'Reinstatement is blocked.',
          'REINSTATEMENT_BLOCKED'
        ));
        return;
      }
      state.policy = { ...state.policy, status: 'REINSTATED', version: state.policy.version + 1 };
      state.reinstatements = [reinstatement()];
      await json(route, 201, reinstatement(), {
        ETag: `"${state.policy.version}"`,
        'Idempotent-Replayed': 'false'
      });
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
  return page.getByRole('region', { name: 'Reinstate policy' });
}

async function fillReinstateForm(form) {
  await form.getByLabel('Approver ID').fill(APPROVER);
  await form.getByLabel('Approval reference').fill(APPROVAL_REF);
  await form.getByLabel('Premium evidence reference').fill('RCPT-2026-0001');
  await form.getByLabel('Evidence amount').fill('1500.00');
}

test('renders the canonical 409 code and detail in the Reinstatement section', async ({ page }) => {
  const state = await installMocks(page, {
    reinstateStatus: 409,
    reinstateError: problem(409, DETAIL, 'CANCELLATION_CREDIT_NOTE_OPEN', {
      cancellationNumber: CANCELLATION_NUMBER,
      noteNumbers: [NOTE_NUMBER],
      guidance: 'Cancel or reverse the open credit notes before reinstatement.'
    })
  });
  const form = await openCancellationTab(page);
  await fillReinstateForm(form);
  await form.getByRole('button', { name: 'Reinstate policy' }).click();

  const guard = form.getByTestId('reinstatement-error');
  await expect(guard).toBeVisible();
  await expect(guard.getByTestId('reinstatement-error-code'))
    .toHaveText('CANCELLATION_CREDIT_NOTE_OPEN');
  await expect(guard.getByTestId('reinstatement-error-detail')).toHaveText(DETAIL);
  await expect(guard).toContainText(NOTE_NUMBER);
  await expect(guard.getByTestId('reinstatement-credit-note-guidance'))
    .toContainText('Cancel or reverse');
  await expect(guard.getByRole('link', { name: 'Open credit note ledger' })).toBeVisible();

  // The rejection is contained in the section and never replaces the values
  // the operator entered.
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(form.getByLabel('Approver ID')).toHaveValue(APPROVER);
  await expect(form.getByLabel('Approval reference')).toHaveValue(APPROVAL_REF);
  await expect(form.getByLabel('Premium evidence reference')).toHaveValue('RCPT-2026-0001');
  await expect(form.getByLabel('Evidence amount')).toHaveValue('1500.00');
  expect(state.reinstatementPosts).toHaveLength(1);
  expect(state.reinstatementPosts[0].body).toMatchObject({
    approvedBy: APPROVER,
    approvalRef: APPROVAL_REF,
    premiumEvidenceRef: 'RCPT-2026-0001',
    premiumEvidenceAmount: '1500.00'
  });
});

test('falls back to the detail when the problem has no meta note numbers', async ({ page }) => {
  await installMocks(page, {
    reinstateStatus: 409,
    reinstateError: problem(409, DETAIL, 'CANCELLATION_CREDIT_NOTE_OPEN')
  });
  const form = await openCancellationTab(page);
  await fillReinstateForm(form);
  await form.getByRole('button', { name: 'Reinstate policy' }).click();

  const guard = form.getByTestId('reinstatement-error');
  await expect(guard).toBeVisible();
  await expect(guard).toContainText(NOTE_NUMBER);
  await expect(guard.getByTestId('reinstatement-credit-note-link')).toBeVisible();
  await expect(guard.getByTestId('reinstatement-credit-note-guidance'))
    .toContainText('Cancel or reverse');
});

test('opens the Billing credit-note ledger from the guard while the error persists', async ({ page }) => {
  await installMocks(page, {
    reinstateStatus: 409,
    reinstateError: problem(409, DETAIL, 'CANCELLATION_CREDIT_NOTE_OPEN', {
      noteNumbers: [NOTE_NUMBER]
    })
  });
  const form = await openCancellationTab(page);
  await fillReinstateForm(form);
  await form.getByRole('button', { name: 'Reinstate policy' }).click();

  const guard = form.getByTestId('reinstatement-error');
  await guard.getByTestId('reinstatement-credit-note-link').click();

  await expect(page.getByRole('tab', { name: 'Billing', exact: true }))
    .toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tabpanel', { name: 'Billing' })).toBeVisible();
  const ledger = page.getByTestId('credit-notes');
  await expect(ledger).toBeVisible();
  await expect(page.getByTestId(`credit-note-row-${NOTE_ID}`)).toContainText(NOTE_NUMBER);

  // Returning to the Cancellation tab shows the guard until a retry or a new
  // record selection clears it.
  await page.getByRole('tab', { name: 'Cancellation', exact: true }).click();
  await expect(page.getByTestId('reinstatement-error')).toBeVisible();
});

test('clears the guard on a successful retry after the notes are resolved', async ({ page }) => {
  const state = await installMocks(page, {
    reinstateStatus: 409,
    reinstateError: problem(409, DETAIL, 'CANCELLATION_CREDIT_NOTE_OPEN', {
      noteNumbers: [NOTE_NUMBER]
    })
  });
  const form = await openCancellationTab(page);
  await fillReinstateForm(form);
  await form.getByRole('button', { name: 'Reinstate policy' }).click();
  await expect(form.getByTestId('reinstatement-error')).toBeVisible();

  // Resolution: the operator cancels/reverses the note, so the same command
  // now succeeds.
  state.reinstateStatus = 201;
  state.reinstateError = null;
  await form.getByRole('button', { name: 'Reinstate policy' }).click();

  await expect(form.getByTestId('reinstatement-error')).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    'Policy reinstated after approval and premium evidence.'
  );
  await expect(page.getByTestId('policy-status')).toHaveText('REINSTATED');
  await expect(page.getByTestId('policy-etag')).toHaveText('"6"');
  await expect(
    page.getByRole('tabpanel', { name: 'Cancellation' }).getByRole('cell', { name: 'APPROVED' })
  ).toBeVisible();
  expect(state.reinstatementPosts).toHaveLength(2);

  // The next attempt is a fresh command with a fresh idempotency key.
  expect(state.reinstatementPosts[1].headers['idempotency-key']).not.toBe(
    state.reinstatementPosts[0].headers['idempotency-key']
  );
});

test('clears the guard when the operator selects another record', async ({ page }) => {
  await installMocks(page, {
    reinstateStatus: 409,
    reinstateError: problem(409, DETAIL, 'CANCELLATION_CREDIT_NOTE_OPEN', {
      noteNumbers: [NOTE_NUMBER]
    })
  });
  const form = await openCancellationTab(page);
  await fillReinstateForm(form);
  await form.getByRole('button', { name: 'Reinstate policy' }).click();
  await expect(form.getByTestId('reinstatement-error')).toBeVisible();

  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: `Open record ${POLICY.policyNumber}` }).click();
  await page.getByRole('tab', { name: 'Cancellation' }).click();
  await expect(page.getByTestId('reinstatement-error')).toHaveCount(0);
});

test('keeps non-credit-note reinstatement errors on the existing page-level path', async ({ page }) => {
  const detail = 'Premium evidence is required before reinstatement.';
  await installMocks(page, {
    reinstateStatus: 422,
    reinstateError: problem(422, detail, 'PREMIUM_EVIDENCE_REQUIRED')
  });
  const form = await openCancellationTab(page);
  await fillReinstateForm(form);
  await form.getByRole('button', { name: 'Reinstate policy' }).click();

  await expect(page.getByRole('alert')).toContainText(detail);
  await expect(page.getByTestId('reinstatement-error')).toHaveCount(0);
  await expect(form.getByTestId('reinstatement-credit-note-link')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(form.getByLabel('Approver ID')).toHaveValue(APPROVER);
});
