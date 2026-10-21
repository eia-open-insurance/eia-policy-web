/**
 * Legal-entity helpers for the Policy record.
 *
 * A policy is issued by exactly one legal entity: the licensed carrier that
 * writes the policy and owns its billing, tax, and regulatory reporting.
 * Assigning a legal entity is an administrative association between the policy
 * and the legal-entity catalog: it does not change coverage, limits, premium, or
 * the policy version, and it does not create capacity, coinsurance, fronting,
 * or intercompany records.
 *
 * Wire contract used by the Legal entity tab:
 *   GET   /api/v1/legal-entities?q={term}&limit={n} -> {items:[LegalEntity]} | [LegalEntity]
 *   POST  /api/v1/legal-entities                    -> 201 LegalEntity
 *   GET   /api/v1/legal-entities/{legalEntityId}    -> LegalEntity
 *   PATCH /api/v1/policies/{policyId}/legal-entity  -> {legalEntityId: uuid | null}
 *
 * A LegalEntity carries `id`, a business code (`entityCode` or `code`), a legal
 * name (`legalName` or `name`), an entity type (`entityType` or `type`), a
 * jurisdiction (`jurisdiction`, or the domicile pair `domicileCountry` /
 * `domicileRegion`), a `regulator`, a `license` reference, and a `status`. The
 * policy record exposes its assignment as `legalEntityId`; a nested
 * `{legalEntity: {id}}` object and the SPEC name `issuingLegalEntityId` are
 * tolerated so a partial rollout cannot break the tab.
 */

/** Mirrors the SPEC `LegalEntityType` catalog. */
export const LEGAL_ENTITY_TYPES = [
  { value: 'INSURER', label: 'Insurer' },
  { value: 'REINSURER', label: 'Reinsurer' },
  { value: 'MGA', label: 'MGA' },
  { value: 'TPA', label: 'TPA' },
  { value: 'CAPTIVE', label: 'Captive' },
  { value: 'SYNDICATE', label: 'Syndicate' },
  { value: 'HOLDING', label: 'Holding' },
  { value: 'SERVICE_COMPANY', label: 'Service company' }
];

const LEGAL_ENTITY_TYPE_LABELS = Object.fromEntries(
  LEGAL_ENTITY_TYPES.map((entry) => [entry.value, entry.label])
);

/** Mirrors the legal-entity catalog's `entity_code` column. */
export const MAX_LEGAL_ENTITY_CODE_LENGTH = 16;
/** Mirrors the legal-entity catalog's `legal_name` column. */
export const MAX_LEGAL_ENTITY_NAME_LENGTH = 300;
/** ISO 3166-2 region or regulator code, e.g. `US-DE` or `US-NAIC`. */
export const MAX_LEGAL_ENTITY_JURISDICTION_LENGTH = 2;
/** Mirrors the legal-entity catalog's `regulator` column. */
export const MAX_LEGAL_ENTITY_REGULATOR_LENGTH = 120;
/** License reference as printed on the carrier's certificate. */
export const MAX_LEGAL_ENTITY_LICENSE_LENGTH = 64;

export const LEGAL_ENTITY_STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  LIQUIDATING: 'LIQUIDATING'
};

export function emptyLegalEntityState() {
  return { legalEntity: null, loading: false, error: '' };
}

export function legalEntitiesEndpoint(term = '', limit = 8) {
  return `/api/v1/legal-entities?q=${encodeURIComponent(String(term || '').trim())}&limit=${limit}`;
}

export function legalEntityEndpoint(legalEntityId) {
  return `/api/v1/legal-entities/${encodeURIComponent(legalEntityId)}`;
}

export function policyLegalEntityEndpoint(policyId) {
  return `/api/v1/policies/${encodeURIComponent(policyId)}/legal-entity`;
}

/**
 * Detaching sends an explicit null so the command is unambiguous on the wire;
 * the domain clears the assignment rather than treating the field as absent.
 */
export function legalEntityAttachPayload(legalEntityId) {
  return { legalEntityId: legalEntityId || null };
}

/**
 * The create form collects the catalog's business fields. Optional references
 * are omitted rather than sent as empty strings so the domain never has to
 * distinguish "blank" from "absent".
 */
export function legalEntityCreatePayload(form) {
  const payload = {
    code: String(form?.code || '').trim(),
    name: String(form?.name || '').trim(),
    entityType: String(form?.type || '').trim().toUpperCase(),
    jurisdiction: String(form?.jurisdiction || '').trim().toUpperCase()
  };
  const regulator = String(form?.regulator || '').trim();
  const license = String(form?.license || '').trim();
  if (regulator) payload.regulator = regulator;
  if (license) payload.licenseNumber = license;
  return payload;
}

export function legalEntityTypeLabel(value) {
  const normalized = String(value || '').toUpperCase();
  return LEGAL_ENTITY_TYPE_LABELS[normalized]
    || (normalized ? normalized.replace(/_/g, ' ') : '—');
}

export function legalEntityStatusTone(status) {
  const normalized = String(status || '').toUpperCase();
  if (normalized === LEGAL_ENTITY_STATUS.ACTIVE) return 'green';
  if (normalized === LEGAL_ENTITY_STATUS.INACTIVE) return 'amber';
  if (normalized === LEGAL_ENTITY_STATUS.LIQUIDATING) return 'red';
  return 'blue';
}

/** Human name first: notices and pickers read better than the catalog code. */
export function legalEntityLabel(legalEntity) {
  if (!legalEntity) return '—';
  return legalEntity.name || legalEntity.code || legalEntity.id || '—';
}

/** Catalog identity plus name, for pickers and headings. */
export function legalEntityDisplayLabel(legalEntity) {
  if (!legalEntity) return '—';
  const parts = [legalEntity.code, legalEntity.name].filter(Boolean);
  if (parts.length > 0) return parts.join(' · ');
  return legalEntity.id || '—';
}

export function legalEntityJurisdictionLabel(legalEntity) {
  if (!legalEntity) return '—';
  return legalEntity.jurisdiction || '—';
}

/** The create form starts blank; the operator records the issuing carrier. */
export function defaultLegalEntityForm() {
  return {
    code: '',
    name: '',
    type: '',
    jurisdiction: '',
    regulator: '',
    license: ''
  };
}

export function validateLegalEntityForm(form) {
  if (!String(form?.code || '').trim()) {
    return 'Enter the legal entity code before creating the legal entity.';
  }
  if (!String(form?.name || '').trim()) {
    return 'Enter the legal entity name before creating the legal entity.';
  }
  if (!String(form?.type || '').trim()) {
    return 'Select the legal entity type before creating the legal entity.';
  }
  const jurisdiction = String(form?.jurisdiction || '').trim().toUpperCase();
  if (!jurisdiction) {
    return 'Enter the jurisdiction before creating the legal entity.';
  }
  if (!/^[A-Z]{2}$/.test(jurisdiction)) {
    return 'Enter a two-letter jurisdiction code.';
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

/**
 * Normalizes a legal-entity read or write response. Catalog field names
 * (`entityCode`, `legalName`, `entityType`, `domicileCountry`/`domicileRegion`)
 * and the shorter names used by the create form (`code`, `name`, `type`,
 * `jurisdiction`) are both accepted; a `{legalEntity: …}` wrapper is unwrapped.
 */
export function normalizeLegalEntity(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const source = body.legalEntity
    && typeof body.legalEntity === 'object'
    && !Array.isArray(body.legalEntity)
    ? { ...body, ...body.legalEntity }
    : body;

  const id = firstText(source.id, source.legalEntityId);
  const code = firstText(
    source.entityCode,
    source.code,
    source.legalEntityCode,
    source.legalEntityNumber,
    source.number
  );
  const name = firstText(
    source.legalName,
    source.name,
    source.legalEntityName,
    source.displayName,
    source.shortName
  );
  const type = firstText(source.entityType, source.type).toUpperCase();
  const jurisdiction = firstText(
    source.jurisdiction,
    source.domicileRegion,
    source.domicileCountry,
    source.jurisdictionCountry
  );
  const regulator = firstText(source.regulator, source.regulatorName);
  const license = firstText(
    source.license,
    source.licenseNumber,
    source.licence,
    source.licenseCode
  );
  const status = firstText(source.status).toUpperCase();

  const hasLegalEntity = Boolean(id || code || name || type || status);
  if (!hasLegalEntity) return null;

  return {
    id,
    code,
    name,
    shortName: firstText(source.shortName),
    type,
    jurisdiction,
    regulator,
    license,
    status
  };
}

/** Reads either the catalog page envelope or a bare array of legal entities. */
export function normalizeLegalEntityList(body) {
  const rows = Array.isArray(body)
    ? body
    : Array.isArray(body?.items)
      ? body.items
      : Array.isArray(body?.legalEntities)
        ? body.legalEntities
        : [];
  return rows.map(normalizeLegalEntity).filter(Boolean);
}

/**
 * The assignment is a single legal entity per policy. The id is read from the
 * flat `legalEntityId` member; the SPEC name `issuingLegalEntityId` and a
 * nested legal-entity object are accepted for rollout safety.
 */
export function policyLegalEntityId(policy) {
  if (!policy || typeof policy !== 'object') return '';
  return firstText(
    policy.legalEntityId,
    policy.issuingLegalEntityId,
    policy.legalEntity?.id,
    policy.legalEntity?.legalEntityId
  );
}
