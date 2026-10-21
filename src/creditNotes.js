/**
 * Credit note helpers for the Policy Billing tab.
 *
 * A credit note reduces the premium the insured owes. It is an accounting
 * document: it never edits the policy premium, coverage, limits, or version,
 * and applying one is a status change on the note, not a Payment.
 *
 * Wire contract used by the Billing tab:
 *   GET   /api/v1/policies/{policyId}/credit-notes
 *   POST  /api/v1/policies/{policyId}/credit-notes
 *   PATCH /api/v1/policies/{policyId}/credit-notes/{creditNoteId}/status
 *
 * A credit note carries `id`, a note number (`creditNoteNumber` or `noteNumber`),
 * `amount`, `currency`, a `reason`, a `status`, and the `issuedDate` and
 * `appliedDate` stamps. The list read may be a bare array, an `{items}` page
 * envelope, or a `{creditNotes: …}` wrapper; the summary may be supplied by the
 * server or derived from the rows.
 */

export const CREDIT_NOTE_REASONS = [
  { value: 'CANCELLATION', label: 'Cancellation' },
  { value: 'ENDORSEMENT', label: 'Endorsement' },
  { value: 'AUDIT_RETURN', label: 'Audit return' },
  { value: 'OVERPAYMENT', label: 'Overpayment' },
  { value: 'REFUND', label: 'Refund' },
  { value: 'CORRECTION', label: 'Correction' }
];

const REASON_LABELS = Object.fromEntries(
  CREDIT_NOTE_REASONS.map((entry) => [entry.value, entry.label])
);

export const CREDIT_NOTE_STATUS = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  APPLIED: 'APPLIED',
  CANCELLED: 'CANCELLED'
};

export function emptyCreditNotesState() {
  return { items: [], summary: null, loading: false, error: '' };
}

export function creditNoteEndpoint(policyId) {
  if (!policyId) return '';
  return `/api/v1/policies/${encodeURIComponent(policyId)}/credit-notes`;
}

export function creditNoteStatusEndpoint(policyId, creditNoteId) {
  if (!policyId || !creditNoteId) return '';
  return `/api/v1/policies/${encodeURIComponent(policyId)}/credit-notes/`
    + `${encodeURIComponent(creditNoteId)}/status`;
}

export function creditNoteStatusPayload(status) {
  return { status: String(status || '').toUpperCase() };
}

export function creditNoteReasonLabel(value) {
  const normalized = String(value || '').toUpperCase();
  if (REASON_LABELS[normalized]) return REASON_LABELS[normalized];
  return normalized ? normalized.replace(/_/g, ' ') : '—';
}

export function creditNoteLabel(creditNote) {
  return creditNote?.creditNoteNumber || creditNote?.id || 'Credit note';
}

/**
 * New notes start as drafts. The amount defaults to the unpaid premium when the
 * Billing tab knows it (or the policy premium when no plan is on screen), and
 * the currency is always the policy's premium currency.
 */
export function defaultCreditNoteForm(policy, unpaidAmount) {
  const unpaid = numeric(unpaidAmount);
  const premium = numeric(policy?.premiumAmount);
  const seed = unpaid !== null ? unpaid : premium;
  return {
    amount: seed === null ? '' : seed.toFixed(2),
    currency: policy?.premiumCurrency || '',
    reason: 'CORRECTION'
  };
}

export function validateCreditNoteForm(form) {
  const amount = numeric(form?.amount);
  if (amount === null || amount <= 0) {
    return 'Credit note amount must be greater than 0.';
  }
  if (!CREDIT_NOTE_REASONS.some((entry) => entry.value === String(form?.reason || ''))) {
    return 'Select a credit note reason.';
  }
  return '';
}

/** The currency is derived from the policy; an amount is sent as a JSON number. */
export function creditNotePayload(form, policy) {
  const amount = numeric(form?.amount);
  return {
    amount: amount === null ? form?.amount : Number(amount.toFixed(2)),
    currency: String(policy?.premiumCurrency || form?.currency || '').toUpperCase(),
    reason: String(form?.reason || '').toUpperCase()
  };
}

export function canIssueCreditNote(status) {
  return String(status || '').toUpperCase() === CREDIT_NOTE_STATUS.DRAFT;
}

export function canApplyCreditNote(status) {
  return String(status || '').toUpperCase() === CREDIT_NOTE_STATUS.ISSUED;
}

export function canCancelCreditNote(status) {
  const normalized = String(status || '').toUpperCase();
  return normalized === CREDIT_NOTE_STATUS.DRAFT || normalized === CREDIT_NOTE_STATUS.ISSUED;
}

export function creditNoteStatusTone(status) {
  switch (String(status || '').toUpperCase()) {
    case 'APPLIED':
      return 'green';
    case 'DRAFT':
      return 'amber';
    case 'CANCELLED':
      return 'red';
    case 'ISSUED':
      return 'blue';
    default:
      return 'blue';
  }
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== '');
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}

function dateOnly(value) {
  const text = String(value || '');
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? text.slice(0, 10) : text;
}

function decimalString(value) {
  const parsed = numeric(value);
  return parsed === null ? null : parsed.toFixed(2);
}

function sumAmount(rows, statuses) {
  return rows.reduce(
    (total, row) => (
      statuses.includes(row.status) ? total + (numeric(row.amount) || 0) : total
    ),
    0
  );
}

function normalizeCreditNote(row, fallbackCurrency) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const id = firstText(row.id, row.creditNoteId);
  if (!id) return null;
  const number = firstText(
    row.creditNoteNumber,
    row.noteNumber,
    row.creditNoteNo,
    row.number,
    row.reference,
    id
  );
  const reason = firstText(row.reason, row.creditReason).toUpperCase();
  return {
    id,
    creditNoteNumber: number,
    amount: firstDefined(row.amount, row.creditAmount, row.creditNoteAmount, row.totalAmount),
    currency: firstText(row.currency, row.currencyCode, fallbackCurrency).toUpperCase(),
    reason,
    reasonLabel: creditNoteReasonLabel(reason),
    status: firstText(row.status).toUpperCase() || 'DRAFT',
    issuedDate: dateOnly(firstDefined(
      row.issuedDate,
      row.issuedOn,
      row.issueDate,
      row.issuedAt,
      ''
    )),
    appliedDate: dateOnly(firstDefined(
      row.appliedDate,
      row.appliedOn,
      row.applyDate,
      row.appliedAt,
      ''
    )),
    createdDate: dateOnly(firstDefined(row.createdAt, row.createdOn, row.createdDate, '')),
    originalInvoiceNumber: firstText(row.originalInvoiceNumber, row.invoiceNumber)
  };
}

/**
 * Tolerant read of GET /credit-notes. Rows without an id cannot be acted on, so
 * they are dropped instead of rendered as unselectable noise. Server summary
 * values win; otherwise issued totals sum the ISSUED and APPLIED notes (an
 * applied note was issued first) and applied totals sum the APPLIED notes.
 */
export function normalizeCreditNotes(body, policy) {
  const envelope = body && typeof body === 'object' && !Array.isArray(body) ? body : {};
  const wrapped = envelope.creditNotes
    && typeof envelope.creditNotes === 'object'
    && !Array.isArray(envelope.creditNotes)
    ? envelope.creditNotes
    : {};
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(envelope.items)
      ? envelope.items
      : Array.isArray(envelope.creditNotes)
        ? envelope.creditNotes
        : Array.isArray(wrapped.items)
          ? wrapped.items
          : [];
  const fallbackCurrency = firstText(
    envelope.currency,
    wrapped.currency,
    policy?.premiumCurrency
  );
  const items = rows
    .map((row) => normalizeCreditNote(row, fallbackCurrency))
    .filter((row) => row !== null);

  const summaryBody = envelope.summary && typeof envelope.summary === 'object'
    ? envelope.summary
    : wrapped.summary && typeof wrapped.summary === 'object'
      ? wrapped.summary
      : {};
  const issued = firstDefined(
    summaryBody.issuedAmount,
    summaryBody.totalIssuedAmount,
    summaryBody.issuedTotalAmount,
    summaryBody.issuedTotal,
    summaryBody.totalIssued,
    summaryBody.issued
  );
  const applied = firstDefined(
    summaryBody.appliedAmount,
    summaryBody.totalAppliedAmount,
    summaryBody.appliedTotalAmount,
    summaryBody.appliedTotal,
    summaryBody.totalApplied,
    summaryBody.applied
  );
  const issuedFallback = sumAmount(items, ['ISSUED', 'APPLIED']);
  const appliedFallback = sumAmount(items, ['APPLIED']);

  return {
    items,
    summary: {
      currency: firstText(summaryBody.currency, fallbackCurrency).toUpperCase(),
      issuedAmount: decimalString(
        issued === undefined || issued === null ? issuedFallback : issued
      ),
      appliedAmount: decimalString(
        applied === undefined || applied === null ? appliedFallback : applied
      ),
      count: items.length
    }
  };
}
