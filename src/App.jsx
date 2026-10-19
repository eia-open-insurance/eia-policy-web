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
  const value = Number(amount);
  if (!Number.isFinite(value) || !currency) return amount;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(value);
  } catch {
    return `${amount} ${currency}`;
  }
}

function formatPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return value ?? '—';
  return `${(numeric * 100).toFixed(2)}%`;
}

function formatEtag(version) {
  return `"${version}"`;
}

function nextStatusFor(status) {
  return NEXT_STATUS[status] || null;
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

  // ---- coverage form -------------------------------------------------
  const [coverageForm, setCoverageForm] = useState(defaultCoverageForm(null));
  const [erosionForm, setErosionForm] = useState({
    claimId: '', allocationId: '', sourceVersion: '1',
    paidAmount: '250000.00', reservedAmount: '50000.00', recoveredAmount: '0.00'
  });

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
  const [endorsementForm, setEndorsementForm] = useState(defaultEndorsementForm());

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
  const [insuredForm, setInsuredForm] = useState(defaultInsuredForm(null));
  const [locationForm, setLocationForm] = useState(defaultLocationForm(null));

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
  const [cancelForm, setCancelForm] = useState(defaultCancelForm());
  const [reinstateForm, setReinstateForm] = useState(defaultReinstateForm());

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

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1280, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>Policy</h1>
      <p style={{ marginTop: 0, color: '#555' }}>
        Direct policies, versions, coverages and limits, endorsements, insureds and locations,
        cancellation and reinstatement. New policies start in DRAFT and advance through the issued lifecycle.
      </p>

      {error && <p role="alert" style={{ color: '#b00020', fontWeight: 600 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#145c2c', fontWeight: 600 }}>{notice}</p>}

      <section aria-label="Create policy" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18 }}>Create policy</h2>
        <form onSubmit={submit} style={gridStyle}>
          <label style={labelStyle}>
            Policy number (optional)
            <input style={inputStyle} placeholder="Auto-generated if blank" value={form.policyNumber}
                   onChange={(e) => update('policyNumber', e.target.value)} />
          </label>
          <label style={labelStyle}>
            Product code
            <input style={inputStyle} placeholder="CGL" value={form.productCode} required
                   onChange={(e) => update('productCode', e.target.value)} />
          </label>
          <label style={labelStyle}>
            Insured party ID
            <input style={inputStyle} placeholder="Insured party ID (UUID)" value={form.insuredPartyId} required
                   onChange={(e) => update('insuredPartyId', e.target.value)} />
          </label>
          <label style={labelStyle}>
            Effective date
            <input style={inputStyle} type="date" value={form.effectiveDate} required
                   onChange={(e) => update('effectiveDate', e.target.value)} />
          </label>
          <label style={labelStyle}>
            Expiration date
            <input style={inputStyle} type="date" value={form.expirationDate} required
                   onChange={(e) => update('expirationDate', e.target.value)} />
          </label>
          <label style={labelStyle}>
            Premium
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.premiumAmount} required
                   onChange={(e) => update('premiumAmount', e.target.value)} />
          </label>
          <label style={labelStyle}>
            Premium currency
            <input style={inputStyle} maxLength={3} placeholder="USD" value={form.premiumCurrency} required
                   onChange={(e) => update('premiumCurrency', e.target.value.toUpperCase())} />
          </label>
          <label style={labelStyle}>
            Limit
            <input style={inputStyle} type="number" min="0" step="0.01" value={form.limitAmount} required
                   onChange={(e) => update('limitAmount', e.target.value)} />
          </label>
          <label style={labelStyle}>
            Limit currency
            <input style={inputStyle} maxLength={3} placeholder="USD" value={form.limitCurrency} required
                   onChange={(e) => update('limitCurrency', e.target.value.toUpperCase())} />
          </label>
          <div style={{ display: 'flex', alignItems: 'end' }}>
            <button type="submit" disabled={saving} style={buttonStyle}>
              {saving ? 'Creating…' : 'Create policy'}
            </button>
          </div>
        </form>
      </section>

      <section aria-label="Policies" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18 }}>Policies</h2>
        <div style={{ overflowX: 'auto' }}>
          <table width="100%" cellPadding="8" style={{ borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ textAlign: 'left', borderBottom: '2px solid #ddd' }}>
                <th>Number</th>
                <th>Product</th>
                <th>Status</th>
                <th>Effective</th>
                <th>Expiration</th>
                <th>Premium</th>
                <th>Limit</th>
                <th>Version</th>
                <th>ETag</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => {
                const target = nextStatusFor(policy.status);
                return (
                  <tr key={policy.id} style={{ borderTop: '1px solid #eee' }}>
                    <td>{policy.policyNumber}</td>
                    <td>{policy.productCode}</td>
                    <td><span style={statusStyle(policy.status)}>{policy.status}</span></td>
                    <td>{policy.effectiveDate}</td>
                    <td>{policy.expirationDate}</td>
                    <td>{formatMoney(policy.premiumAmount, policy.premiumCurrency)}</td>
                    <td>{formatMoney(policy.limitAmount, policy.limitCurrency)}</td>
                    <td>{policy.version}</td>
                    <td><code>{formatEtag(policy.version)}</code></td>
                    <td style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        aria-label={`Open ${policy.policyNumber}`}
                        onClick={() => openPolicy(policy.id)}
                        style={linkButtonStyle}
                      >
                        Open
                      </button>
                      {target && (
                        <button
                          type="button"
                          aria-label={`${policy.policyNumber}: advance to ${target}`}
                          disabled={busyId === policy.id}
                          onClick={() => advance(policy)}
                          style={linkButtonStyle}
                        >
                          {busyId === policy.id ? 'Updating…' : `Advance to ${target}`}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {policies.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: 16, color: '#666' }}>
                    {page > 0 ? 'No policies on this page.' : 'No policies yet.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <nav aria-label="Pagination" style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 14 }}>
          <button type="button" onClick={() => goTo(page - 1)} disabled={page <= 0 || loading} style={buttonStyle}>
            Previous
          </button>
          <span style={{ fontSize: 13, color: '#444' }}>
            Page {page + 1} · {total} {total === 1 ? 'policy' : 'policies'}
          </span>
          <button type="button" onClick={() => goTo(page + 1)} disabled={!links?.next || loading} style={buttonStyle}>
            Next
          </button>
        </nav>
      </section>

      {selectedPolicy && (
        <section aria-label="Policy detail" style={{ border: '1px solid #ddd', borderRadius: 10, padding: 20 }}>
          <header style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 style={{ margin: 0 }}>{selectedPolicy.policyNumber}</h2>
              <p style={{ margin: '6px 0 0', color: '#555' }}>
                <span style={statusStyle(selectedPolicy.status)}>{selectedPolicy.status}</span>
                {' '}· version {selectedPolicy.version} · <code>{selected.etag}</code>
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'start' }}>
              {nextStatusFor(selectedPolicy.status) && (
                <button
                  type="button"
                  onClick={() => advance(selectedPolicy)}
                  disabled={busyId === selectedPolicy.id}
                  style={linkButtonStyle}
                >
                  Advance to {nextStatusFor(selectedPolicy.status)}
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                  setCurrentVersion(null);
                }}
                style={linkButtonStyle}
              >
                Close
              </button>
            </div>
          </header>

          <nav role="tablist" aria-label="Policy sections" style={{ display: 'flex', gap: 6, marginTop: 16, flexWrap: 'wrap' }}>
            {TABS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                role="tab"
                aria-selected={tab === entry.id}
                onClick={() => selectTab(entry.id)}
                style={tab === entry.id ? activeTabStyle : inactiveTabStyle}
              >
                {entry.label}
              </button>
            ))}
          </nav>

          {tabLoading && <p style={{ color: '#555' }}>Loading…</p>}

          {tab === 'overview' && (
            <section aria-label="Overview" style={{ marginTop: 16 }}>
              <dl style={definitionGridStyle}>
                <Field label="Product" value={selectedPolicy.productCode} />
                <Field label="Insured party" value={selectedPolicy.insuredPartyId} />
                <Field label="Effective" value={selectedPolicy.effectiveDate} />
                <Field label="Expiration" value={selectedPolicy.expirationDate} />
                <Field label="Premium" value={formatMoney(selectedPolicy.premiumAmount, selectedPolicy.premiumCurrency)} />
                <Field label="Limit" value={formatMoney(selectedPolicy.limitAmount, selectedPolicy.limitCurrency)} />
                <Field label="Current version" value={currentVersion?.version?.policyVersionNumber || '—'} />
              </dl>
              <h3 style={{ fontSize: 16 }}>Current version</h3>
              {currentVersion ? (
                <table width="100%" cellPadding="8" style={tableStyle}>
                  <thead>
                    <tr style={headRowStyle}>
                      <th>Version</th>
                      <th>Change</th>
                      <th>Status</th>
                      <th>Effective from</th>
                      <th>Hash verified</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{currentVersion.version?.policyVersionNumber}</td>
                      <td>{currentVersion.version?.changeType}</td>
                      <td>{currentVersion.version?.status}</td>
                      <td>{currentVersion.version?.effectiveFrom}</td>
                      <td>{currentVersion.hashVerified ? 'Yes' : 'No'}</td>
                    </tr>
                  </tbody>
                </table>
              ) : (
                <p style={{ color: '#666' }}>No version issued yet. Add a named insured and advance the policy to ISSUED.</p>
              )}
            </section>
          )}

          {tab === 'versions' && (
            <section aria-label="Versions" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16 }}>Version history</h3>
              <table width="100%" cellPadding="8" style={tableStyle}>
                <thead>
                  <tr style={headRowStyle}>
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
                    <tr key={version.id} style={{ borderTop: '1px solid #eee' }}>
                      <td>{version.policyVersionNumber}</td>
                      <td>{version.changeType}</td>
                      <td>{version.status}</td>
                      <td>{version.effectiveFrom}</td>
                      <td>{version.effectiveTo || '—'}</td>
                      <td>{version.premiumDeltaAmount ? formatMoney(version.premiumDeltaAmount, version.premiumDeltaCurrency) : '—'}</td>
                      <td><code>{String(version.immutableHash || '').slice(0, 12)}</code></td>
                    </tr>
                  ))}
                  {versions.length === 0 && (
                    <tr><td colSpan={7} style={emptyCellStyle}>No versions yet.</td></tr>
                  )}
                </tbody>
              </table>
            </section>
          )}

          {tab === 'coverages' && (
            <section aria-label="Coverages and limits" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16 }}>Coverages and limits</h3>
              <table width="100%" cellPadding="8" style={tableStyle}>
                <thead>
                  <tr style={headRowStyle}>
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
                    <tr key={entry.coverage?.id} style={{ borderTop: '1px solid #eee' }}>
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
                    <tr><td colSpan={8} style={emptyCellStyle}>No coverages yet.</td></tr>
                  )}
                </tbody>
              </table>

              <h3 style={{ fontSize: 16 }}>Add coverage</h3>
              <form onSubmit={submitCoverage} style={gridStyle}>
                <label style={labelStyle}>
                  Coverage code
                  <input style={inputStyle} value={coverageForm.coverageCode} required
                         onChange={(e) => updateCoverage('coverageCode', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Coverage name
                  <input style={inputStyle} value={coverageForm.coverageName} required
                         onChange={(e) => updateCoverage('coverageName', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Part
                  <select style={inputStyle} value={coverageForm.coveragePart}
                          onChange={(e) => updateCoverage('coveragePart', e.target.value)}>
                    <option value="A">A</option>
                    <option value="B">B</option>
                    <option value="C">C</option>
                    <option value="D">D</option>
                  </select>
                </label>
                <label style={labelStyle}>
                  Occurrence basis
                  <select style={inputStyle} value={coverageForm.occurrenceBasis}
                          onChange={(e) => updateCoverage('occurrenceBasis', e.target.value)}>
                    <option value="OCCURRENCE">OCCURRENCE</option>
                    <option value="CLAIMS_MADE">CLAIMS_MADE</option>
                    <option value="CLAIMS_MADE_WITH_RETRO">CLAIMS_MADE_WITH_RETRO</option>
                    <option value="DISCOVERY">DISCOVERY</option>
                  </select>
                </label>
                <label style={labelStyle}>
                  Effective from
                  <input style={inputStyle} type="date" value={coverageForm.effectiveFrom} required
                         onChange={(e) => updateCoverage('effectiveFrom', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Effective to
                  <input style={inputStyle} type="date" value={coverageForm.effectiveTo} required
                         onChange={(e) => updateCoverage('effectiveTo', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Per occurrence
                  <input style={inputStyle} type="number" min="0" step="0.01" value={coverageForm.perOccurrenceAmount}
                         required onChange={(e) => updateCoverage('perOccurrenceAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Aggregate (optional)
                  <input style={inputStyle} type="number" min="0" step="0.01" value={coverageForm.aggregateAmount}
                         onChange={(e) => updateCoverage('aggregateAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Sublimit (optional)
                  <input style={inputStyle} type="number" min="0" step="0.01" value={coverageForm.sublimitAmount}
                         onChange={(e) => updateCoverage('sublimitAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Deductible
                  <input style={inputStyle} type="number" min="0" step="0.01" value={coverageForm.deductibleAmount}
                         onChange={(e) => updateCoverage('deductibleAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Coinsurance (fraction)
                  <input style={inputStyle} type="number" min="0" max="1" step="0.01" value={coverageForm.coinsurancePct}
                         onChange={(e) => updateCoverage('coinsurancePct', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Currency
                  <input style={inputStyle} maxLength={3} value={coverageForm.currency} required
                         onChange={(e) => updateCoverage('currency', e.target.value.toUpperCase())} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="submit" style={buttonStyle}>Add coverage</button>
                </div>
              </form>

              <h3 style={{ fontSize: 16 }}>Apply aggregate erosion</h3>
              <p style={{ color: '#555', marginTop: 0 }}>
                Posts an idempotent erosion fact against the first limit on the policy; replaying the same
                claim/allocation/source version never double-counts.
              </p>
              <form onSubmit={submitErosion} style={gridStyle}>
                <label style={labelStyle}>
                  Claim ID
                  <input style={inputStyle} placeholder="Claim UUID" value={erosionForm.claimId} required
                         onChange={(e) => updateErosion('claimId', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Allocation ID
                  <input style={inputStyle} placeholder="Allocation UUID" value={erosionForm.allocationId} required
                         onChange={(e) => updateErosion('allocationId', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Source version
                  <input style={inputStyle} type="number" min="1" value={erosionForm.sourceVersion} required
                         onChange={(e) => updateErosion('sourceVersion', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Paid
                  <input style={inputStyle} type="number" min="0" step="0.01" value={erosionForm.paidAmount}
                         onChange={(e) => updateErosion('paidAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Reserved
                  <input style={inputStyle} type="number" min="0" step="0.01" value={erosionForm.reservedAmount}
                         onChange={(e) => updateErosion('reservedAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Recovered
                  <input style={inputStyle} type="number" min="0" step="0.01" value={erosionForm.recoveredAmount}
                         onChange={(e) => updateErosion('recoveredAmount', e.target.value)} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="submit" disabled={coverages.length === 0} style={buttonStyle}>
                    Apply erosion
                  </button>
                </div>
              </form>
            </section>
          )}

          {tab === 'endorsements' && (
            <section aria-label="Endorsements" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16 }}>Endorsements</h3>
              <table width="100%" cellPadding="8" style={tableStyle}>
                <thead>
                  <tr style={headRowStyle}>
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
                    <tr key={endorsement.id} style={{ borderTop: '1px solid #eee' }}>
                      <td>{endorsement.endorsementNumber}</td>
                      <td>{endorsement.endorsementType}</td>
                      <td>{endorsement.effectiveDate}</td>
                      <td>{endorsement.coverageImpact}</td>
                      <td>{endorsement.premiumDeltaAmount
                        ? formatMoney(endorsement.premiumDeltaAmount, endorsement.premiumDeltaCurrency) : '—'}</td>
                      <td>{endorsement.status}</td>
                    </tr>
                  ))}
                  {endorsements.length === 0 && (
                    <tr><td colSpan={6} style={emptyCellStyle}>No endorsements yet.</td></tr>
                  )}
                </tbody>
              </table>

              <h3 style={{ fontSize: 16 }}>Add endorsement</h3>
              <form onSubmit={submitEndorsement} style={gridStyle}>
                <label style={labelStyle}>
                  Type
                  <select style={inputStyle} value={endorsementForm.endorsementType}
                          onChange={(e) => updateEndorsement('endorsementType', e.target.value)}>
                    {['COVERAGE', 'LIMIT', 'PARTY', 'PREMIUM', 'RETENTION', 'EXCLUSION',
                      'TERRITORY', 'CORRECTION', 'MANUSCRIPT'].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Effective date
                  <input style={inputStyle} type="date" value={endorsementForm.effectiveDate} required
                         onChange={(e) => updateEndorsement('effectiveDate', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Description
                  <input style={inputStyle} value={endorsementForm.description} required
                         onChange={(e) => updateEndorsement('description', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Premium delta
                  <input style={inputStyle} type="number" step="0.01" value={endorsementForm.premiumDeltaAmount}
                         onChange={(e) => updateEndorsement('premiumDeltaAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Delta currency
                  <input style={inputStyle} maxLength={3} value={endorsementForm.premiumDeltaCurrency}
                         onChange={(e) => updateEndorsement('premiumDeltaCurrency', e.target.value.toUpperCase())} />
                </label>
                <label style={labelStyle}>
                  Coverage impact
                  <select style={inputStyle} value={endorsementForm.coverageImpact}
                          onChange={(e) => updateEndorsement('coverageImpact', e.target.value)}>
                    {['NONE', 'BROADEN', 'RESTRICT', 'CLARIFY'].map((impact) => (
                      <option key={impact} value={impact}>{impact}</option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Backdate reason (required before inception)
                  <input style={inputStyle} value={endorsementForm.backdateReason}
                         onChange={(e) => updateEndorsement('backdateReason', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Approver ID
                  <input style={inputStyle} placeholder="Approver UUID" value={endorsementForm.approvedBy}
                         onChange={(e) => updateEndorsement('approvedBy', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Approval reference
                  <input style={inputStyle} placeholder="Approval UUID" value={endorsementForm.approvalRef}
                         onChange={(e) => updateEndorsement('approvalRef', e.target.value)} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="submit" style={buttonStyle}>Add endorsement</button>
                </div>
              </form>
            </section>
          )}

          {tab === 'parties' && (
            <section aria-label="Insureds and locations" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16 }}>Insureds</h3>
              <table width="100%" cellPadding="8" style={tableStyle}>
                <thead>
                  <tr style={headRowStyle}>
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
                    <tr key={insured.id} style={{ borderTop: '1px solid #eee' }}>
                      <td><code>{String(insured.partyId || '').slice(0, 8)}…</code></td>
                      <td>{insured.insuredRole}</td>
                      <td>{insured.displayName}</td>
                      <td>{insured.effectiveFrom}</td>
                      <td>{insured.effectiveTo}</td>
                      <td>{insured.status}</td>
                    </tr>
                  ))}
                  {insureds.length === 0 && (
                    <tr><td colSpan={6} style={emptyCellStyle}>No insureds yet.</td></tr>
                  )}
                </tbody>
              </table>

              <form onSubmit={submitInsured} style={gridStyle}>
                <label style={labelStyle}>
                  Party ID
                  <input style={inputStyle} placeholder="Party UUID" value={insuredForm.partyId} required
                         onChange={(e) => updateInsured('partyId', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Role
                  <select style={inputStyle} value={insuredForm.insuredRole}
                          onChange={(e) => updateInsured('insuredRole', e.target.value)}>
                    {['NAMED_INSURED', 'ADDITIONAL_INSURED', 'INSURED_ORGANIZATION', 'LOSS_PAYEE',
                      'MORTGAGEE', 'LENDER', 'CERTIFICATE_HOLDER'].map((role) => (
                      <option key={role} value={role}>{role}</option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Display name
                  <input style={inputStyle} value={insuredForm.displayName} required
                         onChange={(e) => updateInsured('displayName', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Certificate number
                  <input style={inputStyle} value={insuredForm.certificateNumber}
                         onChange={(e) => updateInsured('certificateNumber', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Effective from
                  <input style={inputStyle} type="date" value={insuredForm.effectiveFrom} required
                         onChange={(e) => updateInsured('effectiveFrom', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Effective to
                  <input style={inputStyle} type="date" value={insuredForm.effectiveTo} required
                         onChange={(e) => updateInsured('effectiveTo', e.target.value)} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="submit" style={buttonStyle}>Add insured</button>
                </div>
              </form>

              <h3 style={{ fontSize: 16 }}>Locations</h3>
              <table width="100%" cellPadding="8" style={tableStyle}>
                <thead>
                  <tr style={headRowStyle}>
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
                    <tr key={location.id} style={{ borderTop: '1px solid #eee' }}>
                      <td>{location.locationCode}</td>
                      <td>{location.addressLine1}</td>
                      <td>{location.city}</td>
                      <td>{location.stateRegion}</td>
                      <td>{location.country}</td>
                      <td>{location.status}</td>
                    </tr>
                  ))}
                  {locations.length === 0 && (
                    <tr><td colSpan={6} style={emptyCellStyle}>No locations yet.</td></tr>
                  )}
                </tbody>
              </table>

              <form onSubmit={submitLocation} style={gridStyle}>
                <label style={labelStyle}>
                  Location code
                  <input style={inputStyle} value={locationForm.locationCode} required
                         onChange={(e) => updateLocation('locationCode', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Address line 1
                  <input style={inputStyle} value={locationForm.addressLine1} required
                         onChange={(e) => updateLocation('addressLine1', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  City
                  <input style={inputStyle} value={locationForm.city} required
                         onChange={(e) => updateLocation('city', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  State / region
                  <input style={inputStyle} placeholder="US-OH" value={locationForm.stateRegion} required
                         onChange={(e) => updateLocation('stateRegion', e.target.value.toUpperCase())} />
                </label>
                <label style={labelStyle}>
                  Postal code
                  <input style={inputStyle} value={locationForm.postalCode}
                         onChange={(e) => updateLocation('postalCode', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Country
                  <input style={inputStyle} maxLength={3} value={locationForm.country} required
                         onChange={(e) => updateLocation('country', e.target.value.toUpperCase())} />
                </label>
                <label style={labelStyle}>
                  Effective from
                  <input style={inputStyle} type="date" value={locationForm.effectiveFrom} required
                         onChange={(e) => updateLocation('effectiveFrom', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Effective to
                  <input style={inputStyle} type="date" value={locationForm.effectiveTo} required
                         onChange={(e) => updateLocation('effectiveTo', e.target.value)} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="submit" style={buttonStyle}>Add location</button>
                </div>
              </form>
            </section>
          )}

          {tab === 'cancellation' && (
            <section aria-label="Cancellation and reinstatement" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 16 }}>Cancellations</h3>
              <table width="100%" cellPadding="8" style={tableStyle}>
                <thead>
                  <tr style={headRowStyle}>
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
                    <tr key={cancellation.id} style={{ borderTop: '1px solid #eee' }}>
                      <td>{cancellation.cancellationType}</td>
                      <td>{cancellation.reason}</td>
                      <td>{cancellation.effectiveDate}</td>
                      <td>{formatMoney(cancellation.returnPremiumAmount, cancellation.premiumCurrency)}</td>
                      <td>{formatPercent(cancellation.proRataPct)}</td>
                      <td>{cancellation.status}</td>
                    </tr>
                  ))}
                  {cancellations.length === 0 && (
                    <tr><td colSpan={6} style={emptyCellStyle}>No cancellations.</td></tr>
                  )}
                </tbody>
              </table>

              <form onSubmit={submitCancel} style={gridStyle}>
                <label style={labelStyle}>
                  Cancellation type
                  <select style={inputStyle} value={cancelForm.cancellationType}
                          onChange={(e) => updateCancel('cancellationType', e.target.value)}>
                    {['PRO_RATA', 'FLAT', 'SHORT_RATE', 'NON_PAYMENT', 'VOID'].map((type) => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </label>
                <label style={labelStyle}>
                  Reason
                  <input style={inputStyle} value={cancelForm.reason} required
                         onChange={(e) => updateCancel('reason', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Effective date
                  <input style={inputStyle} type="date" value={cancelForm.effectiveDate} required
                         onChange={(e) => updateCancel('effectiveDate', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Notice days
                  <input style={inputStyle} type="number" min="0" value={cancelForm.noticeDays}
                         onChange={(e) => updateCancel('noticeDays', e.target.value)} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="submit" style={buttonStyle}>Cancel policy</button>
                </div>
              </form>

              <h3 style={{ fontSize: 16 }}>Reinstatements</h3>
              <table width="100%" cellPadding="8" style={tableStyle}>
                <thead>
                  <tr style={headRowStyle}>
                    <th>Effective</th>
                    <th>Reason</th>
                    <th>Premium evidence</th>
                    <th>Amount</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {reinstatements.map((reinstatement) => (
                    <tr key={reinstatement.id} style={{ borderTop: '1px solid #eee' }}>
                      <td>{reinstatement.effectiveDate}</td>
                      <td>{reinstatement.reason}</td>
                      <td>{reinstatement.premiumEvidenceRef}</td>
                      <td>{formatMoney(reinstatement.premiumEvidenceAmount, reinstatement.premiumEvidenceCurrency)}</td>
                      <td>{reinstatement.status}</td>
                    </tr>
                  ))}
                  {reinstatements.length === 0 && (
                    <tr><td colSpan={5} style={emptyCellStyle}>No reinstatements.</td></tr>
                  )}
                </tbody>
              </table>

              <form onSubmit={submitReinstate} style={gridStyle}>
                <label style={labelStyle}>
                  Effective date
                  <input style={inputStyle} type="date" value={reinstateForm.effectiveDate} required
                         onChange={(e) => updateReinstate('effectiveDate', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Reason
                  <input style={inputStyle} value={reinstateForm.reason} required
                         onChange={(e) => updateReinstate('reason', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Approver ID
                  <input style={inputStyle} placeholder="Approver UUID" value={reinstateForm.approvedBy} required
                         onChange={(e) => updateReinstate('approvedBy', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Approval reference
                  <input style={inputStyle} placeholder="Approval UUID" value={reinstateForm.approvalRef} required
                         onChange={(e) => updateReinstate('approvalRef', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Premium evidence reference
                  <input style={inputStyle} value={reinstateForm.premiumEvidenceRef} required
                         onChange={(e) => updateReinstate('premiumEvidenceRef', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Evidence amount
                  <input style={inputStyle} type="number" min="0" step="0.01" value={reinstateForm.premiumEvidenceAmount}
                         required onChange={(e) => updateReinstate('premiumEvidenceAmount', e.target.value)} />
                </label>
                <label style={labelStyle}>
                  Evidence currency
                  <input style={inputStyle} maxLength={3} value={reinstateForm.premiumEvidenceCurrency} required
                         onChange={(e) => updateReinstate('premiumEvidenceCurrency', e.target.value.toUpperCase())} />
                </label>
                <div style={{ display: 'flex', alignItems: 'end' }}>
                  <button type="submit" style={buttonStyle}>Reinstate policy</button>
                </div>
              </form>
            </section>
          )}
        </section>
      )}
    </main>
  );
}

function Field({ label, value }) {
  return (
    <div>
      <dt style={{ fontSize: 12, color: '#666', fontWeight: 600 }}>{label}</dt>
      <dd style={{ margin: '2px 0 0', fontSize: 14 }}>{value}</dd>
    </div>
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

const gridStyle = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' };
const definitionGridStyle = { display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', margin: '14px 0' };
const labelStyle = { display: 'grid', gap: 4, fontSize: 13, fontWeight: 600, color: '#333' };
const inputStyle = { padding: '8px 10px', border: '1px solid #bbb', borderRadius: 6, fontSize: 14, fontWeight: 400 };
const buttonStyle = { padding: '9px 16px', border: 0, borderRadius: 6, background: '#0b5fff', color: 'white', fontWeight: 600, cursor: 'pointer' };
const linkButtonStyle = { padding: '4px 10px', border: '1px solid #0b5fff', borderRadius: 6, background: 'white', color: '#0b5fff', fontWeight: 600, cursor: 'pointer' };
const tableStyle = { borderCollapse: 'collapse', fontSize: 13, marginBottom: 14 };
const headRowStyle = { textAlign: 'left', borderBottom: '2px solid #ddd' };
const emptyCellStyle = { padding: 12, color: '#666' };
const activeTabStyle = { padding: '7px 12px', border: '1px solid #0b5fff', borderRadius: 999, background: '#0b5fff', color: 'white', fontWeight: 600, cursor: 'pointer' };
const inactiveTabStyle = { padding: '7px 12px', border: '1px solid #bbb', borderRadius: 999, background: 'white', color: '#333', fontWeight: 600, cursor: 'pointer' };

function statusStyle(status) {
  const colors = {
    DRAFT: ['#eee', '#333'],
    QUOTED: ['#e8f0ff', '#0b3d91'],
    BOUND: ['#fff4d6', '#7a5300'],
    ISSUED: ['#e6f4ea', '#1e6b35'],
    IN_FORCE: ['#d7f5e0', '#145c2c'],
    ENDORSED: ['#ede7ff', '#4b2ba8'],
    CANCELLED: ['#fde8e8', '#a11717'],
    REINSTATED: ['#e6f4ea', '#1e6b35'],
    EXPIRED: ['#ececec', '#555'],
    NON_RENEWED: ['#fde8e8', '#a11717'],
    VOID: ['#f3d6d6', '#7a0000']
  };
  const [background, color] = colors[status] || ['#eee', '#333'];
  return { background, color, borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 700 };
}
