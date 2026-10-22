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
  const amountNumber = numeric(amount);
  // A credit note reduces the receivable, never the scheduled installment amount.
  // The server may send either the credited total, the net outstanding, or both;
  // the missing side is derived so a partially rolled-out read still renders.
  const rawCredited = firstDefined(
    row.creditedAmount,
    row.creditAmount,
    row.credited,
    row.totalCreditedAmount,
    row.creditNoteAmount
  );
  const rawOutstanding = firstDefined(
    row.outstandingAmount,
    row.netAmount,
    row.balanceAmount,
    row.remainingAmount
  );
  const explicitCredited = numeric(rawCredited);
  const explicitOutstanding = numeric(rawOutstanding);
  const creditedAmount = explicitCredited !== null
    ? Math.max(explicitCredited, 0)
    : explicitOutstanding !== null && amountNumber !== null
      ? Math.max(amountNumber - explicitOutstanding, 0)
      : 0;
  const outstandingAmount = explicitOutstanding !== null
    ? Math.max(explicitOutstanding, 0)
    : amountNumber === null
      ? null
      : Math.max(amountNumber - creditedAmount, 0);
  return {
    id: String(row.id || row.installmentId || `installment-${number}`),
    installmentNumber: Number.isFinite(installmentNumber) ? installmentNumber : index + 1,
    dueDate: dateOnly(row.dueDate || row.dueOn || ''),
    amount: amount === undefined ? null : amount,
    creditedAmount,
    outstandingAmount,
    hasCreditFields: rawCredited !== undefined || rawOutstanding !== undefined,
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
  const credited = firstDefined(
    summaryBody.creditedAmount,
    summaryBody.totalCreditedAmount,
    summaryBody.creditedTotalAmount,
    summaryBody.creditedTotal,
    summaryBody.totalCredited,
    summaryBody.credited
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
  const outstandingNumber = numeric(outstanding);
  const rowCreditedTotal = installments.reduce(
    (sum, row) => sum + (numeric(row.creditedAmount) || 0),
    0
  );
  // When the server sends the net outstanding but omits the credited total, the
  // difference against premium less paid/waived is the credited amount. The
  // summary table always shows a credited figure, never a blank metric.
  const creditedNumber = numeric(credited) ?? (
    rowCreditedTotal > 0
      ? rowCreditedTotal
      : outstandingNumber !== null && totalNumber !== null
        ? Math.max(totalNumber - paidNumber - waivedNumber - outstandingNumber, 0)
        : 0
  );
  const computedOutstanding = totalNumber === null
    ? null
    : Math.max(totalNumber - paidNumber - waivedNumber - creditedNumber, 0);
  // A summary may still carry the gross scheduled outstanding while adding the
  // credited total. Outstanding is always the net receivable, so clamp the
  // server value to premium less paid/waived/credited when credits exist.
  const outstandingAmount = creditedNumber > 0 && computedOutstanding !== null
    ? outstandingNumber === null
      ? computedOutstanding
      : Math.min(outstandingNumber, computedOutstanding)
    : outstandingNumber === null
      ? computedOutstanding
      : outstandingNumber;

  return {
    plan,
    installments,
    summary: {
      currency: firstDefined(summaryBody.currency, plan?.currency, policy?.premiumCurrency) || '',
      totalPremiumAmount: decimalString(total),
      paidAmount: decimalString(paidNumber),
      creditedAmount: decimalString(creditedNumber),
      outstandingAmount: decimalString(outstandingAmount),
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

/**
 * Parses a decimal money value to integer cents without going through a float.
 * Billing stores premium totals with four decimal places, and `Number` rounding
 * would make a sub-cent remainder look like a real variance. Anything that is
 * not a finite amount is unknown, which callers treat as "nothing to compare".
 */
export function amountToCents(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  const text = String(value).trim().replace(/,/g, '');
  if (!text) return null;
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    const parsed = Number(text);
    return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
  }
  const sign = match[1] === '-' ? -1 : 1;
  const fraction = match[3] || '';
  const cents = Number(match[2]) * 100 + Number(fraction.slice(0, 2).padEnd(2, '0'));
  const roundUp = Number(fraction.slice(2, 3) || 0) >= 5;
  return sign * (cents + (roundUp ? 1 : 0));
}

/**
 * Compares the selected policy's written premium with the billing plan's
 * scheduled total. Both sides must be present; a missing amount is not a
 * variance, it is an unanswerable comparison. Amounts are compared at cent
 * precision so a decimal-column remainder never raises a false warning. The
 * result is a display-ready difference, not a command: a premium audit or
 * endorsement never rewrites the collection schedule.
 */
export function billingPremiumVariance(policy, plan) {
  const policyCents = amountToCents(policy?.premiumAmount);
  const planCents = amountToCents(plan?.totalPremiumAmount);
  if (policyCents === null || planCents === null) return null;
  const deltaCents = policyCents - planCents;
  return {
    policyCents,
    planCents,
    deltaCents,
    differenceCents: Math.abs(deltaCents),
    differs: deltaCents !== 0,
    direction: deltaCents === 0 ? 'EQUAL' : deltaCents > 0 ? 'POLICY_HIGHER' : 'PLAN_HIGHER'
  };
}

/**
 * The credited/outstanding columns appear only when the billing read carries
 * those fields. Older servers keep the original six-column table.
 */
export function billingHasCreditFields(installments) {
  return (Array.isArray(installments) ? installments : []).some(
    (row) => row?.hasCreditFields || (numeric(row?.creditedAmount) || 0) > 0
  );
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

/**
 * Existing payments already linked to the policy source. Policy reads this
 * list so an operator can attach a payment that exists; it never creates one
 * and never changes the Payment record.
 */
export function policyPaymentsEndpoint(policyId) {
  if (!policyId) return '';
  const params = new URLSearchParams();
  params.set('sourceType', 'POLICY');
  params.set('sourceId', policyId);
  return `/api/v1/payments?${params.toString()}`;
}

function paymentPayee(row) {
  const direct = firstDefined(
    row.payeeName,
    row.payeeDisplayName,
    row.payeePartyName,
    row.payeeLabel
  );
  if (direct !== undefined) return String(direct);
  const payee = row.payee;
  if (typeof payee === 'string' && payee) return payee;
  if (payee && typeof payee === 'object') {
    const nested = firstDefined(
      payee.displayName,
      payee.name,
      payee.label,
      payee.partyNumber,
      payee.id
    );
    if (nested !== undefined) return String(nested);
  }
  return row.payeePartyId === undefined || row.payeePartyId === null
    ? ''
    : String(row.payeePartyId);
}

function normalizePayment(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = String(row.id || row.paymentId || '');
  if (!id) return null;
  const number = firstDefined(
    row.paymentNumber,
    row.number,
    row.paymentReference,
    row.reference,
    id
  );
  const amount = firstDefined(row.amount, row.paymentAmount, row.instructedAmount);
  return {
    id,
    paymentNumber: number === undefined ? id : String(number),
    status: String(row.status || '').toUpperCase(),
    amount: amount === undefined ? null : amount,
    currency: String(firstDefined(row.currency, row.paymentCurrency, '') || '').toUpperCase(),
    createdDate: dateOnly(firstDefined(
      row.createdAt,
      row.createdOn,
      row.created,
      row.creationDate,
      ''
    )),
    payee: paymentPayee(row)
  };
}

/**
 * Tolerant read of GET /api/v1/payments: a bare array or an `{items}` envelope
 * during rollout. Rows without an id cannot be linked, so they are dropped
 * instead of rendered as unselectable noise.
 */
export function normalizePolicyPayments(body) {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : [];
  return rows
    .map((row) => normalizePayment(row))
    .filter((row) => row !== null);
}

/** GET /api/v1/payments/{id}: the Payment owns its lifecycle status. */
export function paymentDetailEndpoint(paymentId) {
  if (!paymentId) return '';
  return `/api/v1/payments/${encodeURIComponent(paymentId)}`;
}

/** Tolerant read of a single Payment; a direct or `{payment}` body is accepted. */
export function normalizePaymentDetail(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const candidate = body.payment && typeof body.payment === 'object'
    && !Array.isArray(body.payment)
    ? body.payment
    : body.item && typeof body.item === 'object' && !Array.isArray(body.item)
      ? body.item
      : body;
  return normalizePayment(candidate);
}

/** A linked Payment is read-only context; its record lives in Payment. */
export function paymentRecordHref(paymentId) {
  if (!paymentId) return '/payment';
  return `/payment?record=${encodeURIComponent(paymentId)}`;
}

/**
 * A linked payment that has left the collected state is evidence for review,
 * not a command to rewrite the installment. Only Payment terminal statuses that
 * invalidate the collection link are flagged; approval/settlement states are
 * not a collection failure.
 */
export const PAYMENT_REVIEW_STATUSES = ['REVERSED', 'RETURNED', 'VOID', 'CANCELLED', 'FAILED'];

export function paymentStatusNeedsReview(status) {
  return PAYMENT_REVIEW_STATUSES.includes(String(status || '').toUpperCase());
}

export function paymentReviewWarning(status) {
  const normalized = String(status || '').toUpperCase();
  return normalized ? `Payment ${normalized} — installment may need review` : '';
}

/** Counts installments, not payments, whose linked payment is no longer PAID. */
export function countInstallmentsNeedingPaymentReview(installments, paymentDetails) {
  return (Array.isArray(installments) ? installments : []).filter((installment) => {
    const paymentId = String(installment?.paymentId || '');
    if (!paymentId) return false;
    return paymentStatusNeedsReview(paymentDetails?.[paymentId]?.status);
  }).length;
}

export function paymentStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (['APPROVED', 'SCHEDULED', 'SUBMITTED', 'ACCEPTED', 'PROCESSING', 'PARTIALLY_PAID',
    'PAID', 'RECONCILED'].includes(normalized)) {
    return 'green';
  }
  if (['REJECTED', 'FAILED', 'CANCELLED', 'STOPPED', 'RETURNED', 'REVERSED', 'VOID']
    .includes(normalized)) {
    return 'red';
  }
  if (['DRAFT', 'PENDING_AUTHORITY'].includes(normalized)) return 'amber';
  return 'blue';
}

/**
 * The Payment keeps its own amount and currency; the installment keeps its
 * scheduled amount. A differing amount is surfaced for reconciliation, not
 * corrected. A missing amount on either side cannot be compared.
 */
export function paymentAmountDiffers(payment, installment) {
  const paymentAmount = numeric(payment?.amount);
  const installmentAmount = numeric(installment?.amount);
  if (paymentAmount === null || installmentAmount === null) return false;
  return paymentAmount !== installmentAmount;
}

/**
 * Linking names an existing Payment; it marks the installment collected without
 * creating, executing, approving, or altering the Payment.
 */
export function installmentPaymentPayload(payment) {
  return { status: 'PAID', paymentId: payment?.id || '' };
}
