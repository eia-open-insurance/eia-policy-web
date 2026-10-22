/**
 * Rating worksheet helpers for the Policy record.
 *
 * Rating is the policy's reproducible premium calculation. Every submission
 * persists an immutable worksheet with the normalized method, operands,
 * computed premium, and a canonical SHA-256 hash; the policy premium only
 * moves when the operator applies the result. A worksheet never changes
 * coverage grants or limits, and premium corrections after issue belong to
 * the Premium audit workflow on the Endorsements tab.
 */

export const RATING_METHOD_RATE_TIMES_EXPOSURE = 'RATE_TIMES_EXPOSURE';
export const RATING_METHOD_FLAT = 'FLAT';

/** The domain rates a policy only while it is still a draft or a quote. */
export const RATEABLE_STATUSES = ['DRAFT', 'QUOTED'];

/** numeric(19,4) upper bound enforced by the Policy expert. */
export const MAX_RATING_PREMIUM = 999999999999999.9999;

export const RATING_METHODS = [
  {
    value: RATING_METHOD_RATE_TIMES_EXPOSURE,
    label: 'Rate × exposure',
    description: 'Base rate × exposure amount × factor.'
  },
  {
    value: RATING_METHOD_FLAT,
    label: 'Flat',
    description: 'Base rate × factor; no exposure amount is stored.'
  }
];

const METHOD_LABELS = Object.fromEntries(
  RATING_METHODS.map((entry) => [entry.value, entry.label])
);
const METHOD_DESCRIPTIONS = Object.fromEntries(
  RATING_METHODS.map((entry) => [entry.value, entry.description])
);

function objectOrNull(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function firstText(...values) {
  for (const value of values) {
    if (value === undefined || value === null) continue;
    const text = String(value).trim();
    if (text) return text;
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

export function normalizeRatingMethod(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function isRateable(status) {
  return RATEABLE_STATUSES.includes(String(status || '').trim().toUpperCase());
}

/** The reason shown when the record's status does not allow rating. */
export function ratingUnavailableReason(status) {
  if (isRateable(status)) return '';
  const current = String(status || '').trim() || 'unknown';
  return `Rating is available only when the policy is DRAFT or QUOTED. This policy is ${current}.`;
}

export function emptyRatingState() {
  return { worksheet: null, loading: false, error: '' };
}

/**
 * The calculator starts on the exposure method with a neutral factor so the
 * operator supplies the rate and exposure explicitly rather than inheriting a
 * value from the policy premium. Applying is always an explicit opt-in.
 */
export function defaultRatingForm() {
  return {
    ratingMethod: RATING_METHOD_RATE_TIMES_EXPOSURE,
    baseRate: '',
    exposureAmount: '',
    factor: '1',
    apply: false
  };
}

export function ratingMethodLabel(value) {
  const method = normalizeRatingMethod(value);
  return METHOD_LABELS[method] || method.replace(/_/g, ' ') || '—';
}

export function ratingMethodDescription(value) {
  return METHOD_DESCRIPTIONS[normalizeRatingMethod(value)] || '';
}

export function ratingUsesExposure(method) {
  return normalizeRatingMethod(method) === RATING_METHOD_RATE_TIMES_EXPOSURE;
}

/** Removes storage padding (250000.0000 → 250000) without losing precision. */
export function trimDecimal(value) {
  const text = String(value ?? '').trim();
  if (!text || !text.includes('.')) return text;
  return text.replace(/0+$/, '').replace(/\.$/, '');
}

/** Rates are small decimals, so they are not shown with the money cents format. */
export function formatRatingRate(value, currency = '') {
  const text = trimDecimal(value);
  if (!text) return '—';
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) return currency ? `${text} ${currency}` : text;
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6
  }).format(numeric);
  return currency ? `${formatted} ${currency}` : formatted;
}

export function formatRatingFactor(value) {
  return trimDecimal(value) || '—';
}

/** UTC keeps the worksheet timestamp stable in tests and across operators. */
export function formatRatingTimestamp(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  }).format(date);
}

/** Notice-sized hash reference; the card always renders the full digest. */
export function shortRatingHash(value, length = 12) {
  const hash = String(value || '').trim();
  if (!hash) return '';
  return hash.length > length ? `${hash.slice(0, length)}…` : hash;
}

function ratingNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

/** HALF_UP rounding, matching the money contract the expert applies. */
function roundHalfUp(value, digits) {
  const scale = 10 ** digits;
  return Math.round((value + Number.EPSILON) * scale) / scale;
}

function normalizeOperand(value, digits) {
  return roundHalfUp(value, digits);
}

/**
 * The live preview and the submit validation share one calculation so the
 * amount on screen is the amount that is posted. Operands are normalized to
 * the expert's scales (rate/factor 6, exposure and premium 4) before the
 * product is rounded once to four decimals.
 */
export function ratingPreview(form) {
  const method = normalizeRatingMethod(form?.ratingMethod);
  if (!METHOD_LABELS[method]) {
    return { premium: null, error: 'Select a rating method.' };
  }

  const baseRate = ratingNumber(form?.baseRate);
  if (baseRate === null) {
    return { premium: null, error: 'Base rate is required.' };
  }
  if (baseRate < 0) {
    return { premium: null, error: 'Base rate must be zero or greater.' };
  }

  let exposure = null;
  if (method === RATING_METHOD_RATE_TIMES_EXPOSURE) {
    exposure = ratingNumber(form?.exposureAmount);
    if (exposure === null) {
      return {
        premium: null,
        error: 'Exposure amount is required for RATE_TIMES_EXPOSURE.'
      };
    }
    if (exposure <= 0) {
      return {
        premium: null,
        error: 'Exposure amount must be greater than zero for RATE_TIMES_EXPOSURE.'
      };
    }
    exposure = normalizeOperand(exposure, 4);
  }

  const factorText = String(form?.factor ?? '').trim();
  const factorInput = factorText === '' ? 1 : ratingNumber(factorText);
  if (factorInput === null) {
    return { premium: null, error: 'Factor must be a number.' };
  }
  if (factorInput < 0) {
    return { premium: null, error: 'Factor must be zero or greater.' };
  }

  const normalizedBaseRate = normalizeOperand(baseRate, 6);
  const normalizedFactor = normalizeOperand(factorInput, 6);
  const product = method === RATING_METHOD_RATE_TIMES_EXPOSURE
    ? normalizedBaseRate * exposure * normalizedFactor
    : normalizedBaseRate * normalizedFactor;
  const premium = roundHalfUp(product, 4);
  if (!Number.isFinite(premium) || premium > MAX_RATING_PREMIUM) {
    return {
      premium: null,
      error: 'The computed premium exceeds the supported numeric(19,4) maximum.'
    };
  }
  return { premium, error: '' };
}

export function validateRatingForm(form) {
  return ratingPreview(form).error;
}

/**
 * The wire shape matches the domain command. FLAT explicitly sends a null
 * exposure so the expert stores no exposure line for that method, and a blank
 * factor becomes the documented default of 1.
 */
export function ratingPayload(form) {
  const method = normalizeRatingMethod(form?.ratingMethod);
  return {
    ratingMethod: method,
    baseRate: String(form?.baseRate ?? '').trim(),
    exposureAmount: ratingUsesExposure(method)
      ? String(form?.exposureAmount ?? '').trim()
      : null,
    factor: String(form?.factor ?? '').trim() || '1',
    apply: Boolean(form?.apply)
  };
}

/**
 * Normalizes the latest-worksheet read. The domain returns the worksheet
 * members directly; a `{worksheet: …}` envelope and the SPEC spellings are
 * tolerated so rollout cannot break the card.
 */
export function normalizeRatingWorksheet(body) {
  const record = objectOrNull(body);
  if (!record) return null;
  const source = objectOrNull(record.worksheet)
    ? record.worksheet
    : objectOrNull(record.ratingWorksheet)
      ? record.ratingWorksheet
      : record;

  const id = firstText(source.id, source.worksheetId, source.ratingWorksheetId);
  const ratingMethod = normalizeRatingMethod(
    firstText(source.ratingMethod, source.method)
  );
  const baseRate = firstAmount(source.baseRate, source.rate);
  const exposureAmount = firstAmount(source.exposureAmount, source.exposure);
  const factor = firstAmount(source.factor);
  const computedPremium = firstAmount(
    source.computedPremium,
    source.premiumAmount,
    source.premium
  );
  const calcHash = firstText(source.calcHash, source.hash, source.calculationHash);
  const currency = firstText(source.currency, source.premiumCurrency).toUpperCase();
  const status = firstText(source.status).toUpperCase();
  const createdAt = firstText(source.createdAt, source.createdOn, source.created);
  const createdBy = firstText(source.createdBy, source.createdById);

  if (!id && !ratingMethod && !computedPremium && !calcHash) return null;

  return {
    id,
    ratingMethod,
    baseRate,
    exposureAmount,
    factor,
    computedPremium,
    currency,
    calcHash,
    status,
    createdAt,
    createdBy
  };
}

/** The command envelope carries the worksheet and, only when applied, the policy. */
export function normalizeRatingResult(body) {
  const record = objectOrNull(body) || {};
  return {
    worksheet: normalizeRatingWorksheet(record.worksheet || record.ratingWorksheet || record),
    policy: objectOrNull(record.policy) ? record.policy : null
  };
}
