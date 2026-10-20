import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAGE_SIZE = 20;
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
  { id: 'versions', label: 'Versions' },
  { id: 'coverages', label: 'Coverages & Limits' },
  { id: 'endorsements', label: 'Endorsements' },
  { id: 'parties', label: 'Insureds & Locations' },
  { id: 'cancellation', label: 'Cancellation' }
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

function insuredLabel(policy) {
  return policy?.insuredDisplayName || shortId(policy?.insuredPartyId);
}

function statusTone(status) {
  if (['IN_FORCE', 'ISSUED', 'REINSTATED', 'RENEWED'].includes(status)) return 'green';
  if (['CANCELLED', 'VOID', 'NON_RENEWED'].includes(status)) return 'red';
  if (['DRAFT', 'BOUND', 'EXPIRED'].includes(status)) return 'amber';
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

async function api(path, options = {}) {
  const headers = { 'X-EIA-Tenant': TENANT };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.etag) headers['If-Match'] = options.etag;
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey;
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
    load(0).catch((e) => setError(e.message));
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setNotice('');
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
      if (!options.keepTab) setTab('overview');
      await loadCurrentVersion(policyId);
      setVersions([]);
      setCoverages([]);
      setEndorsements([]);
      setInsureds([]);
      setLocations([]);
      setCancellations([]);
      setReinstatements([]);
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

  async function loadTabData(tabId, policyId = selected?.id) {
    if (!policyId) return;
    setTabLoading(true);
    setError('');
    try {
      if (tabId === 'overview') {
        await loadCurrentVersion(policyId);
      } else if (tabId === 'versions') {
        const result = await api(`/api/v1/policies/${policyId}/versions?page=0&size=50`);
        if (!result.response.ok) setError(problemMessage(result.body, 'Version history failed'));
        else setVersions(pageItems(result.body));
      } else if (tabId === 'coverages') {
        const result = await api(`/api/v1/policies/${policyId}/coverages?page=0&size=50`);
        if (!result.response.ok) setError(problemMessage(result.body, 'Coverage load failed'));
        else setCoverages(pageItems(result.body));
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
    loadTabData(tabId).catch((e) => setError(e.message));
  }

  async function refreshSelected(etag) {
    if (!selected) return;
    const detail = await api(`/api/v1/policies/${selected.id}`);
    if (detail.response.ok) {
      setSelected({
        id: selected.id,
        policy: detail.body,
        etag: etag || detail.etag || formatEtag(detail.body.version)
      });
    }
    await load(page);
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

  const selectedPolicy = selected?.policy;
  const advanceTarget = selectedPolicy ? nextStatusFor(selectedPolicy.status) : null;

  return (
    <main>
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Policy · Direct book</div>
          <h1>Policy</h1>
          <p className="subtitle">
            Direct policies, versions, coverages and limits, endorsements, insureds and locations,
            cancellation and reinstatement. New policies start in DRAFT and advance through the issued lifecycle.
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
              <label htmlFor="create-insured-party">Insured party ID</label>
              <input
                id="create-insured-party"
                placeholder="Insured party ID (UUID)"
                value={form.insuredPartyId}
                onChange={(e) => update('insuredPartyId', e.target.value)}
                required
              />
            </div>
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
          <aside className="eia-record-list" aria-label="Policy register">
            <div className="eia-record-list-head">
              <strong>Direct policies</strong>
              <span className="eia-muted">{total}</span>
            </div>
            {policies.map((policy) => {
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
                  <span className="record-secondary">Insured {insuredLabel(policy)}</span>
                  <span className="record-secondary">
                    {policy.productCode || '—'} · version {policy.version ?? '—'}
                  </span>
                  <span>
                    <span className={`eia-pill ${statusTone(policy.status)}`}>{policy.status}</span>
                  </span>
                </button>
              );
            })}
            {policies.length === 0 && (
              <div className="empty">
                {page > 0 ? 'No policies on this page.' : 'No policies yet. Use New policy to open the first record.'}
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
                </div>
                <div className="eia-actions">
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

              {tabLoading && <p className="eia-muted">Loading…</p>}

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
                        <dd>{selectedPolicy.insuredDisplayName || selectedPolicy.insuredPartyId || '—'}</dd>
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
            </>
          )}
        </section>
      </div>
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
