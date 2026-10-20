/**
 * Billing plan helpers for the Policy record.
 *
 * Policy owns the premium collection schedule. Payment owns disbursement and
 * approval, so this module can build a hand-off URL but never posts a payment.
 */

export const BILLING_FREQUENCIES = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'SEMI_ANNUAL', label: 'Semi-annual' },
  { value: 'ANNUAL', label: 'Annual' }
];

const FREQUENCY_VALUES = BILLING_FREQUENCIES.map((entry) => entry.value);

const FREQUENCY_LABELS = {
  MONTHLY: 'Monthly',
  QUARTERLY: 'Quarterly',
  SEMI_ANNUAL: 'Semi-annual',
  ANNUAL: 'Annual'
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function billingFrequencyLabel(value) {
  const normalized = String(value || '').toUpperCase();
  if (FREQUENCY_LABELS[normalized]) return FREQUENCY_LABELS[normalized];
  return normalized ? normalized.replace(/_/g, ' ') : '—';
}

export function defaultBillingForm(policy) {
  return {
    installmentCount: '4',
    frequency: 'QUARTERLY',
    firstDueDate: policy?.effectiveDate || todayIso()
  };
}

/** The plan command takes only the schedule; the domain derives premium/currency from the policy. */
export function billingPlanPayload(form) {
  return {
    installmentCount: Number(form.installmentCount),
    frequency: String(form.frequency || '').toUpperCase(),
    firstDueDate: form.firstDueDate
  };
}

export function validateBillingForm(form) {
  const count = Number(form.installmentCount);
  if (!Number.isInteger(count) || count < 1 || count > 24) {
    return 'Installment count must be a whole number from 1 to 24.';
  }
  if (!FREQUENCY_VALUES.includes(String(form.frequency || '').toUpperCase())) {
    return 'Select a billing frequency.';
  }
  if (!form.firstDueDate) return 'Choose the first due date.';
  return '';
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function dateOnly(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}

function decimalString(value) {
  const parsed = numeric(value);
  return parsed === null ? null : parsed.toFixed(2);
}

function amountForStatus(rows, status) {
  return rows.reduce(
    (total, row) => (row.status === status ? total + (numeric(row.amount) || 0) : total),
    0
  );
}

function normalizeInstallment(row, index, fallbackCurrency) {
  const number = firstDefined(row.installmentNumber, row.installmentNo, row.number, index + 1);
  const installmentNumber = Number(number);
  const amount = firstDefined(
    row.amount,
    row.installmentAmount,
    row.dueAmount,
    row.expectedAmount
  );
  return {
    id: String(row.id || row.installmentId || `installment-${number}`),
    installmentNumber: Number.isFinite(installmentNumber) ? installmentNumber : index + 1,
    dueDate: dateOnly(row.dueDate || row.dueOn || ''),
    amount: amount === undefined ? null : amount,
    currency: row.currency || fallbackCurrency || '',
    status: String(row.status || 'DUE').toUpperCase(),
    paidDate: dateOnly(row.paidDate || row.paidOn || row.paymentDate || row.paidAt || ''),
    paymentId: row.paymentId || '',
    paymentNumber: row.paymentNumber || ''
  };
}

/**
 * Normalizes the billing read. The Billing API is expected to return
 * `{plan, installments, summary}`; the flat plan shape and a wrapped
 * `{billing: …}` body are tolerated so a rollout cannot break the tab.
 * Summary fields fall back to the policy premium and the installment rows,
 * but the server value always wins when present.
 */
export function normalizeBilling(body, policy) {
  const envelope = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const container = envelope.billing
    && typeof envelope.billing === 'object'
    && !Array.isArray(envelope.billing)
    ? { ...envelope, ...envelope.billing, summary: envelope.summary || envelope.billing.summary }
    : envelope;

  const flatPlan = container.planNumber != null
    || container.installmentCount != null
    || container.frequency != null
    || container.firstDueDate != null
    || Array.isArray(container.installments)
    || Array.isArray(container.installments?.items);
  const rawPlan = container.plan !== undefined
    ? container.plan
    : container.billingPlan !== undefined
      ? container.billingPlan
      : (flatPlan ? container : null);
  const plan = rawPlan && typeof rawPlan === 'object' && !Array.isArray(rawPlan)
    ? { ...rawPlan }
    : null;

  if (plan) {
    plan.id = plan.id || '';
    plan.planNumber = plan.planNumber || plan.number || '';
    plan.installmentCount = firstDefined(
      plan.installmentCount,
      plan.installmentsCount,
      plan.numberOfInstallments
    );
    plan.frequency = plan.frequency || plan.billingFrequency || '';
    plan.firstDueDate = dateOnly(plan.firstDueDate || plan.firstInstallmentDueDate || '');
    plan.totalPremiumAmount = firstDefined(
      plan.totalPremiumAmount,
      plan.totalPremium,
      plan.totalAmount
    );
    plan.currency = plan.currency || policy?.premiumCurrency || '';
    plan.status = plan.status || '';
  }

  const rawRows = Array.isArray(container.installments)
    ? container.installments
    : Array.isArray(container.installments?.items)
      ? container.installments.items
      : Array.isArray(plan?.installments)
        ? plan.installments
        : Array.isArray(plan?.installments?.items)
          ? plan.installments.items
          : Array.isArray(container.items)
            ? container.items
            : [];
  const currency = firstDefined(plan?.currency, container.currency, policy?.premiumCurrency) || '';
  const installments = rawRows
    .filter((row) => row && typeof row === 'object')
    .map((row, index) => normalizeInstallment(row, index, currency))
    .sort((left, right) => left.installmentNumber - right.installmentNumber);

  const summaryBody = container.summary && typeof container.summary === 'object'
    ? container.summary
    : plan?.summary && typeof plan.summary === 'object'
      ? plan.summary
      : {};

  const rowTotal = installments.reduce((total, row) => total + (numeric(row.amount) || 0), 0);
  const total = firstDefined(
    summaryBody.totalPremiumAmount,
    summaryBody.totalPremium,
    summaryBody.totalAmount,
    summaryBody.total,
    plan?.totalPremiumAmount,
    installments.length ? rowTotal : policy?.premiumAmount
  );
  const paid = firstDefined(
    summaryBody.paidAmount,
    summaryBody.totalPaidAmount,
    summaryBody.totalPaid,
    summaryBody.paid
  );
  const waived = firstDefined(
    summaryBody.waivedAmount,
    summaryBody.totalWaivedAmount,
    summaryBody.totalWaived,
    summaryBody.waived
  );
  const outstanding = firstDefined(
    summaryBody.outstandingAmount,
    summaryBody.totalOutstandingAmount,
    summaryBody.totalOutstanding,
    summaryBody.outstanding
  );
  const overdue = firstDefined(
    summaryBody.overdueAmount,
    summaryBody.totalOverdueAmount,
    summaryBody.totalOverdue,
    summaryBody.overdue
  );

  const totalNumber = numeric(total);
  const paidNumber = numeric(paid) ?? amountForStatus(installments, 'PAID');
  const waivedNumber = numeric(waived) ?? amountForStatus(installments, 'WAIVED');
  const computedOutstanding = totalNumber === null
    ? null
    : Math.max(totalNumber - paidNumber - waivedNumber, 0);

  return {
    plan,
    installments,
    summary: {
      currency: firstDefined(summaryBody.currency, plan?.currency, policy?.premiumCurrency) || '',
      totalPremiumAmount: decimalString(total),
      paidAmount: decimalString(paidNumber),
      outstandingAmount: decimalString(
        outstanding === undefined || outstanding === null ? computedOutstanding : outstanding
      ),
      overdueAmount: decimalString(
        overdue === undefined || overdue === null
          ? amountForStatus(installments, 'OVERDUE')
          : overdue
      ),
      installmentCount: firstDefined(
        summaryBody.installmentCount,
        plan?.installmentCount,
        installments.length
      ) ?? 0,
      paidCount: firstDefined(summaryBody.paidCount)
        ?? installments.filter((row) => row.status === 'PAID').length,
      overdueCount: firstDefined(summaryBody.overdueCount)
        ?? installments.filter((row) => row.status === 'OVERDUE').length
    }
  };
}

export function emptyBillingState() {
  return { plan: null, installments: [], summary: null, loading: false, error: '' };
}

export function billingStatusTone(status) {
  switch (String(status || '').toUpperCase()) {
    case 'PAID':
      return 'green';
    case 'WAIVED':
      return 'blue';
    case 'OVERDUE':
      return 'red';
    case 'DUE':
      return 'amber';
    default:
      return 'blue';
  }
}

export function isOverdue(status) {
  return String(status || '').toUpperCase() === 'OVERDUE';
}

export function canManageInstallment(status) {
  const normalized = String(status || '').toUpperCase();
  return normalized === 'DUE' || normalized === 'OVERDUE';
}

export function canCreatePayment(status) {
  return canManageInstallment(status);
}

/**
 * Cross-remote hand-off. Policy does not create the payment: the Payment
 * workbench reads these params, pre-fills the create form, and saves it.
 */
export function billingPaymentHref(policy, installment) {
  if (!policy?.id || !installment) return '';
  const reference = `${policy.policyNumber || ''} installment ${installment.installmentNumber}`.trim();
  const params = new URLSearchParams();
  params.set('new', '1');
  params.set('sourceType', 'POLICY');
  params.set('sourceId', policy.id);
  params.set('sourceReference', reference);
  params.set('amount', installment.amount == null ? '' : String(installment.amount));
  params.set('currency', installment.currency || policy.premiumCurrency || 'USD');
  if (policy.insuredPartyId) params.set('payeePartyId', policy.insuredPartyId);
  return `/payment?${params.toString()}`;
}
