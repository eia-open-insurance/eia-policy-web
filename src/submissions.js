import { partyRecordLabel } from './party.js';
import { addYears } from './renewal.js';

export const SUBMISSION_STATUSES = [
  'RECEIVED',
  'REFERRED',
  'QUOTED',
  'BOUND',
  'DECLINED',
  'WITHDRAWN'
];

export const TERMINAL_SUBMISSION_STATUSES = ['BOUND', 'DECLINED', 'WITHDRAWN'];

/**
 * Conversion is the explicit hand-off from new-business underwriting to the
 * Policy domain. It is offered once the submission has a quoted position
 * (QUOTED) or is already bound (BOUND); earlier stages still lack terms, and
 * DECLINED/WITHDRAWN submissions are closed. Converting creates a DRAFT policy
 * and binds the submission in one command.
 */
export const CONVERTIBLE_SUBMISSION_STATUSES = ['QUOTED', 'BOUND'];

export const SUBMISSION_STATUS_LABELS = {
  RECEIVED: 'Received',
  REFERRED: 'Referred',
  QUOTED: 'Quoted',
  BOUND: 'Bound',
  DECLINED: 'Declined',
  WITHDRAWN: 'Withdrawn'
};

/**
 * Allowed moves for the submission workbench, mirroring the Policy expert's
 * one-way status graph:
 *
 *   RECEIVED -> REFERRED, QUOTED, DECLINED, WITHDRAWN
 *   REFERRED -> QUOTED, DECLINED, WITHDRAWN
 *   QUOTED   -> BOUND, DECLINED, WITHDRAWN
 *
 * BOUND, DECLINED, and WITHDRAWN are terminal. A move records the underwriting
 * position only. Quoting and binding never create a policy: the Policy domain
 * creates that record in a separate, explicit conversion after the submission
 * is complete.
 */
export const SUBMISSION_ACTIONS = {
  RECEIVED: [
    { status: 'REFERRED', label: 'Refer' },
    { status: 'QUOTED', label: 'Quote' },
    { status: 'DECLINED', label: 'Decline' },
    { status: 'WITHDRAWN', label: 'Withdraw' }
  ],
  REFERRED: [
    { status: 'QUOTED', label: 'Quote' },
    { status: 'DECLINED', label: 'Decline' },
    { status: 'WITHDRAWN', label: 'Withdraw' }
  ],
  QUOTED: [
    { status: 'BOUND', label: 'Bind' },
    { status: 'DECLINED', label: 'Decline' },
    { status: 'WITHDRAWN', label: 'Withdraw' }
  ],
  BOUND: [],
  DECLINED: [],
  WITHDRAWN: []
};

export const MAX_SUBMISSION_NOTES_LENGTH = 2000;

const LIST_PATH = '/api/v1/policies/submissions';

export function submissionsEndpoint() {
  return LIST_PATH;
}

export function submissionListEndpoint(page = 0, size = 20) {
  const params = new URLSearchParams({ page: String(page), size: String(size) });
  return `${LIST_PATH}?${params.toString()}`;
}

export function submissionEndpoint(submissionId) {
  return `${LIST_PATH}/${encodeURIComponent(submissionId)}`;
}

export function submissionStatusEndpoint(submissionId) {
  return `${submissionEndpoint(submissionId)}/status`;
}

export function submissionConvertEndpoint(submissionId) {
  return `${submissionEndpoint(submissionId)}/convert`;
}

export function emptySubmissionState() {
  return { items: [], page: 0, size: 20, total: 0, links: {} };
}

export function submissionStatusLabel(status) {
  return SUBMISSION_STATUS_LABELS[status] || status || '—';
}

export function submissionStatusTone(status) {
  if (['QUOTED', 'BOUND'].includes(status)) return 'green';
  if (['DECLINED', 'WITHDRAWN'].includes(status)) return 'red';
  if (['RECEIVED', 'REFERRED'].includes(status)) return 'amber';
  return 'blue';
}

export function submissionActionsFor(status) {
  return SUBMISSION_ACTIONS[status] || [];
}

export function submissionIsTerminal(status) {
  return TERMINAL_SUBMISSION_STATUSES.includes(status);
}

export function submissionCanConvert(status) {
  return CONVERTIBLE_SUBMISSION_STATUSES.includes(
    String(status || '').trim().toUpperCase()
  );
}

/**
 * Tort codes arrive as text from the form and as an array (or objects carrying
 * `code`) from the API. Normalize both to a stable uppercase, deduplicated list.
 */
export function normalizeTortCodes(value) {
  if (value === null || value === undefined || value === '') return [];
  const parts = Array.isArray(value)
    ? value
    : String(value).split(/[,;\s]+/);
  const codes = [];
  for (const part of parts) {
    const raw = part && typeof part === 'object'
      ? part.code || part.tortCode || part.value || ''
      : String(part || '');
    const code = raw.trim().toUpperCase();
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return '';
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/**
 * Normalizes either a queue summary or a detail read into the one shape the
 * workbench renders. The API may nest the applicant party and requested limits,
 * so both flat and nested spellings are accepted.
 */
export function normalizeSubmission(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const nestedApplicant = objectValue(raw.applicantParty);
  const party = Object.keys(nestedApplicant).length
    ? nestedApplicant
    : objectValue(raw.applicant);
  const applicantPartyId = firstPresent(
    raw.applicantPartyId,
    raw.applicantId,
    party.id
  );
  const applicantLabel = firstPresent(
    raw.applicantPartyLabel,
    raw.applicantDisplayName,
    raw.applicantName,
    partyRecordLabel(party),
    raw.applicantPartyNumber
  );
  return {
    submissionId: String(firstPresent(raw.submissionId, raw.id)),
    submissionNumber: String(firstPresent(raw.submissionNumber, raw.number, raw.reference)),
    status: String(firstPresent(raw.status, 'RECEIVED')).trim().toUpperCase(),
    applicantPartyId: String(applicantPartyId),
    applicantLabel: String(applicantLabel),
    policyId: String(firstPresent(raw.policyId, raw.policy_id)),
    productCode: String(firstPresent(raw.productCode)),
    requestedEffectiveDate: String(
      firstPresent(raw.requestedEffectiveDate, raw.effectiveDate)
    ),
    requestedLimitAmount: firstPresent(raw.requestedLimitAmount),
    requestedLimitCurrency: firstPresent(raw.requestedLimitCurrency),
    tortCodes: normalizeTortCodes(firstPresent(raw.tortCodes, raw.torts, raw.tort_codes)),
    notes: String(firstPresent(raw.notes, raw.note)),
    receivedAt: String(firstPresent(raw.receivedAt, raw.submittedAt, raw.createdAt)),
    createdAt: String(firstPresent(raw.createdAt)),
    updatedAt: String(firstPresent(raw.updatedAt)),
    version: raw.version ?? null
  };
}

export function normalizeSubmissionPage(body, fallbackPage = 0, fallbackSize = 20) {
  const envelope = Array.isArray(body) ? null : body;
  const rawItems = Array.isArray(body)
    ? body
    : Array.isArray(body?.items) ? body.items : [];
  const items = rawItems.map(normalizeSubmission).filter(Boolean);
  return {
    items,
    page: Number.isInteger(envelope?.page) ? envelope.page : fallbackPage,
    size: Number.isInteger(envelope?.size) ? envelope.size : fallbackSize,
    total: Number.isInteger(envelope?.total) ? envelope.total : items.length,
    links: envelope?._links && typeof envelope._links === 'object' ? envelope._links : {}
  };
}

export function submissionApplicantLabel(submission, labels = {}) {
  if (!submission) return '';
  return submission.applicantLabel
    || labels[submission.applicantPartyId]
    || '';
}

export function submissionReference(submission) {
  if (!submission) return 'submission';
  if (submission.submissionNumber) return submission.submissionNumber;
  const id = String(submission.submissionId || '');
  return id ? `${id.slice(0, 8)}…` : 'submission';
}

export function submissionMatchesFilters(submission, filters = {}, labels = {}) {
  if (!submission) return false;
  const wantedStatus = String(filters.status || '').trim().toUpperCase();
  if (wantedStatus && submission.status !== wantedStatus) return false;
  const query = String(filters.query || '').trim().toLowerCase();
  if (!query) return true;
  const values = [
    submission.submissionNumber,
    submission.status,
    submissionStatusLabel(submission.status),
    submission.productCode,
    submission.requestedEffectiveDate,
    submission.requestedLimitAmount,
    submission.requestedLimitCurrency,
    submission.notes,
    submissionApplicantLabel(submission, labels),
    ...submission.tortCodes
  ];
  return values.some((value) => String(value || '').toLowerCase().includes(query));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function defaultSubmissionForm() {
  return {
    applicantPartyId: '',
    productCode: '',
    requestedEffectiveDate: todayIso(),
    requestedLimitAmount: '2000000.00',
    requestedLimitCurrency: 'USD',
    tortCodesInput: '',
    notes: ''
  };
}

export function validateSubmissionForm(form) {
  if (!form?.applicantPartyId) {
    return 'Select the applicant party before creating the submission.';
  }
  if (!String(form.productCode || '').trim()) {
    return 'Select a product before creating the submission.';
  }
  if (!String(form.requestedEffectiveDate || '').trim()) {
    return 'Choose the requested effective date.';
  }
  const limit = Number(form.requestedLimitAmount);
  if (!Number.isFinite(limit) || limit <= 0) {
    return 'Enter a requested limit greater than zero.';
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.requestedLimitCurrency || '').trim())) {
    return 'Enter a three-letter limit currency, such as USD.';
  }
  if (String(form.notes || '').length > MAX_SUBMISSION_NOTES_LENGTH) {
    return `Notes cannot exceed ${MAX_SUBMISSION_NOTES_LENGTH} characters.`;
  }
  return '';
}

export function submissionCreatePayload(form) {
  const payload = {
    applicantPartyId: String(form.applicantPartyId || '').trim(),
    productCode: String(form.productCode || '').trim(),
    requestedEffectiveDate: String(form.requestedEffectiveDate || '').trim(),
    requestedLimitAmount: String(form.requestedLimitAmount || '').trim(),
    requestedLimitCurrency: String(form.requestedLimitCurrency || '').trim().toUpperCase(),
    tortCodes: normalizeTortCodes(form.tortCodesInput)
  };
  const notes = String(form.notes || '').trim();
  if (notes) payload.notes = notes;
  return payload;
}

/**
 * The reason is optional; it is omitted entirely when blank so an action
 * without a note does not send an empty audit string.
 */
export function submissionStatusPayload(status, reason = '') {
  const payload = { status: String(status || '').trim().toUpperCase() };
  const trimmed = String(reason || '').trim();
  if (trimmed) payload.reason = trimmed;
  return payload;
}

/**
 * Conversion terms. The premium is the new policy's written premium and is
 * entered by the underwriter. The currency follows the submission's requested
 * limit currency, and the optional expiration defaults to one year after the
 * requested effective date so the common annual term needs no extra typing.
 */
export function defaultSubmissionConversionForm(submission) {
  return {
    premiumAmount: '',
    premiumCurrency: String(submission?.requestedLimitCurrency || 'USD').trim().toUpperCase(),
    expirationDate: addYears(submission?.requestedEffectiveDate, 1) || ''
  };
}

export function validateSubmissionConversionForm(form, submission) {
  const amount = String(form?.premiumAmount ?? '').trim();
  if (!amount) return 'Enter the policy premium amount.';
  const numeric = Number(amount);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 'Enter a premium amount of zero or greater.';
  }
  if (!/^[A-Za-z]{3}$/.test(String(form?.premiumCurrency || '').trim())) {
    return 'Enter a three-letter premium currency, such as USD.';
  }
  const expiration = String(form?.expirationDate || '').trim();
  if (expiration) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration)) {
      return 'Enter a valid expiration date.';
    }
    const effective = String(submission?.requestedEffectiveDate || '').trim();
    if (effective && expiration <= effective) {
      return 'Expiration date must be after the requested effective date.';
    }
  }
  return '';
}

/**
 * The expiration member is optional: when blank it is omitted so the Policy
 * domain can derive the term instead of receiving an empty date string.
 */
export function submissionConversionPayload(form) {
  const payload = {
    premiumAmount: String(form?.premiumAmount ?? '').trim(),
    premiumCurrency: String(form?.premiumCurrency || '').trim().toUpperCase()
  };
  const expiration = String(form?.expirationDate || '').trim();
  if (expiration) payload.expirationDate = expiration;
  return payload;
}

/** `Location: /api/v1/policies/{policyId}` identifies the created record. */
function policyIdFromLocation(location) {
  const text = String(location || '').trim();
  if (!text) return '';
  try {
    const path = new URL(text, 'http://localhost').pathname;
    const segments = path.split('/').filter(Boolean);
    return segments[segments.length - 1] || '';
  } catch {
    return '';
  }
}

/**
 * A conversion command may return the created policy directly, wrapped as
 * `policy`/`createdPolicy`/`result`, or alongside the bound submission. The
 * shape is normalized defensively because the command is new; a `Location`
 * header is the final fallback for the created id.
 */
export function normalizeConversionResult(body, location = '') {
  const envelope = objectValue(body);
  const nestedPolicy = objectValue(envelope.policy);
  const createdPolicy = objectValue(envelope.createdPolicy);
  const resultPolicy = objectValue(envelope.result);
  const policy = [nestedPolicy, createdPolicy, resultPolicy]
    .find((candidate) => Object.keys(candidate).length) || envelope;
  const nestedSubmission = objectValue(envelope.submission);
  return {
    policyId: String(firstPresent(
      policy.policyId,
      policy.id,
      envelope.policyId,
      envelope.createdPolicyId,
      policyIdFromLocation(location)
    )),
    policyNumber: String(firstPresent(
      policy.policyNumber,
      policy.number,
      envelope.policyNumber,
      envelope.number
    )),
    policyStatus: String(firstPresent(
      policy.status,
      envelope.policyStatus,
      'DRAFT'
    )).trim().toUpperCase(),
    policy: Object.keys(policy).length ? policy : null,
    submission: Object.keys(nestedSubmission).length
      ? normalizeSubmission(nestedSubmission)
      : null
  };
}
