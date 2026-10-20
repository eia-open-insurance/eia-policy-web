/**
 * Mass tort profile helpers for the Policy record.
 *
 * The profile is policy-owned administrative context: it records the tort, the
 * trigger theory, the allocation method, and the coverage block that guide how
 * long-tail claims are administered. It never edits coverage, limits, or the
 * policy version, and Direct Claims remains the owner of claim allocations.
 */

export const MASS_TORT_STATUS = {
  DRAFT: 'DRAFT',
  COMPLETE: 'COMPLETE'
};

/** Mirrors the Policy expert's allocation-notes cap. */
export const MAX_ALLOCATION_NOTES_LENGTH = 2000;

/**
 * The tort, trigger, and allocation vocabularies match the Policy expert's
 * mass tort profile rules. Offering a value the domain rejects would only turn
 * a select into a 400, so the workbench stays within the implemented catalog.
 */
export const TORT_TYPES = [
  { value: 'ASBESTOS', label: 'Asbestos' },
  { value: 'SILICA', label: 'Silica' },
  { value: 'TALC', label: 'Talc' },
  { value: 'PFAS', label: 'PFAS / AFFF' },
  { value: 'OPIOIDS', label: 'Opioids' },
  { value: 'PRODUCT_LIABILITY', label: 'Product liability' },
  { value: 'ENVIRONMENTAL', label: 'Environmental contamination' },
  { value: 'OTHER', label: 'Other' }
];

export const TRIGGER_THEORIES = [
  { value: 'EXPOSURE', label: 'Exposure' },
  { value: 'MANIFESTATION', label: 'Manifestation' },
  { value: 'INJURY', label: 'Injury' },
  { value: 'REVISIONIST', label: 'Revisionist' }
];

/**
 * The allocation method is the profile's guidance to Direct Claims. The
 * explanations are administrative, not legal advice: the domain records the
 * agreed method and applies it to the claim allocation.
 */
export const ALLOCATION_METHODS = [
  {
    value: 'ALL_SUMS',
    label: 'All sums',
    description: 'Any triggered policy year may respond, up to that year\'s limits.'
  },
  {
    value: 'PRO_RATA_TIME_ON_RISK',
    label: 'Pro rata — time on risk',
    description: 'Allocate in proportion to the time the insured was exposed in each policy year.'
  },
  {
    value: 'PRO_RATA_PREMIUM',
    label: 'Pro rata — premium',
    description: 'Allocate in proportion to the premium earned in each triggered policy year.'
  },
  {
    value: 'EQUAL_SHARES',
    label: 'Equal shares',
    description: 'Divide the loss evenly across the triggered policy years.'
  },
  {
    value: 'STACKED_LIMITS',
    label: 'Stacked limits',
    description: 'Apply triggered years and layers in sequence, stacking their limits.'
  },
  {
    value: 'CUSTOM_MATRIX',
    label: 'Custom matrix',
    description: 'Use the agreed allocation matrix; record its basis and percentages in the notes.'
  }
];

const TORT_LABELS = Object.fromEntries(TORT_TYPES.map((entry) => [entry.value, entry.label]));const TRIGGER_LABELS = Object.fromEntries(TRIGGER_THEORIES.map((entry) => [entry.value, entry.label]));
const ALLOCATION_LABELS = Object.fromEntries(
  ALLOCATION_METHODS.map((entry) => [entry.value, entry.label])
);
const ALLOCATION_DESCRIPTIONS = Object.fromEntries(
  ALLOCATION_METHODS.map((entry) => [entry.value, entry.description])
);

export function emptyMassTortState() {
  return { profile: null, loading: false, error: '' };
}

export function tortTypeLabel(value) {
  const normalized = String(value || '');
  return TORT_LABELS[normalized] || normalized.replace(/_/g, ' ') || '—';
}

export function triggerLabel(value) {
  const normalized = String(value || '').toUpperCase();
  return TRIGGER_LABELS[normalized] || normalized.replace(/_/g, ' ') || '—';
}

export function allocationMethodLabel(value) {
  const normalized = String(value || '').toUpperCase();
  return ALLOCATION_LABELS[normalized] || normalized.replace(/_/g, ' ') || '—';
}

export function allocationMethodDescription(value) {
  const normalized = String(value || '').toUpperCase();
  return ALLOCATION_DESCRIPTIONS[normalized] || '';
}

export function massTortStatusTone(status) {
  return String(status || '').toUpperCase() === MASS_TORT_STATUS.COMPLETE ? 'green' : 'amber';
}

export function isMassTortComplete(profile) {
  return String(profile?.status || '').toUpperCase() === MASS_TORT_STATUS.COMPLETE;
}

export function coverageBlockLabel(profile) {
  const start = profile?.coverageBlockStart || '';
  const end = profile?.coverageBlockEnd || '';
  if (start && end) return `${start} – ${end}`;
  return start || end || '—';
}

/**
 * A profile created from the record starts with the policy term as the
 * coverage block; a saved profile keeps exactly what the server returned so a
 * missing value is not silently replaced with the policy dates.
 */
export function defaultMassTortForm(profile, policy) {
  if (profile) {
    return {
      tortType: profile.tortType || '',
      trigger: profile.trigger || '',
      allocationMethod: profile.allocationMethod || '',
      allocationNotes: profile.allocationNotes || '',
      coverageBlockStart: profile.coverageBlockStart || '',
      coverageBlockEnd: profile.coverageBlockEnd || ''
    };
  }
  return {
    tortType: '',
    trigger: '',
    allocationMethod: '',
    allocationNotes: '',
    coverageBlockStart: policy?.effectiveDate || '',
    coverageBlockEnd: policy?.expirationDate || ''
  };
}

/**
 * PUT replaces the profile. The three classification fields are always
 * required by the domain; a draft may omit the notes and the coverage block.
 * Marking the profile complete additionally requires the notes and both
 * coverage-block dates, because Direct Claims consumes the complete profile to
 * drive allocation.
 */
export function validateMassTortForm(form, status = MASS_TORT_STATUS.DRAFT) {
  const complete = String(status || '').toUpperCase() === MASS_TORT_STATUS.COMPLETE;
  const scope = complete ? 'before marking the profile complete' : 'before saving the profile';
  const start = String(form?.coverageBlockStart || '');
  const end = String(form?.coverageBlockEnd || '');
  const notes = String(form?.allocationNotes || '').trim();

  if (!String(form?.tortType || '').trim()) {
    return `Select a tort type ${scope}.`;
  }
  if (!String(form?.trigger || '').trim()) {
    return `Select a trigger ${scope}.`;
  }
  if (!String(form?.allocationMethod || '').trim()) {
    return `Select an allocation method ${scope}.`;
  }
  if (notes.length > MAX_ALLOCATION_NOTES_LENGTH) {
    return `Allocation notes must be at most ${MAX_ALLOCATION_NOTES_LENGTH} characters.`;
  }
  if (complete && !notes) {
    return 'Enter allocation notes before marking the profile complete.';
  }
  if (start && end && end < start) {
    return 'Coverage block end must be on or after the coverage block start.';
  }
  if (complete && !start) {
    return 'Enter the coverage block start before marking the profile complete.';
  }
  if (complete && !end) {
    return 'Enter the coverage block end before marking the profile complete.';
  }
  return '';
}

export function massTortPayload(form, status = MASS_TORT_STATUS.DRAFT) {
  const notes = String(form?.allocationNotes || '').trim();
  return {
    tortType: form?.tortType || null,
    triggerType: form?.trigger || null,
    allocationMethod: form?.allocationMethod || null,
    allocationNotes: notes || null,
    coverageBlockStart: form?.coverageBlockStart || null,
    coverageBlockEnd: form?.coverageBlockEnd || null,
    status: String(status || MASS_TORT_STATUS.DRAFT).toUpperCase()
  };
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

function blockField(block, ...names) {
  for (const name of names) {
    if (block[name] !== undefined && block[name] !== null && block[name] !== '') {
      return block[name];
    }
  }
  return '';
}

/**
 * Normalizes the profile read. The public API returns `profileId` and
 * `triggerType`; the SPEC names (`directTortCode`, `triggerTheory`, and a
 * period window) and a wrapped `{profile: …}` body are tolerated so rollout
 * cannot break the tab.
 */
export function normalizeMassTortProfile(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const source = body.profile && typeof body.profile === 'object' && !Array.isArray(body.profile)
    ? { ...body, ...body.profile }
    : body;
  const block = source.coverageBlock
    && typeof source.coverageBlock === 'object'
    && !Array.isArray(source.coverageBlock)
    ? source.coverageBlock
    : {};

  const blocks = Array.isArray(source.coverageBlocks)
    ? source.coverageBlocks
    : Array.isArray(source.blocks)
      ? source.blocks
      : [];

  let coverageBlockStart = dateOnly(firstText(
    source.coverageBlockStart,
    source.coverageBlockFrom,
    source.coverageBlockStartDate,
    source.periodFrom,
    source.coveragePeriodFrom,
    source.exposurePeriodFrom,
    blockField(block, 'start', 'from', 'periodFrom', 'startDate')
  ));
  let coverageBlockEnd = dateOnly(firstText(
    source.coverageBlockEnd,
    source.coverageBlockTo,
    source.coverageBlockEndDate,
    source.periodTo,
    source.coveragePeriodTo,
    source.exposurePeriodTo,
    blockField(block, 'end', 'to', 'periodTo', 'endDate')
  ));

  if (blocks.length > 0) {
    const starts = blocks
      .map((entry) => dateOnly(firstText(entry?.periodFrom, entry?.start, entry?.from)))
      .filter(Boolean)
      .sort();
    const ends = blocks
      .map((entry) => dateOnly(firstText(entry?.periodTo, entry?.end, entry?.to)))
      .filter(Boolean)
      .sort();
    if (!coverageBlockStart && starts.length > 0) coverageBlockStart = starts[0];
    if (!coverageBlockEnd && ends.length > 0) coverageBlockEnd = ends[ends.length - 1];
  }

  const tortType = firstText(
    source.tortType,
    source.directTortCode,
    source.tortCode,
    source.primaryTortCode
  );
  const trigger = firstText(
    source.triggerType,
    source.trigger,
    source.triggerTheory,
    source.coverageTrigger
  ).toUpperCase();
  const allocationMethod = firstText(
    source.allocationMethod,
    source.allocation,
    source.allocationBasis
  ).toUpperCase();
  const allocationNotes = firstText(
    source.allocationNotes,
    source.allocationNote,
    source.notes
  );
  const id = firstText(source.id, source.profileId, source.massTortProfileId);
  const statusText = firstText(
    source.status,
    source.profileStatus,
    body.status
  ).toUpperCase();
  const completedFlag = source.complete === true || source.isComplete === true;
  const status = statusText === MASS_TORT_STATUS.COMPLETE || completedFlag
    ? MASS_TORT_STATUS.COMPLETE
    : MASS_TORT_STATUS.DRAFT;

  const hasProfile = Boolean(
    id || tortType || trigger || allocationMethod || allocationNotes
    || coverageBlockStart || coverageBlockEnd || statusText
  );
  if (!hasProfile) return null;

  return {
    id,
    tortType,
    trigger,
    allocationMethod,
    allocationNotes,
    coverageBlockStart,
    coverageBlockEnd,
    status,
    updatedAt: firstText(source.updatedAt, source.lastReviewedAt),
    version: source.version ?? null
  };
}
