import React, { useEffect, useRef, useState } from 'react';
import { TENANT } from './api.js';
import {
  MAX_PRODUCT_CODE_LENGTH,
  PRODUCT_PICKER_PLACEHOLDER,
  normalizeProductList,
  productDisplayLabel,
  productsEndpoint
} from './products.js';

/**
 * Predictive product lookup for the policy and submission create forms.
 *
 * The picker reads GET /api/v1/products?q=…&status=ACTIVE and lets the operator
 * search by product code or name. Selecting a product reports its code, which
 * is what the create commands store, plus a display label so the form can show
 * the selected product instead of only the code.
 *
 * If the catalog is empty or unavailable the picker falls back to manual code
 * entry. That keeps the create flows usable while the catalog is being seeded:
 * the manual value is used exactly as typed by the caller's command.
 *
 * Props:
 *   value        selected product code ('' when none)
 *   valueLabel   display label for the selected product
 *   onChange     (code, product | null) => void
 *   disabled
 *   placeholder
 *   id           id for whichever input renders (label association)
 */
export default function ProductPicker({
  id,
  value,
  valueLabel,
  onChange,
  disabled = false,
  placeholder = PRODUCT_PICKER_PLACEHOLDER
}) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [manual, setManual] = useState(false);
  const [fallbackReason, setFallbackReason] = useState('manual');
  const [reloadKey, setReloadKey] = useState(0);
  const rootRef = useRef(null);
  const abortRef = useRef(null);
  const manualInputRef = useRef(null);

  useEffect(() => {
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    abortRef.current?.abort();
    abortRef.current = controller;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const response = await fetch(productsEndpoint(term), {
          headers: { 'X-EIA-Tenant': TENANT },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Product lookup failed (${response.status})`);
        const body = await response.json();
        if (controller.signal.aborted) return;
        const products = normalizeProductList(body);
        setItems(products);
        // Only the unfiltered read proves the catalog itself is empty. A
        // filtered read can legitimately return no matches while the catalog
        // has entries, and the operator should be able to keep typing.
        if (!term.trim() && products.length === 0) {
          setFallbackReason('empty');
          setManual(true);
        }
      } catch (e) {
        if (e.name !== 'AbortError' && !controller.signal.aborted) {
          setItems([]);
          setError(e.message);
          setFallbackReason('unavailable');
          setManual(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [term, open, reloadKey]);

  useEffect(() => {
    if (manual && !value && manualInputRef.current) {
      manualInputRef.current.focus();
    }
  }, [manual, value]);

  function choose(product) {
    onChange(product.code, product);
    setOpen(false);
    setTerm('');
    setItems([]);
    setManual(false);
    setError('');
  }

  function clearSelection() {
    onChange('', null);
    setTerm('');
    setItems([]);
    setError('');
    setManual(false);
    setOpen(true);
  }

  function startManual() {
    setOpen(false);
    setItems([]);
    setError('');
    setFallbackReason('manual');
    setManual(true);
    setTerm('');
  }

  function browseCatalog() {
    setManual(false);
    setError('');
    setOpen(true);
    setReloadKey((current) => current + 1);
  }

  if (value && !manual) {
    return (
      <div className="eia-picker" ref={rootRef} data-testid="product-picker">
        <div className="eia-picker-selected" data-testid="product-picker-selected">
          <span className="value">
            <b>{valueLabel || value}</b>
            <small>
              {valueLabel && valueLabel !== value ? `${value} · selected product` : 'manual product code'}
            </small>
          </span>
          <button type="button" disabled={disabled} onClick={clearSelection}>
            Change
          </button>
        </div>
      </div>
    );
  }

  if (manual) {
    return (
      <div className="eia-picker" ref={rootRef} data-testid="product-picker">
        <div className="eia-picker-manual">
          <input
            id={id}
            ref={manualInputRef}
            type="text"
            value={value || ''}
            disabled={disabled}
            maxLength={MAX_PRODUCT_CODE_LENGTH}
            placeholder="Product code, e.g. CGL"
            autoComplete="off"
            onChange={(event) => onChange(event.target.value, null)}
          />
          <button
            type="button"
            className="eia-btn-ghost"
            disabled={disabled}
            onClick={browseCatalog}
          >
            Search catalog
          </button>
        </div>
        <span className="eia-picker-hint" data-testid="product-picker-fallback">
          {error
            ? `Product catalog unavailable (${error}). Enter the code manually.`
            : fallbackReason === 'empty'
              ? 'No active products are configured yet. Enter the code manually.'
              : 'Manual product code. The catalog lookup is skipped.'}
        </span>
      </div>
    );
  }

  return (
    <div className="eia-picker" ref={rootRef} data-testid="product-picker">
      <input
        id={id}
        type="search"
        value={term}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
      />
      {!open && (
        <span className="eia-picker-hint">
          Focus the field to browse active products, then type to search by code or name.
        </span>
      )}
      {open && (
        <div className="eia-picker-results" role="listbox" aria-label="Product catalog results">
          {loading && <div className="eia-picker-empty">Searching products…</div>}
          {!loading && error && <div className="eia-picker-empty">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <>
              <div className="eia-picker-empty" data-testid="product-picker-no-match">
                {term.trim()
                  ? `No active products match “${term.trim()}”.`
                  : 'No active products are configured in the catalog.'}
              </div>
              <button
                type="button"
                className="eia-picker-empty-action"
                data-testid="product-picker-manual-toggle"
                onClick={startManual}
              >
                Enter the code manually
              </button>
            </>
          )}
          {!loading && !error && items.map((product) => (
            <button
              type="button"
              key={product.key || product.code}
              className="eia-picker-option"
              role="option"
              aria-selected={false}
              data-testid="product-picker-option"
              onClick={() => choose(product)}
            >
              <span className="value">
                <b>{productDisplayLabel(product)}</b>
                <small>Active product</small>
              </span>
              <span className="status">{product.status || 'ACTIVE'}</span>
            </button>
          ))}
          {!loading && !error && items.length > 0 && (
            <button
              type="button"
              className="eia-picker-empty-action"
              data-testid="product-picker-manual-toggle"
              onClick={startManual}
            >
              Enter the code manually
            </button>
          )}
        </div>
      )}
    </div>
  );
}
