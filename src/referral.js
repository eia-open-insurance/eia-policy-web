/**
 * Underwriting referral workflow for a new-business submission.
 *
 * A referral is the underwriting decision request recorded on a submission.
 * Opening one records the reason, the authority that will decide it, the
 * directory person it is referred to, and optional notes; it starts PENDING.
 * A pending referral is then APPROVED or DECLINED by a directory person. The
 * referral is not a submission status action: approving a referral does not
 * decline the submission, and declining a referral does not withdraw it.
 *
 * These helpers keep the endpoints, vocabularies, payloads, validation, and
 * the tolerant response normalization out of the rendering layer so the panel
 * and its dialogs can be reasoned about (and tested) independently.
 */

export const REFERRAL_STATUSES = ['PENDING', 'APPROVED', 'DECLINED'];

export const REFERRAL_STATUS_LABELS = {
  PENDING: 'Pending',
  APPROVED: 'Approved',
  DECLINED: 'Declined'
};

/** The closed reason vocabulary the referral command accepts. */
export const REFERRAL_REASONS = [
  { code: 'LIMIT', label: 'Limit exceeds authority' },
  { code: 'PREMIUM', label: 'Premium exceeds authority' },
  { code: 'TORT', label: 'Tort or mass-tort exposure' },
  { code: 'APPETITE', label: 'Outside underwriting appetite' },
  { code: 'MANUSCRIPT', label: 'Manuscript form or endorsement' },
  { code: 'SANCTIONS', label: 'Sanctions or embargo match' },
  { code: 'CONFLICT', label: 'Conflict of interest' },
  { code: 'OTHER', label: 'Other' }
];

export const REFERRAL_REASON_CODES = REFERRAL_REASONS.map((entry) => entry.code);

export const REFERRAL_DECISIONS = ['APPROVED', 'DECLINED'];

export const REFERRAL_DECISION_LABELS = {
  APPROVED: 'Approve',
  DECLINED: 'Decline'
};

/**
 * A referral can be opened while the submission is still in intake or already
 * marked REFERRED (for example after a declined referral). QUOTED, BOUND, and
 * the closed statuses are past the referral gate.
 */
export const REFERRAL_ELIGIBLE_SUBMISSION_STATUSES = ['RECEIVED', 'REFERRED'];

export const MAX_REFERRAL_NOTES_LENGTH = 2000;

const LIST_PATH = '/api/v1/policies/submissions';

export function submissionReferralEndpoint(submissionId) {
  return `${LIST_PATH}/${encodeURIComponent(submissionId)}/referral`;
}

/** The decision is a command on the pending referral of one submission. */
export function submissionReferralDecisionEndpoint(submissionId) {
  return `${submissionReferralEndpoint(submissionId)}/decision`;
}

export function referralStatusLabel(status) {
  const normalized = String(status || '').trim().toUpperCase();
  return REFERRAL_STATUS_LABELS[normalized] || normalized || '—';
}

export function referralStatusTone(status) {
  const normalized = String(status || '').trim().toUpperCase();
  if (normalized === 'APPROVED') return 'green';
  if (normalized === 'DECLINED') return 'red';
  if (normalized === 'PENDING') return 'amber';
  return 'blue';
}

export function referralIsPending(referral) {
  return String(referral?.status || '').trim().toUpperCase() === 'PENDING';
}

export function referralEligible(status) {
  return REFERRAL_ELIGIBLE_SUBMISSION_STATUSES.includes(
    String(status || '').trim().toUpperCase()
  );
}

/**
 * A new referral can be opened during intake or after a declined referral.
 * A PENDING referral is already awaiting its decision and an APPROVED one is
 * resolved, so neither offers the action again.
 */
export function referralCanBeOpened(status, referral) {
  if (!referralEligible(status)) return false;
  const current = String(referral?.status || '').trim().toUpperCase();
  return current !== 'PENDING' && current !== 'APPROVED';
}

export function referralReasonLabel(reason) {
  const normalized = String(reason || '').trim().toUpperCase();
  if (!normalized) return '—';
  const entry = REFERRAL_REASONS.find((candidate) => candidate.code === normalized);
  return entry ? entry.label : normalized;
}

export function referralDecisionLabel(decision) {
  const normalized = String(decision || '').trim().toUpperCase();
  return REFERRAL_DECISION_LABELS[normalized] || normalized || '—';
}

export function defaultReferralForm() {
  return {
    reason: '',
    authority: '',
    referredTo: '',
    notes: ''
  };
}

export function defaultReferralDecisionForm(decision = 'APPROVED') {
  return {
    decision: String(decision || 'APPROVED').trim().toUpperCase(),
    decidedBy: '',
    notes: ''
  };
}

export function validateReferralForm(form) {
  const reason = String(form?.reason || '').trim().toUpperCase();
  if (!reason) return 'Select a referral reason.';
  if (!REFERRAL_REASON_CODES.includes(reason)) return 'Select a valid referral reason.';
  if (!String(form?.authority || '').trim()) {
    return 'Enter the authority that will decide the referral.';
  }
  if (!String(form?.referredTo || '').trim()) {
    return 'Select the person the submission is referred to.';
  }
  if (String(form?.notes || '').length > MAX_REFERRAL_NOTES_LENGTH) {
    return `Referral notes cannot exceed ${MAX_REFERRAL_NOTES_LENGTH} characters.`;
  }
  return '';
}

export function validateReferralDecisionForm(form) {
  const decision = String(form?.decision || '').trim().toUpperCase();
  if (!REFERRAL_DECISIONS.includes(decision)) {
    return 'Select whether the referral is approved or declined.';
  }
  if (!String(form?.decidedBy || '').trim()) {
    return 'Select the person who decided the referral.';
  }
  if (String(form?.notes || '').length > MAX_REFERRAL_NOTES_LENGTH) {
    return `Decision notes cannot exceed ${MAX_REFERRAL_NOTES_LENGTH} characters.`;
  }
  return '';
}

/**
 * Opening a referral sends the closed reason code, the authority, the
 * directory person id, and notes only when supplied. A blank optional member
 * is omitted rather than sent as an empty audit string.
 */
export function referralPayload(form) {
  const payload = {
    reason: String(form?.reason || '').trim().toUpperCase(),
    authority: String(form?.authority || '').trim(),
    referredTo: String(form?.referredTo || '').trim()
  };
  const notes = String(form?.notes || '').trim();
  if (notes) payload.notes = notes;
  return payload;
}

export function referralDecisionPayload(form) {
  const payload = {
    decision: String(form?.decision || '').trim().toUpperCase(),
    decidedBy: String(form?.decidedBy || '').trim()
  };
  const notes = String(form?.notes || '').trim();
  if (notes) payload.notes = notes;
  return payload;
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function nonEmptyObject(value) {
  const record = objectValue(value);
  return Object.keys(record).length ? record : null;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function textValue(...values) {
  return String(firstPresent(...values));
}

/**
 * Normalizes one referral record. The command and read projections may nest
 * the person ids, use the short `at` spelling, or omit the decision fields
 * while the referral is still pending, so every display field is read
 * tolerantly and left blank when the domain has not recorded it yet.
 */
export function normalizeReferral(raw) {
  const record = objectValue(raw);
  if (!Object.keys(record).length) return null;
  const nestedReferral = objectValue(record.referral);
  const source = Object.keys(nestedReferral).length ? nestedReferral : record;

  const decidedAt = textValue(
    source.decidedAt,
    source.referralDecidedAt,
    source.decisionAt,
    source.approvedAt,
    source.resolvedAt
  );
  const referredAt = textValue(
    source.referredAt,
    source.openedAt,
    source.requestedAt,
    source.createdAt
  );
  const at = textValue(
    source.at,
    source.timestamp,
    decidedAt,
    referredAt,
    source.updatedAt,
    source.createdAt
  );

  const referral = {
    referralId: textValue(source.referralId, source.id),
    status: textValue(
      source.referralDecision,
      source.status,
      source.referralStatus,
      source.state,
      source.decision
    )
      .trim()
      .toUpperCase(),
    reason: textValue(source.reason, source.referralReason, source.reasonCode)
      .trim()
      .toUpperCase(),
    authority: textValue(source.authority, source.referralAuthority, source.authorityLevel),
    referredTo: textValue(
      source.referredTo,
      source.referredToId,
      source.referredToPersonId,
      source.assigneeId,
      source.assigneePersonId
    ),
    notes: textValue(source.notes, source.referralNotes, source.note),
    decidedBy: textValue(
      source.decidedBy,
      source.referralDecidedBy,
      source.decidedById,
      source.decidedByPersonId,
      source.decisionBy,
      source.approverId,
      source.approvedBy
    ),
    at,
    referredAt,
    decidedAt
  };

  const hasContent = Boolean(
    referral.referralId
    || referral.status
    || referral.reason
    || referral.authority
    || referral.referredTo
    || referral.decidedBy
    || referral.at
  );
  return hasContent ? referral : null;
}

/**
 * The submission detail may embed the referral as `referral` or flatten its
 * fields onto the submission. Both spellings are accepted; a submission with
 * no referral fields yields null so the panel can show its empty state.
 */
export function referralFromSubmission(raw) {
  const record = objectValue(raw);
  if (!Object.keys(record).length) return null;
  const nested = objectValue(record.referral);
  if (Object.keys(nested).length) return normalizeReferral(nested);
  const hasFlatFields = [
    'referralStatus',
    'referralReason',
    'referralAuthority',
    'referredTo',
    'referralNotes',
    'referralDecidedBy'
  ].some((field) => record[field] !== undefined && record[field] !== null);
  return hasFlatFields ? normalizeReferral(record) : null;
}

/**
 * A command response may answer with the updated submission, a `{referral}`
 * envelope, or the referral record itself. The caller gets the embedded
 * submission (when the body carries one) and the normalized referral, then
 * re-reads the submission for the authoritative state.
 */
export function normalizeReferralResult(body) {
  const envelope = objectValue(body);
  const nestedSubmission = objectValue(envelope.submission);
  const nestedItem = objectValue(envelope.item);
  const submission = Object.keys(nestedSubmission).length
    ? nestedSubmission
    : Object.keys(nestedItem).length ? nestedItem : null;

  const nestedReferral = nonEmptyObject(envelope.referral)
    || nonEmptyObject(nestedSubmission.referral)
    || nonEmptyObject(nestedItem.referral)
    || nonEmptyObject(envelope.result?.referral)
    || nonEmptyObject(envelope.decision?.referral);
  let referral = nestedReferral ? normalizeReferral(nestedReferral) : null;

  if (!referral && !submission && !envelope.submissionId && !envelope.submissionNumber) {
    const decisionRecord = nonEmptyObject(envelope.decision);
    referral = normalizeReferral(decisionRecord || envelope);
  }

  return { submission, referral };
}

/**
 * Overlays a command response onto the referral already on screen without
 * letting absent response members blank known values. The following detail
 * read is still authoritative; this keeps the panel usable if that read fails.
 */
export function mergeReferral(base, update) {
  const merged = { ...(base || {}) };
  for (const [key, value] of Object.entries(update || {})) {
    if (value === undefined || value === null || value === '') continue;
    merged[key] = value;
  }
  return merged;
}
