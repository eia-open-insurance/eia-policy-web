/**
 * A premium audit re-rates the policy's written premium after the term has
 * already been issued. It is not a coverage endorsement: the command issues a
 * PREMIUM_AUDIT policy version and leaves the coverage grants and policy
 * limits exactly as issued. These helpers keep the eligibility, delta preview,
 * payload, and response rules out of the rendering layer so the modal can be
 * reasoned about (and tested) independently.
 */

export const PREMIUM_AUDIT_STATUSES = ['ISSUED', 'IN_FORCE', 'ENDORSED', 'REINSTATED'];

export function isPremiumAuditable(status) {
  return PREMIUM_AUDIT_STATUSES.includes(String(status || '').toUpperCase());
}

/** The tooltip/context shown when the record's status does not allow an audit. */
export function premiumAuditUnavailableReason(status) {
  if (isPremiumAuditable(status)) return '';
  const current = String(status || '').trim() || 'unknown';
  return `Premium audit is available only when the policy is ISSUED, IN_FORCE, ENDORSED, or REINSTATED. This policy is ${current}.`;
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The audit starts from the written premium so a confirming audit is a
 * no-change submission, and the effective date defaults to today. Optional
 * approval references stay blank.
 */
export function defaultPremiumAuditForm(policy) {
  return {
    auditedPremium: policy?.premiumAmount === null || policy?.premiumAmount === undefined
      ? ''
      : String(policy.premiumAmount),
    effectiveDate: todayIsoDate(),
    reason: '',
    approvedBy: '',
    approvalRef: ''
  };
}

/**
 * Returns the audited-minus-current premium, or null while either side is not
 * a finite number. The caller formats the currency; this helper only does the
 * arithmetic so a +/-/no-change decision never depends on display formatting.
 */
export function premiumAuditDelta(policy, form) {
  const currentText = String(policy?.premiumAmount ?? '').trim();
  const auditedText = String(form?.auditedPremium ?? '').trim();
  if (currentText === '' || auditedText === '') return null;
  const current = Number(currentText);
  const audited = Number(auditedText);
  if (!Number.isFinite(current) || !Number.isFinite(audited)) return null;
  return audited - current;
}

export function premiumAuditDirection(delta) {
  if (delta === null || delta === undefined) return 'UNKNOWN';
  const amount = Number(delta);
  if (!Number.isFinite(amount)) return 'UNKNOWN';
  // Currency is rendered to cents; a sub-cent difference is no change.
  if (Math.abs(amount) < 0.005) return 'NO_CHANGE';
  return amount > 0 ? 'INCREASE' : 'DECREASE';
}

export function validatePremiumAuditForm(form) {
  const audited = String(form?.auditedPremium ?? '').trim();
  if (!audited) return 'Audited premium is required.';
  const amount = Number(audited);
  if (!Number.isFinite(amount)) return 'Audited premium must be a number.';
  if (amount < 0) return 'Audited premium must be zero or greater.';
  if (!String(form?.effectiveDate || '').trim()) return 'Effective date is required.';
  if (!String(form?.reason || '').trim()) return 'Reason is required.';
  return '';
}

export function premiumAuditPayload(form) {
  const payload = {
    auditedPremium: String(form.auditedPremium ?? '').trim(),
    effectiveDate: form.effectiveDate,
    reason: String(form.reason ?? '').trim()
  };
  const approvedBy = String(form.approvedBy ?? '').trim();
  const approvalRef = String(form.approvalRef ?? '').trim();
  if (approvedBy) payload.approvedBy = approvedBy;
  if (approvalRef) payload.approvalRef = approvalRef;
  return payload;
}

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function isPolicyLike(value) {
  const record = objectOrNull(value);
  return Boolean(record
    && typeof record.id === 'string'
    && Object.prototype.hasOwnProperty.call(record, 'premiumAmount'));
}

function isVersionLike(value) {
  const record = objectOrNull(value);
  return Boolean(record
    && typeof record.id === 'string'
    && (Object.prototype.hasOwnProperty.call(record, 'changeType')
      || Object.prototype.hasOwnProperty.call(record, 'policyVersionNumber')));
}

function firstText(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function firstAmount(...values) {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/**
 * The audit command may answer with the updated Policy (like renewal), an
 * audit result carrying the audited premium and version number (like
 * cancellation), or a `{policy, version}` envelope. All three are normalized
 * here so the caller can refresh the record from one shape. The caller still
 * re-reads the detail and current version, because the command response is not
 * the authoritative read model.
 */
export function normalizePremiumAuditResult(body) {
  const record = objectOrNull(body) || {};
  const nestedPolicy = isPolicyLike(record.policy) ? record.policy : null;
  const policy = nestedPolicy || (isPolicyLike(record) ? record : null);

  let version = null;
  if (isVersionLike(record.version)) version = record.version;
  else if (isVersionLike(record.currentVersion?.version)) version = record.currentVersion.version;
  else if (isVersionLike(record.premiumAudit?.version)) version = record.premiumAudit.version;
  else if (isVersionLike(record.audit?.version)) version = record.audit.version;
  else if (isVersionLike(record)
    && String(record.changeType || '').toUpperCase() === 'PREMIUM_AUDIT') {
    version = record;
  }

  const audit = objectOrNull(record.premiumAudit) || objectOrNull(record.audit) || null;
  const auditedPremium = firstAmount(
    record.auditedPremium,
    audit?.auditedPremium,
    record.newPremiumAmount,
    record.policyPremiumAmount,
    nestedPolicy?.premiumAmount
  );

  const versionLabel = firstText(
    version?.policyVersionNumber,
    record.policyVersionNumber,
    record.versionNumber,
    record.currentVersion?.version?.policyVersionNumber
  );

  const hashVerified = typeof record.hashVerified === 'boolean'
    ? record.hashVerified
    : (typeof record.currentVersion?.hashVerified === 'boolean'
      ? record.currentVersion.hashVerified
      : null);

  return { policy, version, audit, auditedPremium, versionLabel, hashVerified };
}
