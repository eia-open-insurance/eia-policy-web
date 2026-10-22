import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, problemMessage } from './api.js';
import {
  normalizeProductList,
  productDisplayLabel,
  productKey,
  productStatusTone,
  productsEndpoint
} from './products.js';

/**
 * Read-only product catalog panel.
 *
 * It reads the same active catalog as the policy/submission pickers, so an
 * operator can verify a code and name before starting a record. Product
 * creation is deliberately not offered here: the catalog is curated by the
 * Policy domain and this read slice exposes GET only. When the catalog is
 * empty the create forms fall back to manual code entry.
 */
export default function ProductCatalog() {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const load = useCallback(async (term = '') => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const { response, body } = await api(productsEndpoint(term));
      if (requestId !== requestRef.current) return;
      if (!response.ok) {
        setError(problemMessage(body, `Product catalog read failed: ${response.status}`));
        setItems([]);
        setSelectedKey('');
        return;
      }
      const products = normalizeProductList(body);
      setItems(products);
      setSelectedKey((current) => (
        products.some((product) => productKey(product) === current)
          ? current
          : (products[0] ? productKey(products[0]) : '')
      ));
    } catch (e) {
      if (requestId === requestRef.current) {
        setError(e.message);
        setItems([]);
        setSelectedKey('');
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      load(query).catch(() => {});
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, load]);

  const selected = items.find((product) => productKey(product) === selectedKey) || null;
  const filterActive = Boolean(query.trim());

  return (
    <section className="eia-products" data-testid="products-workspace">
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Policy · Product catalog</div>
          <h1>Product catalog</h1>
          <p className="subtitle">
            The active products that new policies and submissions can use. Search by code or
            name, then open a product to verify its catalog details.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge direct">ACTIVE CATALOG</span>
          <button
            type="button"
            className="eia-btn-ghost"
            data-testid="refresh-products"
            onClick={() => load(query).catch(() => {})}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      <section
        className="eia-context-panel"
        aria-label="Product catalog context"
        data-testid="products-context"
      >
        <h4>Products are the policy and submission taxonomy</h4>
        <p>
          <b>The catalog is curated by the Policy domain.</b> Both create forms read the same{' '}
          <code>GET /api/v1/products?q=…&amp;status=ACTIVE</code> lookup, so a product selected
          here matches the code stored on a policy or submission.
        </p>
        <p>
          <b>This panel is read-only.</b> It shows active products only. If the catalog is empty
          or unavailable, the create forms fall back to manual product-code entry.
        </p>
      </section>

      <section className="eia-submission-search" aria-label="Product search">
        <div className="eia-search-box">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
            <path d="m20 20-3.4-3.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search products by code or name…"
            aria-label="Search products"
            autoComplete="off"
          />
          {filterActive && (
            <button
              type="button"
              className="eia-queue-clear"
              onClick={() => setQuery('')}
            >
              Clear
            </button>
          )}
        </div>
      </section>

      <p className="eia-muted eia-submission-filter-meta" data-testid="products-filter-meta">
        {loading
          ? 'Loading active products…'
          : `${items.length} active ${items.length === 1 ? 'product' : 'products'}${
            filterActive ? ' match the search' : ''
          }`}
      </p>

      {error && (
        <section
          className="eia-card eia-submission-load-error"
          role="alert"
          data-testid="products-load-error"
        >
          <p>{error}</p>
          <button type="button" className="eia-btn-secondary" onClick={() => load(query)}>
            Retry
          </button>
        </section>
      )}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Active product catalog">
          <div className="eia-record-list-head">
            <strong>Active products</strong>
            <span className="eia-muted">{items.length}</span>
          </div>
          {loading && items.length === 0 && <div className="empty">Loading products…</div>}
          {!loading && !error && items.length === 0 && (
            <div className="empty" data-testid="products-empty">
              {filterActive
                ? 'No active products match the search.'
                : 'No active products are configured. The create forms accept a manual product code.'}
            </div>
          )}
          {items.map((product) => {
            const key = productKey(product);
            const isSelected = key === selectedKey;
            return (
              <button
                key={key || product.code}
                type="button"
                className={isSelected ? 'selected' : ''}
                aria-pressed={isSelected}
                aria-label={`Open product ${product.code || product.name}`}
                onClick={() => setSelectedKey(key)}
              >
                <span className="record-primary">{product.code || product.name}</span>
                <span className="record-secondary">{productDisplayLabel(product)}</span>
                <span>
                  <span className={`eia-pill ${productStatusTone(product.status)}`}>
                    {product.status || '—'}
                  </span>
                </span>
              </button>
            );
          })}
        </aside>

        <section className="eia-record-panel" aria-label="Product detail" data-testid="product-detail">
          {selected ? (
            <>
              <header className="eia-record-title">
                <div>
                  <div className="eyebrow">Product</div>
                  <h2>{selected.code || selected.name}</h2>
                  <p className="eia-record-subtitle">{selected.name}</p>
                </div>
                <span className={`eia-pill ${productStatusTone(selected.status)}`}>
                  {selected.status || '—'}
                </span>
              </header>
              <section className="eia-card" style={{ marginTop: 14 }}>
                <dl className="eia-kv">
                  <dt>Product code</dt>
                  <dd className="eia-mono" data-testid="product-detail-code">{selected.code || '—'}</dd>
                  <dt>Name</dt>
                  <dd data-testid="product-detail-name">{selected.name || '—'}</dd>
                  <dt>Status</dt>
                  <dd>{selected.status || '—'}</dd>
                  {selected.productType && (
                    <>
                      <dt>Type</dt>
                      <dd>{selected.productType}</dd>
                    </>
                  )}
                  {selected.description && (
                    <>
                      <dt>Description</dt>
                      <dd>{selected.description}</dd>
                    </>
                  )}
                  <dt>Catalog id</dt>
                  <dd className="eia-mono">{selected.id || '—'}</dd>
                </dl>
              </section>
              <section className="eia-context-panel" style={{ marginTop: 14 }}>
                <h4>Selection stores the product code</h4>
                <p>
                  A new policy or submission stores <b>{selected.code}</b> as its{' '}
                  <code>productCode</code>. The catalog name is presentation only; changing this
                  catalog record does not rewrite an existing policy or submission.
                </p>
              </section>
            </>
          ) : (
            <section className="eia-card">
              <p className="eia-muted" style={{ margin: 0 }}>
                {loading
                  ? 'Loading the product catalog…'
                  : error
                    ? 'The catalog could not be read. Retry above to try again.'
                    : 'Select a product to inspect its catalog details.'}
              </p>
            </section>
          )}
        </section>
      </div>
    </section>
  );
}
