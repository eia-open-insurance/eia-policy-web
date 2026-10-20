import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const INSURED_PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const PAYMENT_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';

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

function summarize(rows, planRow = PLAN) {
  const total = Number(planRow.totalPremiumAmount);
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
  const state = {
    plan: options.plan ? { ...options.plan } : null,
    installments: (options.installments || []).map((row) => ({ ...row })),
    planPosts: [],
    patches: [],
    billingGets: 0,
    postStatus: options.postStatus || 201,
    postError: options.postError || null,
    patchStatus: options.patchStatus || 200,
    patchError: options.patchError || null,
    getStatus: options.getStatus || 200
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
      await json(route, 200, POLICY, { ETag: '"4"' });
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
  await expect(paidRow.getByText('Create payment')).toHaveCount(0);

  const waivedRow = page.getByTestId('installment-row-installment-4');
  await expect(waivedRow.getByText('WAIVED', { exact: true })).toBeVisible();
  await expect(waivedRow.getByText('Create payment')).toHaveCount(0);

  await expect(page.getByTestId('create-payment-installment-1')).toBeVisible();
  await expect(page.getByTestId('create-payment-installment-2')).toBeVisible();
  await expect(page.getByTestId(/^create-payment-/)).toHaveCount(2);
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
    if (request.url().includes('/api/v1/payments')) {
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
