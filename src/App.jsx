import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';
const PAGE_SIZE = 20;
const NEXT_STATUS = {
  DRAFT: 'QUOTED',
  QUOTED: 'BOUND',
  BOUND: 'ISSUED',
  ISSUED: 'IN_FORCE',
  IN_FORCE: 'ENDORSED',
  ENDORSED: 'IN_FORCE'
};

function isoDate(yearOffset) {
  const date = new Date();
  date.setFullYear(date.getFullYear() + yearOffset);
  return date.toISOString().slice(0, 10);
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

  async function load(pageToLoad = 0) {
    setLoading(true);
    try {
      const response = await fetch(`/api/v1/policies?page=${pageToLoad}&size=${PAGE_SIZE}`, {
        headers: { 'X-EIA-Tenant': TENANT }
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(problemMessage(body, `Load failed: ${response.status}`));
        return;
      }
      const envelope = Array.isArray(body) ? null : body;
      const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
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
      const response = await fetch('/api/v1/policies', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-EIA-Tenant': TENANT,
          'Idempotency-Key': newIdempotencyKey()
        },
        body: JSON.stringify(payload)
      });
      const body = await readJson(response);
      if (!response.ok) {
        setError(problemMessage(body, `Create failed: ${response.status}`));
        return;
      }
      const replayed = response.headers.get('Idempotent-Replayed') === 'true' || response.status === 200;
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

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>Policy</h1>
      <p style={{ marginTop: 0, color: '#555' }}>
        Direct policies, terms, and lifecycle state. New policies start in DRAFT and advance through the issued lifecycle.
      </p>

      {error && <p role="alert" style={{ color: '#b00020', fontWeight: 600 }}>{error}</p>}
      {notice && <p role="status" style={{ color: '#145c2c', fontWeight: 600 }}>{notice}</p>}

      <section aria-label="Create policy" style={{ marginBottom: 28 }}>
        <h2 style={{ fontSize: 18 }}>Create policy</h2>
        <form onSubmit={submit} style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
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

      <section aria-label="Policies">
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
                <th>Action</th>
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
                    <td>
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
    </main>
  );
}

const labelStyle = { display: 'grid', gap: 4, fontSize: 13, fontWeight: 600, color: '#333' };
const inputStyle = { padding: '8px 10px', border: '1px solid #bbb', borderRadius: 6, fontSize: 14, fontWeight: 400 };
const buttonStyle = { padding: '9px 16px', border: 0, borderRadius: 6, background: '#0b5fff', color: 'white', fontWeight: 600, cursor: 'pointer' };
const linkButtonStyle = { padding: '4px 10px', border: '1px solid #0b5fff', borderRadius: 6, background: 'white', color: '#0b5fff', fontWeight: 600, cursor: 'pointer' };

function statusStyle(status) {
  const colors = {
    DRAFT: ['#eee', '#333'],
    QUOTED: ['#e8f0ff', '#0b3d91'],
    BOUND: ['#fff4d6', '#7a5300'],
    ISSUED: ['#e6f4ea', '#1e6b35'],
    IN_FORCE: ['#d7f5e0', '#145c2c'],
    ENDORSED: ['#ede7ff', '#4b2ba8'],
    CANCELLED: ['#fde8e8', '#a11717'],
    EXPIRED: ['#ececec', '#555'],
    NON_RENEWED: ['#fde8e8', '#a11717'],
    VOID: ['#f3d6d6', '#7a0000']
  };
  const [background, color] = colors[status] || ['#eee', '#333'];
  return { background, color, borderRadius: 999, padding: '2px 9px', fontSize: 12, fontWeight: 700 };
}
