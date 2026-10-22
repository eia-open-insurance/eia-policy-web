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
 * `appliedDate` stamps. Applying an issued note also names the open installment
 * that absorbs it (`installmentId` on the PATCH, `appliedInstallmentId` and
 * `appliedInstallmentNumber` on the read). An APPLIED note can be reversed with
 * an audit reason: the PATCH sends `{status: "REVERSED", reason}` and the read
 * then carries the `reversedDate` and `reversedReason` stamps. The list read may
 * be a bare array, an `{items}` page envelope, or a `{creditNotes: …}` wrapper;
 * the summary may be supplied by the server or derived from the rows.
 */

import { canManageInstallment } from './billing.js';

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

export const CREDIT_NOTE_REVERSAL_REASON_MAX = 500;

export const CREDIT_NOTE_STATUS = {
  DRAFT: 'DRAFT',
  ISSUED: 'ISSUED',
  APPLIED: 'APPLIED',
  CANCELLED: 'CANCELLED',
  REVERSED: 'REVERSED'
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

/**
 * Issuing and cancelling send only the target status. Applying also names the
 * open installment that receives the credit; reversing sends the audit reason
 * that explains why the posted credit was restored. The server owns the
 * credited and outstanding balances that result from either transition.
 */
export function creditNoteStatusPayload(status, installmentId, reason) {
  const payload = { status: String(status || '').toUpperCase() };
  if (installmentId) payload.installmentId = String(installmentId);
  const reversalReason = String(reason || '').trim();
  if (reversalReason) payload.reason = reversalReason;
  return payload;
}

export function creditNoteReasonLabel(value) {
  const text = String(value || '').trim();
  const normalized = text.toUpperCase();
  if (REASON_LABELS[normalized]) return REASON_LABELS[normalized];
  // A cancellation-derived note carries the human-readable source sentence as
  // its free-text reason. Keep that sentence instead of shouting it in caps,
  // while preserving the legacy enum-ish formatting for all-caps reasons.
  if (text && text === normalized) return normalized.replace(/_/g, ' ');
  return text || '—';
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

/**
 * A negative premium variance is given back with a credit note for the excess
 * (the plan's net premium is above the policy premium). The amount is preset to
 * the positive difference and the reason records the policy whose premium the
 * audit changed; both stay editable because the operator still owns the note.
 */
export function billingVarianceCreditNoteForm(policy, variance) {
  const difference = numeric(variance?.differenceCents);
  const amount = difference !== null && difference > 0 ? difference / 100 : null;
  const policyLabel = policy?.policyNumber || policy?.id || 'this policy';
  return {
    amount: amount === null ? '' : amount.toFixed(2),
    currency: policy?.premiumCurrency || '',
    reason: 'CORRECTION',
    reasonText: `Premium audit adjustment for ${policyLabel}`,
    requireReason: true
  };
}

/**
 * The label a cancellation is known by. The Policy expert currently returns the
 * cancellation `id`; a `cancellationNumber` (or its catalog aliases) is used when
 * the projection widens. This label is also printed in the credit-note reason so
 * the ledger row can be traced back to the posted cancellation.
 */
export function cancellationNumber(cancellation) {
  return firstText(
    cancellation?.cancellationNumber,
    cancellation?.cancellationNo,
    cancellation?.cancellationRef,
    cancellation?.referenceNumber,
    cancellation?.number,
    cancellation?.id
  );
}

/** Only a POSTED cancellation with a positive return premium can be credited. */
export function canCreateCreditNoteForCancellation(cancellation) {
  if (String(cancellation?.status || '').toUpperCase() !== 'POSTED') return false;
  const amount = numeric(cancellation?.returnPremiumAmount);
  return amount !== null && amount > 0;
}

/**
 * The return-premium credit note is created from the posted cancellation: the
 * amount is the computed return premium, the currency is the cancellation's
 * premium currency (the policy currency), and the reason records the source
 * cancellation number. The amount is fixed because changing it would no longer
 * match the cancellation it settles.
 */
export function cancellationCreditNoteForm(policy, cancellation) {
  const amount = numeric(cancellation?.returnPremiumAmount);
  const number = cancellationNumber(cancellation);
  return {
    amount: amount === null ? '' : amount.toFixed(2),
    currency: firstText(
      cancellation?.premiumCurrency,
      policy?.premiumCurrency
    ).toUpperCase(),
    reason: 'CANCELLATION',
    reasonText: `Cancellation ${number || '—'} return premium`,
    cancellationId: firstText(cancellation?.id),
    cancellationNumber: number
  };
}

/** The ledger row already created for a cancellation, when one exists. */
export function creditNoteForCancellation(notes, cancellationId) {
  const id = firstText(cancellationId);
  if (!id) return null;
  return (Array.isArray(notes) ? notes : []).find(
    (note) => firstText(note?.cancellationId) === id
  ) || null;
}

/**
 * The source cancellation shown on the ledger row. The read may carry the
 * number directly; otherwise the loaded cancellation list resolves the stored
 * cancellation id. A bare id is still a useful last resort.
 */
export function creditNoteSourceCancellationLabel(creditNote, cancellations) {
  const number = firstText(
    creditNote?.cancellationNumber,
    creditNote?.sourceCancellationNumber
  );
  if (number) return number;
  const id = firstText(creditNote?.cancellationId);
  if (!id) return '';
  const cancellation = (Array.isArray(cancellations) ? cancellations : [])
    .find((row) => firstText(row?.id) === id);
  return cancellationNumber(cancellation) || id;
}

export function validateCreditNoteForm(form) {
  const amount = numeric(form?.amount);
  if (amount === null || amount <= 0) {
    return 'Credit note amount must be greater than 0.';
  }
  if (form?.requireReason && !String(form?.reasonText || '').trim()) {
    return 'Enter a reason for the credit note.';
  }
  if (!CREDIT_NOTE_REASONS.some((entry) => entry.value === String(form?.reason || ''))) {
    return 'Select a credit note reason.';
  }
  return '';
}

/**
 * The currency is derived from the policy; an amount is sent as a JSON number.
 * A cancellation-derived note sends the source `cancellationId` and its
 * human-readable reason sentence, which lets the Policy expert tie the note to
 * the cancellation and reject a duplicate with 409. A premium-variance note
 * sends the audit sentence as free text for the same traceability.
 */
export function creditNotePayload(form, policy) {
  const amount = numeric(form?.amount);
  const cancellationId = firstText(form?.cancellationId);
  const freeTextReason = firstText(form?.reasonText);
  const payload = {
    amount: amount === null ? form?.amount : Number(amount.toFixed(2)),
    currency: String(policy?.premiumCurrency || form?.currency || '').toUpperCase(),
    reason: cancellationId
      ? String(form?.reasonText || '').trim()
      : freeTextReason || String(form?.reason || '').toUpperCase()
  };
  if (cancellationId) payload.cancellationId = cancellationId;
  return payload;
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

/** Only an APPLIED note has a posted credit that can be undone. */
export function canReverseCreditNote(status) {
  return String(status || '').toUpperCase() === CREDIT_NOTE_STATUS.APPLIED;
}

/**
 * A reversal must say why the credit was restored. The reason is free text kept
 * on the ledger, so the check trims it and guards the payload length.
 */
export function validateCreditNoteReversalReason(reason) {
  const text = String(reason || '').trim();
  if (!text) return 'Enter a reason for the reversal.';
  if (text.length > CREDIT_NOTE_REVERSAL_REASON_MAX) {
    return `Reversal reason must be ${CREDIT_NOTE_REVERSAL_REASON_MAX} characters or fewer.`;
  }
  return '';
}

/** The installment an applied note names, when the read carries one. */
export function creditNoteAppliedInstallmentLabel(creditNote) {
  const number = firstText(creditNote?.appliedInstallmentNumber);
  if (number) return `Installment ${number}`;
  const id = firstText(creditNote?.appliedInstallmentId);
  return id ? `Installment ${id}` : '';
}

/** Net amount still collectible on one installment; credits reduce it. */
export function installmentOutstandingAmount(installment) {
  const outstanding = numeric(installment?.outstandingAmount);
  if (outstanding !== null) return Math.max(outstanding, 0);
  const amount = numeric(installment?.amount);
  if (amount === null) return null;
  return Math.max(amount - (numeric(installment?.creditedAmount) || 0), 0);
}

/**
 * A note can only be applied to a DUE/OVERDUE installment whose outstanding can
 * absorb the whole note. Comparing integer cents avoids a float-rounded offer.
 */
export function canApplyCreditNoteToInstallment(creditNote, installment) {
  const amount = numeric(creditNote?.amount);
  if (amount === null || amount <= 0) return false;
  if (!installment?.id || !canManageInstallment(installment.status)) return false;
  const outstanding = installmentOutstandingAmount(installment);
  if (outstanding === null || outstanding <= 0) return false;
  return Math.round(outstanding * 100) >= Math.round(amount * 100);
}

export function eligibleInstallmentsForCreditNote(creditNote, installments) {
  return (Array.isArray(installments) ? installments : [])
    .filter((row) => canApplyCreditNoteToInstallment(creditNote, row))
    .sort((left, right) => (
      (Number(left.installmentNumber) || 0) - (Number(right.installmentNumber) || 0)
    ));
}

export function creditNoteStatusTone(status) {
  switch (String(status || '').toUpperCase()) {
    case 'APPLIED':
      return 'green';
    case 'DRAFT':
      return 'amber';
    case 'CANCELLED':
      return 'red';
    case 'REVERSED':
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
  const reasonText = firstText(row.reason, row.creditReason);
  const reason = reasonText.toUpperCase();
  const sourceCancellation = row.sourceCancellation
    && typeof row.sourceCancellation === 'object'
    && !Array.isArray(row.sourceCancellation)
    ? row.sourceCancellation
    : {};
  const cancellation = row.cancellation
    && typeof row.cancellation === 'object'
    && !Array.isArray(row.cancellation)
    ? row.cancellation
    : {};
  const cancellationId = firstText(
    row.cancellationId,
    row.sourceCancellationId,
    sourceCancellation.id,
    cancellation.id
  );
  const sourceCancellationNumber = firstText(
    row.cancellationNumber,
    row.sourceCancellationNumber,
    row.cancellationNo,
    sourceCancellation.cancellationNumber,
    sourceCancellation.number,
    cancellation.cancellationNumber,
    cancellation.number
  );
  const appliedInstallment = row.appliedInstallment
    && typeof row.appliedInstallment === 'object'
    && !Array.isArray(row.appliedInstallment)
    ? row.appliedInstallment
    : {};
  const reversal = row.reversal
    && typeof row.reversal === 'object'
    && !Array.isArray(row.reversal)
    ? row.reversal
    : {};
  return {
    id,
    creditNoteNumber: number,
    amount: firstDefined(row.amount, row.creditAmount, row.creditNoteAmount, row.totalAmount),
    currency: firstText(row.currency, row.currencyCode, fallbackCurrency).toUpperCase(),
    reason,
    reasonLabel: creditNoteReasonLabel(reasonText),
    cancellationId,
    cancellationNumber: sourceCancellationNumber,
    sourceCancellationNumber,
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
    reversedDate: dateOnly(firstDefined(
      row.reversedDate,
      row.reversedOn,
      row.reversalDate,
      row.reversedAt,
      reversal.reversedDate,
      reversal.reversedOn,
      reversal.date,
      reversal.reversedAt,
      ''
    )),
    reversedReason: firstText(
      row.reversedReason,
      row.reversalReason,
      row.reasonForReversal,
      row.reversalNote,
      reversal.reason,
      reversal.reversedReason,
      reversal.note
    ),
    appliedInstallmentId: firstText(
      row.appliedInstallmentId,
      row.installmentId,
      row.appliedToInstallmentId,
      row.creditInstallmentId,
      appliedInstallment.id,
      appliedInstallment.installmentId
    ),
    appliedInstallmentNumber: firstText(
      row.appliedInstallmentNumber,
      row.installmentNumber,
      row.appliedInstallmentNo,
      appliedInstallment.installmentNumber,
      appliedInstallment.number
    ),
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
