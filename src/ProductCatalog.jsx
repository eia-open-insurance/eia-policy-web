import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, problemMessage } from './api.js';
import {
  MAX_PRODUCT_CODE_LENGTH,
  MAX_PRODUCT_NAME_LENGTH,
  PRODUCT_JURISDICTION_LENGTH,
  PRODUCT_LINES,
  PRODUCT_STATUS,
  PRODUCT_STATUS_FILTERS,
  defaultProductForm,
  normalizeProduct,
  normalizeProductList,
  productCreateEndpoint,
  productCreatePayload,
  productDisplayLabel,
  productKey,
  productLineLabel,
  productStatusEndpoint,
  productStatusTone,
  productsEndpoint,
  validateProductCreateForm
} from './products.js';

/**
 * Product catalog panel.
 *
 * The catalog is the taxonomy new policies and submissions select from. This
 * panel is the catalog-management surface: it lists every product (ACTIVE and
 * RETIRED), creates new products, and retires or reactivates an existing one.
 *
 * Retiring is deliberately not a delete. The status toggle only removes a
 * product from the create-form pickers; the product code stored on existing
 * policies and submissions stays valid and those records are never rewritten.
 *
 * The list read is `GET /api/v1/products?q=…&status=…`, with `status` omitted
 * for the "All" filter. The create and status commands are POST
 * `/api/v1/products` and PATCH `/api/v1/products/{id}/status`.
 */
export default function ProductCatalog() {
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [items, setItems] = useState([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const requestRef = useRef(0);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState(defaultProductForm);
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);

  const [statusChange, setStatusChange] = useState(null);
  const [statusError, setStatusError] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);

  const load = useCallback(async (term = '', status = '', preferredKey = '') => {
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setLoading(true);
    setError('');
    try {
      const { response, body } = await api(productsEndpoint(term, status));
      if (requestId !== requestRef.current) return;
      if (!response.ok) {
        setError(problemMessage(body, `Product catalog read failed: ${response.status}`));
        setItems([]);
        setSelectedKey('');
        return;
      }
      const products = normalizeProductList(body);
      setItems(products);
      setSelectedKey((current) => {
        const wanted = preferredKey || current;
        if (wanted && products.some((product) => productKey(product) === wanted)) {
          return wanted;
        }
        return products[0] ? productKey(products[0]) : '';
      });
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
      load(query, statusFilter).catch(() => {});
    }, 180);
    return () => window.clearTimeout(timer);
  }, [query, statusFilter, load]);

  useEffect(() => {
    if (!createOpen && !statusChange) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || creating || statusBusy) return;
      if (createOpen) setCreateOpen(false);
      if (statusChange) setStatusChange(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [createOpen, statusChange, creating, statusBusy]);

  const selected = items.find((product) => productKey(product) === selectedKey) || null;
  const filterActive = Boolean(query.trim() || statusFilter);
  const isRetired = selected?.status === PRODUCT_STATUS.RETIRED;
  const canChangeStatus = Boolean(selected?.id)
    && (selected.status === PRODUCT_STATUS.ACTIVE || isRetired);
  const statusScope = statusFilter || 'all statuses';

  function openCreateDialog() {
    setCreateForm(defaultProductForm());
    setCreateError('');
    setNotice('');
    setCreateOpen(true);
  }

  function closeCreateDialog() {
    if (!creating) setCreateOpen(false);
  }

  function updateCreateForm(field, value) {
    setCreateForm((current) => ({ ...current, [field]: value }));
    setCreateError('');
  }

  async function submitCreate(event) {
    event.preventDefault();
    if (creating) return;
    const validation = validateProductCreateForm(createForm);
    if (validation) {
      setCreateError(validation);
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const { response, body } = await api(productCreateEndpoint(), {
        method: 'POST',
        body: productCreatePayload(createForm)
      });
      if (!response.ok) {
        // A duplicate code is a canonical 409. It stays in this dialog so the
        // operator can correct the code without losing the rest of the form.
        setCreateError(problemMessage(body, `Product creation failed: ${response.status}`));
        return;
      }
      const created = normalizeProduct(body);
      setCreateOpen(false);
      setQuery('');
      setStatusFilter('');
      setNotice(created
        ? `Created ${created.code}. It is ACTIVE and selectable on new policies and submissions.`
        : 'Product created. The catalog was refreshed.');
      await load('', '', created ? productKey(created) : '');
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreating(false);
    }
  }

  function requestStatusChange(product) {
    if (!product?.id) return;
    const target = product.status === PRODUCT_STATUS.RETIRED
      ? PRODUCT_STATUS.ACTIVE
      : PRODUCT_STATUS.RETIRED;
    setStatusError('');
    setNotice('');
    setStatusChange({ product, target });
  }

  function closeStatusChange() {
    if (!statusBusy) setStatusChange(null);
  }

  async function confirmStatusChange() {
    if (!statusChange || statusBusy) return;
    const { product, target } = statusChange;
    setStatusBusy(true);
    setStatusError('');
    try {
      const { response, body } = await api(productStatusEndpoint(product.id), {
        method: 'PATCH',
        body: { status: target }
      });
      if (!response.ok) {
        setStatusError(problemMessage(body, `Status update failed: ${response.status}`));
        // A concurrent change means this snapshot is stale; re-read it so the
        // dialog can be closed and the action retried from the current status.
        if (response.status === 409) await load(query, statusFilter);
        return;
      }
      const updated = normalizeProduct(body);
      setStatusChange(null);
      setNotice(updated
        ? target === PRODUCT_STATUS.RETIRED
          ? `${updated.code} retired. New policies and submissions can no longer select it; existing policies and submissions are unchanged.`
          : `${updated.code} reactivated. New policies and submissions can select it again.`
        : 'Product status updated. The catalog was refreshed.');
      await load(query, statusFilter, updated ? productKey(updated) : '');
    } catch (e) {
      setStatusError(e.message);
    } finally {
      setStatusBusy(false);
    }
  }

  return (
    <section className="eia-products" data-testid="products-workspace">
      <header className="eia-page-head">
        <div>
          <div className="eyebrow">Policy · Product catalog</div>
          <h1>Product catalog</h1>
          <p className="subtitle">
            Create the products that new policies and submissions can use, and retire products
            that are no longer offered. Only ACTIVE products appear in the create-form pickers.
          </p>
        </div>
        <div className="eia-actions">
          <span className="eia-badge direct">PRODUCT CATALOG</span>
          <button type="button" data-testid="new-product" onClick={openCreateDialog}>
            New product
          </button>
          <button
            type="button"
            className="eia-btn-ghost"
            data-testid="refresh-products"
            onClick={() => load(query, statusFilter).catch(() => {})}
            disabled={loading}
          >
            Refresh
          </button>
        </div>
      </header>

      {notice && (
        <p role="status" data-testid="products-notice">
          {notice}
        </p>
      )}

      <section
        className="eia-context-panel"
        aria-label="Product catalog context"
        data-testid="products-context"
      >
        <h4>Products are the policy and submission taxonomy</h4>
        <p>
          <b>Only ACTIVE products can be selected on a new record.</b> Both create forms read the
          same <code>GET /api/v1/products?q=…&amp;status=ACTIVE</code> lookup, so a product selected
          here matches the code stored on a policy or submission.
        </p>
        <p>
          <b>Retiring a product stops new selection.</b> It removes the product from the pickers
          used by new policies and submissions, but it does not change existing records: every
          policy and submission that already stores the code keeps its product, coverage, limits,
          premium, billing, and lifecycle unchanged.
        </p>
        <p>
          <b>Status is reversible.</b> Reactivate a retired product to make it selectable again.
          Use the status filter to review retired products; the default All view lists the whole
          catalog.
        </p>
      </section>

      <section className="eia-submission-search" aria-label="Product search and filters">
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
              data-testid="products-clear"
              onClick={() => {
                setQuery('');
                setStatusFilter('');
              }}
            >
              Clear
            </button>
          )}
        </div>
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter products by status"
          data-testid="products-status-filter"
        >
          {PRODUCT_STATUS_FILTERS.map((option) => (
            <option key={option.value || 'ALL'} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </section>

      <p className="eia-muted eia-submission-filter-meta" data-testid="products-filter-meta">
        {loading
          ? 'Loading products…'
          : `${items.length} ${items.length === 1 ? 'product' : 'products'} · ${statusScope}${
            query.trim() ? ' · search applied' : ''
          }`}
      </p>

      {error && (
        <section
          className="eia-card eia-submission-load-error"
          role="alert"
          data-testid="products-load-error"
        >
          <p>{error}</p>
          <button
            type="button"
            className="eia-btn-secondary"
            onClick={() => load(query, statusFilter)}
          >
            Retry
          </button>
        </section>
      )}

      <div className="eia-record-layout">
        <aside className="eia-record-list" aria-label="Product catalog">
          <div className="eia-record-list-head">
            <strong>Products</strong>
            <span className="eia-muted">{items.length}</span>
          </div>
          {loading && items.length === 0 && <div className="empty">Loading products…</div>}
          {!loading && !error && items.length === 0 && (
            <div className="empty" data-testid="products-empty">
              {filterActive
                ? 'No products match the current search and status filter.'
                : 'No products are configured. Create the first product to start the catalog.'}
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
                <div className="eia-actions">
                  <span
                    className={`eia-pill ${productStatusTone(selected.status)}`}
                    data-testid="product-detail-status"
                  >
                    {selected.status || '—'}
                  </span>
                  {canChangeStatus && (isRetired ? (
                    <button
                      type="button"
                      className="eia-btn-secondary"
                      data-testid="reactivate-product"
                      onClick={() => requestStatusChange(selected)}
                    >
                      Reactivate
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="eia-btn-danger"
                      data-testid="retire-product"
                      onClick={() => requestStatusChange(selected)}
                    >
                      Retire
                    </button>
                  ))}
                </div>
              </header>
              <section className="eia-card" style={{ marginTop: 14 }}>
                <dl className="eia-kv">
                  <dt>Product code</dt>
                  <dd className="eia-mono" data-testid="product-detail-code">{selected.code || '—'}</dd>
                  <dt>Name</dt>
                  <dd data-testid="product-detail-name">{selected.name || '—'}</dd>
                  <dt>Product line</dt>
                  <dd data-testid="product-detail-line">
                    {productLineLabel(selected.productLine)}
                    {selected.productLine ? ` (${selected.productLine})` : ''}
                  </dd>
                  <dt>Jurisdiction</dt>
                  <dd className="eia-mono" data-testid="product-detail-jurisdiction">
                    {selected.jurisdiction || '—'}
                  </dd>
                  <dt>Status</dt>
                  <dd>{selected.status || '—'}</dd>
                  {selected.version !== null && (
                    <>
                      <dt>Version</dt>
                      <dd className="eia-mono">{selected.version}</dd>
                    </>
                  )}
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

              {isRetired ? (
                <section
                  className="eia-context-panel eia-product-retired-note"
                  style={{ marginTop: 14 }}
                  data-testid="product-retired-note"
                >
                  <h4>Retired product</h4>
                  <p>
                    <b>{selected.code}</b> cannot be selected on new policies or submissions.
                    Existing policies and submissions that already store this code are unchanged;
                    their coverage, limits, premium, billing, and lifecycle stay as they are.
                  </p>
                  <p>Reactivate this product to make it selectable again.</p>
                </section>
              ) : (
                <section
                  className="eia-context-panel"
                  style={{ marginTop: 14 }}
                  data-testid="product-active-note"
                >
                  <h4>Selectable on new records</h4>
                  <p>
                    New policies and submissions can select <b>{selected.code}</b>. Retiring the
                    product later removes it from those pickers without changing any record that
                    already stores the code.
                  </p>
                </section>
              )}

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

      {createOpen && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal eia-product-create-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-create-dialog-title"
            aria-describedby="product-create-dialog-description"
            data-testid="product-create-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="product-create-dialog-title">Create product</h2>
              <span className="eia-badge">CATALOG</span>
            </div>
            <p className="eia-modal-lede" id="product-create-dialog-description">
              Add a product to the catalog. The new product is ACTIVE and immediately selectable
              on new policies and submissions; the code is upper-cased and must be unique for the
              tenant.
            </p>

            {createError && (
              <p role="alert" className="eia-modal-error" data-testid="product-create-error">
                {createError}
              </p>
            )}

            <form className="eia-form-grid" onSubmit={submitCreate}>
              <div className="eia-field span-2">
                <label htmlFor="product-code">Product code</label>
                <input
                  id="product-code"
                  value={createForm.productCode}
                  maxLength={MAX_PRODUCT_CODE_LENGTH}
                  placeholder="e.g. CGL"
                  autoComplete="off"
                  autoFocus
                  onChange={(event) => updateCreateForm(
                    'productCode',
                    event.target.value.toUpperCase()
                  )}
                />
                <span className="eia-field-hint">
                  Stored on new policies and submissions. At most {MAX_PRODUCT_CODE_LENGTH}{' '}
                  characters.
                </span>
              </div>
              <div className="eia-field">
                <label htmlFor="product-line">Product line</label>
                <select
                  id="product-line"
                  value={createForm.productLine}
                  onChange={(event) => updateCreateForm('productLine', event.target.value)}
                >
                  <option value="">Select a product line</option>
                  {PRODUCT_LINES.map((line) => (
                    <option key={line.value} value={line.value}>{line.label}</option>
                  ))}
                </select>
              </div>
              <div className="eia-field span-2">
                <label htmlFor="product-name">Product name</label>
                <input
                  id="product-name"
                  value={createForm.productName}
                  maxLength={MAX_PRODUCT_NAME_LENGTH}
                  placeholder="e.g. Commercial General Liability"
                  autoComplete="off"
                  onChange={(event) => updateCreateForm('productName', event.target.value)}
                />
              </div>
              <div className="eia-field">
                <label htmlFor="product-jurisdiction">Jurisdiction</label>
                <input
                  id="product-jurisdiction"
                  value={createForm.jurisdiction}
                  maxLength={PRODUCT_JURISDICTION_LENGTH}
                  placeholder="e.g. US"
                  autoComplete="off"
                  onChange={(event) => updateCreateForm(
                    'jurisdiction',
                    event.target.value.toUpperCase()
                  )}
                />
                <span className="eia-field-hint">
                  Two-letter ISO 3166-1 alpha-2 country code.
                </span>
              </div>
              <div className="eia-field span-3 eia-modal-actions">
                <button
                  type="button"
                  className="eia-btn-secondary"
                  onClick={closeCreateDialog}
                  disabled={creating}
                >
                  Cancel
                </button>
                <button type="submit" data-testid="submit-product" disabled={creating}>
                  {creating ? 'Creating product…' : 'Create product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {statusChange && (
        <div className="eia-modal-backdrop">
          <div
            className="eia-modal eia-product-status-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-status-dialog-title"
            aria-describedby="product-status-dialog-description"
            data-testid="product-status-dialog"
          >
            <div className="eia-section-title" style={{ marginTop: 0 }}>
              <h2 id="product-status-dialog-title">
                {statusChange.target === PRODUCT_STATUS.RETIRED
                  ? `Retire ${statusChange.product.code}?`
                  : `Reactivate ${statusChange.product.code}?`}
              </h2>
              <span className={`eia-pill ${productStatusTone(statusChange.product.status)}`}>
                {statusChange.product.status}
              </span>
            </div>
            <p className="eia-modal-lede" id="product-status-dialog-description">
              {statusChange.target === PRODUCT_STATUS.RETIRED
                ? `Retiring ${statusChange.product.code} stops new policies and submissions from selecting it. Existing policies and submissions that already store ${statusChange.product.code} are unchanged.`
                : `Reactivating ${statusChange.product.code} makes it selectable again on new policies and submissions. Existing policies and submissions are unchanged.`}
            </p>

            <section className="eia-context-panel" style={{ marginTop: 14 }}>
              <h4>
                {statusChange.target === PRODUCT_STATUS.RETIRED
                  ? 'What retiring does not change'
                  : 'What reactivating changes'}
              </h4>
              <p>
                {statusChange.target === PRODUCT_STATUS.RETIRED
                  ? 'Coverage, limits, premium, billing, lifecycle, and every other fact on an existing policy or submission stay exactly as they are. Only the pickers used for new records change.'
                  : 'The product becomes available to the create-form pickers again. No existing policy or submission is amended.'}
              </p>
            </section>

            {statusError && (
              <p role="alert" className="eia-modal-error" data-testid="product-status-error">
                {statusError}
              </p>
            )}

            <div className="eia-modal-actions" style={{ marginTop: 16 }}>
              <button
                type="button"
                className="eia-btn-secondary"
                onClick={closeStatusChange}
                disabled={statusBusy}
              >
                Cancel
              </button>
              <button
                type="button"
                className={statusChange.target === PRODUCT_STATUS.RETIRED ? 'eia-btn-danger' : ''}
                data-testid="confirm-product-status"
                onClick={confirmStatusChange}
                disabled={statusBusy}
              >
                {statusBusy
                  ? 'Updating product…'
                  : statusChange.target === PRODUCT_STATUS.RETIRED
                    ? 'Retire product'
                    : 'Reactivate product'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
