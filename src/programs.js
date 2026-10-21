/**
 * Program helpers for the Policy record.
 *
 * A program groups related policies for capacity and aggregate administration.
 * Assigning a policy to a program is an administrative association between the
 * policy and the program catalog: it does not change coverage, limits, premium,
 * or the policy version, and it does not create capacity, coinsurance, or
 * fronting records.
 *
 * Wire contract used by the Program tab:
 *   GET   /api/v1/programs?q={term}&limit={n}  -> {items:[Program]} | [Program]
 *   POST  /api/v1/programs                     -> 201 Program
 *   GET   /api/v1/programs/{programId}         -> Program
 *   PATCH /api/v1/policies/{policyId}/program  -> {programId: uuid | null}
 *
 * A Program carries `id`, a program number (`programNumber` or `code`), `name`,
 * `programType`, `effectiveFrom`/`effectiveTo`, `status`, and the optional
 * `leadPolicyId`/`leadPolicyNumber` pair. The policy record exposes its
 * assignment as `programId`; a nested `{program: {id}}` object is tolerated so
 * a partial rollout cannot break the tab.
 *
 * Capacity is a program-level limit amount and currency. The used amount is the
 * sum of the limits of the policies assigned to the program; assignment never
 * rewrites a policy limit. The program read may return those policy summaries
 * as `policies`/`assignedPolicies`, or the catalog may pre-aggregate them as
 * `usedAmount`/`usedCapacity` plus `policyCount`. Both shapes are accepted so
 * the card can render before the catalog settles on one.
 */

export const PROGRAM_TYPES = [
  { value: 'CASUALTY', label: 'Casualty' },
  { value: 'PROPERTY', label: 'Property' },
  { value: 'COMMERCIAL', label: 'Commercial' },
  { value: 'AUTO', label: 'Auto' },
  { value: 'SPECIALTY', label: 'Specialty' },
  { value: 'OTHER', label: 'Other' }
];

const PROGRAM_TYPE_LABELS = Object.fromEntries(
  PROGRAM_TYPES.map((entry) => [entry.value, entry.label])
);

/** Mirrors the program catalog's `name` column. */
export const MAX_PROGRAM_NAME_LENGTH = 200;

export const PROGRAM_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE'
};

export function emptyProgramState() {
  return { program: null, loading: false, error: '' };
}

export function programsEndpoint(term = '', limit = 8) {
  return `/api/v1/programs?q=${encodeURIComponent(String(term || '').trim())}&limit=${limit}`;
}

export function programEndpoint(programId) {
  return `/api/v1/programs/${encodeURIComponent(programId)}`;
}

export function policyProgramEndpoint(policyId) {
  return `/api/v1/policies/${encodeURIComponent(policyId)}/program`;
}

/**
 * Detaching sends an explicit null so the command is unambiguous on the wire;
 * the domain clears the assignment rather than treating the field as absent.
 */
export function programAttachPayload(programId) {
  return { programId: programId || null };
}

export function programCreatePayload(form, policy) {
  const name = String(form?.name || '').trim();
  const payload = {
    name,
    programType: String(form?.programType || '').toUpperCase(),
    effectiveFrom: form?.effectiveFrom || null,
    effectiveTo: form?.effectiveTo || null
  };
  // Capacity is optional and belongs to the program, not to the policy. An
  // empty amount omits both members so "no capacity limit" is unambiguous.
  const capacityAmount = String(form?.capacityAmount ?? '').trim();
  if (capacityAmount) {
    payload.capacityAmount = capacityAmount;
    payload.capacityCurrency = String(form?.capacityCurrency || '').trim().toUpperCase();
  }
  // The current policy is the default lead policy; clearing the checkbox
  // creates a program without a lead policy instead of silently keeping one.
  const leadPolicyId = form?.leadPolicy === false ? '' : String(policy?.id || '');
  if (leadPolicyId) payload.leadPolicyId = leadPolicyId;
  return payload;
}

export function programTypeLabel(value) {
  const normalized = String(value || '').toUpperCase();
  return PROGRAM_TYPE_LABELS[normalized] || (normalized ? normalized.replace(/_/g, ' ') : '—');
}

export function programStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === PROGRAM_STATUS.ACTIVE) return 'green';
  if (normalized === PROGRAM_STATUS.INACTIVE) return 'amber';
  return 'blue';
}

/** Human name first: the list and notices read better than the catalog code. */
export function programLabel(program) {
  if (!program) return '—';
  return program.name || program.number || program.id || '—';
}

/** Catalog identity plus name, for pickers and headings. */
export function programDisplayLabel(program) {
  if (!program) return '—';
  const parts = [program.number, program.name].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  return program.id || '—';
}

export function programTermLabel(program) {
  const from = program?.effectiveFrom || '';
  const to = program?.effectiveTo || '';
  if (from && to) return `${from} – ${to}`;
  return from || to || '—';
}

/**
 * Defaults for the create form follow the policy term so a new program covers
 * the policy it is created from. The current policy is the default lead policy.
 */
export function defaultProgramForm(policy) {
  return {
    name: '',
    programType: '',
    effectiveFrom: policy?.effectiveDate || '',
    effectiveTo: policy?.expirationDate || '',
    capacityAmount: '',
    capacityCurrency: policy?.limitCurrency || 'USD',
    leadPolicy: true
  };
}

export function validateProgramForm(form) {
  if (!String(form?.name || '').trim()) {
    return 'Enter the program name before creating the program.';
  }
  if (!String(form?.programType || '').trim()) {
    return 'Select a program type before creating the program.';
  }
  if (!form?.effectiveFrom) {
    return 'Choose the program effective date before creating the program.';
  }
  if (form.effectiveTo && form.effectiveTo < form.effectiveFrom) {
    return 'Program end date must be on or after the start date.';
  }
  const capacityAmount = String(form?.capacityAmount ?? '').trim();
  if (capacityAmount) {
    const numeric = numericValue(capacityAmount);
    if (numeric === null || numeric <= 0) {
      return 'Capacity amount must be a positive number, or leave it blank for no limit.';
    }
    if (!/^[A-Za-z]{3}$/.test(String(form?.capacityCurrency || '').trim())) {
      return 'Capacity currency must be a three-letter ISO 4217 code.';
    }
  }
  return '';
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

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return null;
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const numeric = numericValue(value);
    if (numeric !== null) return numeric;
  }
  return null;
}

function currencyCode(...values) {
  return firstText(...values).toUpperCase();
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.items)) return value.items;
  return null;
}

/**
 * A policy summary on the program read needs its limit to contribute to used
 * capacity. Catalog summaries use `limitAmount`; a nested limit object is
 * accepted for read-shape tolerance.
 */
function normalizeAssignedPolicy(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return null;
  const limit = row.limit && typeof row.limit === 'object' && !Array.isArray(row.limit)
    ? row.limit
    : {};
  const limitAmount = firstNumber(
    row.limitAmount,
    row.policyLimitAmount,
    row.aggregateLimitAmount,
    row.aggregateAmount,
    row.policyLimit,
    typeof row.limit === 'number' || typeof row.limit === 'string' ? row.limit : null,
    limit.amount,
    limit.limitAmount,
    limit.aggregateAmount,
    limit.perOccurrenceAmount,
    row.policy?.limitAmount
  );
  const limitCurrency = currencyCode(
    row.limitCurrency,
    row.currency,
    limit.currency,
    limit.limitCurrency,
    row.policy?.limitCurrency,
    row.policy?.currency
  );
  const id = firstText(row.id, row.policyId, row.policy?.id);
  const policyNumber = firstText(row.policyNumber, row.number, row.policy?.policyNumber);
  if (!id && !policyNumber && limitAmount === null) return null;
  return { id, policyNumber, limitAmount, limitCurrency };
}

/**
 * Normalizes a program read or write response. Catalog field names
 * (`programNumber`, `code`, `programType`) and the summary shape used by
 * lookups (`label`, `secondary`) are both accepted; a `{program: …}` wrapper
 * is unwrapped.
 */
export function normalizeProgram(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const source = body.program
    && typeof body.program === 'object'
    && !Array.isArray(body.program)
    ? { ...body, ...body.program }
    : body;

  const id = firstText(source.id, source.programId);
  const number = firstText(
    source.programNumber,
    source.programCode,
    source.code,
    source.number,
    source.label
  );
  const name = firstText(source.name, source.programName, source.title, source.secondary);
  const type = firstText(source.programType, source.type).toUpperCase();
  const status = firstText(source.status).toUpperCase();
  const leadPolicyId = firstText(
    source.leadPolicyId,
    source.leadPolicy?.id,
    source.leadPolicyPolicyId
  );
  const leadPolicyNumber = firstText(
    source.leadPolicyNumber,
    source.leadPolicy?.policyNumber,
    source.leadPolicy?.number
  );
  const capacitySource = source.capacity
    && typeof source.capacity === 'object'
    && !Array.isArray(source.capacity)
    ? source.capacity
    : {};
  const capacityAmount = firstText(
    source.capacityAmount,
    source.capacityLimitAmount,
    source.capacityLimit,
    source.limitCapacityAmount,
    typeof source.capacity === 'number' || typeof source.capacity === 'string'
      ? source.capacity
      : null,
    capacitySource.amount,
    capacitySource.capacityAmount,
    capacitySource.limitAmount,
    capacitySource.limit,
    capacitySource.capacityLimit,
    capacitySource.totalAmount
  );
  const capacityCurrency = currencyCode(
    source.capacityCurrency,
    capacitySource.currency,
    capacitySource.currencyCode,
    capacitySource.limitCurrency
  );
  const assignedSource = [
    source.policies,
    source.assignedPolicies,
    source.assignedPolicySummaries,
    source.programPolicies,
    source.policySummaries,
    source.policyAssignments
  ].map(arrayValue).find((rows) => Array.isArray(rows)) || null;
  const assignedPolicies = assignedSource
    ? assignedSource.map(normalizeAssignedPolicy).filter(Boolean)
    : [];
  const usedCapacityAmount = firstText(
    source.usedAmount,
    source.usedCapacityAmount,
    source.usedCapacity,
    source.capacityUsedAmount,
    source.capacityUtilizedAmount,
    source.utilizedAmount,
    source.utilizedCapacityAmount,
    capacitySource.usedAmount,
    capacitySource.usedCapacityAmount,
    capacitySource.usedCapacity,
    capacitySource.used,
    capacitySource.utilizedAmount,
    capacitySource.consumedAmount
  );
  const usedCapacityCurrency = currencyCode(
    source.usedAmountCurrency,
    source.usedCapacityCurrency,
    source.usedCurrency,
    capacitySource.usedAmountCurrency,
    capacitySource.usedCapacityCurrency,
    capacitySource.usedCurrency
  );
  const policyCount = firstNumber(
    source.policyCount,
    source.assignedPolicyCount,
    source.policiesCount,
    capacitySource.policyCount,
    capacitySource.assignedPolicyCount,
    capacitySource.count
  );

  const hasProgram = Boolean(id || number || name || type || status);
  if (!hasProgram) return null;

  return {
    id,
    number,
    name,
    type,
    effectiveFrom: dateOnly(firstText(source.effectiveFrom, source.effectiveDate, source.startDate)),
    effectiveTo: dateOnly(firstText(source.effectiveTo, source.expirationDate, source.endDate)),
    status,
    leadPolicyId,
    leadPolicyNumber,
    capacityAmount,
    capacityCurrency,
    assignedPolicies,
    hasAssignedPolicies: Boolean(assignedSource),
    usedCapacityAmount,
    usedCapacityCurrency,
    policyCount,
    description: firstText(source.description)
  };
}

/** Reads either the catalog page envelope or a bare array of programs. */
export function normalizeProgramList(body) {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.programs)
        ? body.programs
        : [];
  return rows.map(normalizeProgram).filter(Boolean);
}

/**
 * Derives the card's capacity figures. Capacity belongs to the program; used
 * capacity is the sum of the limits of the program's assigned policies. The
 * pre-aggregated `usedAmount`/`policyCount` members are only a fallback for a
 * catalog read that does not return policy summaries.
 */
export function programCapacitySummary(program) {
  const capacityAmount = numericValue(program?.capacityAmount);
  const rows = Array.isArray(program?.assignedPolicies) ? program.assignedPolicies : [];
  const hasRows = program?.hasAssignedPolicies === true || rows.length > 0;
  let usedAmount = null;
  let usedCurrency = '';
  let policyCount = null;

  if (hasRows) {
    policyCount = rows.length;
    if (rows.length === 0) {
      // An explicitly empty assignment list is a known zero, not missing data.
      usedAmount = 0;
      usedCurrency = currencyCode(
        program?.usedCapacityCurrency,
        program?.capacityCurrency
      );
    } else {
      const limits = rows
        .map((row) => numericValue(row?.limitAmount))
        .filter((value) => value !== null);
      if (limits.length > 0) {
        usedAmount = limits.reduce((sum, value) => sum + value, 0);
        // Keep used in the program's capacity currency when it is known; policy
        // summaries are only a fallback for a catalog that omits it.
        usedCurrency = currencyCode(
          program?.capacityCurrency,
          ...rows.map((row) => row?.limitCurrency),
          program?.usedCapacityCurrency
        );
      }
    }
  }

  if (usedAmount === null) {
    usedAmount = numericValue(program?.usedCapacityAmount);
    if (usedAmount !== null) {
      usedCurrency = currencyCode(
        program?.usedCapacityCurrency,
        program?.capacityCurrency
      );
    }
  }
  if (policyCount === null) policyCount = numericValue(program?.policyCount);

  const currency = currencyCode(program?.capacityCurrency, usedCurrency);
  if (!usedCurrency) usedCurrency = currency;

  const hasCapacity = capacityAmount !== null && capacityAmount > 0;
  const utilizationPercent = hasCapacity && usedAmount !== null
    ? (usedAmount / capacityAmount) * 100
    : null;

  return {
    hasCapacity,
    capacityAmount,
    currency,
    usedAmount,
    usedCurrency,
    policyCount,
    utilizationPercent,
    overCapacity: utilizationPercent !== null && utilizationPercent > 100,
    remainingAmount: capacityAmount !== null && usedAmount !== null
      ? capacityAmount - usedAmount
      : null
  };
}

/** A whole percentage stays whole; a fractional one keeps one decimal. */
export function formatUtilizationPercent(value) {
  const numeric = numericValue(value);
  if (numeric === null) return '—';
  const rounded = Math.round(numeric * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

/** The bar fills to 100 at most; over-capacity is carried by the label. */
export function capacityProgressWidth(value) {
  const numeric = numericValue(value);
  if (numeric === null) return 0;
  return Math.max(0, Math.min(100, Math.round(numeric * 100) / 100));
}

/**
 * The assignment is a single program per policy. The id is read from the flat
 * `programId` member; a nested program object is accepted for rollout safety.
 */
export function policyProgramId(policy) {
  if (!policy || typeof policy !== 'object') return '';
  return firstText(
    policy.programId,
    policy.program?.id,
    policy.program?.programId
  );
}
