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
