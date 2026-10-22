import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const INSURED_PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const PAYMENT_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const PAYMENT_ID_2 = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const PAYMENT_ID_3 = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const PAYMENT_NUMBER = 'PAY-2026-0000001';
const PAYMENT_NUMBER_2 = 'PAY-2026-0000002';
const PAYMENT_NUMBER_3 = 'PAY-2026-0000003';
const CREDIT_NOTE_ID = '99999999-9999-7999-8999-999999999998';
const CREDIT_NOTE_NUMBER = 'CRN-2026-0000009';

const POLICY = {
  id: POLICY_ID,
  tenantId: TENANT,
  policyNumber: 'POL-2026-0000001',
  productCode: 'CGL',
  insuredPartyId: INSURED_PARTY_ID,
  status: 'IN_FORCE',
  effectiveDate: '2026-01-01',
  expirationDate: '2027-01-01',
  premiumAmount: '120000.0000',
  premiumCurrency: 'USD',
  limitAmount: '5000000.0000',
  limitCurrency: 'USD',
  version: 4,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z'
};

const PLAN = {
  id: PLAN_ID,
  tenantId: TENANT,
  policyId: POLICY_ID,
  planNumber: 'BIL-2026-0000001',
  installmentCount: 4,
  frequency: 'QUARTERLY',
  firstDueDate: '2026-02-01',
  totalPremiumAmount: '120000.00',
  currency: 'USD',
  status: 'ACTIVE'
};

const DUE_DATES = ['2026-02-01', '2026-05-01', '2026-08-01', '2026-11-01'];

function installment(number, overrides = {}) {
  return {
    id: `installment-${number}`,
    tenantId: TENANT,
    policyId: POLICY_ID,
    planId: PLAN_ID,
    installmentNumber: number,
    dueDate: DUE_DATES[number - 1],
    amount: '30000.00',
    currency: 'USD',
    status: 'DUE',
    paidDate: null,
    paymentId: null,
    ...overrides
  };
}

function policyPayment(overrides = {}) {
  return {
    id: PAYMENT_ID,
    tenantId: TENANT,
    paymentNumber: PAYMENT_NUMBER,
    paymentType: 'PREMIUM',
    status: 'APPROVED',
    amount: '30000.00',
    currency: 'USD',
    payeePartyId: INSURED_PARTY_ID,
    paymentDate: '2026-03-01',
    version: 1,
    createdAt: '2026-03-01T12:00:00Z',
    updatedAt: '2026-03-01T12:00:00Z',
    sourceType: 'POLICY',
    sourceId: POLICY_ID,
    sourceReference: `${POLICY.policyNumber} installment 1`,
    ...overrides
  };
}

function summarize(rows, planRow = PLAN) {
  const planTotal = Number(planRow?.totalPremiumAmount);
  const total = Number.isFinite(planTotal)
    ? planTotal
    : rows.reduce((sum, row) => sum + Number(row.amount), 0);
  const amountFor = (status) => rows
    .filter((row) => row.status === status)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const paid = amountFor('PAID');
  const waived = amountFor('WAIVED');
  return {
    totalPremiumAmount: total.toFixed(2),
    paidAmount: paid.toFixed(2),
    outstandingAmount: Math.max(total - paid - waived, 0).toFixed(2),
    overdueAmount: amountFor('OVERDUE').toFixed(2),
    currency: planRow.currency,
    installmentCount: rows.length,
    paidCount: rows.filter((row) => row.status === 'PAID').length,
    overdueCount: rows.filter((row) => row.status === 'OVERDUE').length
  };
}

function billingBody(planRow, rows) {
  return {
    plan: planRow,
    installments: rows,
    summary: summarize(rows, planRow)
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

async function json(route, status, body, headers = {}) {
  await route.fulfill({
    status,
    contentType: 'application/json',
    headers,
    body: JSON.stringify(body)
  });
}

function problem(status, detail, code) {
  return {
    type: `https://errors.eia-open-insurance.example/policy/${code.toLowerCase()}`,
    title: 'Billing conflict',
    status,
    detail,
    code,
    category: 'BUSINESS_RULE',
    retryable: false
  };
}

/**
 * Mocks the policy record and the Billing API. The plan, installments, and
 * summary live in one mutable state object so POST/PATCH changes are visible on
 * the follow-up GET that the tab performs after every mutation.
 */
async function installMocks(page, options = {}) {
  const policy = { ...POLICY, ...(options.policy || {}) };
  const state = {
    plan: options.plan ? { ...options.plan } : null,
    installments: (options.installments || []).map((row) => ({ ...row })),
    payments: (options.payments || []).map((row) => ({ ...row })),
    notes: [],
    planPosts: [],
    patches: [],
    adjustmentPosts: [],
    creditNotePosts: [],
    paymentGets: [],
    paymentDetailGets: [],
    billingGets: 0,
    policyGets: 0,
    creditNoteGets: 0,
    postStatus: options.postStatus || 201,
    postError: options.postError || null,
    adjustmentStatus: options.adjustmentStatus || 201,
    adjustmentError: options.adjustmentError || null,
    creditNoteStatus: options.creditNoteStatus || 201,
    creditNoteError: options.creditNoteError || null,
    patchStatus: options.patchStatus || 200,
    patchError: options.patchError || null,
    getStatus: options.getStatus || 200,
    paymentListStatus: options.paymentListStatus || 200,
    paymentListError: options.paymentListError || null,
    paymentDetailStatus: options.paymentDetailStatus || 200,
    paymentDetailError: options.paymentDetailError || null,
    paymentDetails: { ...(options.paymentDetails || {}) }
  };

  await page.route('**/api/v1/policies**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (method === 'GET' && url.pathname === '/api/v1/policies') {
      await json(route, 200, envelope([policy]));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}`) {
      state.policyGets += 1;
      await json(route, 200, policy, { ETag: '"4"' });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/versions/current`) {
      await json(route, 200, {
        version: {
          id: '44444444-4444-7444-8444-444444444444',
          policyVersionNumber: 'POL-2026-0000001-04',
          changeType: 'ENDORSEMENT',
          status: 'ISSUED',
          effectiveFrom: '2026-06-01'
        },
        current: true,
        hashVerified: true
      });
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/billing`) {
      state.billingGets += 1;
      if (state.getStatus >= 400) {
        await json(route, state.getStatus, problem(
          state.getStatus,
          'The billing plan could not be read.',
          'BILLING_UNAVAILABLE'
        ));
        return;
      }
      if (!state.plan) {
        await json(route, 404, problem(
          404,
          'No billing plan has been created for this policy.',
          'BILLING_PLAN_NOT_FOUND'
        ));
        return;
      }
      await json(route, 200, billingBody(state.plan, state.installments));
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/billing`) {
      const body = request.postDataJSON();
      state.planPosts.push({ headers: request.headers(), body });
      if (state.postStatus >= 400) {
        await json(route, state.postStatus, state.postError || problem(
          state.postStatus,
          'A billing plan already exists for this policy.',
          'BILLING_PLAN_CONFLICT'
        ));
        return;
      }
      state.plan = {
        ...PLAN,
        installmentCount: body.installmentCount,
        frequency: body.frequency,
        firstDueDate: body.firstDueDate
      };
      state.installments = Array.from({ length: body.installmentCount }, (_, index) => installment(
        index + 1,
        {
          dueDate: body.firstDueDate,
          amount: (Number(PLAN.totalPremiumAmount) / body.installmentCount).toFixed(2)
        }
      ));
      await json(route, 201, billingBody(state.plan, state.installments), {
        ETag: '"5"',
        'Idempotent-Replayed': 'false'
      });
      return;
    }
    if (method === 'POST' && url.pathname === `/api/v1/policies/${POLICY_ID}/billing/adjustment`) {
      const body = request.postDataJSON();
      state.adjustmentPosts.push({ headers: request.headers(), body });
      if (state.adjustmentStatus >= 400) {
        await json(route, state.adjustmentStatus, state.adjustmentError || problem(
          state.adjustmentStatus,
          'The billing plan changed while the adjustment was open.',
          'BILLING_ADJUSTMENT_CONFLICT'
        ));
        return;
      }
      // The domain derives the added amount from the policy premium and the
      // plan's net premium, so the mock mirrors that calculation.
      const credited = Number(state.plan.creditedAmount || 0);
      const netPlan = Math.max(Number(state.plan.totalPremiumAmount) - credited, 0);
      const delta = Number(policy.premiumAmount) - netPlan;
      const nextNumber = state.installments.length + 1;
      state.plan = {
        ...state.plan,
        totalPremiumAmount: (Number(state.plan.totalPremiumAmount) + delta).toFixed(2)
      };
      state.installments.push(installment(nextNumber, {
        id: `installment-${nextNumber}`,
        dueDate: body.dueDate,
        amount: delta.toFixed(2)
      }));
      await json(route, 201, billingBody(state.plan, state.installments), {
        ETag: '"6"',
        'Idempotent-Replayed': 'false'
      });
      return;
    }
    if (method === 'PATCH' && url.pathname.startsWith(
      `/api/v1/policies/${POLICY_ID}/billing/installments/`
    )) {
      const id = url.pathname.split('/').pop();
      const body = request.postDataJSON();
      state.patches.push({ path: url.pathname, headers: request.headers(), body });
      if (state.patchStatus >= 400) {
        await json(route, state.patchStatus, state.patchError || problem(
          state.patchStatus,
          'The installment was changed by another user.',
          'INSTALLMENT_CONFLICT'
        ));
        return;
      }
      state.installments = state.installments.map((row) => (
        row.id === id
          ? {
            ...row,
            status: body.status,
            paidDate: body.status === 'PAID' ? '2026-10-20' : null,
            paymentId: body.paymentId || row.paymentId
          }
          : row
      ));
      await json(route, 200, state.installments.find((row) => row.id === id));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/endorsements`) {
      await json(route, 200, envelope([]));
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
      if (state.creditNoteStatus >= 400) {
        await json(route, state.creditNoteStatus, state.creditNoteError || problem(
          state.creditNoteStatus,
          'A credit note with this amount and reason already exists.',
          'CREDIT_NOTE_CONFLICT'
        ));
        return;
      }
      const created = {
        id: CREDIT_NOTE_ID,
        tenantId: TENANT,
        policyId: POLICY_ID,
        creditNoteNumber: CREDIT_NOTE_NUMBER,
        amount: Number(body.amount).toFixed(2),
        currency: body.currency,
        reason: body.reason,
        status: 'DRAFT',
        issuedDate: null,
        appliedDate: null,
        createdAt: '2026-10-22T12:00:00Z'
      };
      state.notes.push(created);
      await json(route, 201, created, {
        ETag: '"1"',
        'Idempotent-Replayed': 'false'
      });
      return;
    }
    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await mockRelated(page);
  await mockPartyDetail(page);
  await page.route('**/api/v1/payments**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      await route.fulfill({ status: 404, body: `unexpected route ${request.method()} ${url.pathname}` });
      return;
    }
    if (url.pathname === '/api/v1/payments') {
      state.paymentGets.push({
        headers: request.headers(),
        query: Object.fromEntries(url.searchParams)
      });
      if (state.paymentListStatus >= 400) {
        await json(route, state.paymentListStatus, state.paymentListError || problem(
          state.paymentListStatus,
          'Policy payments are temporarily unavailable.',
          'PAYMENTS_UNAVAILABLE'
        ));
        return;
      }
      await json(route, 200, { items: state.payments });
      return;
    }
    const paymentId = decodeURIComponent(url.pathname.split('/').pop() || '');
    state.paymentDetailGets.push({ headers: request.headers(), paymentId });
    if (state.paymentDetailStatus >= 400) {
      await json(route, state.paymentDetailStatus, state.paymentDetailError || problem(
        state.paymentDetailStatus,
        'The linked payment could not be read.',
        'PAYMENT_UNAVAILABLE'
      ));
      return;
    }
    const payment = state.paymentDetails[paymentId]
      || state.payments.find((row) => row.id === paymentId)
      || null;
    if (!payment) {
      await json(route, 404, problem(
        404,
        `Payment ${paymentId} was not found.`,
        'PAYMENT_NOT_FOUND'
      ));
      return;
    }
    await json(route, 200, payment);
  });
  await page.route('**/api/v1/documents**', async (route) => {
    await json(route, 200, { items: [] });
  });
  await page.route('**/api/v1/events/**', async (route) => {
    await json(route, 200, { items: [] });
  });

  return state;
}

async function openBillingTab(page) {
  await page.goto('/');
  await page.getByRole('button', { name: `Open record ${POLICY.policyNumber}` }).click();
  await expect(page.getByRole('heading', { name: POLICY.policyNumber })).toBeVisible();
  await page.getByRole('tab', { name: 'Billing', exact: true }).click();
}

function handOffParams(href) {
  const url = new URL(href, 'http://localhost:3002');
  return { pathname: url.pathname, params: Object.fromEntries(url.searchParams) };
}

test('creates a billing plan with the selected policy premium and server payload', async ({ page }) => {
  const state = await installMocks(page);
  await openBillingTab(page);

  const empty = page.getByTestId('billing-empty');
  await expect(empty).toContainText('No billing plan yet');
  await expect(empty).toContainText('Billing is premium collection');
  await expect(empty).toContainText('Not scheduled');
  await expect(empty).toContainText('$120,000.00');
  await expect(empty).toContainText('USD');
  await expect(page.getByTestId('billing-premium-variance')).toHaveCount(0);

  const count = page.getByLabel('Installment count');
  await expect(count).toHaveAttribute('min', '1');
  await expect(count).toHaveAttribute('max', '24');
  await count.fill('4');
  await page.getByLabel('Frequency').selectOption('QUARTERLY');
  await page.getByLabel('First due date').fill('2026-02-01');
  await page.getByRole('button', { name: 'Create billing plan' }).click();

  await expect(page.getByRole('status')).toContainText('Billing plan created with 4 installments.');
  await expect(page.getByTestId('billing-plan-meta')).toContainText('4 installments');
  await expect(page.getByTestId('billing-plan-meta')).toContainText('Quarterly');
  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');
  await expect(page.getByTestId('billing-summary-outstanding')).toHaveText('$120,000.00');
  await expect(page.getByTestId('installment-row-installment-4')).toBeVisible();
  await expect(page.getByRole('table', { name: 'Billing installments' }).getByRole('row'))
    .toHaveCount(5);

  expect(state.planPosts).toHaveLength(1);
  expect(state.planPosts[0].body).toEqual({
    installmentCount: 4,
    frequency: 'QUARTERLY',
    firstDueDate: '2026-02-01'
  });
  expect(state.planPosts[0].headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(state.planPosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.billingGets).toBe(2);
});

test('renders summary, paid reference, and overdue installments', async ({ page }) => {
  const rows = [
    installment(1),
    installment(2, { status: 'OVERDUE' }),
    installment(3, {
      status: 'PAID',
      paidDate: '2026-03-15',
      paymentId: PAYMENT_ID
    }),
    installment(4, { status: 'WAIVED' })
  ];
  await installMocks(page, { plan: PLAN, installments: rows });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');
  await expect(page.getByTestId('billing-summary-paid')).toHaveText('$30,000.00');
  await expect(page.getByTestId('billing-summary-outstanding')).toHaveText('$60,000.00');
  await expect(page.getByTestId('billing-summary-overdue')).toHaveText('$30,000.00');
  await expect(page.getByTestId('billing-policy-context')).toContainText('$120,000.00');
  await expect(page.getByTestId('billing-policy-context')).toContainText('USD');
  await expect(page.getByTestId('billing-plan-meta')).toContainText('BIL-2026-0000001');

  const table = page.getByRole('table', { name: 'Billing installments' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Number',
    'Due date',
    'Amount',
    'Status',
    'Paid date / payment ID',
    'Action'
  ]);

  const overdueRow = page.getByTestId('installment-row-installment-2');
  await expect(overdueRow).toHaveClass(/eia-billing-overdue-row/);
  await expect(overdueRow).toHaveAttribute('data-overdue', 'true');
  await expect(overdueRow).toContainText('OVERDUE');
  await expect(overdueRow).toContainText('Past due');

  const paidRow = page.getByTestId('installment-row-installment-3');
  await expect(paidRow).toContainText('2026-03-15');
  await expect(paidRow).toContainText(PAYMENT_ID);
  await expect(paidRow.getByText('PAID', { exact: true })).toBeVisible();
  await expect(paidRow.getByRole('button', { name: 'Mark paid' })).toHaveCount(0);
  await expect(paidRow.getByRole('button', { name: 'Link payment' })).toHaveCount(0);
  await expect(paidRow.getByText('Create payment')).toHaveCount(0);

  const waivedRow = page.getByTestId('installment-row-installment-4');
  await expect(waivedRow.getByText('WAIVED', { exact: true })).toBeVisible();
  await expect(waivedRow.getByRole('button', { name: 'Link payment' })).toHaveCount(0);
  await expect(waivedRow.getByText('Create payment')).toHaveCount(0);

  await expect(page.getByTestId('create-payment-installment-1')).toBeVisible();
  await expect(page.getByTestId('create-payment-installment-2')).toBeVisible();
  await expect(page.getByTestId(/^create-payment-/)).toHaveCount(2);
  await expect(page.getByTestId(/^link-payment-/)).toHaveCount(2);
});

test('shows a linked PAID payment without a review warning', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [
      installment(1, { status: 'PAID', paidDate: '2026-03-15', paymentId: PAYMENT_ID })
    ],
    payments: [policyPayment({ status: 'PAID' })]
  });
  await openBillingTab(page);

  const row = page.getByTestId('installment-row-installment-1');
  await expect(row.getByTestId('payment-status-installment-1'))
    .toContainText('Payment status: PAID');
  await expect(row.getByTestId('payment-review-warning-installment-1')).toHaveCount(0);
  await expect(page.getByTestId('billing-payment-review-summary')).toHaveCount(0);
  await expect(row.getByText('PAID', { exact: true })).toBeVisible();
  await expect(row).toContainText(PAYMENT_ID);

  expect(state.paymentDetailGets).toHaveLength(1);
  expect(state.paymentDetailGets[0].paymentId).toBe(PAYMENT_ID);
  expect(state.paymentDetailGets[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.patches).toHaveLength(0);
});

test('warns when a linked payment is REVERSED and keeps the installment unchanged', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [
      installment(1, { status: 'PAID', paidDate: '2026-03-15', paymentId: PAYMENT_ID })
    ],
    payments: [policyPayment({ status: 'REVERSED' })]
  });
  await openBillingTab(page);

  const warning = page.getByTestId('payment-review-warning-installment-1');
  await expect(warning).toHaveText('Payment REVERSED — installment may need review');
  await expect(page.getByTestId('payment-record-link-installment-1')).toBeVisible();
  await expect(page.getByTestId('billing-payment-review-summary')).toContainText('1 installment');

  const row = page.getByTestId('installment-row-installment-1');
  await expect(row.getByText('PAID', { exact: true })).toBeVisible();
  await expect(row).toContainText(PAYMENT_ID);
  expect(state.patches).toHaveLength(0);
});

test('counts installments whose linked payment is no longer PAID', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [
      installment(1, { status: 'PAID', paidDate: '2026-03-15', paymentId: PAYMENT_ID }),
      installment(2, { status: 'PAID', paidDate: '2026-03-16', paymentId: PAYMENT_ID_2 }),
      installment(3, { status: 'PAID', paidDate: '2026-03-17', paymentId: PAYMENT_ID_3 }),
      installment(4)
    ],
    payments: [
      policyPayment({ status: 'REVERSED' }),
      policyPayment({
        id: PAYMENT_ID_2,
        paymentNumber: PAYMENT_NUMBER_2,
        status: 'CANCELLED'
      }),
      policyPayment({
        id: PAYMENT_ID_3,
        paymentNumber: PAYMENT_NUMBER_3,
        status: 'PAID'
      })
    ]
  });
  await openBillingTab(page);

  const summary = page.getByTestId('billing-payment-review-summary');
  await expect(summary).toContainText('2 installments');
  await expect(summary).toContainText('no longer PAID');
  await expect(page.getByTestId(/^payment-review-warning-/)).toHaveCount(2);
  await expect(page.getByTestId('payment-review-warning-installment-1')).toContainText('REVERSED');
  await expect(page.getByTestId('payment-review-warning-installment-2')).toContainText('CANCELLED');
  await expect(page.getByTestId('payment-review-warning-installment-3')).toHaveCount(0);
  await expect(page.getByTestId('payment-status-installment-3'))
    .toContainText('Payment status: PAID');

  expect(state.paymentDetailGets).toHaveLength(3);
  expect(state.patches).toHaveLength(0);
});

test('contains a linked payment read failure without a warning', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [
      installment(1, { status: 'PAID', paidDate: '2026-03-15', paymentId: PAYMENT_ID })
    ],
    paymentDetailStatus: 503
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');
  const row = page.getByTestId('installment-row-installment-1');
  await expect(row.getByText('PAID', { exact: true })).toBeVisible();
  await expect(row.getByTestId('payment-status-unavailable-installment-1'))
    .toContainText('Payment status unavailable');
  await expect(page.getByTestId('payment-review-warning-installment-1')).toHaveCount(0);
  await expect(page.getByTestId('billing-payment-review-summary')).toHaveCount(0);
  await expect(page.getByRole('tabpanel', { name: 'Billing' }).getByRole('alert'))
    .toHaveCount(0);

  expect(state.paymentDetailGets).toHaveLength(1);
  expect(state.patches).toHaveLength(0);
});

test('links a review warning to the Payment record', async ({ page }) => {
  await installMocks(page, {
    plan: PLAN,
    installments: [
      installment(1, { status: 'PAID', paidDate: '2026-03-15', paymentId: PAYMENT_ID })
    ],
    payments: [policyPayment({ status: 'RETURNED' })]
  });
  await openBillingTab(page);

  const link = page.getByTestId('payment-record-link-installment-1');
  await expect(link).toHaveAttribute('href', `/payment?record=${PAYMENT_ID}`);
  await expect(link).toHaveText('Payment record');
  await link.click();
  await expect(page).toHaveURL(new URL(
    `/payment?record=${PAYMENT_ID}`,
    'http://localhost:3002'
  ).toString());
});

test('marks an installment paid and waives another with PATCH payloads', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [installment(1), installment(2)]
  });
  await openBillingTab(page);

  await page.getByTestId('mark-paid-installment-1').click();
  await expect(page.getByRole('status')).toContainText('Installment 1 marked paid.');
  await expect(page.getByTestId('installment-row-installment-1')).toContainText('PAID');
  await expect(page.getByTestId('installment-row-installment-1')).toContainText('2026-10-20');
  await expect(page.getByTestId('mark-paid-installment-1')).toHaveCount(0);

  await page.getByTestId('waive-installment-2').click();
  await expect(page.getByRole('status')).toContainText('Installment 2 waived.');
  await expect(page.getByTestId('installment-row-installment-2')).toContainText('WAIVED');
  await expect(page.getByTestId('waive-installment-2')).toHaveCount(0);

  expect(state.patches).toHaveLength(2);
  expect(state.patches[0]).toMatchObject({
    path: `/api/v1/policies/${POLICY_ID}/billing/installments/installment-1`,
    body: { status: 'PAID' }
  });
  expect(state.patches[1]).toMatchObject({
    path: `/api/v1/policies/${POLICY_ID}/billing/installments/installment-2`,
    body: { status: 'WAIVED' }
  });
  expect(state.patches[0].body.paymentId).toBeUndefined();
  expect(state.patches[1].body.paymentId).toBeUndefined();
});

test('links an existing policy payment to an overdue installment', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [
      installment(1),
      installment(2, { status: 'OVERDUE', amount: '45000.50' })
    ],
    payments: [
      policyPayment({
        amount: '45000.50',
        sourceReference: `${POLICY.policyNumber} installment 2`
      }),
      policyPayment({
        id: PAYMENT_ID_2,
        paymentNumber: PAYMENT_NUMBER_2,
        status: 'DRAFT',
        amount: '1000.00'
      })
    ]
  });
  await openBillingTab(page);

  await page.getByTestId('link-payment-installment-2').click();
  const dialog = page.getByTestId('link-payment-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Link payment to installment 2' }))
    .toBeVisible();

  const table = dialog.getByRole('table', { name: 'Policy payments' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Select',
    'Payment',
    'Status',
    'Amount',
    'Created',
    'Payee'
  ]);
  const paymentRow = dialog.getByTestId(`payment-row-${PAYMENT_ID}`);
  await expect(paymentRow).toContainText(PAYMENT_NUMBER);
  await expect(paymentRow).toContainText('APPROVED');
  await expect(paymentRow).toContainText('$45,000.50');
  await expect(paymentRow).toContainText('USD');
  await expect(paymentRow).toContainText('2026-03-01');
  await expect(paymentRow).toContainText(INSURED_PARTY_ID);

  expect(state.paymentGets).toHaveLength(1);
  expect(state.paymentGets[0].query).toEqual({ sourceType: 'POLICY', sourceId: POLICY_ID });
  expect(state.paymentGets[0].headers['x-eia-tenant']).toBe(TENANT);

  const apply = dialog.getByRole('button', { name: 'Apply payment' });
  await expect(apply).toBeDisabled();
  await dialog.getByRole('radio', { name: `Select ${PAYMENT_NUMBER}` }).check();
  await expect(apply).toBeEnabled();
  await expect(dialog.getByTestId('payment-amount-warning')).toHaveCount(0);

  await apply.click();

  await expect(page.getByRole('status')).toContainText(
    `Installment 2 linked to ${PAYMENT_NUMBER}.`
  );
  await expect(page.getByTestId('link-payment-dialog')).toHaveCount(0);
  const row = page.getByTestId('installment-row-installment-2');
  await expect(row).toContainText('PAID');
  await expect(row).toContainText(PAYMENT_ID);
  await expect(row.getByTestId('payment-number-installment-2')).toHaveText(PAYMENT_NUMBER);

  expect(state.patches).toHaveLength(1);
  expect(state.patches[0]).toMatchObject({
    path: `/api/v1/policies/${POLICY_ID}/billing/installments/installment-2`,
    body: { status: 'PAID', paymentId: PAYMENT_ID }
  });
  expect(state.billingGets).toBe(2);
});

test('warns when the selected payment amount differs from the installment', async ({ page }) => {
  await installMocks(page, {
    plan: PLAN,
    installments: [installment(1)],
    payments: [
      policyPayment({ amount: '28500.25' }),
      policyPayment({
        id: PAYMENT_ID_2,
        paymentNumber: PAYMENT_NUMBER_2,
        amount: '30000.00'
      })
    ]
  });
  await openBillingTab(page);

  await page.getByTestId('link-payment-installment-1').click();
  const dialog = page.getByTestId('link-payment-dialog');
  const warning = dialog.getByTestId('payment-amount-warning');

  await dialog.getByRole('radio', { name: `Select ${PAYMENT_NUMBER}` }).check();
  await expect(warning).toBeVisible();
  await expect(warning).toContainText('Amounts differ');
  await expect(warning).toContainText('$28,500.25');
  await expect(warning).toContainText('$30,000.00');
  await expect(warning).toContainText('not changed');
  await expect(dialog.getByRole('button', { name: 'Apply payment' })).toBeEnabled();

  await dialog.getByRole('radio', { name: `Select ${PAYMENT_NUMBER_2}` }).check();
  await expect(warning).toHaveCount(0);
});

test('shows an empty state when the policy has no source payments', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [installment(1)],
    payments: []
  });
  await openBillingTab(page);

  await page.getByTestId('link-payment-installment-1').click();
  const dialog = page.getByTestId('link-payment-dialog');

  await expect(dialog.getByTestId('link-payment-empty')).toContainText(
    'No payments found for this policy.'
  );
  await expect(dialog.getByTestId('link-payment-loading')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Apply payment' })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Create payment' })).toHaveCount(0);
  await expect(dialog.getByRole('link', { name: 'Open Payment workbench' }))
    .toHaveAttribute('href', '/payment');
  expect(state.paymentGets).toHaveLength(1);
  expect(state.paymentGets[0].query).toEqual({ sourceType: 'POLICY', sourceId: POLICY_ID });
});

test('keeps the payment picker open when the payment read fails and retries', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [installment(1)],
    paymentListStatus: 503
  });
  await openBillingTab(page);

  await page.getByTestId('link-payment-installment-1').click();
  const dialog = page.getByTestId('link-payment-dialog');
  await expect(dialog.getByTestId('link-payment-error')).toContainText(
    'Policy payments are temporarily unavailable.'
  );

  await dialog.getByRole('button', { name: 'Retry' }).click();
  await expect.poll(() => state.paymentGets.length).toBe(2);
  await expect(dialog.getByTestId('link-payment-error')).toContainText(
    'Policy payments are temporarily unavailable.'
  );
});

test('keeps the linked installment unchanged when the PATCH is rejected with 409', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [installment(1)],
    payments: [policyPayment()],
    patchStatus: 409,
    patchError: problem(
      409,
      'Installment 1 was already paid by another user.',
      'INSTALLMENT_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId('link-payment-installment-1').click();
  const dialog = page.getByTestId('link-payment-dialog');
  await dialog.getByRole('radio', { name: `Select ${PAYMENT_NUMBER}` }).check();
  await dialog.getByRole('button', { name: 'Apply payment' }).click();

  await expect(dialog.getByRole('alert')).toContainText(
    'Installment 1 was already paid by another user.'
  );
  await expect(dialog).toBeVisible();
  const row = page.getByTestId('installment-row-installment-1');
  await expect(row).toContainText('DUE');
  await expect(row.getByTestId('payment-id-installment-1')).toHaveCount(0);

  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ status: 'PAID', paymentId: PAYMENT_ID });
});

test('offers a Payment hand-off URL for collectible installments only', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [
      installment(1),
      installment(2, { status: 'OVERDUE', amount: '45000.50' }),
      installment(3, { status: 'PAID', paidDate: '2026-03-15', paymentId: PAYMENT_ID })
    ]
  });
  const paymentRequests = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/v1/payments') {
      paymentRequests.push({ method: request.method(), url: request.url() });
    }
  });
  await openBillingTab(page);

  const first = page.getByTestId('create-payment-installment-1');
  const second = page.getByTestId('create-payment-installment-2');
  await expect(first).toHaveText('Create payment');
  await expect(second).toHaveText('Create payment');
  await expect(page.getByTestId('create-payment-installment-3')).toHaveCount(0);

  const firstHref = await first.getAttribute('href');
  const secondHref = await second.getAttribute('href');
  expect(handOffParams(firstHref)).toEqual({
    pathname: '/payment',
    params: {
      new: '1',
      sourceType: 'POLICY',
      sourceId: POLICY_ID,
      sourceReference: `${POLICY.policyNumber} installment 1`,
      amount: '30000.00',
      currency: 'USD',
      payeePartyId: INSURED_PARTY_ID
    }
  });
  expect(handOffParams(secondHref).params).toMatchObject({
    sourceReference: `${POLICY.policyNumber} installment 2`,
    amount: '45000.50',
    sourceType: 'POLICY',
    sourceId: POLICY_ID,
    payeePartyId: INSURED_PARTY_ID
  });
  expect(state.planPosts).toHaveLength(0);

  await first.click();
  await expect(page).toHaveURL(new URL(firstHref, 'http://localhost:3002').toString());
  expect(paymentRequests).toEqual([]);
});

test('states the Billing and Payment boundary in the context panel', async ({ page }) => {
  await installMocks(page, { plan: PLAN, installments: [installment(1)] });
  await openBillingTab(page);

  const context = page.getByRole('region', { name: 'Billing and Payment boundary' });
  await expect(context).toBeVisible();
  await expect(context).toContainText('Billing is premium collection');
  await expect(context).toContainText('Payment owns disbursement and approval');
  await expect(context).toContainText('A billing plan does not change policy coverage');
  await expect(context.getByRole('link', { name: 'Open Payment workbench' }))
    .toHaveAttribute('href', '/payment');
});

test('shows a billing read failure inside the tab and retries', async ({ page }) => {
  await installMocks(page, { getStatus: 503 });
  await openBillingTab(page);

  const tab = page.getByRole('tabpanel', { name: 'Billing' });
  await expect(tab.getByRole('alert')).toContainText('Billing is temporarily unavailable.');
  await expect(tab.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('keeps the plan when a PATCH is rejected with 409', async ({ page }) => {
  const state = await installMocks(page, {
    plan: PLAN,
    installments: [installment(1), installment(2)],
    patchStatus: 409,
    patchError: problem(
      409,
      'Installment 1 was already paid by another user.',
      'INSTALLMENT_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId('mark-paid-installment-1').click();

  await expect(page.getByRole('alert')).toContainText(
    'Installment 1 was already paid by another user.'
  );
  await expect(page.getByTestId('installment-row-installment-1')).toContainText('DUE');
  expect(state.patches).toHaveLength(1);
  expect(state.patches[0].body).toEqual({ status: 'PAID' });
  expect(state.billingGets).toBe(2);
});

test('reports a create conflict when a plan already exists', async ({ page }) => {
  const state = await installMocks(page, {
    postStatus: 409,
    postError: problem(
      409,
      'A billing plan already exists for this policy.',
      'BILLING_PLAN_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByLabel('Installment count').fill('4');
  await page.getByRole('button', { name: 'Create billing plan' }).click();

  await expect(page.getByRole('alert')).toContainText(
    'A billing plan already exists for this policy.'
  );
  await expect(page.getByTestId('billing-empty')).toBeVisible();
  expect(state.planPosts).toHaveLength(1);
  expect(state.billingGets).toBe(2);
});

test('warns when the policy premium is above the net billing plan premium', async ({ page }) => {
  await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '100000.00' },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  const warning = page.getByTestId('billing-premium-variance');
  await expect(warning).toBeVisible();
  await expect(page.getByTestId('billing-premium-variance-message')).toHaveText(
    'Policy premium $120,000.00 differs from the billing plan net premium $100,000.00 by $20,000.00.'
  );
  await expect(warning).toContainText('does not automatically re-plan existing billing');
  await expect(warning.getByTestId('billing-variance-add-adjustment'))
    .toHaveText('Add adjustment installment');
  await expect(warning.getByTestId('billing-variance-create-credit-note')).toHaveCount(0);
});

test('warns when the policy premium is below the net billing plan premium', async ({ page }) => {
  await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '125000.50' },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-premium-variance-message')).toHaveText(
    'Policy premium $120,000.00 differs from the billing plan net premium $125,000.50 by $5,000.50.'
  );
  await expect(page.getByTestId('billing-variance-create-credit-note'))
    .toHaveText('Create credit note');
  await expect(page.getByTestId('billing-variance-add-adjustment')).toHaveCount(0);
});

test('reduces the premium variance by the plan credits', async ({ page }) => {
  await installMocks(page, {
    plan: {
      ...PLAN,
      totalPremiumAmount: '130000.00',
      creditedAmount: '5000.00'
    },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-summary-credited')).toHaveText('$5,000.00');
  await expect(page.getByTestId('billing-premium-variance-message')).toHaveText(
    'Policy premium $120,000.00 differs from the billing plan net premium $125,000.00 by $5,000.00. Plan total $130,000.00 less credits $5,000.00.'
  );
});

test('compares a partially credited plan at cent precision', async ({ page }) => {
  await installMocks(page, {
    plan: {
      ...PLAN,
      totalPremiumAmount: '125000.50',
      creditedAmount: '2000.25'
    },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-premium-variance-message')).toHaveText(
    'Policy premium $120,000.00 differs from the billing plan net premium $123,000.25 by $3,000.25. Plan total $125,000.50 less credits $2,000.25.'
  );
});

test('shows no variance warning when credits bring the net plan premium to the policy premium', async ({ page }) => {
  await installMocks(page, {
    plan: {
      ...PLAN,
      totalPremiumAmount: '125000.00',
      creditedAmount: '5000.00'
    },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-summary-credited')).toHaveText('$5,000.00');
  await expect(page.getByTestId('billing-premium-variance')).toHaveCount(0);
  await expect(page.getByTestId('billing-variance-add-adjustment')).toHaveCount(0);
  await expect(page.getByTestId('billing-variance-create-credit-note')).toHaveCount(0);
});

test('floors a fully credited plan net premium at zero', async ({ page }) => {
  await installMocks(page, {
    plan: {
      ...PLAN,
      totalPremiumAmount: '100000.00',
      creditedAmount: '100000.00'
    },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-premium-variance-message')).toHaveText(
    'Policy premium $120,000.00 differs from the billing plan net premium $0.00 by $120,000.00. Plan total $100,000.00 less credits $100,000.00.'
  );
});

test('floors the net plan premium at zero when credits exceed the total', async ({ page }) => {
  await installMocks(page, {
    plan: {
      ...PLAN,
      totalPremiumAmount: '100000.00',
      creditedAmount: '150000.00'
    },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-premium-variance-message')).toHaveText(
    'Policy premium $120,000.00 differs from the billing plan net premium $0.00 by $120,000.00. Plan total $100,000.00 less credits $150,000.00.'
  );
});

test('shows no variance warning when the plan total matches at cent precision', async ({ page }) => {
  await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '120000.0040' },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');
  await expect(page.getByTestId('billing-premium-variance')).toHaveCount(0);
});

test('shows no variance warning when the plan total is missing', async ({ page }) => {
  const planWithoutTotal = { ...PLAN };
  delete planWithoutTotal.totalPremiumAmount;
  await installMocks(page, { plan: planWithoutTotal, installments: [installment(1)] });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-plan-meta')).toContainText('BIL-2026-0000001');
  await expect(page.getByTestId('billing-premium-variance')).toHaveCount(0);
});

test('shows no variance warning when the policy premium is missing', async ({ page }) => {
  await installMocks(page, {
    policy: { premiumAmount: null },
    plan: { ...PLAN, totalPremiumAmount: '100000.00' },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-policy-context')).toContainText('Policy premium —');
  await expect(page.getByTestId('billing-premium-variance')).toHaveCount(0);
});

test('adds a positive variance adjustment installment and reloads the plan and policy', async ({ page }) => {
  const state = await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '100000.00' },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await page.getByTestId('billing-variance-add-adjustment').click();
  const dialog = page.getByTestId('billing-adjustment-dialog');
  const todayIso = new Date().toISOString().slice(0, 10);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'Add adjustment installment' })).toBeVisible();
  const delta = dialog.getByTestId('billing-adjustment-delta');
  await expect(delta).toHaveValue('$20,000.00');
  await expect(delta).toHaveAttribute('readonly', '');
  await expect(dialog.getByLabel('Due date')).toHaveValue(todayIso);
  await expect(dialog.getByTestId('billing-adjustment-reason')).toHaveValue('');
  await expect(dialog.getByTestId('billing-adjustment-context-panel')).toContainText(
    'The plan gains one collection installment'
  );

  await dialog.getByLabel('Reason').fill('   ');
  await dialog.getByTestId('confirm-billing-adjustment').click();
  await expect(dialog.getByTestId('billing-adjustment-error')).toContainText(
    'Enter a reason for the adjustment installment.'
  );
  expect(state.adjustmentPosts).toHaveLength(0);

  await dialog.getByLabel('Reason').fill('  Audit premium increase  ');
  await dialog.getByTestId('confirm-billing-adjustment').click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    `Adjustment installment of $20,000.00 added, due ${todayIso}.`
  );
  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');
  const newRow = page.getByTestId('installment-row-installment-2');
  await expect(newRow).toContainText('$20,000.00');
  await expect(newRow).toContainText(todayIso);
  await expect(page.getByTestId('billing-premium-variance')).toHaveCount(0);

  expect(state.adjustmentPosts).toHaveLength(1);
  expect(state.adjustmentPosts[0].body).toEqual({
    dueDate: todayIso,
    reason: 'Audit premium increase'
  });
  expect(state.adjustmentPosts[0].headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(state.adjustmentPosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.billingGets).toBe(2);
  expect(state.policyGets).toBe(2);
});

test('contains an adjustment rejection inside the dialog without reloading the plan', async ({ page }) => {
  const state = await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '100000.00' },
    installments: [installment(1)],
    adjustmentStatus: 422,
    adjustmentError: problem(
      422,
      'The due date must fall inside the policy term.',
      'INVALID_BILLING_ADJUSTMENT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId('billing-variance-add-adjustment').click();
  const dialog = page.getByTestId('billing-adjustment-dialog');
  await dialog.getByLabel('Reason').fill('Premium audit increase');
  await dialog.getByTestId('confirm-billing-adjustment').click();

  await expect(dialog.getByTestId('billing-adjustment-error')).toContainText(
    'The due date must fall inside the policy term.'
  );
  await expect(dialog).toBeVisible();
  await expect(page.locator('main > p[role="alert"]')).toHaveCount(0);
  await expect(page.getByTestId('billing-summary-total')).toHaveText('$100,000.00');
  expect(state.adjustmentPosts).toHaveLength(1);
  expect(state.billingGets).toBe(1);
  expect(state.policyGets).toBe(1);
});

test('reloads the plan and policy with guidance when the adjustment is 409', async ({ page }) => {
  const state = await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '100000.00' },
    installments: [installment(1)],
    adjustmentStatus: 409,
    adjustmentError: problem(
      409,
      'The billing plan was already adjusted by another user.',
      'BILLING_ADJUSTMENT_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId('billing-variance-add-adjustment').click();
  const dialog = page.getByTestId('billing-adjustment-dialog');
  await dialog.getByLabel('Reason').fill('Premium audit increase');
  await dialog.getByTestId('confirm-billing-adjustment').click();

  const error = dialog.getByTestId('billing-adjustment-error');
  await expect(error).toContainText('The billing plan was already adjusted by another user.');
  await expect(error).toContainText('The billing plan and policy were reloaded');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Reason')).toHaveValue('Premium audit increase');
  await expect(page.locator('main > p[role="alert"]')).toHaveCount(0);
  await expect(page.getByTestId('billing-summary-total')).toHaveText('$100,000.00');
  expect(state.adjustmentPosts).toHaveLength(1);
  await expect.poll(() => state.billingGets).toBe(2);
  await expect.poll(() => state.policyGets).toBe(2);
});

test('prefills a negative variance credit note with the excess and audit reason', async ({ page }) => {
  const state = await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '125000.50' },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await page.getByTestId('billing-variance-create-credit-note').click();
  const dialog = page.getByTestId('credit-note-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Amount')).toHaveValue('5000.50');
  await expect(dialog.getByLabel('Currency')).toHaveValue('USD');
  await expect(dialog.getByLabel('Reason')).toHaveValue(
    `Premium audit adjustment for ${POLICY.policyNumber}`
  );
  await expect(dialog.getByTestId('credit-note-variance-context')).toContainText('$5,000.50');
  await expect(dialog.getByTestId('credit-note-dialog-context')).toContainText(
    'settles a negative premium variance'
  );

  await dialog.getByRole('button', { name: 'Save draft' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(`${CREDIT_NOTE_NUMBER} saved as draft.`);
  const row = page.getByTestId(`credit-note-row-${CREDIT_NOTE_ID}`);
  await expect(row).toContainText(`Premium audit adjustment for ${POLICY.policyNumber}`);
  await expect(row.getByTestId(`issue-credit-note-${CREDIT_NOTE_ID}`)).toBeVisible();
  expect(state.creditNotePosts).toHaveLength(1);
  expect(state.creditNotePosts[0].body).toEqual({
    amount: 5000.5,
    currency: 'USD',
    reason: `Premium audit adjustment for ${POLICY.policyNumber}`
  });
});

test('contains a variance credit note 409 and reloads the ledger with guidance', async ({ page }) => {
  const state = await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '125000.50' },
    installments: [installment(1)],
    creditNoteStatus: 409,
    creditNoteError: problem(
      409,
      'A credit note for this variance already exists.',
      'CREDIT_NOTE_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId('billing-variance-create-credit-note').click();
  const dialog = page.getByTestId('credit-note-dialog');
  await dialog.getByRole('button', { name: 'Save draft' }).click();

  const error = dialog.getByTestId('credit-note-form-error');
  await expect(error).toContainText('A credit note for this variance already exists.');
  await expect(error).toContainText('ledger was reloaded');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('Amount')).toHaveValue('5000.50');
  expect(state.creditNotePosts).toHaveLength(1);
  expect(state.billingGets).toBe(1);
  await expect.poll(() => state.creditNoteGets).toBe(2);
});

test('offers no variance action when the policy premium equals the net plan premium', async ({ page }) => {
  await installMocks(page, {
    plan: { ...PLAN, totalPremiumAmount: '120000.00' },
    installments: [installment(1)]
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-premium-variance')).toHaveCount(0);
  await expect(page.getByTestId('billing-variance-add-adjustment')).toHaveCount(0);
  await expect(page.getByTestId('billing-variance-create-credit-note')).toHaveCount(0);
});
