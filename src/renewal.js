/**
 * Renewal is a policy command that creates the next term as a new policy
 * record. It never edits the expiring policy: the predecessor keeps its
 * coverage, premium, versions, and history. These helpers keep the date and
 * payload rules out of the rendering layer so the modal can be reasoned about
 * (and tested) independently.
 */

export const RENEWABLE_STATUSES = ['ISSUED', 'IN_FORCE', 'ENDORSED', 'REINSTATED'];

export function isRenewable(status) {
  return RENEWABLE_STATUSES.includes(String(status || '').toUpperCase());
}

/** The tooltip/context shown when the record's status does not allow renewal. */
export function renewalUnavailableReason(status) {
  if (isRenewable(status)) return '';
  const current = String(status || '').trim() || 'unknown';
  return `Renewal is available only when the policy is ISSUED, IN_FORCE, ENDORSED, or REINSTATED. This policy is ${current}.`;
}

/**
 * Parses a `YYYY-MM-DD` date at UTC midnight so day arithmetic never shifts
 * with the browser time zone.
 */
export function parseIsoDate(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function addDays(value, days) {
  const date = parseIsoDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addYears(value, years) {
  const date = parseIsoDate(value);
  if (!date) return '';
  date.setUTCFullYear(date.getUTCFullYear() + years);
  return date.toISOString().slice(0, 10);
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Renewal term defaults: inception is the day after the expiring policy and
 * the term runs one year from that inception. Premium, limit, and currencies
 * start from the current policy and stay editable.
 */
export function defaultRenewalForm(policy) {
  const effectiveDate = addDays(policy?.expirationDate, 1) || todayIsoDate();
  return {
    effectiveDate,
    expirationDate: addYears(effectiveDate, 1) || '',
    premiumAmount: policy?.premiumAmount ?? '',
    premiumCurrency: policy?.premiumCurrency || 'USD',
    limitAmount: policy?.limitAmount ?? '',
    limitCurrency: policy?.limitCurrency || 'USD'
  };
}

export function renewalPayload(form) {
  return {
    effectiveDate: form.effectiveDate,
    expirationDate: form.expirationDate,
    premiumAmount: form.premiumAmount,
    premiumCurrency: String(form.premiumCurrency || '').toUpperCase(),
    limitAmount: form.limitAmount,
    limitCurrency: String(form.limitCurrency || '').toUpperCase()
  };
}

export function validateRenewalForm(form) {
  if (!form.effectiveDate) return 'Effective date is required.';
  if (!form.expirationDate) return 'Expiration date is required.';
  if (form.expirationDate < form.effectiveDate) {
    return 'Expiration date must be on or after the effective date.';
  }
  if (form.premiumAmount === '' || Number(form.premiumAmount) < 0) {
    return 'Premium must be zero or greater.';
  }
  if (form.limitAmount === '' || Number(form.limitAmount) < 0) {
    return 'Limit must be zero or greater.';
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.premiumCurrency || ''))) {
    return 'Premium currency must be a three-letter ISO 4217 code.';
  }
  if (!/^[A-Za-z]{3}$/.test(String(form.limitCurrency || ''))) {
    return 'Limit currency must be a three-letter ISO 4217 code.';
  }
  return '';
}
