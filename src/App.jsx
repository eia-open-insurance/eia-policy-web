import React, { useEffect, useRef, useState } from 'react';
import ActivityTimeline, { activityEndpoint, sortActivityItems } from './ActivityTimeline.jsx';
import EntityPicker from './EntityPicker.jsx';
import LegalEntityPicker from './LegalEntityPicker.jsx';
import ProgramPicker from './ProgramPicker.jsx';
import {
  BILLING_FREQUENCIES,
  billingFrequencyLabel,
  billingPaymentHref,
  billingPlanPayload,
  billingStatusTone,
  canCreatePayment,
  canManageInstallment,
  defaultBillingForm,
  emptyBillingState,
  installmentPaymentPayload,
  isOverdue,
  normalizeBilling,
  normalizePolicyPayments,
  paymentAmountDiffers,
  paymentStatusTone,
  policyPaymentsEndpoint,
  validateBillingForm
} from './billing.js';
import {
  CREDIT_NOTE_REASONS,
  canApplyCreditNote,
  canCancelCreditNote,
  canIssueCreditNote,
  creditNoteEndpoint,
  creditNoteLabel,
  creditNotePayload,
  creditNoteReasonLabel,
  creditNoteStatusEndpoint,
  creditNoteStatusPayload,
  creditNoteStatusTone,
  defaultCreditNoteForm,
  emptyCreditNotesState,
  normalizeCreditNotes,
  validateCreditNoteForm
} from './creditNotes.js';
import {
  ALLOCATION_METHODS,
  MASS_TORT_STATUS,
  MAX_ALLOCATION_NOTES_LENGTH,
  TORT_TYPES,
  TRIGGER_THEORIES,
  allocationMethodDescription,
  allocationMethodLabel,
  coverageBlockLabel,
  defaultMassTortForm,
  emptyMassTortState,
  isMassTortComplete,
  massTortPayload,
  massTortStatusTone,
  normalizeMassTortProfile,
  tortTypeLabel,
  triggerLabel,
  validateMassTortForm
} from './massTort.js';
import { partyEndpoint, partyRecordLabel } from './party.js';
import {
  LEGAL_ENTITY_TYPES,
  MAX_LEGAL_ENTITY_CODE_LENGTH,
  MAX_LEGAL_ENTITY_JURISDICTION_LENGTH,
  MAX_LEGAL_ENTITY_LICENSE_LENGTH,
  MAX_LEGAL_ENTITY_NAME_LENGTH,
  MAX_LEGAL_ENTITY_REGULATOR_LENGTH,
  defaultLegalEntityForm,
  emptyLegalEntityState,
  legalEntityAttachPayload,
  legalEntityCreatePayload,
  legalEntityDisplayLabel,
  legalEntityEndpoint,
  legalEntityJurisdictionLabel,
  legalEntityLabel,
  legalEntityStatusTone,
  legalEntityTypeLabel,
  normalizeLegalEntity,
  policyLegalEntityEndpoint,
  policyLegalEntityId,
  validateLegalEntityForm
} from './legalEntities.js';
import {
  MAX_PROGRAM_NAME_LENGTH,
  PROGRAM_TYPES,
  defaultProgramForm,
  emptyProgramState,
  normalizeProgram,
  policyProgramEndpoint,
  policyProgramId,
  programAttachPayload,
  programCreatePayload,
  programDisplayLabel,
  programEndpoint,
  programLabel,
  programStatusTone,
  programTypeLabel,
  validateProgramForm
} from './programs.js';
import {
  addYears,
  defaultRenewalForm,
  isRenewable,
  renewalPayload,
  renewalUnavailableReason,
  validateRenewalForm
} from './renewal.js';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAGE_SIZE = 20;
const RELATED_LIMIT = 5;
const QUEUE_FILTER_PLACEHOLDER = 'Filter policies by number, product, or status…';
const NEXT_STATUS = {
  DRAFT: 'QUOTED',
  QUOTED: 'BOUND',
  BOUND: 'ISSUED',
  ISSUED: 'IN_FORCE',
  IN_FORCE: 'ENDORSED',
  ENDORSED: 'IN_FORCE',
  REINSTATED: 'IN_FORCE'
};

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'program', label: 'Program' },
  { id: 'legalEntity', label: 'Legal entity' },
  { id: 'versions', label: 'Versions' },
  { id: 'coverages', label: 'Coverages & Limits' },
  { id: 'massTort', label: 'Mass tort' },
  { id: 'endorsements', label: 'Endorsements' },
  { id: 'parties', label: 'Insureds & Locations' },
  { id: 'billing', label: 'Billing' },
  { id: 'cancellation', label: 'Cancellation' },
  { id: 'activity', label: 'Activity' }
];

function isoDate(yearOffset) {
  const date = new Date();
  date.setFullYear(date.getFullYear() + yearOffset);
  return date.toISOString().slice(0, 10);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function initialForm() {
  return {
    policyNumber: '',
    productCode: 'CGL',
    insuredPartyId: '',
    effectiveDate: isoDate(0),
    expirationDate: isoDate(1),
    premiumAmount: '125000.00',
    premiumCurrency: 'USD',
    limitAmount: '2000000.00',
    limitCurrency: 'USD'
  };
}

function formatMoney(amount, currency) {
  if (amount === null || amount === undefined || amount === '') return '—';
  const value = Number(amount);
  if (!Number.isFinite(value) || !currency) return String(amount);
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatPercent(value) {
  if (value === null || value === undefined || value === '') return '—';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return String(value);
  return `${(numeric * 100).toFixed(2)}%`;
}

function formatEtag(version) {
  return `"${version}"`;
}

function nextStatusFor(status) {
  return NEXT_STATUS[status] || null;
}

function shortId(value) {
  if (!value) return '—';
  const text = String(value);
  return text.length > 8 ? `${text.slice(0, 8)}…` : text;
}

function insuredLabel(policy, partyLabels = {}) {
  if (!policy) return '—';
  return partyLabels[policy.insuredPartyId]
    || policy.insuredDisplayName
    || shortId(policy.insuredPartyId);
}

function statusTone(status) {
  if (['IN_FORCE', 'ISSUED', 'REINSTATED', 'RENEWED'].includes(status)) return 'green';
  if (['CANCELLED', 'VOID', 'NON_RENEWED'].includes(status)) return 'red';
  if (['DRAFT', 'BOUND', 'EXPIRED'].includes(status)) return 'amber';
  return 'blue';
}

function documentStatusTone(status) {
  if (['ACTIVE', 'CLASSIFIED'].includes(status)) return 'green';
  if (['REJECTED', 'FAILED', 'DISPOSED'].includes(status)) return 'red';
  if (['PENDING_UPLOAD', 'RECEIVED', 'SCANNING', 'PROCESSING', 'ON_HOLD'].includes(status)) {
    return 'amber';
  }
  return 'blue';
}

function readJson(response) {
  return response.json().catch(() => null);
}

function problemMessage(body, fallback) {
  if (!body) return fallback;
  const summary = body.detail || body.title || body.message || fallback;
  const errors = Array.isArray(body.errors) ? body.errors : Array.isArray(body.details) ? body.details : [];
  if (errors.length === 0) return summary;
  const details = errors
    .map((error) => `${error.field || 'request'}: ${error.message || error.code || 'is invalid'}`)
    .join('; ');
  return `${summary} (${details})`;
}

function newIdempotencyKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `policy-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * The shell owns SPA routing. Pushing history and re-broadcasting popstate keeps
 * cross-vertical links inside the shell; a hard navigation is the last resort.
 */
function navigateTo(path) {
  try {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  } catch (e) {
    window.location.assign(path);
  }
}

function CrossLink({ href, className, title, children, ...rest }) {
  return (
    <a
      href={href}
      className={className}
      title={title}
      {...rest}
      onClick={(event) => {
        event.preventDefault();
        navigateTo(href);
      }}
    >
      {children}
    </a>
  );
}

function searchHref(item, basePath) {
  const href = item?.href;
  if (typeof href === 'string' && href.startsWith('/')) return href;
  return `${basePath}?record=${encodeURIComponent(item?.id || '')}`;
}

function isPolicyRoute() {
  const path = window.location.pathname.replace(/\/+$/, '');
  return path === '' || path === '/index.html' || path === '/policy';
}

function readPolicyUrl() {
  const params = new URLSearchParams(window.location.search);
  return {
    record: (params.get('record') || '').trim(),
    create: params.get('new') === '1'
  };
}

async function api(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.etag) headers['If-Match'] = options.etag;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
  if (options.book) headers['X-EIA-Book'] = options.book;
  const response = await fetch(path, {
    method: options.method || 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const body = await readJson(response);
  return {
    response,
    body,
    etag: response.headers.get('ETag'),
    replayed: response.headers.get('Idempotent-Replayed') === 'true'
  };
}

function pageItems(body) {
  if (Array.isArray(body)) return body;
  return Array.isArray(body?.items) ? body.items : [];
}

export default function App() {
  const [policies, setPolicies] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [links, setLinks] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [queueFilter, setQueueFilter] = useState('');
  const [insuredPartyLabel, setInsuredPartyLabel] = useState('');
  const [partyLabels, setPartyLabels] = useState({});
  const [related, setRelated] = useState({ claims: [], cessions: [], loading: false, error: '' });
  const relatedRequestRef = useRef(0);
  const [documents, setDocuments] = useState({ items: [], loading: false, error: '' });
  const documentsRequestRef = useRef(0);
  const [activity, setActivity] = useState({ items: [], loading: false, error: '' });
  const activityRequestRef = useRef(0);

  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('overview');
  const [tabLoading, setTabLoading] = useState(false);
  const [currentVersion, setCurrentVersion] = useState(null);
  const [versions, setVersions] = useState([]);
  const [coverages, setCoverages] = useState([]);
  const [endorsements, setEndorsements] = useState([]);
  const [insureds, setInsureds] = useState([]);
  const [locations, setLocations] = useState([]);
  const [cancellations, setCancellations] = useState([]);
  const [reinstatements, setReinstatements] = useState([]);
  const [billing, setBilling] = useState(emptyBillingState);
  const billingRequestRef = useRef(0);
  const [creditNotes, setCreditNotes] = useState(emptyCreditNotesState);
  const creditNotesRequestRef = useRef(0);
  const [creditNoteOpen, setCreditNoteOpen] = useState(false);
  const [creditNoteBusyId, setCreditNoteBusyId] = useState(null);
  const [creditNoteCancelId, setCreditNoteCancelId] = useState(null);
  const [creditNoteActionError, setCreditNoteActionError] = useState('');

  const [massTort, setMassTort] = useState(emptyMassTortState);
  const massTortRequestRef = useRef(0);
  const [massTortForm, setMassTortForm] = useState(() => defaultMassTortForm(null, null));
  const [massTortSetup, setMassTortSetup] = useState(false);
  const [massTortSaving, setMassTortSaving] = useState('');
  const [massTortFormError, setMassTortFormError] = useState('');
  const [massTortNotice, setMassTortNotice] = useState('');

  const [program, setProgram] = useState(emptyProgramState);
  const programRequestRef = useRef(0);
  const [programPick, setProgramPick] = useState(null);
  const [programBusy, setProgramBusy] = useState('');
  const [programAttachError, setProgramAttachError] = useState('');
  const [programActionError, setProgramActionError] = useState('');
  const [programCreateOpen, setProgramCreateOpen] = useState(false);
  const [programForm, setProgramForm] = useState(() => defaultProgramForm(null));
  const [programFormError, setProgramFormError] = useState('');
  const [programSaving, setProgramSaving] = useState(false);
  const [programLeadPolicy, setProgramLeadPolicy] = useState(null);

  const [legalEntity, setLegalEntity] = useState(emptyLegalEntityState);
  const legalEntityRequestRef = useRef(0);
  const [legalEntityPick, setLegalEntityPick] = useState(null);
  const [legalEntityBusy, setLegalEntityBusy] = useState('');
  const [legalEntityAttachError, setLegalEntityAttachError] = useState('');
  const [legalEntityActionError, setLegalEntityActionError] = useState('');
  const [legalEntityConflict, setLegalEntityConflict] = useState('');
  const [legalEntityCreateOpen, setLegalEntityCreateOpen] = useState(false);
  const [legalEntityForm, setLegalEntityForm] = useState(() => defaultLegalEntityForm());
  const [legalEntityFormError, setLegalEntityFormError] = useState('');
  const [legalEntitySaving, setLegalEntitySaving] = useState(false);

  const [coverageForm, setCoverageForm] = useState(() => defaultCoverageForm(null));
  const [erosionForm, setErosionForm] = useState({
    claimId: '', allocationId: '', sourceVersion: '1',
    paidAmount: '250000.00', reservedAmount: '50000.00', recoveredAmount: '0.00'
  });
  const [endorsementForm, setEndorsementForm] = useState(defaultEndorsementForm);
  const [insuredForm, setInsuredForm] = useState(() => defaultInsuredForm(null));
  const [locationForm, setLocationForm] = useState(() => defaultLocationForm(null));
  const [cancelForm, setCancelForm] = useState(defaultCancelForm);
  const [reinstateForm, setReinstateForm] = useState(defaultReinstateForm);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewForm, setRenewForm] = useState(() => defaultRenewalForm(null));
  const [renewBusy, setRenewBusy] = useState(false);
  const [renewError, setRenewError] = useState('');
  const [renewedFrom, setRenewedFrom] = useState(null);
  const [billingForm, setBillingForm] = useState(() => defaultBillingForm(null));
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingInstallmentId, setBillingInstallmentId] = useState(null);
  const [linkPaymentInstallment, setLinkPaymentInstallment] = useState(null);
  const [linkedPayments, setLinkedPayments] = useState({});

  async function load(pageToLoad = 0) {
    setLoading(true);
    try {
      const { response, body } = await api(`/api/v1/policies?page=${pageToLoad}&size=${PAGE_SIZE}`);
      if (!response.ok) {
        setError(problemMessage(body, `Load failed: ${response.status}`));
        return;
      }
      const envelope = Array.isArray(body) ? null : body;
      const items = pageItems(body);
      setPolicies(items);
      setPage(Number.isInteger(envelope?.page) ? envelope.page : pageToLoad);
      setTotal(Number.isInteger(envelope?.total) ? envelope.total : items.length);
      setLinks(envelope?._links || {});
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let active = true;
    const applyUrl = async (reload) => {
      if (reload) await load(0);
      if (!active || !isPolicyRoute()) return;
      const { record, create } = readPolicyUrl();
      setShowCreate(create);
      if (record) await openPolicy(record);
      else closeSelected();
    };
    applyUrl(true).catch((e) => setError(e.message));
    const onPopState = () => {
      applyUrl(false).catch((e) => setError(e.message));
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      active = false;
      window.removeEventListener('popstate', onPopState);
    };
  }, []);

  const selectedInsuredPartyId = selected?.policy?.insuredPartyId || '';

  /**
   * Resolves the insured party through the Party API after the policy record
   * is already on screen. A 404 or an unavailable Party service never blocks
   * rendering: the cross-link falls back to the short UUID.
   */
  useEffect(() => {
    if (!selectedInsuredPartyId) return undefined;
    let alive = true;
    api(partyEndpoint(selectedInsuredPartyId))
      .then(({ response, body }) => {
        if (!alive || !response.ok || !body) return;
        const label = partyRecordLabel(body);
        if (!label) return;
        setPartyLabels((current) => (
          current[selectedInsuredPartyId] === label
            ? current
            : { ...current, [selectedInsuredPartyId]: label }
        ));
      })
      .catch(() => {
        // Party lookup is an enhancement; the record still renders.
      });
    return () => {
      alive = false;
    };
  }, [selectedInsuredPartyId]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!form.insuredPartyId) {
      setError('Select an insured party before creating the policy.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        policyNumber: form.policyNumber.trim() || undefined
      };
      const { response, body, replayed } = await api('/api/v1/policies', {
        method: 'POST',
        body: payload,
        idempotencyKey: newIdempotencyKey()
      });
      if (!response.ok) {
        setError(problemMessage(body, `Create failed: ${response.status}`));
        return;
      }
      setNotice(replayed
        ? `Idempotent replay: returned ${body?.policyNumber || 'the original policy'}.`
        : `Created ${body?.policyNumber || 'policy'}.`);
      setForm((current) => ({ ...current, policyNumber: '' }));
      setShowCreate(false);
      await load(0);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function advance(policy) {
    setError('');
    setNotice('');
    setBusyId(policy.id);
    try {
      const detailResponse = await fetch(`/api/v1/policies/${policy.id}`, {
        headers: { 'X-EIA-Tenant': TENANT }
      });
      const detailBody = await readJson(detailResponse);
      if (!detailResponse.ok) {
        setError(problemMessage(detailBody, `Load failed: ${detailResponse.status}`));
        return;
      }
      const target = nextStatusFor(detailBody.status);
      if (!target) return;
      const etag = detailResponse.headers.get('ETag') || formatEtag(detailBody.version);
      const response = await fetch(`/api/v1/policies/${policy.id}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'X-EIA-Tenant': TENANT,
          'If-Match': etag
        },
        body: JSON.stringify({ status: target, expectedVersion: detailBody.version })
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(problemMessage(body, `Update failed: ${response.status}`));
        await load(page);
        return;
      }
      setNotice(`${body?.policyNumber || policy.policyNumber} advanced to ${body?.status || target}.`);
      await load(page);
      if (selected?.id === policy.id) {
        await openPolicy(policy.id, { keepTab: true, silent: true });
        if (tab !== 'overview') {
          await loadTabData(tab, policy.id);
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  }

  function goTo(pageNumber) {
    if (pageNumber < 0 || loading) return;
    setError('');
    setNotice('');
    load(pageNumber).catch((e) => setError(e.message));
  }

  async function openPolicy(policyId, options = {}) {
    setError('');
    setRenewOpen(false);
    setRenewError('');
    if (!options.silent) setNotice('');
    setTabLoading(true);
    try {
      const detail = await api(`/api/v1/policies/${policyId}`);
      if (!detail.response.ok) {
        setError(problemMessage(detail.body, `Load failed: ${detail.response.status}`));
        return;
      }
      setSelected({
        id: policyId,
        policy: detail.body,
        etag: detail.etag || formatEtag(detail.body.version)
      });
      loadRelated(policyId).catch(() => {});
      loadDocuments(policyId).catch(() => {});
      loadActivity(policyId).catch(() => {});
      if (!options.keepTab) setTab('overview');
      await loadCurrentVersion(policyId);
      setVersions([]);
      setCoverages([]);
      setEndorsements([]);
      setInsureds([]);
      setLocations([]);
      setCancellations([]);
      setReinstatements([]);
      clearBilling();
      setBillingForm(defaultBillingForm(detail.body));
      setBillingInstallmentId(null);
      setBillingBusy(false);
      setLinkPaymentInstallment(null);
      setLinkedPayments({});
      clearCreditNotes();
      clearMassTort();
      setMassTortForm(defaultMassTortForm(null, detail.body));
      clearProgram();
      clearLegalEntity();
      if (!options.keepTab) {
        setCoverageForm(defaultCoverageForm(detail.body));
        setInsuredForm(defaultInsuredForm(detail.body));
        setLocationForm(defaultLocationForm(detail.body));
        setCancelForm(defaultCancelForm());
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setTabLoading(false);
    }
  }

  async function loadCurrentVersion(policyId) {
    const current = await api(`/api/v1/policies/${policyId}/versions/current`);
    if (current.response.ok) {
      setCurrentVersion(current.body);
    } else if (current.response.status !== 404) {
      setError(problemMessage(current.body, `Version load failed: ${current.response.status}`));
    } else {
      setCurrentVersion(null);
    }
  }

  async function loadRelated(policyId) {
    if (!policyId) return;
    const requestId = relatedRequestRef.current + 1;
    relatedRequestRef.current = requestId;
    setRelated({ claims: [], cessions: [], loading: true, error: '' });
    const query = encodeURIComponent(policyId);
    const [claimsResult, cessionsResult] = await Promise.allSettled([
      api(`/api/v1/claims/search?q=${query}&limit=${RELATED_LIMIT}`, { book: 'DIRECT' }),
      api(`/api/v1/cessions/search?q=${query}&limit=${RELATED_LIMIT}`, { book: 'DIRECT' })
    ]);
    if (relatedRequestRef.current !== requestId) return;
    const claims = claimsResult.status === 'fulfilled' && claimsResult.value.response.ok
      ? pageItems(claimsResult.value.body)
      : [];
    const cessions = cessionsResult.status === 'fulfilled' && cessionsResult.value.response.ok
      ? pageItems(cessionsResult.value.body)
      : [];
    const bothFailed = (claimsResult.status !== 'fulfilled' || !claimsResult.value.response.ok)
      && (cessionsResult.status !== 'fulfilled' || !cessionsResult.value.response.ok);
    setRelated({
      claims,
      cessions,
      loading: false,
      error: bothFailed ? 'Related records are temporarily unavailable.' : ''
    });
  }

  function clearRelated() {
    relatedRequestRef.current += 1;
    setRelated({ claims: [], cessions: [], loading: false, error: '' });
  }

  /**
   * Linked documents are evidence, not policy facts. The lookup is independent
   * of the record read: a failure stays inside the card and never blocks the
   * policy itself.
   */
  async function loadDocuments(policyId) {
    const requestId = documentsRequestRef.current + 1;
    documentsRequestRef.current = requestId;
    if (!policyId) {
      setDocuments({ items: [], loading: false, error: '' });
      return;
    }
    setDocuments({ items: [], loading: true, error: '' });
    try {
      const result = await api(
        `/api/v1/documents?linkedType=POLICY&linkedId=${encodeURIComponent(policyId)}`
      );
      if (documentsRequestRef.current !== requestId) return;
      if (!result.response.ok) {
        setDocuments({
          items: [],
          loading: false,
          error: 'Linked documents are temporarily unavailable.'
        });
        return;
      }
      setDocuments({ items: pageItems(result.body), loading: false, error: '' });
    } catch {
      if (documentsRequestRef.current !== requestId) return;
      setDocuments({
        items: [],
        loading: false,
        error: 'Linked documents are temporarily unavailable.'
      });
    }
  }

  function clearDocuments() {
    documentsRequestRef.current += 1;
    setDocuments({ items: [], loading: false, error: '' });
  }

  /**
   * Billing is the policy's premium collection plan. A 404 means the policy has
   * no plan yet (the record itself is already on screen), so it is an empty
   * state rather than an error. The tab keeps its own request lifecycle so a
   * slow billing read never blocks the policy header or another tab.
   */
  async function loadBilling(policyId = selected?.id, policy = selected?.policy) {
    const requestId = billingRequestRef.current + 1;
    billingRequestRef.current = requestId;
    if (!policyId) {
      setBilling(emptyBillingState());
      return;
    }
    setBilling((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await api(`/api/v1/policies/${policyId}/billing`);
      if (billingRequestRef.current !== requestId) return;
      if (result.response.status === 204 || result.response.status === 404) {
        setBilling({ ...emptyBillingState(), loading: false });
        return;
      }
      if (!result.response.ok) {
        setBilling({
          ...emptyBillingState(),
          loading: false,
          error: 'Billing is temporarily unavailable.'
        });
        return;
      }
      setBilling({
        ...normalizeBilling(result.body, policy),
        loading: false,
        error: ''
      });
    } catch {
      if (billingRequestRef.current !== requestId) return;
      setBilling({
        ...emptyBillingState(),
        loading: false,
        error: 'Billing is temporarily unavailable.'
      });
    }
  }

  function clearBilling() {
    billingRequestRef.current += 1;
    setBilling(emptyBillingState());
  }

  /**
   * Credit notes are policy-level accounting documents read alongside the
   * billing plan. They keep their own request lifecycle so a slow or missing
   * credit-note read never hides the plan or the installments. A 404 during
   * rollout is treated as no notes rather than an unavailable tab.
   */
  async function loadCreditNotes(policyId = selected?.id, policy = selected?.policy) {
    const requestId = creditNotesRequestRef.current + 1;
    creditNotesRequestRef.current = requestId;
    if (!policyId) {
      setCreditNotes(emptyCreditNotesState());
      return;
    }
    setCreditNotes((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await api(creditNoteEndpoint(policyId));
      if (creditNotesRequestRef.current !== requestId) return;
      if (result.response.status === 204 || result.response.status === 404) {
        setCreditNotes({ ...emptyCreditNotesState(), loading: false });
        return;
      }
      if (!result.response.ok) {
        setCreditNotes({
          ...emptyCreditNotesState(),
          loading: false,
          error: 'Credit notes are temporarily unavailable.'
        });
        return;
      }
      setCreditNotes({
        ...normalizeCreditNotes(result.body, policy),
        loading: false,
        error: ''
      });
    } catch {
      if (creditNotesRequestRef.current !== requestId) return;
      setCreditNotes({
        ...emptyCreditNotesState(),
        loading: false,
        error: 'Credit notes are temporarily unavailable.'
      });
    }
  }

  function clearCreditNotes() {
    creditNotesRequestRef.current += 1;
    setCreditNotes(emptyCreditNotesState());
    setCreditNoteOpen(false);
    setCreditNoteBusyId(null);
    setCreditNoteCancelId(null);
    setCreditNoteActionError('');
  }

  /**
   * The mass tort profile is administrative context owned by the policy. A 404
   * means the policy has no profile yet, so it is the tab's empty state rather
   * than an unavailable tab. A slow read never blocks the record header or
   * another tab: the profile keeps its own request lifecycle.
   */
  async function loadMassTort(policyId = selected?.id, policy = selected?.policy) {
    const requestId = massTortRequestRef.current + 1;
    massTortRequestRef.current = requestId;
    if (!policyId) {
      setMassTort(emptyMassTortState());
      return;
    }
    setMassTort((current) => ({ ...current, loading: true, error: '' }));
    try {
      const result = await api(`/api/v1/policies/${policyId}/mass-tort-profile`);
      if (massTortRequestRef.current !== requestId) return;
      if (result.response.status === 204 || result.response.status === 404) {
        setMassTort({ ...emptyMassTortState(), loading: false });
        setMassTortForm(defaultMassTortForm(null, policy));
        setMassTortSetup(false);
        setMassTortFormError('');
        setMassTortNotice('');
        return;
      }
      if (!result.response.ok) {
        setMassTort((current) => ({
          ...current,
          loading: false,
          error: 'Mass tort profile is temporarily unavailable.'
        }));
        return;
      }
      const profile = normalizeMassTortProfile(result.body);
      if (!profile) {
        setMassTort({ ...emptyMassTortState(), loading: false });
        setMassTortForm(defaultMassTortForm(null, policy));
        setMassTortSetup(false);
        return;
      }
      setMassTort({ profile, loading: false, error: '' });
      setMassTortForm(defaultMassTortForm(profile, policy));
      setMassTortSetup(true);
    } catch {
      if (massTortRequestRef.current !== requestId) return;
      setMassTort((current) => ({
        ...current,
        loading: false,
        error: 'Mass tort profile is temporarily unavailable.'
      }));
    }
  }

  function clearMassTort() {
    massTortRequestRef.current += 1;
    setMassTort(emptyMassTortState());
    setMassTortForm(defaultMassTortForm(null, null));
    setMassTortSetup(false);
    setMassTortSaving('');
    setMassTortFormError('');
    setMassTortNotice('');
  }

  /**
   * A policy belongs to at most one program. The tab reads the policy's current
   * assignment, then the program catalog record, so a policy with no program is
   * the tab's empty state rather than an unavailable tab. A missing policy
   * read or program read stays inside the card and never blocks the record.
   *
   * `policy` may be passed when a command already returned the updated
   * assignment; otherwise the policy is re-read so the tab never displays an
   * association that was cleared or changed elsewhere.
   */
  async function loadProgram(policy = null, options = {}) {
    const requestId = programRequestRef.current + 1;
    programRequestRef.current = requestId;
    const policyId = options.policyId || selected?.id;
    if (!policyId) {
      setProgram(emptyProgramState());
      return null;
    }
    setProgram((current) => ({ ...current, loading: true, error: '' }));
    try {
      let record = policy;
      if (!record) {
        const detail = await api(`/api/v1/policies/${policyId}`);
        if (programRequestRef.current !== requestId) return null;
        if (!detail.response.ok) {
          setProgram({
            program: null,
            loading: false,
            error: 'Program assignment is temporarily unavailable.'
          });
          return null;
        }
        record = detail.body;
      }
      const programId = policyProgramId(record);
      if (!programId) {
        setProgram({ ...emptyProgramState(), loading: false });
        return null;
      }
      const result = await api(programEndpoint(programId));
      if (programRequestRef.current !== requestId) return null;
      if (result.response.status === 404) {
        setProgram({
          program: null,
          loading: false,
          error: 'The assigned program could not be found.'
        });
        return null;
      }
      if (!result.response.ok) {
        setProgram({
          program: null,
          loading: false,
          error: 'Program is temporarily unavailable.'
        });
        return null;
      }
      const normalized = normalizeProgram(result.body);
      if (!normalized) {
        setProgram({
          program: null,
          loading: false,
          error: 'The assigned program could not be read.'
        });
        return null;
      }
      setProgram({ program: normalized, loading: false, error: '' });
      return normalized;
    } catch {
      if (programRequestRef.current !== requestId) return null;
      setProgram({
        program: null,
        loading: false,
        error: 'Program is temporarily unavailable.'
      });
      return null;
    }
  }

  function clearProgram() {
    programRequestRef.current += 1;
    setProgram(emptyProgramState());
    setProgramPick(null);
    setProgramBusy('');
    setProgramAttachError('');
    setProgramActionError('');
    setProgramCreateOpen(false);
    setProgramForm(defaultProgramForm(null));
    setProgramFormError('');
    setProgramSaving(false);
    setProgramLeadPolicy(null);
  }

  /**
   * A policy is issued by at most one legal entity. The tab reads the policy's
   * current assignment, then the legal-entity catalog record, so a policy with
   * no assignment is the tab's empty state rather than an unavailable tab. A
   * missing policy read or legal-entity read stays inside the card and never
   * blocks the record. A 404 on the assigned entity means the catalog no longer
   * has it; that is reported in the tab and is not treated as "not assigned".
   *
   * `policy` may be passed when a command already returned the updated
   * assignment; otherwise the policy is re-read so the tab never displays an
   * association that was cleared or changed elsewhere.
   */
  async function loadLegalEntity(policy = null, options = {}) {
    const requestId = legalEntityRequestRef.current + 1;
    legalEntityRequestRef.current = requestId;
    const policyId = options.policyId || selected?.id;
    if (!policyId) {
      setLegalEntity(emptyLegalEntityState());
      return null;
    }
    setLegalEntity((current) => ({ ...current, loading: true, error: '' }));
    try {
      let record = policy;
      if (!record) {
        const detail = await api(`/api/v1/policies/${policyId}`);
        if (legalEntityRequestRef.current !== requestId) return null;
        if (detail.response.status === 404) {
          setLegalEntity({
            legalEntity: null,
            loading: false,
            error: 'This policy record could not be found.'
          });
          return null;
        }
        if (!detail.response.ok) {
          setLegalEntity({
            legalEntity: null,
            loading: false,
            error: 'Legal entity assignment is temporarily unavailable.'
          });
          return null;
        }
        record = detail.body;
      }
      const legalEntityId = policyLegalEntityId(record);
      if (!legalEntityId) {
        setLegalEntity({ ...emptyLegalEntityState(), loading: false });
        return null;
      }
      const result = await api(legalEntityEndpoint(legalEntityId));
      if (legalEntityRequestRef.current !== requestId) return null;
      if (result.response.status === 404) {
        setLegalEntity({
          legalEntity: null,
          loading: false,
          error: 'The assigned legal entity could not be found.'
        });
        return null;
      }
      if (!result.response.ok) {
        setLegalEntity({
          legalEntity: null,
          loading: false,
          error: 'Legal entity is temporarily unavailable.'
        });
        return null;
      }
      const normalized = normalizeLegalEntity(result.body);
      if (!normalized) {
        setLegalEntity({
          legalEntity: null,
          loading: false,
          error: 'The assigned legal entity could not be read.'
        });
        return null;
      }
      setLegalEntity({ legalEntity: normalized, loading: false, error: '' });
      return normalized;
    } catch {
      if (legalEntityRequestRef.current !== requestId) return null;
      setLegalEntity({
        legalEntity: null,
        loading: false,
        error: 'Legal entity is temporarily unavailable.'
      });
      return null;
    }
  }

  function clearLegalEntity() {
    legalEntityRequestRef.current += 1;
    setLegalEntity(emptyLegalEntityState());
    setLegalEntityPick(null);
    setLegalEntityBusy('');
    setLegalEntityAttachError('');
    setLegalEntityActionError('');
    setLegalEntityConflict('');
    setLegalEntityCreateOpen(false);
    setLegalEntityForm(defaultLegalEntityForm());
    setLegalEntityFormError('');
    setLegalEntitySaving(false);
  }

  /**
   * The activity timeline is derived from the platform event stream, not from
   * the policy aggregate. It loads as soon as a record is selected, but remains
   * card-local: an unavailable event service never blocks the policy record.
   */
  async function loadActivity(policyId) {
    const requestId = activityRequestRef.current + 1;
    activityRequestRef.current = requestId;
    if (!policyId) {
      setActivity({ items: [], loading: false, error: '' });
      return;
    }
    setActivity({ items: [], loading: true, error: '' });
    try {
      const result = await api(activityEndpoint(policyId));
      if (activityRequestRef.current !== requestId) return;
      if (!result.response.ok) {
        setActivity({
          items: [],
          loading: false,
          error: 'Activity timeline is temporarily unavailable.'
        });
        return;
      }
      setActivity({
        items: sortActivityItems(pageItems(result.body)),
        loading: false,
        error: ''
      });
    } catch {
      if (activityRequestRef.current !== requestId) return;
      setActivity({
        items: [],
        loading: false,
        error: 'Activity timeline is temporarily unavailable.'
      });
    }
  }

  function clearActivity() {
    activityRequestRef.current += 1;
    setActivity({ items: [], loading: false, error: '' });
  }

  async function loadTabData(tabId, policyId = selected?.id) {
    if (!policyId) return;
    // Activity has its own request lifecycle and is loaded on selection; the
    // generic tab loader must not turn it into a duplicate lookup.
    if (tabId === 'activity') return;
    setTabLoading(true);
    setError('');
    try {
      if (tabId === 'overview') {
        await loadCurrentVersion(policyId);
      } else if (tabId === 'program') {
        await loadProgram(null, { policyId });
      } else if (tabId === 'legalEntity') {
        await loadLegalEntity(null, { policyId });
      } else if (tabId === 'versions') {
        const result = await api(`/api/v1/policies/${policyId}/versions?page=0&size=50`);
        if (!result.response.ok) setError(problemMessage(result.body, 'Version history failed'));
        else setVersions(pageItems(result.body));
      } else if (tabId === 'coverages') {
        const result = await api(`/api/v1/policies/${policyId}/coverages?page=0&size=50`);
        if (!result.response.ok) setError(problemMessage(result.body, 'Coverage load failed'));
        else setCoverages(pageItems(result.body));
      } else if (tabId === 'massTort') {
        await loadMassTort(policyId, selected?.id === policyId ? selected.policy : null);
      } else if (tabId === 'endorsements') {
        const result = await api(`/api/v1/policies/${policyId}/endorsements?page=0&size=50`);
        if (!result.response.ok) setError(problemMessage(result.body, 'Endorsement load failed'));
        else setEndorsements(pageItems(result.body));
      } else if (tabId === 'parties') {
        const [insuredResult, locationResult] = await Promise.all([
          api(`/api/v1/policies/${policyId}/insureds?page=0&size=50`),
          api(`/api/v1/policies/${policyId}/locations?page=0&size=50`)
        ]);
        if (!insuredResult.response.ok) setError(problemMessage(insuredResult.body, 'Insured load failed'));
        else setInsureds(pageItems(insuredResult.body));
        if (!locationResult.response.ok) setError(problemMessage(locationResult.body, 'Location load failed'));
        else setLocations(pageItems(locationResult.body));
      } else if (tabId === 'billing') {
        await Promise.all([
          loadBilling(policyId, selected?.id === policyId ? selected.policy : null),
          loadCreditNotes(policyId, selected?.id === policyId ? selected.policy : null)
        ]);
      } else if (tabId === 'cancellation') {
        const [cancellationResult, reinstatementResult] = await Promise.all([
          api(`/api/v1/policies/${policyId}/cancellations?page=0&size=50`),
          api(`/api/v1/policies/${policyId}/reinstatements?page=0&size=50`)
        ]);
        if (!cancellationResult.response.ok) {
          setError(problemMessage(cancellationResult.body, 'Cancellation load failed'));
        } else {
          setCancellations(pageItems(cancellationResult.body));
        }
        if (!reinstatementResult.response.ok) {
          setError(problemMessage(reinstatementResult.body, 'Reinstatement load failed'));
        } else {
          setReinstatements(pageItems(reinstatementResult.body));
        }
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setTabLoading(false);
    }
  }

  function selectTab(tabId) {
    setTab(tabId);
    // Activity is fetched when the record is selected; clicking the tab only
    // reveals the already-loaded card. Refresh re-reads the event stream.
    if (tabId === 'activity') return;
    loadTabData(tabId).catch((e) => setError(e.message));
  }

  async function refreshSelected(etag) {
    if (!selected) return null;
    let refreshed = null;
    const detail = await api(`/api/v1/policies/${selected.id}`);
    if (detail.response.ok) {
      refreshed = detail.body;
      setSelected({
        id: selected.id,
        policy: detail.body,
        etag: etag || detail.etag || formatEtag(detail.body.version)
      });
    }
    await load(page);
    return refreshed;
  }

  function mutationSucceeded(message, result) {
    if (!result.response.ok) {
      setError(problemMessage(result.body, `Request failed: ${result.response.status}`));
      return false;
    }
    const replayed = result.replayed || result.response.status === 200;
    setNotice(replayed ? `Idempotent replay: ${message}` : message);
    return true;
  }

  function closeSelected() {
    setSelected(null);
    setTab('overview');
    setCurrentVersion(null);
    setRenewOpen(false);
    setRenewError('');
    setRenewedFrom(null);
    clearRelated();
    clearDocuments();
    clearActivity();
    clearBilling();
    setBillingForm(defaultBillingForm(null));
    setBillingInstallmentId(null);
    setLinkPaymentInstallment(null);
    setLinkedPayments({});
    clearCreditNotes();
    clearMassTort();
    clearProgram();
    clearLegalEntity();
  }

  async function refreshWorkspace() {
    setError('');
    setNotice('');
    try {
      await load(page);
      if (selected?.id) {
        await openPolicy(selected.id, { keepTab: true, silent: true });
        if (tab !== 'overview') {
          await loadTabData(tab, selected.id);
        }
      }
    } catch (e) {
      setError(e.message);
    }
  }

  // ---- coverage form -------------------------------------------------
  function updateCoverage(field, value) {
    setCoverageForm((current) => ({ ...current, [field]: value }));
  }

  function updateErosion(field, value) {
    setErosionForm((current) => ({ ...current, [field]: value }));
  }

  async function submitCoverage(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    const payload = {
      coverageCode: coverageForm.coverageCode.trim().toUpperCase(),
      coverageName: coverageForm.coverageName,
      coveragePart: coverageForm.coveragePart,
      occurrenceBasis: coverageForm.occurrenceBasis,
      effectiveFrom: coverageForm.effectiveFrom,
      effectiveTo: coverageForm.effectiveTo,
      coinsurancePct: coverageForm.coinsurancePct || undefined,
      limit: {
        perOccurrenceAmount: coverageForm.perOccurrenceAmount,
        aggregateAmount: coverageForm.aggregateAmount || undefined,
        sublimitAmount: coverageForm.sublimitAmount || undefined,
        deductibleAmount: coverageForm.deductibleAmount || undefined,
        coinsurancePct: coverageForm.coinsurancePct || undefined,
        currency: coverageForm.currency.toUpperCase()
      }
    };
    const result = await api(`/api/v1/policies/${selected.id}/coverages`, {
      method: 'POST',
      body: payload,
      etag: selected.etag,
      idempotencyKey: newIdempotencyKey()
    });
    if (!mutationSucceeded(`Coverage ${payload.coverageCode} added.`, result)) return;
    await loadTabData('coverages');
    await refreshSelected(result.etag);
  }

  async function submitErosion(event) {
    event.preventDefault();
    if (!selected || coverages.length === 0) return;
    setError('');
    setNotice('');
    const limitId = coverages[0]?.limit?.id;
    const result = await api(`/api/v1/policies/${selected.id}/erosion`, {
      method: 'POST',
      body: {
        limitId,
        claimId: erosionForm.claimId,
        allocationId: erosionForm.allocationId,
        sourceVersion: Number(erosionForm.sourceVersion),
        paidAmount: erosionForm.paidAmount,
        reservedAmount: erosionForm.reservedAmount,
        recoveredAmount: erosionForm.recoveredAmount
      },
      idempotencyKey: newIdempotencyKey()
    });
    if (!mutationSucceeded('Erosion fact applied.', result)) return;
    await loadTabData('coverages');
    await refreshSelected(result.etag);
  }

  // ---- endorsement form ---------------------------------------------
  function updateEndorsement(field, value) {
    setEndorsementForm((current) => ({ ...current, [field]: value }));
  }

  async function submitEndorsement(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    const result = await api(`/api/v1/policies/${selected.id}/endorsements`, {
      method: 'POST',
      body: {
        endorsementType: endorsementForm.endorsementType,
        effectiveDate: endorsementForm.effectiveDate,
        description: endorsementForm.description,
        premiumDeltaAmount: endorsementForm.premiumDeltaAmount || undefined,
        premiumDeltaCurrency: endorsementForm.premiumDeltaAmount
          ? endorsementForm.premiumDeltaCurrency.toUpperCase() : undefined,
        coverageImpact: endorsementForm.coverageImpact,
        backdateReason: endorsementForm.backdateReason || undefined,
        approvedBy: endorsementForm.approvedBy || undefined,
        approvalRef: endorsementForm.approvalRef || undefined
      },
      etag: selected.etag,
      idempotencyKey: newIdempotencyKey()
    });
    if (!mutationSucceeded(`Endorsement ${result.body?.endorsementNumber || ''} issued.`.trim(), result)) {
      return;
    }
    setEndorsementForm(defaultEndorsementForm());
    await loadTabData('endorsements');
    await loadTabData('versions');
    await refreshSelected(result.etag);
  }

  // ---- insured and location forms -----------------------------------
  function updateInsured(field, value) {
    setInsuredForm((current) => ({ ...current, [field]: value }));
  }

  function updateLocation(field, value) {
    setLocationForm((current) => ({ ...current, [field]: value }));
  }

  async function submitInsured(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    const result = await api(`/api/v1/policies/${selected.id}/insureds`, {
      method: 'POST',
      body: {
        partyId: insuredForm.partyId,
        insuredRole: insuredForm.insuredRole,
        displayName: insuredForm.displayName,
        certificateNumber: insuredForm.certificateNumber || undefined,
        effectiveFrom: insuredForm.effectiveFrom,
        effectiveTo: insuredForm.effectiveTo
      },
      etag: selected.etag,
      idempotencyKey: newIdempotencyKey()
    });
    if (!mutationSucceeded(`${insuredForm.displayName || 'Insured'} added.`, result)) return;
    await loadTabData('parties');
    await refreshSelected(result.etag);
  }

  async function submitLocation(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    const result = await api(`/api/v1/policies/${selected.id}/locations`, {
      method: 'POST',
      body: {
        locationCode: locationForm.locationCode.trim().toUpperCase(),
        addressLine1: locationForm.addressLine1,
        addressLine2: locationForm.addressLine2 || undefined,
        city: locationForm.city,
        stateRegion: locationForm.stateRegion.toUpperCase(),
        postalCode: locationForm.postalCode || undefined,
        country: locationForm.country.toUpperCase(),
        effectiveFrom: locationForm.effectiveFrom,
        effectiveTo: locationForm.effectiveTo
      },
      etag: selected.etag,
      idempotencyKey: newIdempotencyKey()
    });
    if (!mutationSucceeded(`Location ${locationForm.locationCode} added.`, result)) return;
    await loadTabData('parties');
    await refreshSelected(result.etag);
  }

  // ---- cancellation and reinstatement -------------------------------
  function updateCancel(field, value) {
    setCancelForm((current) => ({ ...current, [field]: value }));
  }

  function updateReinstate(field, value) {
    setReinstateForm((current) => ({ ...current, [field]: value }));
  }

  async function submitCancel(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    const result = await api(`/api/v1/policies/${selected.id}/cancel`, {
      method: 'POST',
      body: {
        cancellationType: cancelForm.cancellationType,
        reason: cancelForm.reason,
        effectiveDate: cancelForm.effectiveDate,
        noticeDays: Number(cancelForm.noticeDays || 0)
      },
      etag: selected.etag,
      idempotencyKey: newIdempotencyKey()
    });
    if (!mutationSucceeded(
      `Policy cancelled (${result.body?.cancellationType || cancelForm.cancellationType}); return premium ${formatMoney(result.body?.returnPremiumAmount, result.body?.premiumCurrency)}.`,
      result)) {
      return;
    }
    await loadTabData('cancellation');
    await loadTabData('versions');
    await refreshSelected(result.etag);
  }

  async function submitReinstate(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    const result = await api(`/api/v1/policies/${selected.id}/reinstate`, {
      method: 'POST',
      body: {
        effectiveDate: reinstateForm.effectiveDate,
        reason: reinstateForm.reason,
        approvedBy: reinstateForm.approvedBy,
        approvalRef: reinstateForm.approvalRef,
        premiumEvidenceRef: reinstateForm.premiumEvidenceRef,
        premiumEvidenceAmount: reinstateForm.premiumEvidenceAmount,
        premiumEvidenceCurrency: reinstateForm.premiumEvidenceCurrency.toUpperCase()
      },
      etag: selected.etag,
      idempotencyKey: newIdempotencyKey()
    });
    if (!mutationSucceeded('Policy reinstated after approval and premium evidence.', result)) return;
    await loadTabData('cancellation');
    await loadTabData('versions');
    await refreshSelected(result.etag);
  }

  // ---- renewal ------------------------------------------------------
  function openRenewal() {
    if (!selectedPolicy || !isRenewable(selectedPolicy.status)) return;
    setError('');
    setNotice('');
    setRenewError('');
    setRenewForm(defaultRenewalForm(selectedPolicy));
    setRenewOpen(true);
  }

  function closeRenewal() {
    if (renewBusy) return;
    setRenewOpen(false);
    setRenewError('');
  }

  function updateRenewal(field, value) {
    setRenewForm((current) => {
      const next = { ...current, [field]: value };
      // The one-year term follows the effective date until the operator edits
      // the expiration date themselves.
      if (field === 'effectiveDate' && current.expirationDate === addYears(current.effectiveDate, 1)) {
        next.expirationDate = addYears(value, 1) || current.expirationDate;
      }
      return next;
    });
  }

  async function submitRenewal(event) {
    event.preventDefault();
    if (!selected || !selectedPolicy || !isRenewable(selectedPolicy.status)) return;
    setRenewError('');
    const validation = validateRenewalForm(renewForm);
    if (validation) {
      setRenewError(validation);
      return;
    }
    setRenewBusy(true);
    try {
      const result = await api(`/api/v1/policies/${selected.id}/renew`, {
        method: 'POST',
        body: renewalPayload(renewForm),
        etag: selected.etag,
        idempotencyKey: newIdempotencyKey()
      });
      if (!result.response.ok) {
        setRenewError(problemMessage(result.body, `Renewal failed: ${result.response.status}`));
        return;
      }
      const renewed = result.body || {};
      setRenewOpen(false);
      setRenewForm(defaultRenewalForm(renewed));
      // Refresh the queue so the new record appears in the direct book, then
      // select it. The predecessor stays in the queue unchanged.
      await load(0);
      if (renewed.id) {
        await openPolicy(renewed.id, { silent: true });
      }
      setNotice(`Renewed as ${renewed.policyNumber || 'the new policy'}.`);
    } catch (e) {
      setRenewError(e.message);
    } finally {
      setRenewBusy(false);
    }
  }

  useEffect(() => {
    if (!renewOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !renewBusy) {
        setRenewOpen(false);
        setRenewError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [renewOpen, renewBusy]);

  useEffect(() => {
    if (!programCreateOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !programSaving) {
        setProgramCreateOpen(false);
        setProgramFormError('');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [programCreateOpen, programSaving]);

  // ---- billing plan -------------------------------------------------
  function updateBilling(field, value) {
    setBillingForm((current) => ({ ...current, [field]: value }));
  }

  async function submitBillingPlan(event) {
    event.preventDefault();
    if (!selected) return;
    setError('');
    setNotice('');
    const validation = validateBillingForm(billingForm);
    if (validation) {
      setError(validation);
      return;
    }
    const payload = billingPlanPayload(billingForm);
    setBillingBusy(true);
    try {
      const result = await api(`/api/v1/policies/${selected.id}/billing`, {
        method: 'POST',
        body: payload,
        idempotencyKey: newIdempotencyKey()
      });
      if (!result.response.ok) {
        setError(problemMessage(result.body, `Billing plan creation failed: ${result.response.status}`));
        // A conflict usually means a plan already exists; read it back so the
        // tab shows the current schedule instead of the stale empty state.
        if (result.response.status === 409) {
          await loadBilling(selected.id, selected.policy);
        }
        return;
      }
      const noun = payload.installmentCount === 1 ? 'installment' : 'installments';
      setNotice(`Billing plan created with ${payload.installmentCount} ${noun}.`);
      setBillingForm(defaultBillingForm(selected.policy));
      await loadBilling(selected.id, selected.policy);
    } catch (e) {
      setError(e.message);
    } finally {
      setBillingBusy(false);
    }
  }

  async function updateInstallment(installment, status) {
    if (!selected || !installment?.id) return;
    setError('');
    setNotice('');
    setBillingInstallmentId(installment.id);
    const body = { status };
    if (status === 'PAID' && installment.paymentId) body.paymentId = installment.paymentId;
    try {
      const result = await api(
        `/api/v1/policies/${selected.id}/billing/installments/${installment.id}`,
        { method: 'PATCH', body }
      );
      if (!result.response.ok) {
        setError(problemMessage(result.body, `Installment update failed: ${result.response.status}`));
        if ([404, 409, 410, 412].includes(result.response.status)) {
          await loadBilling(selected.id, selected.policy);
        }
        return;
      }
      setNotice(
        status === 'PAID'
          ? `Installment ${installment.installmentNumber} marked paid.`
          : `Installment ${installment.installmentNumber} waived.`
      );
      await loadBilling(selected.id, selected.policy);
    } catch (e) {
      setError(e.message);
    } finally {
      setBillingInstallmentId(null);
    }
  }

  // ---- link an existing payment --------------------------------------
  function openPaymentLink(installment) {
    if (!installment?.id) return;
    setError('');
    setLinkPaymentInstallment(installment);
  }

  function closePaymentLink() {
    setLinkPaymentInstallment(null);
  }

  /**
   * The PATCH links the existing Payment and marks the installment collected.
   * The Payment keeps its own status, amount, and approval path; the selected
   * payment number is retained locally so the row can show it after the
   * billing read returns only the stored paymentId.
   */
  function paymentLinked(installment, payment) {
    if (!installment?.id || !payment?.id) return;
    setError('');
    setLinkedPayments((current) => ({
      ...current,
      [installment.id]: {
        id: payment.id,
        number: payment.paymentNumber || ''
      }
    }));
    setLinkPaymentInstallment(null);
    setNotice(
      `Installment ${installment.installmentNumber} linked to `
      + `${payment.paymentNumber || payment.id}.`
    );
    if (selected?.id) {
      loadBilling(selected.id, selected.policy).catch(() => {});
    }
  }

  // ---- credit notes -------------------------------------------------
  function openCreditNoteForm() {
    setCreditNoteActionError('');
    setCreditNoteOpen(true);
  }

  function closeCreditNoteForm() {
    setCreditNoteOpen(false);
  }

  /** POST saves the note as a DRAFT; issuing and applying are separate PATCHes. */
  function creditNoteCreated(resultBody) {
    const created = resultBody?.creditNote || resultBody;
    setCreditNoteOpen(false);
    setCreditNoteActionError('');
    setNotice(`${creditNoteLabel(created)} saved as draft.`);
    if (selected?.id) {
      loadCreditNotes(selected.id, selected.policy).catch(() => {});
    }
  }

  /**
   * Issuing, applying, and cancelling are status transitions on the credit
   * note. A rejection is contained in the Credit notes section; a 409/404
   * re-reads the list so a stale row cannot be acted on again.
   */
  async function updateCreditNoteStatus(creditNote, status) {
    if (!selected || !creditNote?.id) return;
    setCreditNoteActionError('');
    setNotice('');
    setCreditNoteBusyId(creditNote.id);
    try {
      const result = await api(
        creditNoteStatusEndpoint(selected.id, creditNote.id),
        { method: 'PATCH', body: creditNoteStatusPayload(status) }
      );
      if (!result.response.ok) {
        setCreditNoteActionError(problemMessage(
          result.body,
          `Credit note update failed: ${result.response.status}`
        ));
        if ([404, 409, 410, 412].includes(result.response.status)) {
          setCreditNoteCancelId(null);
          await loadCreditNotes(selected.id, selected.policy);
        }
        return;
      }
      setCreditNoteCancelId(null);
      const verb = status === 'ISSUED' ? 'issued' : status === 'APPLIED' ? 'applied' : 'cancelled';
      setNotice(`${creditNoteLabel(creditNote)} ${verb}.`);
      await Promise.all([
        loadCreditNotes(selected.id, selected.policy),
        loadBilling(selected.id, selected.policy)
      ]);
    } catch (e) {
      setCreditNoteActionError(e.message);
    } finally {
      setCreditNoteBusyId(null);
    }
  }

  function requestCancelCreditNote(creditNote) {
    if (!creditNote?.id || !canCancelCreditNote(creditNote.status)) return;
    setCreditNoteActionError('');
    setCreditNoteCancelId(creditNote.id);
  }

  function keepCreditNote() {
    setCreditNoteCancelId(null);
  }

  // ---- mass tort profile --------------------------------------------
  function updateMassTort(field, value) {
    setMassTortForm((current) => ({ ...current, [field]: value }));
  }

  function openMassTortSetup() {
    setMassTortFormError('');
    setMassTortNotice('');
    if (!massTort.profile) {
      setMassTortForm(defaultMassTortForm(null, selectedPolicy));
    }
    setMassTortSetup(true);
  }

  /**
   * PUT replaces the profile and moves its status between DRAFT and COMPLETE.
   * Validation stays in the tab; the canonical problem body wins when the
   * domain rejects the request. A 409 means another operator changed the
   * profile, so the current value is reloaded before the operator retries.
   */
  async function submitMassTort(status) {
    if (!selected || massTortSaving) return;
    setMassTortFormError('');
    setMassTortNotice('');
    const validation = validateMassTortForm(massTortForm, status);
    if (validation) {
      setMassTortFormError(validation);
      return;
    }
    const payload = massTortPayload(massTortForm, status);
    setMassTortSaving(status);
    try {
      const result = await api(`/api/v1/policies/${selected.id}/mass-tort-profile`, {
        method: 'PUT',
        body: payload
      });
      if (!result.response.ok) {
        setMassTortFormError(
          problemMessage(result.body, `Profile save failed: ${result.response.status}`)
        );
        if (result.response.status === 409) {
          setMassTortFormError((current) => (
            `${current} The current profile was reloaded; review the values and try again.`
          ));
          await loadMassTort(selected.id, selected.policy);
        }
        return;
      }
      const saved = normalizeMassTortProfile(result.body) || {
        id: '',
        tortType: payload.tortType || '',
        trigger: payload.triggerType || '',
        allocationMethod: payload.allocationMethod || '',
        allocationNotes: payload.allocationNotes || '',
        coverageBlockStart: payload.coverageBlockStart || '',
        coverageBlockEnd: payload.coverageBlockEnd || '',
        status: payload.status,
        updatedAt: ''
      };
      setMassTort({ profile: saved, loading: false, error: '' });
      setMassTortForm(defaultMassTortForm(saved, selected.policy));
      setMassTortSetup(true);
      setMassTortNotice(
        status === MASS_TORT_STATUS.COMPLETE
          ? 'Mass tort profile marked complete.'
          : 'Mass tort profile saved as draft.'
      );
      // The expert bumps the policy aggregate version when the profile changes,
      // so the header version/ETag is refreshed without touching coverage.
      try {
        await refreshSelected();
      } catch {
        // The profile is saved; a failed header refresh is not a save failure.
      }
    } catch (e) {
      setMassTortFormError(e.message);
    } finally {
      setMassTortSaving('');
    }
  }

  // ---- program assignment -------------------------------------------
  function updateProgramForm(field, value) {
    setProgramForm((current) => ({ ...current, [field]: value }));
  }

  function openProgramCreate() {
    if (!selected) return;
    setProgramFormError('');
    setProgramAttachError('');
    setProgramActionError('');
    setProgramForm(defaultProgramForm(selected.policy));
    setProgramCreateOpen(true);
  }

  function closeProgramCreate() {
    if (programSaving) return;
    setProgramCreateOpen(false);
    setProgramFormError('');
  }

  function selectProgramForAttach(programId, picked) {
    setProgramAttachError('');
    setProgramPick(picked || (programId ? { id: programId } : null));
  }

  /**
   * Attaching records the association with PATCH /policies/{id}/program. The
   * program itself is not edited and the policy keeps its coverage, limits,
   * premium, and version; the policy is re-read afterwards so the record and
   * the card agree on the new assignment.
   */
  async function attachProgram() {
    if (!selected || programBusy) return;
    const target = programPick;
    if (!target?.id) {
      setProgramAttachError('Select a program to attach.');
      return;
    }
    setProgramAttachError('');
    setProgramActionError('');
    setProgramBusy('attach');
    try {
      const result = await api(policyProgramEndpoint(selected.id), {
        method: 'PATCH',
        body: programAttachPayload(target.id)
      });
      if (!result.response.ok) {
        setProgramAttachError(
          problemMessage(result.body, `Attach failed: ${result.response.status}`)
        );
        return;
      }
      setNotice(
        `Attached program ${programLabel(target)} to `
        + `${selected.policy?.policyNumber || 'the policy'}.`
      );
      setProgramPick(null);
      const updated = await refreshSelected();
      const record = updated && policyProgramId(updated)
        ? updated
        : { ...(updated || selected.policy), programId: target.id };
      await loadProgram(record);
    } catch (e) {
      setProgramAttachError(e.message);
    } finally {
      setProgramBusy('');
    }
  }

  /**
   * Detaching clears only the association. An explicit null programId is sent
   * so the command cannot be mistaken for an absent field.
   */
  async function detachProgram() {
    if (!selected || programBusy) return;
    const current = program.program;
    setProgramAttachError('');
    setProgramActionError('');
    setProgramBusy('detach');
    try {
      const result = await api(policyProgramEndpoint(selected.id), {
        method: 'PATCH',
        body: programAttachPayload(null)
      });
      if (!result.response.ok) {
        setProgramActionError(
          problemMessage(result.body, `Detach failed: ${result.response.status}`)
        );
        return;
      }
      setNotice(`Detached program ${programLabel(current)}.`);
      setProgramPick(null);
      const updated = await refreshSelected();
      const record = { ...(updated || selected.policy), programId: null, program: null };
      await loadProgram(record);
    } catch (e) {
      setProgramActionError(e.message);
    } finally {
      setProgramBusy('');
    }
  }

  /**
   * Creating a program also attaches it to the policy it was created from, so
   * the operator never has to repeat the attach step. If creation succeeds but
   * the attach fails, the new program stays in the catalog and is preselected
   * in the attach card for a retry.
   */
  async function submitProgramCreate(event) {
    event.preventDefault();
    if (!selected || programSaving) return;
    setProgramFormError('');
    const validation = validateProgramForm(programForm);
    if (validation) {
      setProgramFormError(validation);
      return;
    }
    const payload = programCreatePayload(programForm, selected.policy);
    setProgramSaving(true);
    try {
      const created = await api('/api/v1/programs', {
        method: 'POST',
        body: payload,
        idempotencyKey: newIdempotencyKey()
      });
      if (!created.response.ok) {
        setProgramFormError(
          problemMessage(created.body, `Program creation failed: ${created.response.status}`)
        );
        return;
      }
      const createdProgram = normalizeProgram(created.body);
      if (!createdProgram?.id) {
        setProgramFormError(
          'The program was created without an id in the response. Reload the tab and attach it from the program catalog.'
        );
        return;
      }
      const attach = await api(policyProgramEndpoint(selected.id), {
        method: 'PATCH',
        body: programAttachPayload(createdProgram.id)
      });
      if (!attach.response.ok) {
        setProgramCreateOpen(false);
        setProgramForm(defaultProgramForm(selected.policy));
        setProgramPick(createdProgram);
        setProgramAttachError(
          `Created ${programLabel(createdProgram)} but attaching it to this policy failed: `
          + `${problemMessage(attach.body, `status ${attach.response.status}`)} `
          + 'Select it under Attach existing program to try again.'
        );
        setNotice(`Created program ${programLabel(createdProgram)}.`);
        await loadProgram(null, { policyId: selected.id });
        return;
      }
      setProgramCreateOpen(false);
      setProgramForm(defaultProgramForm(selected.policy));
      setProgramPick(null);
      setNotice(
        `Created program ${programLabel(createdProgram)} and attached it to `
        + `${selected.policy?.policyNumber || 'the policy'}.`
      );
      const updated = await refreshSelected();
      const record = updated && policyProgramId(updated)
        ? updated
        : { ...(updated || selected.policy), programId: createdProgram.id };
      await loadProgram(record);
    } catch (e) {
      setProgramFormError(e.message);
    } finally {
      setProgramSaving(false);
    }
  }

  // ---- legal entity assignment --------------------------------------
  function updateLegalEntityForm(field, value) {
    setLegalEntityForm((current) => ({ ...current, [field]: value }));
  }

  function openLegalEntityCreate() {
    if (!selected) return;
    setLegalEntityFormError('');
    setLegalEntityAttachError('');
    setLegalEntityActionError('');
    setLegalEntityConflict('');
    setLegalEntityForm(defaultLegalEntityForm());
    setLegalEntityCreateOpen(true);
  }

  function closeLegalEntityCreate() {
    if (legalEntitySaving) return;
    setLegalEntityCreateOpen(false);
    setLegalEntityFormError('');
  }

  function selectLegalEntityForAttach(legalEntityId, picked) {
    setLegalEntityAttachError('');
    setLegalEntityPick(picked || (legalEntityId ? { id: legalEntityId } : null));
  }

  /**
   * A conflict means the policy or the catalog changed since the tab read it.
   * The canonical problem stays in the tab and the assignment is re-read, so
   * the next attempt starts from the current state instead of a stale card.
   */
  async function reloadLegalEntityAfterConflict() {
    try {
      const updated = await refreshSelected();
      await loadLegalEntity(updated || null);
    } catch {
      // The conflict is already reported; Retry re-reads the tab.
    }
  }

  /**
   * Attaching records the issuing-entity association with
   * PATCH /policies/{id}/legal-entity. The legal entity itself is not edited
   * and the policy keeps its coverage, limits, premium, and version; the policy
   * is re-read afterwards so the record and the card agree.
   */
  async function attachLegalEntity() {
    if (!selected || legalEntityBusy) return;
    const target = legalEntityPick;
    if (!target?.id) {
      setLegalEntityAttachError('Select a legal entity to attach.');
      return;
    }
    setLegalEntityAttachError('');
    setLegalEntityActionError('');
    setLegalEntityConflict('');
    setLegalEntityBusy('attach');
    try {
      const result = await api(policyLegalEntityEndpoint(selected.id), {
        method: 'PATCH',
        body: legalEntityAttachPayload(target.id)
      });
      if (!result.response.ok) {
        const message = problemMessage(
          result.body,
          `Attach failed: ${result.response.status}`
        );
        setLegalEntityAttachError(message);
        if (result.response.status === 409) {
          setLegalEntityConflict(
            `${message} The current assignment was re-read; review it before retrying.`
          );
          await reloadLegalEntityAfterConflict();
        } else if (result.response.status === 404) {
          await reloadLegalEntityAfterConflict();
        }
        return;
      }
      setNotice(
        `Attached legal entity ${legalEntityLabel(target)} to `
        + `${selected.policy?.policyNumber || 'the policy'}.`
      );
      setLegalEntityPick(null);
      const updated = await refreshSelected();
      const record = updated && policyLegalEntityId(updated)
        ? updated
        : { ...(updated || selected.policy), legalEntityId: target.id };
      await loadLegalEntity(record);
    } catch (e) {
      setLegalEntityAttachError(e.message);
    } finally {
      setLegalEntityBusy('');
    }
  }

  /**
   * Detaching clears only the association. An explicit null legalEntityId is
   * sent so the command cannot be mistaken for an absent field.
   */
  async function detachLegalEntity() {
    if (!selected || legalEntityBusy) return;
    const current = legalEntity.legalEntity;
    setLegalEntityAttachError('');
    setLegalEntityActionError('');
    setLegalEntityConflict('');
    setLegalEntityBusy('detach');
    try {
      const result = await api(policyLegalEntityEndpoint(selected.id), {
        method: 'PATCH',
        body: legalEntityAttachPayload(null)
      });
      if (!result.response.ok) {
        const message = problemMessage(
          result.body,
          `Detach failed: ${result.response.status}`
        );
        setLegalEntityActionError(message);
        if (result.response.status === 409) {
          setLegalEntityConflict(
            `${message} The current assignment was re-read; review it before retrying.`
          );
          await reloadLegalEntityAfterConflict();
        } else if (result.response.status === 404) {
          await reloadLegalEntityAfterConflict();
        }
        return;
      }
      setNotice(`Detached legal entity ${legalEntityLabel(current)}.`);
      setLegalEntityPick(null);
      const updated = await refreshSelected();
      const record = { ...(updated || selected.policy), legalEntityId: null, legalEntity: null };
      await loadLegalEntity(record);
    } catch (e) {
      setLegalEntityActionError(e.message);
    } finally {
      setLegalEntityBusy('');
    }
  }

  /**
   * Creating a legal entity also attaches it to the policy it was created
   * from. If creation succeeds but the attach fails, the new entity stays in
   * the catalog and is preselected in the attach card for a retry.
   */
  async function submitLegalEntityCreate(event) {
    event.preventDefault();
    if (!selected || legalEntitySaving) return;
    setLegalEntityFormError('');
    const validation = validateLegalEntityForm(legalEntityForm);
    if (validation) {
      setLegalEntityFormError(validation);
      return;
    }
    const payload = legalEntityCreatePayload(legalEntityForm);
    setLegalEntitySaving(true);
    setLegalEntityConflict('');
    try {
      const created = await api('/api/v1/legal-entities', {
        method: 'POST',
        body: payload,
        idempotencyKey: newIdempotencyKey()
      });
      if (!created.response.ok) {
        setLegalEntityFormError(
          problemMessage(
            created.body,
            `Legal entity creation failed: ${created.response.status}`
          )
        );
        return;
      }
      const createdEntity = normalizeLegalEntity(created.body);
      if (!createdEntity?.id) {
        setLegalEntityFormError(
          'The legal entity was created without an id in the response. Reload the tab and attach it from the catalog.'
        );
        return;
      }
      const attach = await api(policyLegalEntityEndpoint(selected.id), {
        method: 'PATCH',
        body: legalEntityAttachPayload(createdEntity.id)
      });
      if (!attach.response.ok) {
        const message = `Created ${legalEntityLabel(createdEntity)} but attaching it to this policy failed: `
          + `${problemMessage(attach.body, `status ${attach.response.status}`)} `
          + 'Select it under Attach existing legal entity to try again.';
        setLegalEntityCreateOpen(false);
        setLegalEntityForm(defaultLegalEntityForm());
        setLegalEntityPick(createdEntity);
        setLegalEntityAttachError(message);
        if (attach.response.status === 409) {
          setLegalEntityConflict(message);
          await reloadLegalEntityAfterConflict();
        } else if (attach.response.status === 404) {
          await reloadLegalEntityAfterConflict();
        } else {
          await loadLegalEntity(null, { policyId: selected.id });
        }
        setNotice(`Created legal entity ${legalEntityLabel(createdEntity)}.`);
        return;
      }
      setLegalEntityCreateOpen(false);
      setLegalEntityForm(defaultLegalEntityForm());
      setLegalEntityPick(null);
      setNotice(
        `Created legal entity ${legalEntityLabel(createdEntity)} and attached it to `
        + `${selected.policy?.policyNumber || 'the policy'}.`
      );
      const updated = await refreshSelected();
      const record = updated && policyLegalEntityId(updated)
        ? updated
        : { ...(updated || selected.policy), legalEntityId: createdEntity.id };
      await loadLegalEntity(record);
    } catch (e) {
      setLegalEntityFormError(e.message);
    } finally {
      setLegalEntitySaving(false);
    }
  }

  const selectedPolicy = selected?.policy;
  const advanceTarget = selectedPolicy ? nextStatusFor(selectedPolicy.status) : null;
  const renewalAllowed = selectedPolicy ? isRenewable(selectedPolicy.status) : false;
  const renewalHint = selectedPolicy ? renewalUnavailableReason(selectedPolicy.status) : '';
  const renewedFromPolicyId = selectedPolicy?.renewedFromPolicyId || '';
  const renewedFromLabel = renewedFromPolicyId
    ? ((renewedFrom?.id === renewedFromPolicyId && renewedFrom.policyNumber)
      ? renewedFrom.policyNumber
      : shortId(renewedFromPolicyId))
    : '';
  const insuredPartyText = selectedPolicy?.insuredPartyId
    ? partyLabels[selectedPolicy.insuredPartyId] || shortId(selectedPolicy.insuredPartyId)
    : '—';
  const massTortProfile = massTort.profile;
  const massTortComplete = isMassTortComplete(massTortProfile);
  const currentProgram = program.program;
  const programLeadPolicyId = currentProgram?.leadPolicyId || '';
  const programLeadPolicyText = programLeadPolicyId
    ? (programLeadPolicy?.id === programLeadPolicyId && programLeadPolicy.number
      ? programLeadPolicy.number
      : currentProgram?.leadPolicyNumber || shortId(programLeadPolicyId))
    : '';
  const currentLegalEntity = legalEntity.legalEntity;

  /**
   * A renewal record knows its predecessor by id only. Resolve the policy
   * number from the queue when it is already loaded and fall back to the
   * detail read; the link target works from the id alone either way.
   */
  useEffect(() => {
    if (!renewedFromPolicyId) {
      setRenewedFrom(null);
      return undefined;
    }
    const queued = policies.find((policy) => policy.id === renewedFromPolicyId);
    if (queued?.policyNumber) {
      setRenewedFrom({ id: renewedFromPolicyId, policyNumber: queued.policyNumber });
      return undefined;
    }
    let active = true;
    setRenewedFrom({ id: renewedFromPolicyId, policyNumber: '' });
    api(`/api/v1/policies/${renewedFromPolicyId}`)
      .then(({ response, body }) => {
        if (!active) return;
        setRenewedFrom({
          id: renewedFromPolicyId,
          policyNumber: response.ok && body?.policyNumber ? body.policyNumber : ''
        });
      })
      .catch(() => {
        if (active) setRenewedFrom({ id: renewedFromPolicyId, policyNumber: '' });
      });
    return () => {
      active = false;
    };
  }, [renewedFromPolicyId, policies]);

  /**
   * The program card links to the program's lead policy. The catalog may send
   * the policy number with the program; otherwise resolve it from the queue or
   * the detail read. The link target is the policy id either way.
   */
  useEffect(() => {
    if (!programLeadPolicyId) {
      setProgramLeadPolicy(null);
      return undefined;
    }
    const knownNumber = currentProgram?.leadPolicyNumber || '';
    if (knownNumber) {
      setProgramLeadPolicy({ id: programLeadPolicyId, number: knownNumber });
      return undefined;
    }
    const queued = policies.find((policy) => policy.id === programLeadPolicyId);
    if (queued?.policyNumber) {
      setProgramLeadPolicy({ id: programLeadPolicyId, number: queued.policyNumber });
      return undefined;
    }
    let active = true;
    setProgramLeadPolicy({ id: programLeadPolicyId, number: '' });
    api(`/api/v1/policies/${programLeadPolicyId}`)
      .then(({ response, body }) => {
        if (!active) return;
        setProgramLeadPolicy({
          id: programLeadPolicyId,
          number: response.ok && body?.policyNumber ? body.policyNumber : ''
        });
      })
      .catch(() => {
        if (active) setProgramLeadPolicy({ id: programLeadPolicyId, number: '' });
      });
    return () => {
      active = false;
    };
  }, [programLeadPolicyId, currentProgram?.leadPolicyNumber, policies]);

  const normalizedQueueFilter = queueFilter.trim().toLowerCase();
  const filterActive = normalizedQueueFilter.length > 0;
  const visiblePolicies = filterActive
    ? policies.filter((policy) => [policy.policyNumber, policy.productCode, policy.status]
      .some((value) => String(value || '').toLowerCase().includes(normalizedQueueFilter)))
    : policies;

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Policy · Direct book</div>
          <h1>Policy</h1>
          <p className="subtitle">
            Direct policies, versions, coverages and limits, mass tort profiles, endorsements,
            insureds and locations, billing, cancellation and reinstatement. New policies start in
            DRAFT and advance through the issued lifecycle.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge direct">DIRECT book</span>
          <button type="button" className="eia-btn-ghost" onClick={refreshWorkspace}>
            Refresh
          </button>
          <button
            type="button"
            aria-expanded={showCreate}
            onClick={() => setShowCreate((value) => !value)}
          >
            New policy
          </button>
        </div>
      </header>

      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}

      {showCreate && (
        <section className="eia-card" aria-label="Create policy" style={{ marginBottom: 16 }}>
          <div className="eia-section-title" style={{ marginTop: 0 }}>
            <h2>Create policy</h2>
            <button type="button" className="eia-btn-ghost" onClick={() => setShowCreate(false)}>
              Cancel
            </button>
          </div>
          <form className="eia-form-grid" onSubmit={submit}>
            <div className="eia-field span-2">
              <label htmlFor="create-policy-number">Policy number (optional)</label>
              <input
                id="create-policy-number"
                placeholder="Auto-generated if blank"
                value={form.policyNumber}
                onChange={(e) => update('policyNumber', e.target.value)}
              />
            </div>
            <div className="eia-field">
              <label htmlFor="create-product-code">Product code</label>
              <input
                id="create-product-code"
                placeholder="CGL"
                value={form.productCode}
                onChange={(e) => update('productCode', e.target.value)}
                required
              />
            </div>
            <div className="eia-field span-2">
              <label>Insured party</label>
              <EntityPicker
                endpoint="/api/v1/parties/search"
                value={form.insuredPartyId}
                valueLabel={insuredPartyLabel}
                onChange={(id, item) => {
                  setForm((current) => ({ ...current, insuredPartyId: id || '' }));
                  setInsuredPartyLabel(item
                    ? [item.label, item.secondary].filter(Boolean).join(' · ')
                    : '');
                }}
              />
            </div>
            {form.insuredPartyId && (
              <section className="eia-card eia-selected-party span-3" aria-label="Selected insured party">
                <div className="eia-selected-party-meta">
                  <span className="eia-muted">Selected insured party</span>
                  <b>{insuredPartyLabel || shortId(form.insuredPartyId)}</b>
                  <code className="eia-mono">{form.insuredPartyId}</code>
                </div>
                <CrossLink
                  className="eia-selected-party-link"
                  href={`/party?record=${form.insuredPartyId}`}
                >
                  Open party record
                </CrossLink>
              </section>
            )}
            <div className="eia-field">
              <label htmlFor="create-effective-date">Effective date</label>
              <input
                id="create-effective-date"
                type="date"
                value={form.effectiveDate}
                onChange={(e) => update('effectiveDate', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="create-expiration-date">Expiration date</label>
              <input
                id="create-expiration-date"
                type="date"
                value={form.expirationDate}
                onChange={(e) => update('expirationDate', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="create-premium">Premium</label>
              <input
                id="create-premium"
                type="number"
                min="0"
                step="0.01"
                value={form.premiumAmount}
                onChange={(e) => update('premiumAmount', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="create-premium-currency">Premium currency</label>
              <input
                id="create-premium-currency"
                maxLength={3}
                placeholder="USD"
                value={form.premiumCurrency}
                onChange={(e) => update('premiumCurrency', e.target.value.toUpperCase())}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="create-limit">Limit</label>
              <input
                id="create-limit"
                type="number"
                min="0"
                step="0.01"
                value={form.limitAmount}
                onChange={(e) => update('limitAmount', e.target.value)}
                required
              />
            </div>
            <div className="eia-field">
              <label htmlFor="create-limit-currency">Limit currency</label>
              <input
                id="create-limit-currency"
                maxLength={3}
                placeholder="USD"
                value={form.limitCurrency}
                onChange={(e) => update('limitCurrency', e.target.value.toUpperCase())}
                required
              />
            </div>
            <div className="eia-field">
              <button type="submit" disabled={saving}>
                {saving ? 'Creating…' : 'Create policy'}
              </button>
            </div>
          </form>
        </section>
      )}

      <div className="eia-record-layout">
        <div>
          <div className="eia-queue-search">
            <div className="eia-search-box">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                type="search"
                value={queueFilter}
                onChange={(event) => setQueueFilter(event.target.value)}
                placeholder={QUEUE_FILTER_PLACEHOLDER}
                aria-label="Filter policies"
                autoComplete="off"
              />
              {filterActive && (
                <button
                  type="button"
                  className="eia-queue-clear"
                  onClick={() => setQueueFilter('')}
                >
                  Clear
                </button>
              )}
            </div>
          </div>
          <aside className="eia-record-list" aria-label="Policy register">
            <div className="eia-record-list-head">
              <strong>Direct policies</strong>
              <span className="eia-muted">
                {filterActive ? `${visiblePolicies.length} of ${policies.length}` : total}
              </span>
            </div>
            {visiblePolicies.map((policy) => {
              const isSelected = selected?.id === policy.id;
              return (
                <button
                  key={policy.id}
                  type="button"
                  className={isSelected ? 'selected' : ''}
                  aria-pressed={isSelected}
                  aria-label={`Open record ${policy.policyNumber}`}
                  onClick={() => openPolicy(policy.id)}
                >
                  <span className="record-primary">{policy.policyNumber}</span>
                  <span className="record-secondary">Insured {insuredLabel(policy, partyLabels)}</span>
                  <span className="record-secondary">
                    {policy.productCode || '—'} · version {policy.version ?? '—'}
                  </span>
                  <span>
                    <span className={`eia-pill ${statusTone(policy.status)}`}>{policy.status}</span>
                  </span>
                </button>
              );
            })}
            {visiblePolicies.length === 0 && (
              <div className="empty">
                {filterActive
                  ? 'No matching policies'
                  : (page > 0 ? 'No policies on this page.' : 'No policies yet. Use New policy to open the first record.')}
              </div>
            )}
          </aside>

          <nav
            aria-label="Pagination"
            className="eia-toolbar"
            style={{ marginTop: 10, marginBottom: 0, justifyContent: 'space-between' }}
          >
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={() => goTo(page - 1)}
              disabled={page <= 0 || loading}
            >
              Previous
            </button>
            <span className="eia-muted">
              Page {page + 1} · {total} {total === 1 ? 'policy' : 'policies'}
            </span>
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={() => goTo(page + 1)}
              disabled={!links?.next || loading}
            >
              Next
            </button>
          </nav>
        </div>

        <section className="eia-record-panel" aria-label="Policy record">
          {!selectedPolicy ? (
            <div className="eia-empty">
              Select a policy from the direct book to open its record, or create a new policy to start a quote.
            </div>
          ) : (
            <>
              <div className="eia-record-title">
                <div>
                  <h2>{selectedPolicy.policyNumber}</h2>
                  <p className="eia-record-subtitle">
                    <span
                      className={`eia-pill ${statusTone(selectedPolicy.status)}`}
                      data-testid="policy-status"
                    >
                      {selectedPolicy.status}
                    </span>
                    {' · '}
                    Product {selectedPolicy.productCode || '—'}
                    {' · '}
                    Version {selectedPolicy.version ?? '—'}
                    {' · '}
                    ETag <code className="eia-mono" data-testid="policy-etag">{selected.etag}</code>
                  </p>
                  <p className="eia-record-subtitle">
                    Insured{' '}
                    {selectedPolicy.insuredPartyId ? (
                      <CrossLink
                        href={`/party?record=${selectedPolicy.insuredPartyId}`}
                        data-testid="record-insured-link"
                        title={`Open party ${selectedPolicy.insuredPartyId}`}
                      >
                        {insuredPartyText}
                      </CrossLink>
                    ) : '—'}
                  </p>
                  {renewedFromPolicyId && (
                    <p className="eia-record-subtitle" data-testid="renewed-from">
                      Renewed from{' '}
                      <CrossLink
                        href={`/policy?record=${renewedFromPolicyId}`}
                        data-testid="renewed-from-link"
                        title={`Open predecessor policy ${renewedFromLabel}`}
                      >
                        {renewedFromLabel}
                      </CrossLink>
                    </p>
                  )}
                </div>
                <div className="eia-actions">
                  <span
                    className="eia-renew-action"
                    title={renewalAllowed ? 'Create the next term as a new policy record' : renewalHint}
                  >
                    <button
                      type="button"
                      className="eia-btn-secondary"
                      data-testid="renew-policy"
                      onClick={openRenewal}
                      disabled={!renewalAllowed || renewBusy}
                      title={renewalAllowed
                        ? 'Create the next term as a new policy record'
                        : renewalHint}
                    >
                      Renew
                    </button>
                  </span>
                  {advanceTarget && (
                    <button
                      type="button"
                      onClick={() => advance(selectedPolicy)}
                      disabled={busyId === selectedPolicy.id}
                    >
                      {busyId === selectedPolicy.id ? 'Advancing…' : `Advance to ${advanceTarget}`}
                    </button>
                  )}
                  <button type="button" className="eia-btn-ghost" onClick={closeSelected}>
                    Close
                  </button>
                </div>
              </div>

              <div className="eia-summary-grid">
                <div className="eia-card">
                  <h3>Premium</h3>
                  <div className="value">
                    {formatMoney(selectedPolicy.premiumAmount, selectedPolicy.premiumCurrency)}
                  </div>
                  <div className="eia-metric-label">
                    {selectedPolicy.premiumCurrency || '—'} written premium
                  </div>
                </div>
                <div className="eia-card">
                  <h3>Limit</h3>
                  <div className="value">
                    {formatMoney(selectedPolicy.limitAmount, selectedPolicy.limitCurrency)}
                  </div>
                  <div className="eia-metric-label">
                    {selectedPolicy.limitCurrency || '—'} policy limit
                  </div>
                </div>
                <div className="eia-card">
                  <h3>Effective</h3>
                  <div className="value">{selectedPolicy.effectiveDate || '—'}</div>
                  <div className="eia-metric-label">policy inception</div>
                </div>
                <div className="eia-card">
                  <h3>Expiration</h3>
                  <div className="value">{selectedPolicy.expirationDate || '—'}</div>
                  <div className="eia-metric-label">policy expiration</div>
                </div>
              </div>

              <nav className="eia-tabs" role="tablist" aria-label="Policy sections">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    id={`tab-${entry.id}`}
                    type="button"
                    role="tab"
                    className={`eia-tab${tab === entry.id ? ' active' : ''}`}
                    aria-selected={tab === entry.id}
                    aria-controls={`panel-${entry.id}`}
                    onClick={() => selectTab(entry.id)}
                  >
                    {entry.label}
                  </button>
                ))}
              </nav>

              {tabLoading && tab !== 'billing' && tab !== 'massTort' && tab !== 'program' && tab !== 'legalEntity' && (
                <p className="eia-muted">Loading…</p>
              )}

              {tab === 'overview' && (
                <section
                  id="panel-overview"
                  role="tabpanel"
                  aria-labelledby="tab-overview"
                >
                  <div className="eia-grid eia-grid-2">
                    <section className="eia-card" aria-label="Policy details">
                      <h3>Policy details</h3>
                      <dl className="eia-kv" style={{ marginTop: 8 }}>
                        <dt>Policy number</dt>
                        <dd className="eia-mono">{selectedPolicy.policyNumber}</dd>
                        <dt>Product</dt>
                        <dd>{selectedPolicy.productCode || '—'}</dd>
                        <dt>Insured party</dt>
                        <dd>
                          {selectedPolicy.insuredPartyId ? (
                            <CrossLink
                              href={`/party?record=${selectedPolicy.insuredPartyId}`}
                              data-testid="overview-insured-link"
                              title={`Open party ${selectedPolicy.insuredPartyId}`}
                            >
                              {insuredPartyText}
                            </CrossLink>
                          ) : '—'}
                        </dd>
                        <dt>Effective</dt>
                        <dd>{selectedPolicy.effectiveDate || '—'}</dd>
                        <dt>Expiration</dt>
                        <dd>{selectedPolicy.expirationDate || '—'}</dd>
                        <dt>Premium</dt>
                        <dd>{formatMoney(selectedPolicy.premiumAmount, selectedPolicy.premiumCurrency)}</dd>
                        <dt>Limit</dt>
                        <dd>{formatMoney(selectedPolicy.limitAmount, selectedPolicy.limitCurrency)}</dd>
                        <dt>Version</dt>
                        <dd>{selectedPolicy.version ?? '—'}</dd>
                      </dl>
                    </section>

                    <section className="eia-card" aria-label="Current version">
                      <h3>Current version</h3>
                      {currentVersion?.version ? (
                        <dl className="eia-kv" style={{ marginTop: 8 }}>
                          <dt>Version</dt>
                          <dd className="eia-mono">{currentVersion.version?.policyVersionNumber}</dd>
                          <dt>Change</dt>
                          <dd>{currentVersion.version?.changeType}</dd>
                          <dt>Status</dt>
                          <dd>{currentVersion.version?.status}</dd>
                          <dt>Effective from</dt>
                          <dd>{currentVersion.version?.effectiveFrom}</dd>
                          <dt>Hash verified</dt>
                          <dd>{currentVersion.hashVerified ? 'Yes' : 'No'}</dd>
                        </dl>
                      ) : (
                        <p className="eia-muted" style={{ marginTop: 8 }}>
                          No version issued yet. Add a named insured and advance the policy to ISSUED.
                        </p>
                      )}
                    </section>
                  </div>

                  <section className="eia-context-panel" aria-label="Why this matters">
                    <h4>Why this matters</h4>
                    <p>
                      This policy is the source of coverage for Direct Claims and Cessions. Changes
                      affect both. SAP FS-RI remains the system of record for ceded amounts.
                    </p>
                  </section>

                  <section className="eia-card" aria-label="Related records" style={{ marginTop: 14 }}>
                    <h3>Related records</h3>
                    {related.loading ? (
                      <p className="eia-muted" style={{ marginTop: 8 }}>Loading related records…</p>
                    ) : (
                      <>
                        {related.error && (
                          <p className="eia-muted" style={{ marginTop: 8 }}>{related.error}</p>
                        )}
                        {!related.error && related.claims.length === 0 && related.cessions.length === 0 && (
                          <p className="eia-muted" style={{ marginTop: 8 }}>
                            No direct claims or cessions reference this policy yet.
                          </p>
                        )}
                        {related.claims.length > 0 && (
                          <>
                            <div className="eia-related-group-label">Direct claims</div>
                            <div className="eia-related-list">
                              {related.claims.map((item) => (
                                <CrossLink
                                  key={item.id || item.href || item.label}
                                  className="eia-related-record"
                                  href={searchHref(item, '/direct-claims')}
                                  title={item.secondary}
                                >
                                  <b>{item.label}</b>
                                  {item.status ? <span>{item.status}</span> : null}
                                </CrossLink>
                              ))}
                            </div>
                          </>
                        )}
                        {related.cessions.length > 0 && (
                          <>
                            <div className="eia-related-group-label">Cessions</div>
                            <div className="eia-related-list">
                              {related.cessions.map((item) => (
                                <CrossLink
                                  key={item.id || item.href || item.label}
                                  className="eia-related-record"
                                  href={searchHref(item, '/cession')}
                                  title={item.secondary}
                                >
                                  <b>{item.label}</b>
                                  {item.status ? <span>{item.status}</span> : null}
                                </CrossLink>
                              ))}
                            </div>
                          </>
                        )}
                      </>
                    )}
                  </section>

                  <section
                    className="eia-card"
                    aria-label="Linked documents"
                    data-testid="linked-documents"
                    style={{ marginTop: 14 }}
                  >
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h3>Documents</h3>
                      <span className="eia-badge" data-testid="linked-documents-count">
                        {documents.loading
                          ? '…'
                          : `${documents.items.length} ${documents.items.length === 1 ? 'document' : 'documents'}`}
                      </span>
                    </div>
                    <p
                      className="eia-muted"
                      style={{ margin: '4px 0 0' }}
                      data-testid="documents-evidence-note"
                    >
                      Documents are evidence, not business facts. Open a document in the Document
                      workspace to review its content and links.
                    </p>
                    {documents.loading ? (
                      <p className="eia-muted" style={{ margin: '8px 0 0' }}>Loading documents…</p>
                    ) : documents.error ? (
                      <p className="eia-muted" style={{ margin: '8px 0 0' }}>{documents.error}</p>
                    ) : documents.items.length === 0 ? (
                      <p className="eia-muted" style={{ margin: '8px 0 0' }}>
                        No documents are linked to this policy.
                      </p>
                    ) : (
                      <div className="eia-table-wrap" style={{ marginTop: 10 }}>
                        <table className="eia-table">
                          <thead>
                            <tr>
                              <th>Document number</th>
                              <th>Title</th>
                              <th>Type</th>
                              <th>Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {documents.items.map((document, index) => (
                              <tr key={document.id || document.documentNumber || `document-${index}`}>
                                <td>
                                  {document.id ? (
                                    <CrossLink
                                      className="eia-mono"
                                      href={`/document?record=${encodeURIComponent(document.id)}`}
                                      title={`Open document ${document.documentNumber || document.id}`}
                                    >
                                      {document.documentNumber || 'Document'}
                                    </CrossLink>
                                  ) : (document.documentNumber || '—')}
                                </td>
                                <td>{document.title || '—'}</td>
                                <td>{document.documentType || document.type || '—'}</td>
                                <td>
                                  <span className={`eia-pill ${documentStatusTone(document.status)}`}>
                                    {document.status || '—'}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </section>
              )}

              {tab === 'program' && (
                <section
                  id="panel-program"
                  role="tabpanel"
                  aria-labelledby="tab-program"
                >
                  <div className="eia-section-title">
                    <h2>Program</h2>
                    <span className="eia-muted">
                      Capacity and aggregate administration · Direct book
                    </span>
                  </div>
                  <div className="eia-toolbar" style={{ marginBottom: 12 }}>
                    <span className="eia-muted">
                      One program per policy · assigning does not change coverage or limits
                    </span>
                    <span className="spacer" />
                    <button type="button" data-testid="create-program" onClick={openProgramCreate}>
                      Create program
                    </button>
                  </div>

                  {program.loading && !currentProgram ? (
                    <p className="eia-muted" data-testid="program-loading">
                      Loading program…
                    </p>
                  ) : program.error ? (
                    <section
                      className="eia-card"
                      aria-label="Program unavailable"
                      data-testid="program-error"
                    >
                      <p role="alert" style={{ marginTop: 0 }}>{program.error}</p>
                      <button
                        type="button"
                        className="eia-btn-secondary"
                        onClick={() => loadProgram()}
                      >
                        Retry
                      </button>
                    </section>
                  ) : !currentProgram ? (
                    <>
                      <section
                        className="eia-card eia-program-empty"
                        aria-label="No program assigned"
                        data-testid="program-empty"
                      >
                        <h3 style={{ marginTop: 0 }}>No program assigned</h3>
                        <p className="eia-billing-copy">
                          This policy is not assigned to a program. A program groups related
                          policies for capacity and aggregate administration, so a block of
                          policies can be reviewed and managed together.
                        </p>
                        <p className="eia-billing-copy">
                          Attach an existing program below, or create a program to group this
                          policy with its related policies. Assigning a program is
                          administrative: coverage, limits, premium, and the policy version
                          stay unchanged.
                        </p>
                      </section>

                      <section
                        className="eia-card"
                        aria-label="Attach existing program"
                        data-testid="program-attach"
                        style={{ marginTop: 16 }}
                      >
                        <div className="eia-section-title" style={{ marginTop: 0 }}>
                          <h2>Attach existing program</h2>
                          <span className="eia-muted">Reads the program catalog</span>
                        </div>
                        <p className="eia-billing-copy">
                          Search by program number or name. Attaching records the association
                          on this policy; the program keeps its own effective dates, status,
                          and lead policy.
                        </p>
                        <div className="eia-form-grid">
                          <div className="eia-field span-2">
                            <label htmlFor="program-attach-picker">Program</label>
                            <ProgramPicker
                              value={programPick?.id || ''}
                              valueLabel={programPick ? programDisplayLabel(programPick) : ''}
                              onChange={selectProgramForAttach}
                              disabled={Boolean(programBusy)}
                            />
                          </div>
                          <div className="eia-field">
                            <button
                              type="button"
                              data-testid="attach-program"
                              onClick={attachProgram}
                              disabled={Boolean(programBusy) || !programPick?.id}
                            >
                              {programBusy === 'attach' ? 'Attaching…' : 'Attach program'}
                            </button>
                          </div>
                        </div>
                        {programPick && (
                          <p
                            className="eia-muted"
                            style={{ margin: '8px 0 0' }}
                            data-testid="program-attach-selection"
                          >
                            Selected {programDisplayLabel(programPick)}
                            {programPick.type ? ` · ${programTypeLabel(programPick.type)}` : ''}
                            {programPick.status ? ` · ${programPick.status}` : ''}
                          </p>
                        )}
                        {programAttachError && (
                          <p
                            role="alert"
                            data-testid="program-attach-error"
                            style={{ margin: '10px 0 0' }}
                          >
                            {programAttachError}
                          </p>
                        )}
                      </section>
                    </>
                  ) : (
                    <section
                      className="eia-card"
                      aria-label="Current program"
                      data-testid="program-current"
                    >
                      <div className="eia-section-title" style={{ marginTop: 0 }}>
                        <h2>Current program</h2>
                        <span
                          className={`eia-pill ${programStatusTone(currentProgram.status)}`}
                          data-testid="program-status"
                        >
                          {currentProgram.status || '—'}
                        </span>
                      </div>
                      <dl className="eia-kv" style={{ marginTop: 10 }}>
                        <dt>Program number</dt>
                        <dd className="eia-mono" data-testid="program-value-number">
                          {currentProgram.number || '—'}
                        </dd>
                        <dt>Name</dt>
                        <dd data-testid="program-value-name">{currentProgram.name || '—'}</dd>
                        <dt>Type</dt>
                        <dd data-testid="program-value-type">
                          {programTypeLabel(currentProgram.type)}
                        </dd>
                        <dt>Effective from</dt>
                        <dd data-testid="program-value-effective-from">
                          {currentProgram.effectiveFrom || '—'}
                        </dd>
                        <dt>Effective to</dt>
                        <dd data-testid="program-value-effective-to">
                          {currentProgram.effectiveTo || '—'}
                        </dd>
                        <dt>Status</dt>
                        <dd data-testid="program-value-status">
                          {currentProgram.status || '—'}
                        </dd>
                        <dt>Lead policy</dt>
                        <dd data-testid="program-value-lead-policy">
                          {programLeadPolicyId ? (
                            <CrossLink
                              href={`/policy?record=${programLeadPolicyId}`}
                              data-testid="program-lead-policy-link"
                              title={`Open lead policy ${programLeadPolicyId}`}
                            >
                              {programLeadPolicyText}
                            </CrossLink>
                          ) : '—'}
                        </dd>
                      </dl>

                      {programActionError && (
                        <p
                          role="alert"
                          data-testid="program-action-error"
                          style={{ margin: '12px 0 0' }}
                        >
                          {programActionError}
                        </p>
                      )}

                      <div
                        className="eia-actions"
                        style={{ marginTop: 14, justifyContent: 'flex-start' }}
                      >
                        <button
                          type="button"
                          className="eia-btn-secondary"
                          data-testid="detach-program"
                          onClick={detachProgram}
                          disabled={Boolean(programBusy)}
                        >
                          {programBusy === 'detach' ? 'Detaching…' : 'Detach program'}
                        </button>
                      </div>
                      <p className="eia-muted" style={{ margin: '8px 0 0' }}>
                        Detaching removes only the program association. Coverage, limits,
                        premium, and the policy version stay unchanged.
                      </p>
                    </section>
                  )}

                  <ProgramContextPanel />
                </section>
              )}

              {tab === 'legalEntity' && (
                <section
                  id="panel-legalEntity"
                  role="tabpanel"
                  aria-labelledby="tab-legalEntity"
                >
                  <div className="eia-section-title">
                    <h2>Legal entity</h2>
                    <span className="eia-muted">Issuing carrier · Direct book</span>
                  </div>
                  <div className="eia-toolbar" style={{ marginBottom: 12 }}>
                    <span className="eia-muted">
                      One issuing legal entity per policy · assigning does not change coverage or
                      limits
                    </span>
                    <span className="spacer" />
                    <button
                      type="button"
                      data-testid="create-legal-entity"
                      onClick={openLegalEntityCreate}
                    >
                      Create legal entity
                    </button>
                  </div>

                  {legalEntityConflict && (
                    <p
                      role="alert"
                      className="eia-legal-entity-conflict"
                      data-testid="legal-entity-conflict"
                    >
                      {legalEntityConflict}
                    </p>
                  )}

                  {legalEntity.loading && !currentLegalEntity ? (
                    <p className="eia-muted" data-testid="legal-entity-loading">
                      Loading legal entity…
                    </p>
                  ) : legalEntity.error ? (
                    <section
                      className="eia-card"
                      aria-label="Legal entity unavailable"
                      data-testid="legal-entity-error"
                    >
                      <p role="alert" style={{ marginTop: 0 }}>{legalEntity.error}</p>
                      <button
                        type="button"
                        className="eia-btn-secondary"
                        onClick={() => loadLegalEntity()}
                      >
                        Retry
                      </button>
                    </section>
                  ) : !currentLegalEntity ? (
                    <>
                      <section
                        className="eia-card eia-legal-entity-empty"
                        aria-label="No legal entity assigned"
                        data-testid="legal-entity-empty"
                      >
                        <h3 style={{ marginTop: 0 }}>No legal entity assigned</h3>
                        <p className="eia-billing-copy">
                          This policy does not record an issuing legal entity. The legal entity is
                          the licensed carrier that issues the policy and owns its billing, tax,
                          and regulatory reporting.
                        </p>
                        <p className="eia-billing-copy">
                          Attach an existing legal entity below, or create one to record the
                          issuing carrier. Assigning a legal entity is administrative: coverage,
                          limits, premium, and the policy version stay unchanged.
                        </p>
                      </section>

                      <section
                        className="eia-card"
                        aria-label="Attach existing legal entity"
                        data-testid="legal-entity-attach"
                        style={{ marginTop: 16 }}
                      >
                        <div className="eia-section-title" style={{ marginTop: 0 }}>
                          <h2>Attach existing legal entity</h2>
                          <span className="eia-muted">Reads the legal-entity catalog</span>
                        </div>
                        <p className="eia-billing-copy">
                          Search by entity code or legal name. Attaching records the association
                          on this policy; the legal entity keeps its own type, jurisdiction,
                          regulator, license, and status.
                        </p>
                        <div className="eia-form-grid">
                          <div className="eia-field span-2">
                            <label htmlFor="legal-entity-attach-picker">Legal entity</label>
                            <LegalEntityPicker
                              value={legalEntityPick?.id || ''}
                              valueLabel={legalEntityPick
                                ? legalEntityDisplayLabel(legalEntityPick)
                                : ''}
                              onChange={selectLegalEntityForAttach}
                              disabled={Boolean(legalEntityBusy)}
                            />
                          </div>
                          <div className="eia-field">
                            <button
                              type="button"
                              data-testid="attach-legal-entity"
                              onClick={attachLegalEntity}
                              disabled={Boolean(legalEntityBusy) || !legalEntityPick?.id}
                            >
                              {legalEntityBusy === 'attach'
                                ? 'Attaching…'
                                : 'Attach legal entity'}
                            </button>
                          </div>
                        </div>
                        {legalEntityPick && (
                          <p
                            className="eia-muted"
                            style={{ margin: '8px 0 0' }}
                            data-testid="legal-entity-attach-selection"
                          >
                            Selected {legalEntityDisplayLabel(legalEntityPick)}
                            {legalEntityPick.type
                              ? ` · ${legalEntityTypeLabel(legalEntityPick.type)}`
                              : ''}
                            {legalEntityPick.status ? ` · ${legalEntityPick.status}` : ''}
                          </p>
                        )}
                        {legalEntityAttachError && (
                          <p
                            role="alert"
                            data-testid="legal-entity-attach-error"
                            style={{ margin: '10px 0 0' }}
                          >
                            {legalEntityAttachError}
                          </p>
                        )}
                      </section>
                    </>
                  ) : (
                    <section
                      className="eia-card"
                      aria-label="Current legal entity"
                      data-testid="legal-entity-current"
                    >
                      <div className="eia-section-title" style={{ marginTop: 0 }}>
                        <h2>Issuing legal entity</h2>
                        <span
                          className={`eia-pill ${legalEntityStatusTone(currentLegalEntity.status)}`}
                          data-testid="legal-entity-status"
                        >
                          {currentLegalEntity.status || '—'}
                        </span>
                      </div>
                      <dl className="eia-kv" style={{ marginTop: 10 }}>
                        <dt>Entity code</dt>
                        <dd className="eia-mono" data-testid="legal-entity-value-code">
                          {currentLegalEntity.code || '—'}
                        </dd>
                        <dt>Legal name</dt>
                        <dd data-testid="legal-entity-value-name">
                          {currentLegalEntity.name || '—'}
                        </dd>
                        <dt>Type</dt>
                        <dd data-testid="legal-entity-value-type">
                          {legalEntityTypeLabel(currentLegalEntity.type)}
                        </dd>
                        <dt>Jurisdiction</dt>
                        <dd data-testid="legal-entity-value-jurisdiction">
                          {legalEntityJurisdictionLabel(currentLegalEntity)}
                        </dd>
                        <dt>Regulator</dt>
                        <dd data-testid="legal-entity-value-regulator">
                          {currentLegalEntity.regulator || '—'}
                        </dd>
                        <dt>License</dt>
                        <dd data-testid="legal-entity-value-license">
                          {currentLegalEntity.license || '—'}
                        </dd>
                        <dt>Status</dt>
                        <dd data-testid="legal-entity-value-status">
                          {currentLegalEntity.status || '—'}
                        </dd>
                      </dl>

                      {legalEntityActionError && (
                        <p
                          role="alert"
                          data-testid="legal-entity-action-error"
                          style={{ margin: '12px 0 0' }}
                        >
                          {legalEntityActionError}
                        </p>
                      )}

                      <div
                        className="eia-actions"
                        style={{ marginTop: 14, justifyContent: 'flex-start' }}
                      >
                        <button
                          type="button"
                          className="eia-btn-secondary"
                          data-testid="detach-legal-entity"
                          onClick={detachLegalEntity}
                          disabled={Boolean(legalEntityBusy)}
                        >
                          {legalEntityBusy === 'detach' ? 'Detaching…' : 'Detach'}
                        </button>
                      </div>
                      <p className="eia-muted" style={{ margin: '8px 0 0' }}>
                        Detaching removes only the issuing-entity association. Coverage, limits,
                        premium, and the policy version stay unchanged.
                      </p>
                    </section>
                  )}

                  <LegalEntityContextPanel />
                </section>
              )}

              {tab === 'versions' && (
                <section
                  id="panel-versions"
                  role="tabpanel"
                  aria-labelledby="tab-versions"
                >
                  <div className="eia-section-title">
                    <h2>Version history</h2>
                    <span className="eia-muted">
                      {versions.length} version{versions.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Version</th>
                          <th>Change</th>
                          <th>Status</th>
                          <th>Effective from</th>
                          <th>Effective to</th>
                          <th>Premium delta</th>
                          <th>Hash</th>
                        </tr>
                      </thead>
                      <tbody>
                        {versions.map((version) => (
                          <tr key={version.id}>
                            <td>{version.policyVersionNumber}</td>
                            <td>{version.changeType}</td>
                            <td>{version.status}</td>
                            <td>{version.effectiveFrom}</td>
                            <td>{version.effectiveTo || '—'}</td>
                            <td>
                              {version.premiumDeltaAmount
                                ? formatMoney(version.premiumDeltaAmount, version.premiumDeltaCurrency)
                                : '—'}
                            </td>
                            <td><code className="eia-mono">{String(version.immutableHash || '').slice(0, 12)}</code></td>
                          </tr>
                        ))}
                        {versions.length === 0 && (
                          <tr><td className="eia-muted" colSpan={7}>No versions yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}

              {tab === 'coverages' && (
                <section
                  id="panel-coverages"
                  role="tabpanel"
                  aria-labelledby="tab-coverages"
                >
                  <div className="eia-section-title">
                    <h2>Coverages and limits</h2>
                    <span className="eia-muted">
                      {coverages.length} coverage{coverages.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Name</th>
                          <th>Part</th>
                          <th>Per occurrence</th>
                          <th>Aggregate</th>
                          <th>Deductible</th>
                          <th>Coinsurance</th>
                          <th>Remaining</th>
                        </tr>
                      </thead>
                      <tbody>
                        {coverages.map((entry) => (
                          <tr key={entry.coverage?.id}>
                            <td>{entry.coverage?.coverageCode}</td>
                            <td>{entry.coverage?.coverageName}</td>
                            <td>{entry.coverage?.coveragePart}</td>
                            <td>{formatMoney(entry.limit?.perOccurrenceAmount, entry.limit?.currency)}</td>
                            <td>{formatMoney(entry.limit?.aggregateAmount, entry.limit?.currency)}</td>
                            <td>{formatMoney(entry.limit?.deductibleAmount, entry.limit?.currency)}</td>
                            <td>{formatPercent(entry.limit?.coinsurancePct)}</td>
                            <td>{formatMoney(entry.state?.remainingAmount, entry.limit?.currency)}</td>
                          </tr>
                        ))}
                        {coverages.length === 0 && (
                          <tr><td className="eia-muted" colSpan={8}>No coverages yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <section className="eia-card" aria-label="Add coverage" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Add coverage</h2>
                      <span className="eia-muted">Writes with the current If-Match ETag</span>
                    </div>
                    <form className="eia-form-grid" onSubmit={submitCoverage}>
                      <div className="eia-field">
                        <label htmlFor="coverage-code">Coverage code</label>
                        <input
                          id="coverage-code"
                          value={coverageForm.coverageCode}
                          onChange={(e) => updateCoverage('coverageCode', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field span-2">
                        <label htmlFor="coverage-name">Coverage name</label>
                        <input
                          id="coverage-name"
                          value={coverageForm.coverageName}
                          onChange={(e) => updateCoverage('coverageName', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-part">Part</label>
                        <select
                          id="coverage-part"
                          value={coverageForm.coveragePart}
                          onChange={(e) => updateCoverage('coveragePart', e.target.value)}
                        >
                          <option value="A">A</option>
                          <option value="B">B</option>
                          <option value="C">C</option>
                          <option value="D">D</option>
                        </select>
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-occurrence-basis">Occurrence basis</label>
                        <select
                          id="coverage-occurrence-basis"
                          value={coverageForm.occurrenceBasis}
                          onChange={(e) => updateCoverage('occurrenceBasis', e.target.value)}
                        >
                          <option value="OCCURRENCE">OCCURRENCE</option>
                          <option value="CLAIMS_MADE">CLAIMS_MADE</option>
                          <option value="CLAIMS_MADE_WITH_RETRO">CLAIMS_MADE_WITH_RETRO</option>
                          <option value="DISCOVERY">DISCOVERY</option>
                        </select>
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-effective-from">Effective from</label>
                        <input
                          id="coverage-effective-from"
                          type="date"
                          value={coverageForm.effectiveFrom}
                          onChange={(e) => updateCoverage('effectiveFrom', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-effective-to">Effective to</label>
                        <input
                          id="coverage-effective-to"
                          type="date"
                          value={coverageForm.effectiveTo}
                          onChange={(e) => updateCoverage('effectiveTo', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-per-occurrence">Per occurrence</label>
                        <input
                          id="coverage-per-occurrence"
                          type="number"
                          min="0"
                          step="0.01"
                          value={coverageForm.perOccurrenceAmount}
                          onChange={(e) => updateCoverage('perOccurrenceAmount', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-aggregate">Aggregate (optional)</label>
                        <input
                          id="coverage-aggregate"
                          type="number"
                          min="0"
                          step="0.01"
                          value={coverageForm.aggregateAmount}
                          onChange={(e) => updateCoverage('aggregateAmount', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-sublimit">Sublimit (optional)</label>
                        <input
                          id="coverage-sublimit"
                          type="number"
                          min="0"
                          step="0.01"
                          value={coverageForm.sublimitAmount}
                          onChange={(e) => updateCoverage('sublimitAmount', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-deductible">Deductible</label>
                        <input
                          id="coverage-deductible"
                          type="number"
                          min="0"
                          step="0.01"
                          value={coverageForm.deductibleAmount}
                          onChange={(e) => updateCoverage('deductibleAmount', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-coinsurance">Coinsurance (fraction)</label>
                        <input
                          id="coverage-coinsurance"
                          type="number"
                          min="0"
                          max="1"
                          step="0.01"
                          value={coverageForm.coinsurancePct}
                          onChange={(e) => updateCoverage('coinsurancePct', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="coverage-currency">Currency</label>
                        <input
                          id="coverage-currency"
                          maxLength={3}
                          value={coverageForm.currency}
                          onChange={(e) => updateCoverage('currency', e.target.value.toUpperCase())}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <button type="submit">Add coverage</button>
                      </div>
                    </form>
                  </section>

                  <section className="eia-card" aria-label="Apply aggregate erosion" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Apply aggregate erosion</h2>
                    </div>
                    <p className="eia-muted" style={{ marginTop: 0 }}>
                      Posts an idempotent erosion fact against the first limit on the policy; replaying the same
                      claim/allocation/source version never double-counts.
                    </p>
                    <form className="eia-form-grid" onSubmit={submitErosion}>
                      <div className="eia-field">
                        <label htmlFor="erosion-claim">Claim ID</label>
                        <input
                          id="erosion-claim"
                          placeholder="Claim UUID"
                          value={erosionForm.claimId}
                          onChange={(e) => updateErosion('claimId', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="erosion-allocation">Allocation ID</label>
                        <input
                          id="erosion-allocation"
                          placeholder="Allocation UUID"
                          value={erosionForm.allocationId}
                          onChange={(e) => updateErosion('allocationId', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="erosion-source-version">Source version</label>
                        <input
                          id="erosion-source-version"
                          type="number"
                          min="1"
                          value={erosionForm.sourceVersion}
                          onChange={(e) => updateErosion('sourceVersion', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="erosion-paid">Paid</label>
                        <input
                          id="erosion-paid"
                          type="number"
                          min="0"
                          step="0.01"
                          value={erosionForm.paidAmount}
                          onChange={(e) => updateErosion('paidAmount', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="erosion-reserved">Reserved</label>
                        <input
                          id="erosion-reserved"
                          type="number"
                          min="0"
                          step="0.01"
                          value={erosionForm.reservedAmount}
                          onChange={(e) => updateErosion('reservedAmount', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="erosion-recovered">Recovered</label>
                        <input
                          id="erosion-recovered"
                          type="number"
                          min="0"
                          step="0.01"
                          value={erosionForm.recoveredAmount}
                          onChange={(e) => updateErosion('recoveredAmount', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <button type="submit" disabled={coverages.length === 0}>
                          Apply erosion
                        </button>
                      </div>
                    </form>
                  </section>
                </section>
              )}

              {tab === 'massTort' && (
                <section
                  id="panel-massTort"
                  role="tabpanel"
                  aria-labelledby="tab-massTort"
                >
                  <div className="eia-section-title">
                    <h2>Mass tort profile</h2>
                    <span className="eia-muted">
                      Policy-owned administrative context · Direct Claims owns allocations
                    </span>
                  </div>

                  {massTort.loading && !massTort.profile ? (
                    <p className="eia-muted" role="status" data-testid="mass-tort-loading">
                      Loading mass tort profile…
                    </p>
                  ) : massTort.error && !massTort.profile ? (
                    <section
                      className="eia-card"
                      aria-label="Mass tort profile unavailable"
                      data-testid="mass-tort-error"
                    >
                      <p role="alert" style={{ marginTop: 0 }}>{massTort.error}</p>
                      <button
                        type="button"
                        className="eia-btn-secondary"
                        onClick={() => loadMassTort()}
                      >
                        Retry
                      </button>
                    </section>
                  ) : !massTort.profile ? (
                    !massTortSetup && (
                      <section
                        className="eia-card eia-empty"
                        aria-label="Mass tort profile not set"
                        data-testid="mass-tort-empty"
                      >
                        <h3 style={{ marginTop: 0 }}>Mass tort profile not set</h3>
                        <p className="eia-billing-copy">
                          A mass tort profile records the tort, coverage trigger, allocation method,
                          and coverage block that guide long-tail claim administration. It supplies
                          the policy context Direct Claims uses to allocate claims across policy
                          years and layers. It does not change coverage, limits, premium, or the
                          policy version.
                        </p>
                        <button
                          type="button"
                          data-testid="mass-tort-setup"
                          onClick={openMassTortSetup}
                        >
                          Set up profile
                        </button>
                      </section>
                    )
                  ) : (
                    <section
                      className={`eia-card${massTortComplete ? ' eia-mass-tort-complete' : ''}`}
                      aria-label={massTortComplete
                        ? 'Complete mass tort profile'
                        : 'Mass tort profile summary'}
                      data-testid="mass-tort-summary"
                    >
                      <div className="eia-section-title" style={{ marginTop: 0 }}>
                        <h2>{massTortComplete ? 'Complete mass tort profile' : 'Mass tort profile'}</h2>
                        <span
                          className={`eia-pill ${massTortStatusTone(massTortProfile.status)}`}
                          data-testid="mass-tort-status"
                        >
                          {massTortProfile.status}
                        </span>
                      </div>
                      {massTortComplete && (
                        <p className="eia-billing-copy" data-testid="mass-tort-complete-note">
                          This profile is complete and available to guide allocation and coverage
                          administration. Completing it did not change coverage, limits, or the
                          policy version.
                        </p>
                      )}
                      <dl className="eia-kv" style={{ marginTop: 10 }}>
                        <dt>Tort type</dt>
                        <dd data-testid="mass-tort-value-tort">
                          {tortTypeLabel(massTortProfile.tortType)}
                        </dd>
                        <dt>Trigger</dt>
                        <dd data-testid="mass-tort-value-trigger">
                          {triggerLabel(massTortProfile.trigger)}
                        </dd>
                        <dt>Allocation method</dt>
                        <dd data-testid="mass-tort-value-allocation">
                          {allocationMethodLabel(massTortProfile.allocationMethod)}
                        </dd>
                        <dt>Coverage block</dt>
                        <dd data-testid="mass-tort-value-block">
                          {coverageBlockLabel(massTortProfile)}
                        </dd>
                        <dt>Allocation notes</dt>
                        <dd
                          data-testid="mass-tort-value-notes"
                          style={{ whiteSpace: 'pre-wrap' }}
                        >
                          {massTortProfile.allocationNotes || '—'}
                        </dd>
                      </dl>
                    </section>
                  )}

                  {massTort.loading && massTort.profile && (
                    <p className="eia-muted" role="status">Refreshing mass tort profile…</p>
                  )}

                  {massTort.error && massTort.profile && (
                    <section
                      className="eia-card"
                      aria-label="Mass tort profile refresh failed"
                      style={{ marginTop: 12 }}
                    >
                      <p role="alert" style={{ marginTop: 0 }}>{massTort.error}</p>
                      <button
                        type="button"
                        className="eia-btn-secondary"
                        onClick={() => loadMassTort()}
                      >
                        Retry
                      </button>
                    </section>
                  )}

                  {(massTort.profile || massTortSetup) && (
                    <section
                      className="eia-card"
                      aria-label="Mass tort profile form"
                      data-testid="mass-tort-form"
                      style={{ marginTop: 16 }}
                    >
                      <div className="eia-section-title" style={{ marginTop: 0 }}>
                        <h2>
                          {massTortComplete
                            ? 'Edit mass tort profile'
                            : massTort.profile
                              ? 'Update mass tort profile'
                              : 'Set up mass tort profile'}
                        </h2>
                        <span className="eia-muted">Saved independently of coverage and limits</span>
                      </div>
                      <p className="eia-billing-copy">
                        The profile guides how Direct Claims allocates long-tail claims. It does not
                        change the policy&apos;s coverage or limits. A draft may omit the allocation
                        notes and coverage block; mark the profile complete once the tort, trigger,
                        allocation method, notes, and coverage block are final.
                      </p>
                      <form
                        className="eia-form-grid"
                        onSubmit={(event) => {
                          event.preventDefault();
                          submitMassTort(MASS_TORT_STATUS.DRAFT);
                        }}
                      >
                        <div className="eia-field">
                          <label htmlFor="mass-tort-type">Tort type</label>
                          <select
                            id="mass-tort-type"
                            value={massTortForm.tortType}
                            onChange={(e) => updateMassTort('tortType', e.target.value)}
                          >
                            <option value="">Select a tort type</option>
                            {TORT_TYPES.map((entry) => (
                              <option key={entry.value} value={entry.value}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="eia-field">
                          <label htmlFor="mass-tort-trigger">Trigger</label>
                          <select
                            id="mass-tort-trigger"
                            value={massTortForm.trigger}
                            onChange={(e) => updateMassTort('trigger', e.target.value)}
                          >
                            <option value="">Select a trigger</option>
                            {TRIGGER_THEORIES.map((entry) => (
                              <option key={entry.value} value={entry.value}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                          <span className="eia-field-hint">
                            The theory that determines which policy years respond.
                          </span>
                        </div>
                        <div className="eia-field">
                          <label htmlFor="mass-tort-allocation-method">Allocation method</label>
                          <select
                            id="mass-tort-allocation-method"
                            value={massTortForm.allocationMethod}
                            onChange={(e) => updateMassTort('allocationMethod', e.target.value)}
                          >
                            <option value="">Select an allocation method</option>
                            {ALLOCATION_METHODS.map((entry) => (
                              <option key={entry.value} value={entry.value}>
                                {entry.label}
                              </option>
                            ))}
                          </select>
                          <span
                            className="eia-field-hint"
                            data-testid="mass-tort-allocation-help"
                          >
                            {allocationMethodDescription(massTortForm.allocationMethod)
                              || 'Choose the method Direct Claims should apply to the allocation.'}
                          </span>
                        </div>
                        <div className="eia-field span-3">
                          <label htmlFor="mass-tort-allocation-notes">Allocation notes</label>
                          <textarea
                            id="mass-tort-allocation-notes"
                            rows={3}
                            maxLength={MAX_ALLOCATION_NOTES_LENGTH}
                            placeholder="Agreed basis, matrix, or exceptions used to allocate claims…"
                            value={massTortForm.allocationNotes}
                            onChange={(e) => updateMassTort('allocationNotes', e.target.value)}
                          />
                        </div>
                        <div className="eia-field">
                          <label htmlFor="mass-tort-block-start">Coverage block start</label>
                          <input
                            id="mass-tort-block-start"
                            type="date"
                            value={massTortForm.coverageBlockStart}
                            onChange={(e) => updateMassTort('coverageBlockStart', e.target.value)}
                          />
                        </div>
                        <div className="eia-field">
                          <label htmlFor="mass-tort-block-end">Coverage block end</label>
                          <input
                            id="mass-tort-block-end"
                            type="date"
                            min={massTortForm.coverageBlockStart || undefined}
                            value={massTortForm.coverageBlockEnd}
                            onChange={(e) => updateMassTort('coverageBlockEnd', e.target.value)}
                          />
                        </div>
                        <div className="eia-actions span-3" style={{ justifyContent: 'flex-start' }}>
                          <button type="submit" disabled={Boolean(massTortSaving)}>
                            {massTortSaving === MASS_TORT_STATUS.DRAFT ? 'Saving draft…' : 'Save draft'}
                          </button>
                          <button
                            type="button"
                            className="eia-btn-secondary"
                            data-testid="mass-tort-complete"
                            disabled={Boolean(massTortSaving)}
                            onClick={() => submitMassTort(MASS_TORT_STATUS.COMPLETE)}
                          >
                            {massTortSaving === MASS_TORT_STATUS.COMPLETE
                              ? 'Marking complete…'
                              : 'Mark complete'}
                          </button>
                        </div>
                      </form>

                      {massTortFormError && (
                        <p
                          role="alert"
                          data-testid="mass-tort-form-error"
                          style={{ margin: '10px 0 0' }}
                        >
                          {massTortFormError}
                        </p>
                      )}
                      {massTortNotice && (
                        <p
                          role="status"
                          data-testid="mass-tort-notice"
                          style={{ margin: '10px 0 0' }}
                        >
                          {massTortNotice}
                        </p>
                      )}
                    </section>
                  )}

                  <MassTortContextPanel />
                </section>
              )}

              {tab === 'endorsements' && (
                <section
                  id="panel-endorsements"
                  role="tabpanel"
                  aria-labelledby="tab-endorsements"
                >
                  <div className="eia-section-title">
                    <h2>Endorsements</h2>
                    <span className="eia-muted">
                      {endorsements.length} endorsement{endorsements.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Number</th>
                          <th>Type</th>
                          <th>Effective</th>
                          <th>Impact</th>
                          <th>Premium delta</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {endorsements.map((endorsement) => (
                          <tr key={endorsement.id}>
                            <td>{endorsement.endorsementNumber}</td>
                            <td>{endorsement.endorsementType}</td>
                            <td>{endorsement.effectiveDate}</td>
                            <td>{endorsement.coverageImpact}</td>
                            <td>
                              {endorsement.premiumDeltaAmount
                                ? formatMoney(endorsement.premiumDeltaAmount, endorsement.premiumDeltaCurrency)
                                : '—'}
                            </td>
                            <td>{endorsement.status}</td>
                          </tr>
                        ))}
                        {endorsements.length === 0 && (
                          <tr><td className="eia-muted" colSpan={6}>No endorsements yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <section className="eia-card" aria-label="Add endorsement" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Add endorsement</h2>
                      <span className="eia-muted">Issues a new immutable version</span>
                    </div>
                    <form className="eia-form-grid" onSubmit={submitEndorsement}>
                      <div className="eia-field">
                        <label htmlFor="endorsement-type">Type</label>
                        <select
                          id="endorsement-type"
                          value={endorsementForm.endorsementType}
                          onChange={(e) => updateEndorsement('endorsementType', e.target.value)}
                        >
                          {['COVERAGE', 'LIMIT', 'PARTY', 'PREMIUM', 'RETENTION', 'EXCLUSION',
                            'TERRITORY', 'CORRECTION', 'MANUSCRIPT'].map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-effective-date">Effective date</label>
                        <input
                          id="endorsement-effective-date"
                          type="date"
                          value={endorsementForm.effectiveDate}
                          onChange={(e) => updateEndorsement('effectiveDate', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-description">Description</label>
                        <input
                          id="endorsement-description"
                          value={endorsementForm.description}
                          onChange={(e) => updateEndorsement('description', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-premium-delta">Premium delta</label>
                        <input
                          id="endorsement-premium-delta"
                          type="number"
                          step="0.01"
                          value={endorsementForm.premiumDeltaAmount}
                          onChange={(e) => updateEndorsement('premiumDeltaAmount', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-delta-currency">Delta currency</label>
                        <input
                          id="endorsement-delta-currency"
                          maxLength={3}
                          value={endorsementForm.premiumDeltaCurrency}
                          onChange={(e) => updateEndorsement('premiumDeltaCurrency', e.target.value.toUpperCase())}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-coverage-impact">Coverage impact</label>
                        <select
                          id="endorsement-coverage-impact"
                          value={endorsementForm.coverageImpact}
                          onChange={(e) => updateEndorsement('coverageImpact', e.target.value)}
                        >
                          {['NONE', 'BROADEN', 'RESTRICT', 'CLARIFY'].map((impact) => (
                            <option key={impact} value={impact}>{impact}</option>
                          ))}
                        </select>
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-backdate-reason">Backdate reason (required before inception)</label>
                        <input
                          id="endorsement-backdate-reason"
                          value={endorsementForm.backdateReason}
                          onChange={(e) => updateEndorsement('backdateReason', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-approved-by">Approver ID</label>
                        <input
                          id="endorsement-approved-by"
                          placeholder="Approver UUID"
                          value={endorsementForm.approvedBy}
                          onChange={(e) => updateEndorsement('approvedBy', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="endorsement-approval-ref">Approval reference</label>
                        <input
                          id="endorsement-approval-ref"
                          placeholder="Approval UUID"
                          value={endorsementForm.approvalRef}
                          onChange={(e) => updateEndorsement('approvalRef', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <button type="submit">Add endorsement</button>
                      </div>
                    </form>
                  </section>
                </section>
              )}

              {tab === 'parties' && (
                <section
                  id="panel-parties"
                  role="tabpanel"
                  aria-labelledby="tab-parties"
                >
                  <div className="eia-section-title">
                    <h2>Insureds</h2>
                    <span className="eia-muted">
                      {insureds.length} insured{insureds.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Party</th>
                          <th>Role</th>
                          <th>Name</th>
                          <th>Effective from</th>
                          <th>Effective to</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {insureds.map((insured) => (
                          <tr key={insured.id}>
                            <td><code className="eia-mono">{shortId(insured.partyId)}</code></td>
                            <td>{insured.insuredRole}</td>
                            <td>{insured.displayName}</td>
                            <td>{insured.effectiveFrom}</td>
                            <td>{insured.effectiveTo}</td>
                            <td>{insured.status}</td>
                          </tr>
                        ))}
                        {insureds.length === 0 && (
                          <tr><td className="eia-muted" colSpan={6}>No insureds yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <section className="eia-card" aria-label="Add insured" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Add insured</h2>
                      <span className="eia-muted">Party owns the identity; the policy references it</span>
                    </div>
                    <form className="eia-form-grid" onSubmit={submitInsured}>
                      <div className="eia-field">
                        <label htmlFor="insured-party-id">Party ID</label>
                        <input
                          id="insured-party-id"
                          placeholder="Party UUID"
                          value={insuredForm.partyId}
                          onChange={(e) => updateInsured('partyId', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="insured-role">Role</label>
                        <select
                          id="insured-role"
                          value={insuredForm.insuredRole}
                          onChange={(e) => updateInsured('insuredRole', e.target.value)}
                        >
                          {['NAMED_INSURED', 'ADDITIONAL_INSURED', 'INSURED_ORGANIZATION', 'LOSS_PAYEE',
                            'MORTGAGEE', 'LENDER', 'CERTIFICATE_HOLDER'].map((role) => (
                            <option key={role} value={role}>{role}</option>
                          ))}
                        </select>
                      </div>
                      <div className="eia-field">
                        <label htmlFor="insured-display-name">Display name</label>
                        <input
                          id="insured-display-name"
                          value={insuredForm.displayName}
                          onChange={(e) => updateInsured('displayName', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="insured-certificate-number">Certificate number</label>
                        <input
                          id="insured-certificate-number"
                          value={insuredForm.certificateNumber}
                          onChange={(e) => updateInsured('certificateNumber', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="insured-effective-from">Effective from</label>
                        <input
                          id="insured-effective-from"
                          type="date"
                          value={insuredForm.effectiveFrom}
                          onChange={(e) => updateInsured('effectiveFrom', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="insured-effective-to">Effective to</label>
                        <input
                          id="insured-effective-to"
                          type="date"
                          value={insuredForm.effectiveTo}
                          onChange={(e) => updateInsured('effectiveTo', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <button type="submit">Add insured</button>
                      </div>
                    </form>
                  </section>

                  <div className="eia-section-title">
                    <h2>Locations</h2>
                    <span className="eia-muted">
                      {locations.length} location{locations.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Code</th>
                          <th>Address</th>
                          <th>City</th>
                          <th>State</th>
                          <th>Country</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {locations.map((location) => (
                          <tr key={location.id}>
                            <td>{location.locationCode}</td>
                            <td>{location.addressLine1}</td>
                            <td>{location.city}</td>
                            <td>{location.stateRegion}</td>
                            <td>{location.country}</td>
                            <td>{location.status}</td>
                          </tr>
                        ))}
                        {locations.length === 0 && (
                          <tr><td className="eia-muted" colSpan={6}>No locations yet.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <section className="eia-card" aria-label="Add location" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Add location</h2>
                    </div>
                    <form className="eia-form-grid" onSubmit={submitLocation}>
                      <div className="eia-field">
                        <label htmlFor="location-code">Location code</label>
                        <input
                          id="location-code"
                          value={locationForm.locationCode}
                          onChange={(e) => updateLocation('locationCode', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field span-2">
                        <label htmlFor="location-address-line-1">Address line 1</label>
                        <input
                          id="location-address-line-1"
                          value={locationForm.addressLine1}
                          onChange={(e) => updateLocation('addressLine1', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="location-city">City</label>
                        <input
                          id="location-city"
                          value={locationForm.city}
                          onChange={(e) => updateLocation('city', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="location-state-region">State / region</label>
                        <input
                          id="location-state-region"
                          placeholder="US-OH"
                          value={locationForm.stateRegion}
                          onChange={(e) => updateLocation('stateRegion', e.target.value.toUpperCase())}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="location-postal-code">Postal code</label>
                        <input
                          id="location-postal-code"
                          value={locationForm.postalCode}
                          onChange={(e) => updateLocation('postalCode', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="location-country">Country</label>
                        <input
                          id="location-country"
                          maxLength={3}
                          value={locationForm.country}
                          onChange={(e) => updateLocation('country', e.target.value.toUpperCase())}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="location-effective-from">Effective from</label>
                        <input
                          id="location-effective-from"
                          type="date"
                          value={locationForm.effectiveFrom}
                          onChange={(e) => updateLocation('effectiveFrom', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="location-effective-to">Effective to</label>
                        <input
                          id="location-effective-to"
                          type="date"
                          value={locationForm.effectiveTo}
                          onChange={(e) => updateLocation('effectiveTo', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <button type="submit">Add location</button>
                      </div>
                    </form>
                  </section>
                </section>
              )}

              {tab === 'billing' && (
                <section
                  id="panel-billing"
                  role="tabpanel"
                  aria-labelledby="tab-billing"
                >
                  <div className="eia-section-title">
                    <h2>Billing</h2>
                    <span className="eia-muted">
                      Premium collection · Payment owns disbursement and approval
                    </span>
                  </div>

                  {billing.loading && !billing.plan ? (
                    <p className="eia-muted">Loading billing plan…</p>
                  ) : billing.error ? (
                    <section className="eia-card" aria-label="Billing unavailable">
                      <p role="alert" style={{ marginTop: 0 }}>{billing.error}</p>
                      <button
                        type="button"
                        className="eia-btn-secondary"
                        onClick={() => loadBilling()}
                      >
                        Retry
                      </button>
                    </section>
                  ) : !billing.plan ? (
                    <>
                      <section
                        className="eia-card"
                        aria-label="No billing plan"
                        data-testid="billing-empty"
                      >
                        <h3>No billing plan yet</h3>
                        <p className="eia-billing-copy">
                          This policy&apos;s premium is not scheduled for collection. Billing is
                          premium collection: create an installment plan to collect the selected
                          policy premium over time. No money moves from Policy; Payment owns
                          disbursement and approval.
                        </p>
                        <dl className="eia-kv" style={{ marginTop: 10 }}>
                          <dt>Policy premium</dt>
                          <dd>
                            {formatMoney(
                              selectedPolicy.premiumAmount,
                              selectedPolicy.premiumCurrency
                            )}
                          </dd>
                          <dt>Premium currency</dt>
                          <dd>{selectedPolicy.premiumCurrency || '—'}</dd>
                          <dt>Collection status</dt>
                          <dd>Not scheduled</dd>
                        </dl>
                      </section>

                      <section
                        className="eia-card"
                        aria-label="Create billing plan"
                        style={{ marginTop: 16 }}
                      >
                        <div className="eia-section-title" style={{ marginTop: 0 }}>
                          <h2>Create billing plan</h2>
                          <span className="eia-muted">
                            Installments 1–24 · premium is derived from the policy
                          </span>
                        </div>
                        <p className="eia-billing-copy">
                          Splits the selected policy&apos;s premium into a collection schedule.
                          Creating a plan does not change coverage, limits, or the policy version.
                        </p>
                        <form className="eia-form-grid" onSubmit={submitBillingPlan}>
                          <div className="eia-field">
                            <label htmlFor="billing-installment-count">Installment count</label>
                            <input
                              id="billing-installment-count"
                              type="number"
                              min="1"
                              max="24"
                              step="1"
                              value={billingForm.installmentCount}
                              onChange={(e) => updateBilling('installmentCount', e.target.value)}
                              required
                            />
                          </div>
                          <div className="eia-field">
                            <label htmlFor="billing-frequency">Frequency</label>
                            <select
                              id="billing-frequency"
                              value={billingForm.frequency}
                              onChange={(e) => updateBilling('frequency', e.target.value)}
                            >
                              {BILLING_FREQUENCIES.map((entry) => (
                                <option key={entry.value} value={entry.value}>
                                  {entry.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="eia-field">
                            <label htmlFor="billing-first-due-date">First due date</label>
                            <input
                              id="billing-first-due-date"
                              type="date"
                              value={billingForm.firstDueDate}
                              onChange={(e) => updateBilling('firstDueDate', e.target.value)}
                              required
                            />
                          </div>
                          <div className="eia-field">
                            <button type="submit" disabled={billingBusy}>
                              {billingBusy ? 'Creating plan…' : 'Create billing plan'}
                            </button>
                          </div>
                        </form>
                      </section>

                      <BillingContextPanel />
                    </>
                  ) : (
                    <>
                      <div className="eia-section-title" style={{ marginTop: 0 }}>
                        <h2>Billing plan</h2>
                        <span className="eia-muted" data-testid="billing-plan-meta">
                          {billing.plan.planNumber ? `${billing.plan.planNumber} · ` : ''}
                          {billing.plan.installmentCount ?? billing.installments.length} installment
                          {(billing.plan.installmentCount ?? billing.installments.length) === 1
                            ? ''
                            : 's'}
                          {' · '}
                          {billingFrequencyLabel(billing.plan.frequency)}
                          {billing.plan.firstDueDate
                            ? ` · first due ${billing.plan.firstDueDate}`
                            : ''}
                        </span>
                      </div>

                      <p className="eia-billing-policy-context" data-testid="billing-policy-context">
                        Policy premium{' '}
                        <b>{formatMoney(selectedPolicy.premiumAmount, selectedPolicy.premiumCurrency)}</b>
                        {' · '}Billing currency <b>{billing.summary?.currency || '—'}</b>
                        {billing.plan.status ? (
                          <>
                            {' · '}Plan status{' '}
                            <span
                              className={`eia-pill ${billing.plan.status === 'ACTIVE' ? 'green' : 'blue'}`}
                            >
                              {billing.plan.status}
                            </span>
                          </>
                        ) : null}
                      </p>

                      <div className="eia-summary-grid" aria-label="Billing summary">
                        <div className="eia-card">
                          <h3>Total premium</h3>
                          <div className="value" data-testid="billing-summary-total">
                            {formatMoney(
                              billing.summary?.totalPremiumAmount,
                              billing.summary?.currency
                            )}
                          </div>
                          <div className="eia-metric-label">scheduled premium</div>
                        </div>
                        <div className="eia-card">
                          <h3>Paid</h3>
                          <div className="value" data-testid="billing-summary-paid">
                            {formatMoney(billing.summary?.paidAmount, billing.summary?.currency)}
                          </div>
                          <div className="eia-metric-label">collected premium</div>
                        </div>
                        <div className="eia-card">
                          <h3>Outstanding</h3>
                          <div className="value" data-testid="billing-summary-outstanding">
                            {formatMoney(
                              billing.summary?.outstandingAmount,
                              billing.summary?.currency
                            )}
                          </div>
                          <div className="eia-metric-label">still to collect</div>
                        </div>
                        <div className="eia-card eia-billing-overdue-card">
                          <h3>Overdue</h3>
                          <div className="value" data-testid="billing-summary-overdue">
                            {formatMoney(
                              billing.summary?.overdueAmount,
                              billing.summary?.currency
                            )}
                          </div>
                          <div className="eia-metric-label">
                            {billing.summary?.overdueCount || 0} past due installment
                            {(billing.summary?.overdueCount || 0) === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      <div className="eia-section-title">
                        <h2>Installments</h2>
                        <span className="eia-muted">
                          {billing.installments.length} installment
                          {billing.installments.length === 1 ? '' : 's'}
                        </span>
                      </div>
                      <div className="eia-table-wrap">
                        <table className="eia-table eia-billing-table" aria-label="Billing installments">
                          <thead>
                            <tr>
                              <th>Number</th>
                              <th>Due date</th>
                              <th>Amount</th>
                              <th>Status</th>
                              <th>Paid date / payment ID</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {billing.installments.map((installment) => {
                              const overdue = isOverdue(installment.status);
                              const linkedPaymentNumber = installment.paymentNumber
                                || linkedPayments[installment.id]?.number
                                || '';
                              return (
                                <tr
                                  key={installment.id}
                                  className={overdue ? 'eia-billing-overdue-row' : undefined}
                                  data-overdue={overdue ? 'true' : undefined}
                                  data-testid={`installment-row-${installment.id}`}
                                >
                                  <td>{installment.installmentNumber}</td>
                                  <td>{installment.dueDate || '—'}</td>
                                  <td>
                                    {formatMoney(
                                      installment.amount,
                                      installment.currency || billing.summary?.currency
                                    )}
                                  </td>
                                  <td>
                                    <span
                                      className={`eia-pill ${billingStatusTone(installment.status)}`}
                                    >
                                      {installment.status}
                                    </span>
                                    {overdue && (
                                      <span className="eia-billing-overdue-flag">Past due</span>
                                    )}
                                  </td>
                                  <td>
                                    {installment.paidDate || installment.paymentId || linkedPaymentNumber ? (
                                      <>
                                        {installment.paidDate || '—'}
                                        {installment.paymentId ? (
                                          <>
                                            {' · '}
                                            <code
                                              className="eia-mono"
                                              data-testid={`payment-id-${installment.id}`}
                                            >
                                              {installment.paymentId}
                                            </code>
                                          </>
                                        ) : null}
                                        {linkedPaymentNumber ? (
                                          <>
                                            {' · '}
                                            <span
                                              className="eia-mono"
                                              data-testid={`payment-number-${installment.id}`}
                                            >
                                              {linkedPaymentNumber}
                                            </span>
                                          </>
                                        ) : null}
                                      </>
                                    ) : '—'}
                                  </td>
                                  <td>
                                    {canManageInstallment(installment.status) ? (
                                      <span className="eia-billing-actions">
                                        <button
                                          type="button"
                                          className="eia-btn-secondary"
                                          data-testid={`link-payment-${installment.id}`}
                                          disabled={billingInstallmentId === installment.id}
                                          onClick={() => openPaymentLink(installment)}
                                        >
                                          Link payment
                                        </button>
                                        <button
                                          type="button"
                                          className="eia-btn-secondary"
                                          data-testid={`mark-paid-${installment.id}`}
                                          disabled={billingInstallmentId === installment.id}
                                          onClick={() => updateInstallment(installment, 'PAID')}
                                        >
                                          Mark paid
                                        </button>
                                        <button
                                          type="button"
                                          className="eia-btn-secondary"
                                          data-testid={`waive-${installment.id}`}
                                          disabled={billingInstallmentId === installment.id}
                                          onClick={() => updateInstallment(installment, 'WAIVED')}
                                        >
                                          Waive
                                        </button>
                                        {canCreatePayment(installment.status) && (
                                          <CrossLink
                                            className="eia-btn-secondary eia-billing-payment-link"
                                            href={billingPaymentHref(selectedPolicy, installment)}
                                            data-testid={`create-payment-${installment.id}`}
                                            title={`Create a Payment for installment ${installment.installmentNumber}`}
                                          >
                                            Create payment
                                          </CrossLink>
                                        )}
                                      </span>
                                    ) : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                            {billing.installments.length === 0 && (
                              <tr>
                                <td className="eia-muted" colSpan={6}>
                                  No installments on this plan.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>

                      <BillingContextPanel />
                    </>
                  )}

                  <CreditNotesSection
                    policy={selectedPolicy}
                    state={creditNotes}
                    busyId={creditNoteBusyId}
                    cancelId={creditNoteCancelId}
                    actionError={creditNoteActionError}
                    onRetry={() => loadCreditNotes()}
                    onNew={openCreditNoteForm}
                    onIssue={(creditNote) => updateCreditNoteStatus(creditNote, 'ISSUED')}
                    onApply={(creditNote) => updateCreditNoteStatus(creditNote, 'APPLIED')}
                    onRequestCancel={requestCancelCreditNote}
                    onConfirmCancel={(creditNote) => (
                      updateCreditNoteStatus(creditNote, 'CANCELLED')
                    )}
                    onKeep={keepCreditNote}
                  />
                </section>
              )}

              {tab === 'cancellation' && (
                <section
                  id="panel-cancellation"
                  role="tabpanel"
                  aria-labelledby="tab-cancellation"
                >
                  <div className="eia-section-title">
                    <h2>Cancellations</h2>
                    <span className="eia-muted">
                      {cancellations.length} cancellation{cancellations.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Type</th>
                          <th>Reason</th>
                          <th>Effective</th>
                          <th>Return premium</th>
                          <th>Pro-rata</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cancellations.map((cancellation) => (
                          <tr key={cancellation.id}>
                            <td>{cancellation.cancellationType}</td>
                            <td>{cancellation.reason}</td>
                            <td>{cancellation.effectiveDate}</td>
                            <td>{formatMoney(cancellation.returnPremiumAmount, cancellation.premiumCurrency)}</td>
                            <td>{formatPercent(cancellation.proRataPct)}</td>
                            <td>{cancellation.status}</td>
                          </tr>
                        ))}
                        {cancellations.length === 0 && (
                          <tr><td className="eia-muted" colSpan={6}>No cancellations.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <section className="eia-card" aria-label="Cancel policy" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Cancel policy</h2>
                      <span className="eia-muted">Posts the cancellation with the current ETag</span>
                    </div>
                    <form className="eia-form-grid" onSubmit={submitCancel}>
                      <div className="eia-field">
                        <label htmlFor="cancel-type">Cancellation type</label>
                        <select
                          id="cancel-type"
                          value={cancelForm.cancellationType}
                          onChange={(e) => updateCancel('cancellationType', e.target.value)}
                        >
                          {['PRO_RATA', 'FLAT', 'SHORT_RATE', 'NON_PAYMENT', 'VOID'].map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </div>
                      <div className="eia-field span-2">
                        <label htmlFor="cancel-reason">Reason</label>
                        <input
                          id="cancel-reason"
                          value={cancelForm.reason}
                          onChange={(e) => updateCancel('reason', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="cancel-effective-date">Effective date</label>
                        <input
                          id="cancel-effective-date"
                          type="date"
                          value={cancelForm.effectiveDate}
                          onChange={(e) => updateCancel('effectiveDate', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="cancel-notice-days">Notice days</label>
                        <input
                          id="cancel-notice-days"
                          type="number"
                          min="0"
                          value={cancelForm.noticeDays}
                          onChange={(e) => updateCancel('noticeDays', e.target.value)}
                        />
                      </div>
                      <div className="eia-field">
                        <button type="submit">Cancel policy</button>
                      </div>
                    </form>
                  </section>

                  <div className="eia-section-title">
                    <h2>Reinstatements</h2>
                    <span className="eia-muted">
                      {reinstatements.length} reinstatement{reinstatements.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="eia-table-wrap">
                    <table className="eia-table">
                      <thead>
                        <tr>
                          <th>Effective</th>
                          <th>Reason</th>
                          <th>Premium evidence</th>
                          <th>Amount</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {reinstatements.map((reinstatement) => (
                          <tr key={reinstatement.id}>
                            <td>{reinstatement.effectiveDate}</td>
                            <td>{reinstatement.reason}</td>
                            <td>{reinstatement.premiumEvidenceRef}</td>
                            <td>{formatMoney(reinstatement.premiumEvidenceAmount, reinstatement.premiumEvidenceCurrency)}</td>
                            <td>{reinstatement.status}</td>
                          </tr>
                        ))}
                        {reinstatements.length === 0 && (
                          <tr><td className="eia-muted" colSpan={5}>No reinstatements.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>

                  <section className="eia-card" aria-label="Reinstate policy" style={{ marginTop: 16 }}>
                    <div className="eia-section-title" style={{ marginTop: 0 }}>
                      <h2>Reinstate policy</h2>
                      <span className="eia-muted">Requires approval and premium evidence</span>
                    </div>
                    <form className="eia-form-grid" onSubmit={submitReinstate}>
                      <div className="eia-field">
                        <label htmlFor="reinstate-effective-date">Effective date</label>
                        <input
                          id="reinstate-effective-date"
                          type="date"
                          value={reinstateForm.effectiveDate}
                          onChange={(e) => updateReinstate('effectiveDate', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field span-2">
                        <label htmlFor="reinstate-reason">Reason</label>
                        <input
                          id="reinstate-reason"
                          value={reinstateForm.reason}
                          onChange={(e) => updateReinstate('reason', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="reinstate-approved-by">Approver ID</label>
                        <input
                          id="reinstate-approved-by"
                          placeholder="Approver UUID"
                          value={reinstateForm.approvedBy}
                          onChange={(e) => updateReinstate('approvedBy', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="reinstate-approval-ref">Approval reference</label>
                        <input
                          id="reinstate-approval-ref"
                          placeholder="Approval UUID"
                          value={reinstateForm.approvalRef}
                          onChange={(e) => updateReinstate('approvalRef', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="reinstate-premium-evidence-ref">Premium evidence reference</label>
                        <input
                          id="reinstate-premium-evidence-ref"
                          value={reinstateForm.premiumEvidenceRef}
                          onChange={(e) => updateReinstate('premiumEvidenceRef', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="reinstate-evidence-amount">Evidence amount</label>
                        <input
                          id="reinstate-evidence-amount"
                          type="number"
                          min="0"
                          step="0.01"
                          value={reinstateForm.premiumEvidenceAmount}
                          onChange={(e) => updateReinstate('premiumEvidenceAmount', e.target.value)}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <label htmlFor="reinstate-evidence-currency">Evidence currency</label>
                        <input
                          id="reinstate-evidence-currency"
                          maxLength={3}
                          value={reinstateForm.premiumEvidenceCurrency}
                          onChange={(e) => updateReinstate('premiumEvidenceCurrency', e.target.value.toUpperCase())}
                          required
                        />
                      </div>
                      <div className="eia-field">
                        <button type="submit">Reinstate policy</button>
                      </div>
                    </form>
                  </section>
                </section>
              )}

              {tab === 'activity' && (
                <section
                  id="panel-activity"
                  role="tabpanel"
                  aria-labelledby="tab-activity"
                >
                  <div className="eia-section-title">
                    <h2>Activity</h2>
                    <span className="eia-muted">Newest first · derived from policy events</span>
                  </div>
                  <ActivityTimeline
                    items={activity.items}
                    loading={activity.loading}
                    error={activity.error}
                    onRefresh={() => loadActivity(selectedPolicy.id)}
                  />
                </section>
              )}
            </>
          )}
        </section>
      </div>

      {renewOpen && selectedPolicy && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="renew-dialog-title"
            aria-describedby="renew-dialog-description"
            data-testid="renew-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="renew-dialog-title">Renew {selectedPolicy.policyNumber}</h2>
              <span className="eia-badge">{selectedPolicy.status}</span>
            </div>
            <p className="eia-modal-lede" id="renew-dialog-description">
              Create the next term as a new policy record. The expiring policy remains intact.
            </p>
            <p className="eia-muted eia-modal-currency-context">
              Current term {selectedPolicy.effectiveDate || '—'} – {selectedPolicy.expirationDate || '—'}
              {' · '}
              {formatMoney(selectedPolicy.premiumAmount, selectedPolicy.premiumCurrency)} premium
            </p>

            {renewError && (
              <p role="alert" data-testid="renewal-error" className="eia-modal-error">
                {renewError}
              </p>
            )}

            <form className="eia-form-grid" onSubmit={submitRenewal}>
              <div className="eia-field">
                <label htmlFor="renew-effective-date">Effective date</label>
                <input
                  id="renew-effective-date"
                  type="date"
                  value={renewForm.effectiveDate}
                  onChange={(e) => updateRenewal('effectiveDate', e.target.value)}
                  autoFocus
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="renew-expiration-date">Expiration date</label>
                <input
                  id="renew-expiration-date"
                  type="date"
                  min={renewForm.effectiveDate || undefined}
                  value={renewForm.expirationDate}
                  onChange={(e) => updateRenewal('expirationDate', e.target.value)}
                  required
                />
                <span className="eia-field-hint">Defaults to one year after the renewal effective date.</span>
              </div>
              <div className="eia-field">
                <label htmlFor="renew-premium">Premium</label>
                <input
                  id="renew-premium"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={renewForm.premiumAmount}
                  onChange={(e) => updateRenewal('premiumAmount', e.target.value)}
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="renew-premium-currency">Premium currency</label>
                <input
                  id="renew-premium-currency"
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  placeholder="USD"
                  value={renewForm.premiumCurrency}
                  onChange={(e) => updateRenewal('premiumCurrency', e.target.value.toUpperCase())}
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="renew-limit">Limit</label>
                <input
                  id="renew-limit"
                  type="number"
                  min="0"
                  step="0.0001"
                  value={renewForm.limitAmount}
                  onChange={(e) => updateRenewal('limitAmount', e.target.value)}
                  required
                />
              </div>
              <div className="eia-field">
                <label htmlFor="renew-limit-currency">Limit currency</label>
                <input
                  id="renew-limit-currency"
                  maxLength={3}
                  pattern="[A-Za-z]{3}"
                  placeholder="USD"
                  value={renewForm.limitCurrency}
                  onChange={(e) => updateRenewal('limitCurrency', e.target.value.toUpperCase())}
                  required
                />
              </div>
              <p className="eia-field span-3 eia-renewal-carry-note" data-testid="renewal-carry-forward">
                <b>Coverages and limits are carried forward.</b> The new record keeps the current
                coverage grants and limits; review the premium and limits for the new term before
                creating the renewal.
              </p>
              <div className="eia-field span-3 eia-modal-actions">
                <button type="submit" disabled={renewBusy}>
                  {renewBusy ? 'Renewing…' : 'Create renewal'}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeRenewal}
                  disabled={renewBusy}
                >
                  Cancel
                </button>
              </div>
            </form>

            <section
              className="eia-context-panel"
              aria-label="Renewal context"
              data-testid="renewal-context"
            >
              <h4>Renewal creates a new policy record</h4>
              <p>
                The new policy is selected when the domain accepts the renewal and the queue is
                refreshed. The prior policy remains intact: its coverage, premium, versions,
                cancellation history, and activity are unchanged.
              </p>
              <p>
                The successor records <span className="eia-mono">{selectedPolicy.policyNumber}</span>
                {' '}as its renewal source. This policy does not link forward to a successor.
              </p>
            </section>
          </div>
        </div>
      )}
      {programCreateOpen && selectedPolicy && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="program-dialog-title"
            aria-describedby="program-dialog-description"
            data-testid="program-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="program-dialog-title">Create program</h2>
              <span className="eia-badge">{selectedPolicy.policyNumber}</span>
            </div>
            <p className="eia-modal-lede" id="program-dialog-description">
              The new program is added to the program catalog and attached to this policy when
              it is created.
              {currentProgram ? ' The current program assignment is replaced.' : ''}
            </p>
            <p className="eia-muted eia-modal-currency-context">
              Policy term {selectedPolicy.effectiveDate || '—'} –{' '}
              {selectedPolicy.expirationDate || '—'} · default program dates
            </p>

            {programFormError && (
              <p role="alert" className="eia-modal-error" data-testid="program-form-error">
                {programFormError}
              </p>
            )}

            <form className="eia-form-grid" onSubmit={submitProgramCreate}>
              <div className="eia-field span-2">
                <label htmlFor="program-name">Program name</label>
                <input
                  id="program-name"
                  value={programForm.name}
                  maxLength={MAX_PROGRAM_NAME_LENGTH}
                  onChange={(e) => updateProgramForm('name', e.target.value)}
                  autoFocus
                />
              </div>
              <div className="eia-field">
                <label htmlFor="program-type">Program type</label>
                <select
                  id="program-type"
                  value={programForm.programType}
                  onChange={(e) => updateProgramForm('programType', e.target.value)}
                >
                  <option value="">Select a program type</option>
                  {PROGRAM_TYPES.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </div>
              <div className="eia-field">
                <label htmlFor="program-effective-from">Effective from</label>
                <input
                  id="program-effective-from"
                  type="date"
                  value={programForm.effectiveFrom}
                  onChange={(e) => updateProgramForm('effectiveFrom', e.target.value)}
                />
              </div>
              <div className="eia-field">
                <label htmlFor="program-effective-to">Effective to</label>
                <input
                  id="program-effective-to"
                  type="date"
                  min={programForm.effectiveFrom || undefined}
                  value={programForm.effectiveTo}
                  onChange={(e) => updateProgramForm('effectiveTo', e.target.value)}
                />
                <span className="eia-field-hint">
                  Optional. End dates may be left open for a program that continues.
                </span>
              </div>
              <div className="eia-field span-3">
                <label className="eia-program-lead-toggle" htmlFor="program-lead-policy">
                  <input
                    id="program-lead-policy"
                    type="checkbox"
                    checked={programForm.leadPolicy !== false}
                    onChange={(e) => updateProgramForm('leadPolicy', e.target.checked)}
                  />
                  Use {selectedPolicy.policyNumber} as the program&apos;s lead policy
                </label>
                <span className="eia-field-hint">
                  Optional. The lead policy is the reference policy for the program; clear this
                  to create the program without one.
                </span>
              </div>
              <div className="eia-field span-3 eia-modal-actions">
                <button type="submit" data-testid="submit-program" disabled={programSaving}>
                  {programSaving ? 'Creating program…' : 'Create and attach program'}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeProgramCreate}
                  disabled={programSaving}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {legalEntityCreateOpen && selectedPolicy && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="legal-entity-dialog-title"
            aria-describedby="legal-entity-dialog-description"
            data-testid="legal-entity-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="legal-entity-dialog-title">Create legal entity</h2>
              <span className="eia-badge">{selectedPolicy.policyNumber}</span>
            </div>
            <p className="eia-modal-lede" id="legal-entity-dialog-description">
              The new legal entity is added to the legal-entity catalog and attached to this
              policy when it is created.
              {currentLegalEntity ? ' The current legal-entity assignment is replaced.' : ''}
            </p>

            {legalEntityFormError && (
              <p role="alert" className="eia-modal-error" data-testid="legal-entity-form-error">
                {legalEntityFormError}
              </p>
            )}

            <form className="eia-form-grid" onSubmit={submitLegalEntityCreate}>
              <div className="eia-field">
                <label htmlFor="legal-entity-code">Entity code</label>
                <input
                  id="legal-entity-code"
                  value={legalEntityForm.code}
                  maxLength={MAX_LEGAL_ENTITY_CODE_LENGTH}
                  placeholder="EIA-INS-US"
                  onChange={(e) => updateLegalEntityForm('code', e.target.value)}
                  autoFocus
                />
                <span className="eia-field-hint">
                  Business code of the carrier. Immutable once the entity exists.
                </span>
              </div>
              <div className="eia-field span-2">
                <label htmlFor="legal-entity-name">Legal name</label>
                <input
                  id="legal-entity-name"
                  value={legalEntityForm.name}
                  maxLength={MAX_LEGAL_ENTITY_NAME_LENGTH}
                  placeholder="EIA Insurance Company"
                  onChange={(e) => updateLegalEntityForm('name', e.target.value)}
                />
              </div>
              <div className="eia-field">
                <label htmlFor="legal-entity-type">Entity type</label>
                <select
                  id="legal-entity-type"
                  value={legalEntityForm.type}
                  onChange={(e) => updateLegalEntityForm('type', e.target.value)}
                >
                  <option value="">Select an entity type</option>
                  {LEGAL_ENTITY_TYPES.map((entry) => (
                    <option key={entry.value} value={entry.value}>{entry.label}</option>
                  ))}
                </select>
              </div>
              <div className="eia-field">
                <label htmlFor="legal-entity-jurisdiction">Jurisdiction</label>
                <input
                  id="legal-entity-jurisdiction"
                  value={legalEntityForm.jurisdiction}
                  maxLength={MAX_LEGAL_ENTITY_JURISDICTION_LENGTH}
                  placeholder="US-DE"
                  onChange={(e) => updateLegalEntityForm('jurisdiction', e.target.value)}
                />
                <span className="eia-field-hint">
                  Domicile region or regulator code, e.g. US-DE.
                </span>
              </div>
              <div className="eia-field">
                <label htmlFor="legal-entity-regulator">Regulator</label>
                <input
                  id="legal-entity-regulator"
                  value={legalEntityForm.regulator}
                  maxLength={MAX_LEGAL_ENTITY_REGULATOR_LENGTH}
                  placeholder="Delaware Department of Insurance"
                  onChange={(e) => updateLegalEntityForm('regulator', e.target.value)}
                />
                <span className="eia-field-hint">Optional. Primary licensing regulator.</span>
              </div>
              <div className="eia-field span-3">
                <label htmlFor="legal-entity-license">License</label>
                <input
                  id="legal-entity-license"
                  value={legalEntityForm.license}
                  maxLength={MAX_LEGAL_ENTITY_LICENSE_LENGTH}
                  placeholder="DOI-100245"
                  onChange={(e) => updateLegalEntityForm('license', e.target.value)}
                />
                <span className="eia-field-hint">
                  Optional. License reference printed on the carrier certificate.
                </span>
              </div>
              <p className="eia-field span-3 eia-legal-entity-modal-note">
                <b>The legal entity issues and is licensed for the policy.</b> Creating and
                attaching it is administrative: coverage, limits, premium, and the policy version
                stay unchanged.
              </p>
              <div className="eia-field span-3 eia-modal-actions">
                <button type="submit" data-testid="submit-legal-entity" disabled={legalEntitySaving}>
                  {legalEntitySaving ? 'Creating legal entity…' : 'Create and attach legal entity'}
                </button>
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeLegalEntityCreate}
                  disabled={legalEntitySaving}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      {linkPaymentInstallment && selectedPolicy && (
        <LinkPaymentDialog
          policyId={selectedPolicy.id}
          installment={linkPaymentInstallment}
          currency={billing.summary?.currency || selectedPolicy.premiumCurrency || ''}
          onClose={closePaymentLink}
          onLinked={(payment) => paymentLinked(linkPaymentInstallment, payment)}
        />
      )}
      {creditNoteOpen && selectedPolicy && (
        <CreditNoteDialog
          policy={selectedPolicy}
          unpaidAmount={billing.summary?.outstandingAmount}
          onClose={closeCreditNoteForm}
          onCreated={creditNoteCreated}
        />
      )}
    </main>
  );
}

function defaultCoverageForm(policy) {
  return {
    coverageCode: 'GL_PRODUCTS',
    coverageName: 'Products liability',
    coveragePart: 'A',
    occurrenceBasis: 'OCCURRENCE',
    effectiveFrom: policy?.effectiveDate || isoDate(0),
    effectiveTo: policy?.expirationDate || isoDate(1),
    perOccurrenceAmount: '2000000.00',
    aggregateAmount: '5000000.00',
    sublimitAmount: '1000000.00',
    deductibleAmount: '5000.00',
    coinsurancePct: '0.10',
    currency: policy?.premiumCurrency || 'USD'
  };
}

function defaultEndorsementForm() {
  return {
    endorsementType: 'LIMIT',
    effectiveDate: today(),
    description: 'Increase the general aggregate',
    premiumDeltaAmount: '5000.00',
    premiumDeltaCurrency: 'USD',
    coverageImpact: 'BROADEN',
    backdateReason: '',
    approvedBy: '',
    approvalRef: ''
  };
}

function defaultInsuredForm(policy) {
  return {
    partyId: '',
    insuredRole: 'ADDITIONAL_INSURED',
    displayName: '',
    certificateNumber: '',
    effectiveFrom: policy?.effectiveDate || isoDate(0),
    effectiveTo: policy?.expirationDate || isoDate(1)
  };
}

function defaultLocationForm(policy) {
  return {
    locationCode: 'LOC-001',
    addressLine1: '1200 Industrial Way',
    addressLine2: '',
    city: 'Akron',
    stateRegion: 'US-OH',
    postalCode: '44311',
    country: 'USA',
    effectiveFrom: policy?.effectiveDate || isoDate(0),
    effectiveTo: policy?.expirationDate || isoDate(1)
  };
}

function defaultCancelForm() {
  return {
    cancellationType: 'PRO_RATA',
    reason: 'Insured sold the business',
    effectiveDate: today(),
    noticeDays: '0'
  };
}

function defaultReinstateForm() {
  return {
    effectiveDate: today(),
    reason: 'Premium received in full',
    approvedBy: '',
    approvalRef: '',
    premiumEvidenceRef: 'RCPT-2026-0001',
    premiumEvidenceAmount: '1500.00',
    premiumEvidenceCurrency: 'USD'
  };
}

/**
 * Billing and Payment are deliberately separate responsibilities. The plan
 * schedules collection of the policy premium; it never moves money, approves a
 * payment, or edits coverage.
 */
function BillingContextPanel() {
  return (
    <section className="eia-context-panel" aria-label="Billing and Payment boundary">
      <h4>Billing boundary</h4>
      <p>
        <b>Billing is premium collection.</b> The plan records what the insured owes and when each
        installment is due against the selected policy premium.
      </p>
      <p>
        <b>Payment owns disbursement and approval.</b> Policy hands an installment to Payment
        through the Create payment link, or links a Payment that already exists; it never creates,
        executes, or approves a payment.
      </p>
      <p>
        <b>Applying an existing payment marks the installment collected.</b> The installment stores
        the payment id as collection evidence; the Payment keeps its own status, amount, currency,
        and approval path. Amounts may differ and both are shown for reconciliation.
      </p>
      <p>
        <b>A billing plan does not change policy coverage.</b> Coverage, limits, premium, and the
        policy version stay with the policy record.
      </p>
      <div className="links">
        <CrossLink href="/payment">Open Payment workbench</CrossLink>
      </div>
    </section>
  );
}

/**
 * Credit notes reduce the premium owed. The section is an accounting ledger:
 * a note never edits the policy premium or coverage, and applying one changes
 * the note's accounting status only; it is not a Payment.
 */
function CreditNotesSection({
  policy,
  state,
  busyId,
  cancelId,
  actionError,
  onRetry,
  onNew,
  onIssue,
  onApply,
  onRequestCancel,
  onConfirmCancel,
  onKeep
}) {
  const currency = state.summary?.currency || policy?.premiumCurrency || '';
  const items = Array.isArray(state.items) ? state.items : [];

  return (
    <section className="eia-credit-notes" aria-label="Credit notes" data-testid="credit-notes">
      <div className="eia-section-title">
        <h2>Credit notes</h2>
        <span className="eia-muted">
          Reduces premium owed · accounting status, not a Payment
        </span>
      </div>
      <p className="eia-billing-policy-context">
        Credit notes issued against {policy?.policyNumber || 'this policy'} reduce the premium
        owed. They do not change the policy premium, coverage, limits, or version.
      </p>

      <div className="eia-summary-grid" aria-label="Credit note summary">
        <div className="eia-card">
          <h3>Issued</h3>
          <div className="value" data-testid="credit-notes-summary-issued">
            {formatMoney(state.summary?.issuedAmount, currency)}
          </div>
          <div className="eia-metric-label">issued and applied credit notes</div>
        </div>
        <div className="eia-card">
          <h3>Applied</h3>
          <div className="value" data-testid="credit-notes-summary-applied">
            {formatMoney(state.summary?.appliedAmount, currency)}
          </div>
          <div className="eia-metric-label">posted against premium owed</div>
        </div>
      </div>

      <div className="eia-toolbar eia-credit-notes-toolbar">
        <span className="eia-muted">Drafts do not affect premium owed until issued.</span>
        <span className="spacer" />
        <button type="button" data-testid="new-credit-note" onClick={onNew}>
          New credit note
        </button>
      </div>

      {actionError && (
        <p role="alert" className="eia-credit-note-error" data-testid="credit-note-action-error">
          {actionError}
        </p>
      )}

      {state.loading && items.length === 0 ? (
        <p className="eia-muted" data-testid="credit-notes-loading">Loading credit notes…</p>
      ) : state.error ? (
        <section
          className="eia-card"
          aria-label="Credit notes unavailable"
          data-testid="credit-notes-error"
        >
          <p role="alert" style={{ marginTop: 0 }}>{state.error}</p>
          <button type="button" className="eia-btn-secondary" onClick={onRetry}>
            Retry
          </button>
        </section>
      ) : items.length === 0 ? (
        <div className="eia-empty eia-credit-notes-empty" data-testid="credit-notes-empty">
          <p><b>No credit notes yet.</b></p>
          <p>
            A credit note reduces the premium the insured owes without changing the policy premium
            or coverage. Create one to record a cancellation, endorsement, audit return,
            overpayment, refund, or correction.
          </p>
        </div>
      ) : (
        <div className="eia-table-wrap">
          <table className="eia-table eia-credit-notes-table" aria-label="Credit notes">
            <thead>
              <tr>
                <th>Note</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Status</th>
                <th>Issued</th>
                <th>Applied</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {items.map((note) => {
                const busy = busyId === note.id;
                const confirming = cancelId === note.id;
                const showActions = canIssueCreditNote(note.status)
                  || canApplyCreditNote(note.status)
                  || canCancelCreditNote(note.status);
                return (
                  <tr key={note.id} data-testid={`credit-note-row-${note.id}`}>
                    <td><code className="eia-mono">{note.creditNoteNumber}</code></td>
                    <td>
                      {formatMoney(note.amount, note.currency || currency)}
                      {note.currency || currency ? (
                        <span className="eia-muted"> {note.currency || currency}</span>
                      ) : null}
                    </td>
                    <td>{note.reasonLabel || creditNoteReasonLabel(note.reason)}</td>
                    <td>
                      <span className={`eia-pill ${creditNoteStatusTone(note.status)}`}>
                        {note.status}
                      </span>
                    </td>
                    <td>{note.issuedDate || '—'}</td>
                    <td>{note.appliedDate || '—'}</td>
                    <td>
                      {confirming ? (
                        <span
                          className="eia-credit-note-actions"
                          role="group"
                          aria-label={`Confirm cancel ${note.creditNoteNumber}`}
                        >
                          <span className="eia-credit-note-confirm">Cancel this credit note?</span>
                          <button
                            type="button"
                            className="eia-btn-secondary"
                            data-testid={`confirm-cancel-credit-note-${note.id}`}
                            disabled={busy}
                            onClick={() => onConfirmCancel(note)}
                          >
                            Confirm cancel
                          </button>
                          <button
                            type="button"
                            className="eia-btn-ghost"
                            data-testid={`keep-credit-note-${note.id}`}
                            disabled={busy}
                            onClick={onKeep}
                          >
                            Keep
                          </button>
                        </span>
                      ) : showActions ? (
                        <span className="eia-credit-note-actions">
                          {canIssueCreditNote(note.status) && (
                            <button
                              type="button"
                              className="eia-btn-secondary"
                              data-testid={`issue-credit-note-${note.id}`}
                              disabled={busy}
                              onClick={() => onIssue(note)}
                            >
                              {busy ? 'Working…' : 'Issue'}
                            </button>
                          )}
                          {canApplyCreditNote(note.status) && (
                            <button
                              type="button"
                              className="eia-btn-secondary"
                              data-testid={`apply-credit-note-${note.id}`}
                              disabled={busy}
                              onClick={() => onApply(note)}
                            >
                              {busy ? 'Working…' : 'Apply'}
                            </button>
                          )}
                          {canCancelCreditNote(note.status) && (
                            <button
                              type="button"
                              className="eia-btn-secondary"
                              data-testid={`cancel-credit-note-${note.id}`}
                              disabled={busy}
                              onClick={() => onRequestCancel(note)}
                            >
                              Cancel
                            </button>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section
        className="eia-context-panel"
        aria-label="Credit note context"
        data-testid="credit-note-context"
      >
        <h4>Credit note context</h4>
        <p>
          <b>A credit note reduces premium owed.</b> The issued and applied totals show how much
          of the receivable has been credited; the note does not change the policy premium,
          coverage, limits, or version.
        </p>
        <p>
          <b>Applying is an accounting status.</b> It records the credit against the receivable;
          it is not a Payment, does not move money, and is not approved here.
        </p>
        <p>
          <b>Only issued notes credit anything.</b> A draft does not change premium owed, and
          cancelling ends the note without posting a credit.
        </p>
      </section>
    </section>
  );
}

/**
 * New credit notes are saved as drafts. The amount defaults to the unpaid
 * premium and stays editable; the currency is fixed to the policy premium
 * currency because the note reduces that receivable.
 */
function CreditNoteDialog({ policy, unpaidAmount, onClose, onCreated }) {
  const [form, setForm] = useState(() => defaultCreditNoteForm(policy, unpaidAmount));
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const currency = policy?.premiumCurrency || form.currency || '';

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !saving) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [saving, onClose]);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setFormError('');
  }

  async function submit(event) {
    event.preventDefault();
    if (saving || !policy?.id) return;
    const validation = validateCreditNoteForm(form);
    if (validation) {
      setFormError(validation);
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      const result = await api(creditNoteEndpoint(policy.id), {
        method: 'POST',
        body: creditNotePayload(form, policy),
        idempotencyKey: newIdempotencyKey()
      });
      if (!result.response.ok) {
        setFormError(problemMessage(
          result.body,
          `Credit note creation failed: ${result.response.status}`
        ));
        return;
      }
      onCreated(result.body);
    } catch (e) {
      setFormError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="eia-modal-backdrop">
      <div
        className="eia-modal eia-credit-note-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="credit-note-dialog-title"
        aria-describedby="credit-note-dialog-description"
        data-testid="credit-note-dialog"
      >
        <div className="eia-section-title" style={{ marginTop: 0 }}>
          <h2 id="credit-note-dialog-title">New credit note</h2>
          <span className="eia-badge">{policy.policyNumber}</span>
        </div>
        <p className="eia-modal-lede" id="credit-note-dialog-description">
          Save a draft credit note against {policy.policyNumber}. Issuing and applying are
          separate, audited status changes; no money moves and the policy premium is not edited.
        </p>
        <p
          className="eia-muted eia-modal-currency-context"
          data-testid="credit-note-default-context"
        >
          Policy premium {formatMoney(policy.premiumAmount, policy.premiumCurrency)}
          {' · '}unpaid <b>{formatMoney(unpaidAmount, currency)}</b>
        </p>

        {formError && (
          <p role="alert" className="eia-modal-error" data-testid="credit-note-form-error">
            {formError}
          </p>
        )}

        <form className="eia-form-grid" onSubmit={submit}>
          <div className="eia-field">
            <label htmlFor="credit-note-amount">Amount</label>
            <input
              id="credit-note-amount"
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => update('amount', e.target.value)}
              autoFocus
              required
            />
            <span className="eia-field-hint">
              Defaults to the unpaid premium. The note reduces premium owed; it does not change
              the policy premium.
            </span>
          </div>
          <div className="eia-field">
            <label htmlFor="credit-note-currency">Currency</label>
            <input
              id="credit-note-currency"
              value={currency}
              readOnly
              aria-readonly="true"
            />
            <span className="eia-field-hint">Fixed to the policy premium currency.</span>
          </div>
          <div className="eia-field">
            <label htmlFor="credit-note-reason">Reason</label>
            <select
              id="credit-note-reason"
              value={form.reason}
              onChange={(e) => update('reason', e.target.value)}
            >
              {CREDIT_NOTE_REASONS.map((entry) => (
                <option key={entry.value} value={entry.value}>{entry.label}</option>
              ))}
            </select>
          </div>
          <div className="eia-field span-3 eia-modal-actions">
            <button type="submit" data-testid="save-credit-note" disabled={saving}>
              {saving ? 'Saving draft…' : 'Save draft'}
            </button>
            <button
              type="button"
              className="eia-btn-secondary"
              onClick={onClose}
              disabled={saving}
            >
              Cancel
            </button>
          </div>
        </form>

        <section
          className="eia-context-panel"
          aria-label="New credit note context"
          data-testid="credit-note-dialog-context"
        >
          <h4>What saving a draft does</h4>
          <p>
            <b>The note starts in DRAFT.</b> It does not affect premium owed until it is issued,
            and it does not change the policy premium, coverage, limits, or version.
          </p>
          <p>
            <b>Issuing and applying are accounting status changes.</b> Applying is not a Payment;
            it records the credit against the receivable and does not move money.
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * Links an existing policy-source Payment to a DUE/OVERDUE installment. Policy
 * reads GET /api/v1/payments?sourceType=POLICY&sourceId=… and PATCHes the
 * installment; nothing here creates, executes, or changes a Payment.
 */
function LinkPaymentDialog({ policyId, installment, currency, onClose, onLinked }) {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [applyError, setApplyError] = useState('');
  const [applying, setApplying] = useState(false);
  const requestRef = useRef(0);

  const installmentCurrency = installment.currency || currency || '';
  const selected = payments.find((payment) => payment.id === selectedId) || null;
  const amountsDiffer = selected ? paymentAmountDiffers(selected, installment) : false;

  async function loadPayments() {
    if (!policyId) {
      setPayments([]);
      setLoading(false);
      setLoadError('Policy payments are unavailable for this record.');
      return;
    }
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setLoadError('');
    setSelectedId('');
    setApplyError('');
    try {
      const result = await api(policyPaymentsEndpoint(policyId));
      if (requestRef.current !== requestId) return;
      if (!result.response.ok) {
        setPayments([]);
        setLoadError('Policy payments are temporarily unavailable.');
        return;
      }
      setPayments(normalizePolicyPayments(result.body));
    } catch {
      if (requestRef.current !== requestId) return;
      setPayments([]);
      setLoadError('Policy payments are temporarily unavailable.');
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }

  useEffect(() => {
    loadPayments();
    return () => {
      requestRef.current += 1;
    };
  }, [policyId]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape' && !applying) onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [applying, onClose]);

  function selectPayment(paymentId) {
    setSelectedId(paymentId);
    setApplyError('');
  }

  async function applyPayment(event) {
    event.preventDefault();
    if (!selected || applying) return;
    setApplyError('');
    setApplying(true);
    try {
      const result = await api(
        `/api/v1/policies/${policyId}/billing/installments/${encodeURIComponent(installment.id)}`,
        { method: 'PATCH', body: installmentPaymentPayload(selected) }
      );
      if (!result.response.ok) {
        setApplyError(problemMessage(result.body, `Payment link failed: ${result.response.status}`));
        return;
      }
      onLinked(selected);
    } catch (e) {
      setApplyError(e.message);
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="eia-modal-backdrop">
      <div
        className="eia-modal eia-payment-link-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-payment-title"
        aria-describedby="link-payment-description"
        data-testid="link-payment-dialog"
      >
        <div className="eia-section-title" style={{ marginTop: 0 }}>
          <h2 id="link-payment-title">
            Link payment to installment {installment.installmentNumber}
          </h2>
          <span className="eia-badge">{installment.status}</span>
        </div>
        <p className="eia-modal-lede" id="link-payment-description">
          Choose an existing Payment for this policy. Applying marks installment{' '}
          {installment.installmentNumber} collected; it does not execute, approve, create, or alter
          the Payment.
        </p>
        <p
          className="eia-muted eia-modal-currency-context"
          data-testid="link-payment-installment-context"
        >
          Due {installment.dueDate || '—'} · scheduled{' '}
          <b>{formatMoney(installment.amount, installmentCurrency)}</b>
          {' · '}policy source <b>POLICY</b>
        </p>

        {loading ? (
          <p className="eia-muted eia-payment-link-state" data-testid="link-payment-loading">
            Loading policy payments…
          </p>
        ) : loadError ? (
          <div className="eia-payment-link-state">
            <p role="alert" data-testid="link-payment-error" style={{ marginTop: 0 }}>
              {loadError}
            </p>
            <button type="button" className="eia-btn-secondary" onClick={loadPayments}>
              Retry
            </button>
          </div>
        ) : payments.length === 0 ? (
          <div className="eia-empty eia-payment-link-empty" data-testid="link-payment-empty">
            <p><b>No payments found for this policy.</b></p>
            <p>
              Payments are created and executed in the Payment workbench. Policy only links a
              payment that already exists.
            </p>
            <CrossLink href="/payment">Open Payment workbench</CrossLink>
          </div>
        ) : (
          <form onSubmit={applyPayment}>
            <div className="eia-table-wrap">
              <table className="eia-table eia-payment-table" aria-label="Policy payments">
                <thead>
                  <tr>
                    <th>Select</th>
                    <th>Payment</th>
                    <th>Status</th>
                    <th>Amount</th>
                    <th>Created</th>
                    <th>Payee</th>
                  </tr>
                </thead>
                <tbody>
                  {payments.map((payment) => (
                    <tr
                      key={payment.id}
                      className={selectedId === payment.id ? 'selected' : undefined}
                      data-testid={`payment-row-${payment.id}`}
                    >
                      <td>
                        <input
                          type="radio"
                          name="link-payment"
                          value={payment.id}
                          aria-label={`Select ${payment.paymentNumber}`}
                          checked={selectedId === payment.id}
                          onChange={() => selectPayment(payment.id)}
                        />
                      </td>
                      <td><code className="eia-mono">{payment.paymentNumber}</code></td>
                      <td>
                        <span className={`eia-pill ${paymentStatusTone(payment.status)}`}>
                          {payment.status || '—'}
                        </span>
                      </td>
                      <td>
                        {formatMoney(
                          payment.amount,
                          payment.currency || installmentCurrency
                        )}
                        {(payment.currency || installmentCurrency) ? (
                          <span className="eia-muted">
                            {' '}{payment.currency || installmentCurrency}
                          </span>
                        ) : null}
                      </td>
                      <td>{payment.createdDate || '—'}</td>
                      <td>{payment.payee || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {amountsDiffer && (
              <p
                className="eia-payment-warning"
                role="note"
                data-testid="payment-amount-warning"
              >
                <b>Amounts differ.</b> Selected payment {selected.paymentNumber} is{' '}
                {formatMoney(selected.amount, selected.currency || installmentCurrency)}; installment{' '}
                {installment.installmentNumber} is{' '}
                {formatMoney(installment.amount, installmentCurrency)}. Applying links the payment
                for reconciliation and marks the installment collected. The Payment record and its
                amount are not changed.
              </p>
            )}

            {applyError && (
              <p
                role="alert"
                className="eia-modal-error"
                data-testid="link-payment-apply-error"
              >
                {applyError}
              </p>
            )}

            <div className="eia-modal-actions">
              <button
                type="submit"
                data-testid="apply-payment"
                disabled={!selected || applying}
              >
                {applying ? 'Applying…' : 'Apply payment'}
              </button>
              <button
                type="button"
                className="eia-btn-secondary"
                onClick={onClose}
                disabled={applying}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        <section
          className="eia-context-panel"
          aria-label="Payment linking context"
          data-testid="payment-link-context"
        >
          <h4>What linking does</h4>
          <p>
            <b>Marks the installment collected.</b> The installment records the payment id as
            collection evidence. The Payment is not executed, approved, or altered by this action.
          </p>
          <p>
            <b>Amounts may differ.</b> The installment keeps its scheduled amount and the Payment
            keeps its own amount and currency; both are shown here for reconciliation.
          </p>
          <p>
            <b>No payment is created.</b> A payment must already exist in the Payment workbench
            before it can be linked.
          </p>
        </section>
      </div>
    </div>
  );
}

/**
 * The program association is administrative context on the policy. A program
 * groups related policies for capacity and aggregate administration; it does
 * not create capacity, coinsurance, or fronting records, and assigning or
 * detaching a program never edits coverage, limits, premium, or the version.
 */
function ProgramContextPanel() {
  return (
    <section
      className="eia-context-panel"
      aria-label="Program context"
      data-testid="program-context"
    >
      <h4>Program context</h4>
      <p>
        <b>A program groups related policies for capacity and aggregate administration.</b>{' '}
        Policies placed under one program are reviewed and managed as a block, and the program
        records its own type, effective dates, status, and lead policy.
      </p>
      <p>
        <b>Assigning a program does not change coverage or limits.</b> The association is
        administrative: coverage grants, limits, premium, and the policy version stay on the
        policy record.
      </p>
      <p>
        <b>Capacity, coinsurance, and fronting stay separate.</b> The program is the grouping
        dimension; capacity shares, coinsurance, and fronting arrangements are recorded on their
        own policy structures and are not created or edited here.
      </p>
    </section>
  );
}

/**
 * The issuing legal entity is administrative context on the policy. It is the
 * licensed carrier that writes the policy and owns billing, tax, and regulatory
 * reporting; assigning or detaching it never edits coverage, limits, premium,
 * or the policy version, and it creates no capacity or intercompany records.
 */
function LegalEntityContextPanel() {
  return (
    <section
      className="eia-context-panel"
      aria-label="Legal entity context"
      data-testid="legal-entity-context"
    >
      <h4>Legal entity context</h4>
      <p>
        <b>The legal entity is the issuing, licensed carrier.</b> It is the carrier that writes
        the policy and appears on the policy documents; its type, jurisdiction, regulator, and
        license identify who is licensed to issue the business.
      </p>
      <p>
        <b>Assigning a legal entity does not change coverage or limits.</b> The association is
        administrative: coverage grants, limits, premium, and the policy version stay on the
        policy record.
      </p>
      <p>
        <b>Billing, tax, and regulatory reporting use the issuing entity.</b> The legal entity is
        the reporting carrier, not the group. Capacity, coinsurance, fronting, and intercompany
        arrangements remain on their own policy structures.
      </p>
    </section>
  );
}

/**
 * The profile is policy context for claim allocation, not a coverage change and
 * not the allocation ledger. Direct Claims records the claim-side split and
 * Policy records the coverage-block and limit context the split is measured
 * against.
 */
function MassTortContextPanel() {
  return (
    <section
      className="eia-context-panel"
      aria-label="Mass tort profile context"
      data-testid="mass-tort-context"
    >
      <h4>Mass tort profile context</h4>
      <p>
        <b>The profile guides allocation and coverage administration.</b> Tort type, trigger,
        allocation method, and the coverage block give adjusters the policy context for
        long-tail claims that span several years and layers.
      </p>
      <p>
        <b>The profile does not change coverage or limits.</b> Coverage grants, limits, premium,
        and the policy version stay on the policy record; completing this profile never edits
        them.
      </p>
      <p>
        <b>Policy owns the profile; Direct Claims owns allocations.</b> Direct Claims records how
        a claim loss is split across policy years and layers, and Policy supplies the profile and
        limit ledger that administration is measured against.
      </p>
      <div className="links">
        <CrossLink href="/direct-claims">Open Direct Claims workbench</CrossLink>
      </div>
    </section>
  );
}
