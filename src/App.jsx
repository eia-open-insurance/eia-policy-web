import React, { useEffect, useState } from 'react';

const TENANT = '11111111-1111-7111-8111-111111111111';

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

export default function App() {
  const [policies, setPolicies] = useState([]);
  const [form, setForm] = useState(initialForm);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    const response = await fetch('/api/v1/policies', {
      headers: { 'X-EIA-Tenant': TENANT }
    });
    if (!response.ok) throw new Error(`Load failed: ${response.status}`);
    setPolicies(await response.json());
  }

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, []);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError('');
    setSaving(true);
    try {
      const payload = {
        ...form,
        policyNumber: form.policyNumber.trim() || undefined
      };
      const response = await fetch('/api/v1/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-EIA-Tenant': TENANT },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        setError(body?.message || `Create failed: ${response.status}`);
        return;
      }
      setForm((current) => ({ ...current, policyNumber: '' }));
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 24, maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ marginBottom: 4 }}>Policy</h1>
      <p style={{ marginTop: 0, color: '#555' }}>
        Direct policies, terms, and lifecycle state. New policies start in DRAFT and advance through the issued lifecycle.
      </p>

      {error && <p role="alert" style={{ color: '#b00020', fontWeight: 600 }}>{error}</p>}

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
              </tr>
            </thead>
            <tbody>
              {policies.map((policy) => (
                <tr key={policy.id} style={{ borderTop: '1px solid #eee' }}>
                  <td>{policy.policyNumber}</td>
                  <td>{policy.productCode}</td>
                  <td><span style={statusStyle(policy.status)}>{policy.status}</span></td>
                  <td>{policy.effectiveDate}</td>
                  <td>{policy.expirationDate}</td>
                  <td>{formatMoney(policy.premiumAmount, policy.premiumCurrency)}</td>
                  <td>{formatMoney(policy.limitAmount, policy.limitCurrency)}</td>
                  <td>{policy.version}</td>
                </tr>
              ))}
              {policies.length === 0 && (
                <tr>
                  <td colSpan={8} style={{ padding: 16, color: '#666' }}>No policies yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

const labelStyle = { display: 'grid', gap: 4, fontSize: 13, fontWeight: 600, color: '#333' };
const inputStyle = { padding: '8px 10px', border: '1px solid #bbb', borderRadius: 6, fontSize: 14, fontWeight: 400 };
const buttonStyle = { padding: '9px 16px', border: 0, borderRadius: 6, background: '#0b5fff', color: 'white', fontWeight: 600, cursor: 'pointer' };

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
