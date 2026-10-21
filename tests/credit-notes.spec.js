import { test, expect } from '@playwright/test';
import { mockPartyDetail, mockRelated } from './support.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const POLICY_ID = 'aaaaaaaa-aaaa-7aaa-8aaa-aaaaaaaaaaaa';
const INSURED_PARTY_ID = 'bbbbbbbb-bbbb-7bbb-8bbb-bbbbbbbbbbbb';
const PLAN_ID = 'cccccccc-cccc-7ccc-8ccc-cccccccccccc';
const NOTE_ID = 'dddddddd-dddd-7ddd-8ddd-dddddddddddd';
const NOTE_ID_2 = 'eeeeeeee-eeee-7eee-8eee-eeeeeeeeeeee';
const CREATED_NOTE_ID = 'ffffffff-ffff-7fff-8fff-ffffffffffff';
const NOTE_NUMBER = 'CRN-2026-0000001';
const NOTE_NUMBER_2 = 'CRN-2026-0000002';
const CREATED_NOTE_NUMBER = 'CRN-2026-0000009';

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

function creditNote(overrides = {}) {
  return {
    id: NOTE_ID,
    tenantId: TENANT,
    policyId: POLICY_ID,
    creditNoteNumber: NOTE_NUMBER,
    amount: '25000.00',
    currency: 'USD',
    reason: 'CANCELLATION',
    status: 'DRAFT',
    issuedDate: null,
    appliedDate: null,
    originalInvoiceNumber: 'INV-2026-0000001',
    createdAt: '2026-09-01T10:00:00Z',
    ...overrides
  };
}

function summarize(rows) {
  const total = Number(PLAN.totalPremiumAmount);
  const amountFor = (status) => rows
    .filter((row) => row.status === status)
    .reduce((sum, row) => sum + Number(row.amount), 0);
  const paid = amountFor('PAID');
  const waived = amountFor('WAIVED');
  const credited = rows.reduce((sum, row) => sum + Number(row.creditedAmount || 0), 0);
  return {
    totalPremiumAmount: total.toFixed(2),
    paidAmount: paid.toFixed(2),
    creditedAmount: credited.toFixed(2),
    outstandingAmount: Math.max(total - paid - waived - credited, 0).toFixed(2),
    overdueAmount: amountFor('OVERDUE').toFixed(2),
    currency: PLAN.currency,
    installmentCount: rows.length,
    paidCount: rows.filter((row) => row.status === 'PAID').length,
    overdueCount: rows.filter((row) => row.status === 'OVERDUE').length
  };
}

function billingBody(rows, summaryOverrides = {}) {
  const summary = summarize(rows);
  Object.entries(summaryOverrides).forEach(([key, value]) => {
    if (value === undefined) delete summary[key];
    else summary[key] = value;
  });
  return { plan: PLAN, installments: rows, summary };
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
    type: `https://errors.eia-open-insurance.example/policy/${String(code || 'error').toLowerCase()}`,
    title: status === 409 ? 'Credit note conflict' : 'Credit notes unavailable',
    status,
    detail,
    code,
    category: status === 409 ? 'CONFLICT' : 'BUSINESS_RULE',
    retryable: false
  };
}

/**
 * Mocks the policy record, billing plan, and credit-note ledger. Credit-note
 * reads, creations, and status transitions share one mutable `notes` array so
 * the reload after every mutation reflects the change.
 */
async function installMocks(page, options = {}) {
  const state = {
    installments: (options.installments || [installment(1), installment(2)]).map(
      (row) => ({ ...row })
    ),
    notes: (options.notes || []).map((row) => ({ ...row })),
    billingGets: 0,
    creditNoteGets: 0,
    creditNotePosts: [],
    creditNotePatches: [],
    readStatus: options.readStatus || 200,
    readError: options.readError || null,
    summaryOverrides: options.summaryOverrides || {},
    postStatus: options.postStatus || 201,
    postError: options.postError || null,
    patchStatus: options.patchStatus || 200,
    patchError: options.patchError || null
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
          id: '99999999-9999-7999-8999-999999999999',
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
      await json(route, 200, billingBody(state.installments, state.summaryOverrides));
      return;
    }
    if (method === 'GET' && url.pathname === `/api/v1/policies/${POLICY_ID}/credit-notes`) {
      state.creditNoteGets += 1;
      if (state.readStatus >= 400) {
        await json(route, state.readStatus, state.readError || problem(
          state.readStatus,
          'The credit notes could not be read.',
          'CREDIT_NOTES_UNAVAILABLE'
        ));
        return;
      }
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
      const created = creditNote({
        id: CREATED_NOTE_ID,
        creditNoteNumber: CREATED_NOTE_NUMBER,
        amount: String(body.amount),
        currency: body.currency,
        reason: body.reason,
        status: 'DRAFT',
        issuedDate: null,
        appliedDate: null,
        originalInvoiceNumber: null,
        createdAt: '2026-10-20T12:00:00Z'
      });
      state.notes.push(created);
      await json(route, 201, created, { ETag: '"1"', 'Idempotent-Replayed': 'false' });
      return;
    }
    const statusMatch = url.pathname.match(
      new RegExp(`^/api/v1/policies/${POLICY_ID}/credit-notes/([^/]+)/status$`)
    );
    if (method === 'PATCH' && statusMatch) {
      const id = decodeURIComponent(statusMatch[1]);
      const body = request.postDataJSON();
      state.creditNotePatches.push({
        path: url.pathname,
        headers: request.headers(),
        body
      });
      if (state.patchStatus >= 400) {
        await json(route, state.patchStatus, state.patchError || problem(
          state.patchStatus,
          'The credit note was changed by another user.',
          'CREDIT_NOTE_CONFLICT'
        ));
        return;
      }
      const note = state.notes.find((row) => row.id === id);
      if (!note) {
        await json(route, 404, problem(404, 'Credit note not found.', 'CREDIT_NOTE_NOT_FOUND'));
        return;
      }
      note.status = String(body.status || '').toUpperCase();
      if (note.status === 'ISSUED') note.issuedDate = '2026-10-20';
      if (note.status === 'APPLIED') {
        note.appliedDate = '2026-10-20';
        const target = state.installments.find((row) => row.id === body.installmentId);
        if (target) {
          const credited = Number(target.creditedAmount || 0) + Number(note.amount);
          target.creditedAmount = credited.toFixed(2);
          target.outstandingAmount = Math.max(
            Number(target.amount) - credited,
            0
          ).toFixed(2);
          note.appliedInstallmentId = target.id;
          note.appliedInstallmentNumber = String(target.installmentNumber);
        }
      }
      await json(route, 200, note);
      return;
    }

    await route.fulfill({ status: 404, body: `unexpected route ${method} ${url.pathname}` });
  });

  await mockRelated(page);
  await mockPartyDetail(page);
  await page.route('**/api/v1/payments**', async (route) => {
    await json(route, 200, { items: [] });
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
  await expect(page.getByTestId('credit-notes')).toBeVisible();
}

test('creates a draft credit note with the unpaid default and policy currency', async ({ page }) => {
  const state = await installMocks(page);
  await openBillingTab(page);

  const section = page.getByTestId('credit-notes');
  await expect(page.getByTestId('credit-notes-empty')).toContainText('No credit notes yet');
  await expect(page.getByTestId('credit-notes-empty')).toContainText(
    'reduces the premium the insured owes'
  );
  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$0.00');
  await expect(page.getByTestId('credit-notes-summary-applied')).toHaveText('$0.00');
  await expect(section.getByRole('link', { name: 'Open Payment workbench' })).toHaveCount(0);
  await expect(page.getByTestId('credit-note-context')).toContainText(
    'A credit note reduces premium owed'
  );
  await expect(page.getByTestId('credit-note-context')).toContainText(
    'Applying is an accounting status'
  );
  await expect(page.getByTestId('credit-note-context')).toContainText('not a Payment');
  await expect(page.getByTestId('credit-note-context')).toContainText(
    'does not change the policy premium'
  );

  await page.getByTestId('new-credit-note').click();
  const dialog = page.getByTestId('credit-note-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: 'New credit note' })).toBeVisible();
  await expect(dialog.getByLabel('Amount')).toHaveValue('120000.00');
  await expect(dialog.getByLabel('Currency')).toHaveValue('USD');
  await expect(dialog.getByLabel('Currency')).toHaveAttribute('readonly', '');
  await expect(dialog.getByTestId('credit-note-default-context')).toContainText('$120,000.00');

  await dialog.getByLabel('Amount').fill('25000.50');
  await dialog.getByLabel('Reason').selectOption('CANCELLATION');
  await dialog.getByRole('button', { name: 'Save draft' }).click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    `${CREATED_NOTE_NUMBER} saved as draft.`
  );
  const row = page.getByTestId(`credit-note-row-${CREATED_NOTE_ID}`);
  await expect(row).toContainText(CREATED_NOTE_NUMBER);
  await expect(row).toContainText('$25,000.50');
  await expect(row).toContainText('USD');
  await expect(row).toContainText('Cancellation');
  await expect(row).toContainText('DRAFT');
  await expect(row.getByTestId(`issue-credit-note-${CREATED_NOTE_ID}`)).toBeVisible();
  await expect(row.getByTestId(`apply-credit-note-${CREATED_NOTE_ID}`)).toHaveCount(0);
  await expect(row.getByTestId(`cancel-credit-note-${CREATED_NOTE_ID}`)).toBeVisible();
  await expect(page.getByTestId('credit-notes-empty')).toHaveCount(0);
  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$0.00');

  expect(state.creditNotePosts).toHaveLength(1);
  expect(state.creditNotePosts[0].body).toEqual({
    amount: 25000.5,
    currency: 'USD',
    reason: 'CANCELLATION'
  });
  expect(state.creditNotePosts[0].headers['idempotency-key']).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  );
  expect(state.creditNotePosts[0].headers['x-eia-tenant']).toBe(TENANT);
  expect(state.creditNoteGets).toBe(2);
});

test('renders the credit note ledger after installments and summarises issued and applied totals', async ({ page }) => {
  await installMocks(page, {
    notes: [
      creditNote({ id: NOTE_ID, status: 'ISSUED', issuedDate: '2026-09-15' }),
      creditNote({
        id: NOTE_ID_2,
        creditNoteNumber: NOTE_NUMBER_2,
        amount: '5000.00',
        reason: 'ENDORSEMENT',
        status: 'APPLIED',
        issuedDate: '2026-08-01',
        appliedDate: '2026-08-15'
      })
    ]
  });
  await openBillingTab(page);

  const ordered = await page.evaluate(() => {
    const installments = document.querySelector('table[aria-label="Billing installments"]');
    const creditNotes = document.querySelector('[data-testid="credit-notes"]');
    return Boolean(
      installments
      && creditNotes
      && (installments.compareDocumentPosition(creditNotes) & Node.DOCUMENT_POSITION_FOLLOWING)
    );
  });
  expect(ordered).toBe(true);

  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$30,000.00');
  await expect(page.getByTestId('credit-notes-summary-applied')).toHaveText('$5,000.00');

  const table = page.getByRole('table', { name: 'Credit notes' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Note',
    'Amount',
    'Reason',
    'Status',
    'Issued',
    'Applied',
    'Installment',
    'Action'
  ]);
  const issuedRow = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await expect(issuedRow).toContainText('ISSUED');
  await expect(issuedRow).toContainText('2026-09-15');
  await expect(issuedRow.getByTestId(`apply-credit-note-${NOTE_ID}`)).toBeVisible();
  await expect(issuedRow.getByTestId(`issue-credit-note-${NOTE_ID}`)).toHaveCount(0);
  const appliedRow = page.getByTestId(`credit-note-row-${NOTE_ID_2}`);
  await expect(appliedRow).toContainText('Endorsement');
  await expect(appliedRow).toContainText('APPLIED');
  await expect(appliedRow).toContainText('2026-08-15');
  await expect(appliedRow.getByTestId(/^issue-credit-note-/)).toHaveCount(0);
  await expect(appliedRow.getByTestId(/^apply-credit-note-/)).toHaveCount(0);
  await expect(appliedRow.getByTestId(/^cancel-credit-note-/)).toHaveCount(0);
});

test('issues and applies a credit note through contained status transitions', async ({ page }) => {
  const state = await installMocks(page, {
    notes: [creditNote({ id: NOTE_ID })]
  });
  await openBillingTab(page);

  const row = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await page.getByTestId(`issue-credit-note-${NOTE_ID}`).click();

  await expect(page.getByRole('status')).toContainText(`${NOTE_NUMBER} issued.`);
  await expect(row).toContainText('ISSUED');
  await expect(row).toContainText('2026-10-20');
  await expect(row.getByTestId(`apply-credit-note-${NOTE_ID}`)).toBeVisible();
  await expect(row.getByTestId(`issue-credit-note-${NOTE_ID}`)).toHaveCount(0);
  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$25,000.00');
  await expect(page.getByTestId('credit-notes-summary-applied')).toHaveText('$0.00');

  await row.getByTestId(`apply-credit-note-${NOTE_ID}`).click();

  const applyDialog = page.getByTestId('credit-note-apply-dialog');
  await expect(applyDialog).toBeVisible();
  await expect(applyDialog.getByRole('heading', {
    name: `Apply credit note ${NOTE_NUMBER}`
  })).toBeVisible();
  await expect(applyDialog.getByRole('radio', { name: 'Select installment 1' })).toBeVisible();
  await expect(applyDialog.getByRole('radio', { name: 'Select installment 2' })).toBeVisible();
  const confirmApply = applyDialog.getByTestId('confirm-apply-credit-note');
  await expect(confirmApply).toBeDisabled();
  await applyDialog.getByRole('radio', { name: 'Select installment 1' }).check();
  await expect(confirmApply).toBeEnabled();
  await confirmApply.click();

  await expect(page.getByRole('status')).toContainText(
    `${NOTE_NUMBER} applied to installment 1.`
  );
  await expect(applyDialog).toHaveCount(0);
  await expect(row).toContainText('APPLIED');
  await expect(row.getByTestId(`applied-installment-${NOTE_ID}`)).toHaveText('Installment 1');
  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$25,000.00');
  await expect(page.getByTestId('credit-notes-summary-applied')).toHaveText('$25,000.00');
  await expect(page.getByTestId('billing-summary-credited')).toHaveText('$25,000.00');
  await expect(page.getByTestId('billing-summary-outstanding')).toHaveText('$95,000.00');
  await expect(page.getByTestId('credited-installment-1')).toHaveText('$25,000.00');
  await expect(page.getByTestId('outstanding-installment-1')).toHaveText('$5,000.00');

  expect(state.creditNotePatches).toHaveLength(2);
  expect(state.creditNotePatches[0]).toMatchObject({
    path: `/api/v1/policies/${POLICY_ID}/credit-notes/${NOTE_ID}/status`,
    body: { status: 'ISSUED' }
  });
  expect(state.creditNotePatches[1]).toMatchObject({
    path: `/api/v1/policies/${POLICY_ID}/credit-notes/${NOTE_ID}/status`,
    body: { status: 'APPLIED', installmentId: 'installment-1' }
  });
  expect(state.creditNotePatches[0].headers['x-eia-tenant']).toBe(TENANT);
});

test('shows credited and net outstanding in the billing summary and installments', async ({ page }) => {
  await installMocks(page, {
    installments: [
      installment(1, { creditedAmount: '5000.00', outstandingAmount: '25000.00' }),
      installment(2, { creditedAmount: '10000.00' }),
      installment(3),
      installment(4, {
        status: 'PAID',
        paidDate: '2026-03-15',
        paymentId: 'ffffffff-ffff-7fff-8fff-ffffffffffff'
      })
    ],
    // The summary omits the credited total and still carries the gross
    // outstanding. The tab derives credited 15,000 from the rows and shows the
    // net outstanding 120,000 - 30,000 paid - 15,000 credited = 75,000.
    summaryOverrides: { creditedAmount: undefined, outstandingAmount: '90000.00' }
  });
  await openBillingTab(page);

  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');
  await expect(page.getByTestId('billing-summary-paid')).toHaveText('$30,000.00');
  await expect(page.getByTestId('billing-summary-credited')).toHaveText('$15,000.00');
  await expect(page.getByTestId('billing-summary-outstanding')).toHaveText('$75,000.00');
  await expect(page.getByTestId('billing-summary-outstanding').locator('..'))
    .toContainText('net of credits');

  const table = page.getByRole('table', { name: 'Billing installments' });
  await expect(table.getByRole('columnheader')).toHaveText([
    'Number',
    'Due date',
    'Amount',
    'Credited',
    'Outstanding',
    'Status',
    'Paid date / payment ID',
    'Action'
  ]);
  await expect(page.getByTestId('credited-installment-1')).toHaveText('$5,000.00');
  await expect(page.getByTestId('outstanding-installment-1')).toHaveText('$25,000.00');
  await expect(page.getByTestId('credited-installment-2')).toHaveText('$10,000.00');
  await expect(page.getByTestId('outstanding-installment-2')).toHaveText('$20,000.00');
  await expect(page.getByTestId('credited-installment-3')).toHaveText('$0.00');
  await expect(page.getByTestId('outstanding-installment-3')).toHaveText('$30,000.00');
});

function applyInstallments() {
  return [
    installment(1, { status: 'DUE', amount: '30000.00' }),
    installment(2, {
      status: 'DUE',
      amount: '30000.00',
      creditedAmount: '10000.00',
      outstandingAmount: '20000.00'
    }),
    installment(3, {
      status: 'PAID',
      paidDate: '2026-03-15',
      paymentId: 'ffffffff-ffff-7fff-8fff-ffffffffffff'
    }),
    installment(4, {
      status: 'OVERDUE',
      amount: '30000.00',
      creditedAmount: '5000.00'
    })
  ];
}

function issuedNote(overrides = {}) {
  return creditNote({
    id: NOTE_ID,
    status: 'ISSUED',
    issuedDate: '2026-10-01',
    ...overrides
  });
}

test('apply picker offers only open installments whose outstanding covers the note', async ({ page }) => {
  await installMocks(page, {
    installments: applyInstallments(),
    notes: [issuedNote()]
  });
  await openBillingTab(page);

  await page.getByTestId(`apply-credit-note-${NOTE_ID}`).click();
  const dialog = page.getByTestId('credit-note-apply-dialog');

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('credit-note-apply-context')).toContainText('$25,000.00');
  await expect(dialog.getByRole('table', { name: 'Eligible installments' })).toBeVisible();
  await expect(dialog.getByRole('radio')).toHaveCount(2);
  await expect(dialog.getByRole('radio', { name: 'Select installment 1' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Select installment 4' })).toBeVisible();
  await expect(dialog.getByRole('radio', { name: 'Select installment 2' })).toHaveCount(0);
  await expect(dialog.getByTestId('apply-installment-row-installment-2')).toHaveCount(0);
  await expect(dialog.getByTestId('apply-installment-row-installment-3')).toHaveCount(0);
  await expect(dialog.getByTestId('apply-credited-installment-4')).toContainText(
    'credited $5,000.00'
  );
  await expect(dialog.getByTestId('apply-installment-row-installment-4')).toContainText(
    '$25,000.00'
  );

  const confirmApply = dialog.getByTestId('confirm-apply-credit-note');
  await expect(confirmApply).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Select installment 1' }).check();
  await expect(confirmApply).toBeEnabled();
  await expect(dialog.getByTestId('apply-installment-row-installment-1')).toHaveClass(/selected/);
});

test('apply modal explains when no open installment can absorb the note', async ({ page }) => {
  await installMocks(page, {
    installments: [
      installment(1, { amount: '10000.00' }),
      installment(2, {
        amount: '10000.00',
        status: 'PAID',
        paidDate: '2026-03-15',
        paymentId: 'ffffffff-ffff-7fff-8fff-ffffffffffff'
      })
    ],
    notes: [issuedNote({ amount: '50000.00' })]
  });
  await openBillingTab(page);

  await page.getByTestId(`apply-credit-note-${NOTE_ID}`).click();
  const dialog = page.getByTestId('credit-note-apply-dialog');
  await expect(dialog.getByTestId('credit-note-apply-empty')).toContainText(
    'No eligible installment'
  );
  await expect(dialog.getByTestId('confirm-apply-credit-note')).toHaveCount(0);
  await expect(dialog.getByRole('table', { name: 'Eligible installments' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toHaveCount(0);
});

test('applies a partial credit note to the selected installment with its id and refreshes balances', async ({ page }) => {
  const state = await installMocks(page, {
    installments: applyInstallments(),
    notes: [issuedNote()]
  });
  await openBillingTab(page);

  await page.getByTestId(`apply-credit-note-${NOTE_ID}`).click();
  const dialog = page.getByTestId('credit-note-apply-dialog');
  await dialog.getByRole('radio', { name: 'Select installment 1' }).check();
  await dialog.getByTestId('confirm-apply-credit-note').click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    `${NOTE_NUMBER} applied to installment 1.`
  );
  const row = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await expect(row).toContainText('APPLIED');
  await expect(row.getByTestId(`applied-installment-${NOTE_ID}`)).toHaveText('Installment 1');

  expect(state.creditNotePatches).toHaveLength(1);
  expect(state.creditNotePatches[0]).toMatchObject({
    path: `/api/v1/policies/${POLICY_ID}/credit-notes/${NOTE_ID}/status`,
    body: { status: 'APPLIED', installmentId: 'installment-1' }
  });
  expect(state.billingGets).toBe(2);
  expect(state.creditNoteGets).toBe(2);
  await expect(page.getByTestId('billing-summary-credited')).toHaveText('$40,000.00');
  await expect(page.getByTestId('billing-summary-outstanding')).toHaveText('$50,000.00');
  await expect(page.getByTestId('credited-installment-1')).toHaveText('$25,000.00');
  await expect(page.getByTestId('outstanding-installment-1')).toHaveText('$5,000.00');
});

test('applies a credit note that exactly equals the installment outstanding', async ({ page }) => {
  const state = await installMocks(page, {
    installments: applyInstallments(),
    notes: [issuedNote()]
  });
  await openBillingTab(page);

  await page.getByTestId(`apply-credit-note-${NOTE_ID}`).click();
  const dialog = page.getByTestId('credit-note-apply-dialog');
  await dialog.getByRole('radio', { name: 'Select installment 4' }).check();
  await dialog.getByTestId('confirm-apply-credit-note').click();

  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText(
    `${NOTE_NUMBER} applied to installment 4.`
  );
  await expect(
    page.getByTestId(`credit-note-row-${NOTE_ID}`).getByTestId(`applied-installment-${NOTE_ID}`)
  ).toHaveText('Installment 4');
  expect(state.creditNotePatches).toHaveLength(1);
  expect(state.creditNotePatches[0].body).toEqual({
    status: 'APPLIED',
    installmentId: 'installment-4'
  });
  await expect(page.getByTestId('billing-summary-credited')).toHaveText('$40,000.00');
  await expect(page.getByTestId('billing-summary-outstanding')).toHaveText('$50,000.00');
  await expect(page.getByTestId('credited-installment-4')).toHaveText('$30,000.00');
  await expect(page.getByTestId('outstanding-installment-4')).toHaveText('$0.00');
});

test('keeps the apply modal open and re-reads on a 409 conflict', async ({ page }) => {
  const state = await installMocks(page, {
    installments: applyInstallments(),
    notes: [issuedNote()],
    patchStatus: 409,
    patchError: problem(
      409,
      'Installment 1 was credited by another user while this note was open.',
      'CREDIT_NOTE_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId(`apply-credit-note-${NOTE_ID}`).click();
  const dialog = page.getByTestId('credit-note-apply-dialog');
  await dialog.getByRole('radio', { name: 'Select installment 1' }).check();
  await dialog.getByTestId('confirm-apply-credit-note').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('alert')).toContainText(
    'Installment 1 was credited by another user while this note was open.'
  );
  await expect(dialog.getByTestId('confirm-apply-credit-note')).toBeEnabled();
  const row = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await expect(row).toContainText('ISSUED');
  await expect(row.getByTestId(`applied-installment-${NOTE_ID}`)).toHaveCount(0);
  expect(state.creditNotePatches).toHaveLength(1);
  expect(state.creditNotePatches[0].body).toEqual({
    status: 'APPLIED',
    installmentId: 'installment-1'
  });
  expect(state.creditNoteGets).toBe(2);
  expect(state.billingGets).toBe(2);
});

test('contains a 400 apply rejection in the modal without changing the note', async ({ page }) => {
  const state = await installMocks(page, {
    installments: applyInstallments(),
    notes: [issuedNote()],
    patchStatus: 400,
    patchError: problem(
      400,
      'The selected installment no longer has enough outstanding for this credit note.',
      'CREDIT_NOTE_INVALID_INSTALLMENT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId(`apply-credit-note-${NOTE_ID}`).click();
  const dialog = page.getByTestId('credit-note-apply-dialog');
  await dialog.getByRole('radio', { name: 'Select installment 1' }).check();
  await dialog.getByTestId('confirm-apply-credit-note').click();

  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('credit-note-apply-error')).toContainText(
    'The selected installment no longer has enough outstanding for this credit note.'
  );
  await expect(dialog.getByRole('radio', { name: 'Select installment 1' })).toBeChecked();
  const row = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await expect(row).toContainText('ISSUED');
  await expect(row).toContainText('2026-10-01');
  expect(state.creditNotePatches).toHaveLength(1);
  expect(state.billingGets).toBe(2);
});

test('cancels a draft and an issued note only after confirmation', async ({ page }) => {
  const state = await installMocks(page, {
    notes: [
      creditNote({ id: NOTE_ID, amount: '1000.00' }),
      creditNote({
        id: NOTE_ID_2,
        creditNoteNumber: NOTE_NUMBER_2,
        amount: '5000.00',
        status: 'ISSUED',
        issuedDate: '2026-09-15'
      })
    ]
  });
  await openBillingTab(page);

  const draftRow = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await page.getByTestId(`cancel-credit-note-${NOTE_ID}`).click();
  await expect(draftRow.getByRole('group', {
    name: `Confirm cancel ${NOTE_NUMBER}`
  })).toBeVisible();
  await expect(draftRow).toContainText('Cancel this credit note?');
  await expect(draftRow.getByTestId(`cancel-credit-note-${NOTE_ID}`)).toHaveCount(0);

  await draftRow.getByTestId(`keep-credit-note-${NOTE_ID}`).click();
  await expect(draftRow.getByTestId(`cancel-credit-note-${NOTE_ID}`)).toBeVisible();
  expect(state.creditNotePatches).toHaveLength(0);

  await draftRow.getByTestId(`cancel-credit-note-${NOTE_ID}`).click();
  await draftRow.getByTestId(`confirm-cancel-credit-note-${NOTE_ID}`).click();

  await expect(page.getByRole('status')).toContainText(`${NOTE_NUMBER} cancelled.`);
  await expect(draftRow).toContainText('CANCELLED');
  await expect(draftRow.getByTestId(/^issue-credit-note-/)).toHaveCount(0);
  await expect(draftRow.getByTestId(/^cancel-credit-note-/)).toHaveCount(0);
  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$5,000.00');

  const issuedRow = page.getByTestId(`credit-note-row-${NOTE_ID_2}`);
  await issuedRow.getByTestId(`cancel-credit-note-${NOTE_ID_2}`).click();
  await issuedRow.getByTestId(`confirm-cancel-credit-note-${NOTE_ID_2}`).click();

  await expect(page.getByRole('status')).toContainText(`${NOTE_NUMBER_2} cancelled.`);
  await expect(issuedRow).toContainText('CANCELLED');
  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$0.00');
  await expect(page.getByTestId('credit-notes-summary-applied')).toHaveText('$0.00');

  expect(state.creditNotePatches).toHaveLength(2);
  expect(state.creditNotePatches[0].body).toEqual({ status: 'CANCELLED' });
  expect(state.creditNotePatches[1].body).toEqual({ status: 'CANCELLED' });
});

test('shows an empty credit note ledger without affecting the plan', async ({ page }) => {
  await installMocks(page);
  await openBillingTab(page);

  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');
  await expect(page.getByTestId('credit-notes-empty')).toContainText('No credit notes yet');
  await expect(page.getByRole('table', { name: 'Credit notes' })).toHaveCount(0);
  await expect(page.getByTestId('credit-notes-summary-issued')).toHaveText('$0.00');
  await expect(page.getByTestId('credit-notes-summary-applied')).toHaveText('$0.00');
  await expect(page.getByTestId('new-credit-note')).toBeVisible();
  await expect(page.getByTestId('credit-notes-loading')).toHaveCount(0);
});

test('contains a credit note read failure and retries inside the section', async ({ page }) => {
  const state = await installMocks(page, { readStatus: 503 });
  await openBillingTab(page);

  const errorCard = page.getByTestId('credit-notes-error');
  await expect(errorCard.getByRole('alert')).toContainText(
    'Credit notes are temporarily unavailable.'
  );
  await expect(page.getByTestId('credit-notes-empty')).toHaveCount(0);
  await expect(page.getByTestId('billing-summary-total')).toHaveText('$120,000.00');

  state.readStatus = 200;
  await errorCard.getByRole('button', { name: 'Retry' }).click();

  await expect(page.getByTestId('credit-notes-error')).toHaveCount(0);
  await expect(page.getByTestId('credit-notes-empty')).toBeVisible();
  expect(state.creditNoteGets).toBe(2);
});

test('keeps the create dialog open when the credit note POST is rejected with 409', async ({ page }) => {
  const state = await installMocks(page, {
    postStatus: 409,
    postError: problem(
      409,
      'A credit note with this amount and reason already exists.',
      'CREDIT_NOTE_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId('new-credit-note').click();
  const dialog = page.getByTestId('credit-note-dialog');
  await dialog.getByLabel('Reason').selectOption('REFUND');
  await dialog.getByRole('button', { name: 'Save draft' }).click();

  await expect(dialog.getByTestId('credit-note-form-error')).toContainText(
    'A credit note with this amount and reason already exists.'
  );
  await expect(dialog).toBeVisible();
  await expect(page.getByRole('table', { name: 'Credit notes' })).toHaveCount(0);
  expect(state.creditNotePosts).toHaveLength(1);
  expect(state.creditNotePosts[0].body.reason).toBe('REFUND');
});

test('keeps the current credit note status when a status PATCH is rejected with 409', async ({ page }) => {
  const state = await installMocks(page, {
    notes: [creditNote({ id: NOTE_ID })],
    patchStatus: 409,
    patchError: problem(
      409,
      'Credit note CRN-2026-0000001 was already issued by another user.',
      'CREDIT_NOTE_CONFLICT'
    )
  });
  await openBillingTab(page);

  await page.getByTestId(`issue-credit-note-${NOTE_ID}`).click();

  const section = page.getByTestId('credit-notes');
  await expect(section.getByRole('alert')).toContainText(
    'Credit note CRN-2026-0000001 was already issued by another user.'
  );
  const row = page.getByTestId(`credit-note-row-${NOTE_ID}`);
  await expect(row).toContainText('DRAFT');
  await expect(row.getByTestId(`issue-credit-note-${NOTE_ID}`)).toBeVisible();
  expect(state.creditNotePatches).toHaveLength(1);
  expect(state.creditNotePatches[0].body).toEqual({ status: 'ISSUED' });
  expect(state.creditNoteGets).toBe(2);
  expect(state.billingGets).toBe(1);
});
