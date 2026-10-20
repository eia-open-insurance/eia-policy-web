import React, { useEffect, useRef, useState } from 'react';
import {
  programDisplayLabel,
  programTermLabel,
  programTypeLabel,
  normalizeProgramList,
  programsEndpoint
} from './programs.js';

/**
 * Predictive program lookup for the Policy record.
 *
 * The catalog is read from GET /api/v1/programs, which is the same endpoint the
 * Program tab uses to verify an assignment. The picker only selects an existing
 * program: attaching it is a separate PATCH owned by the caller, so a lookup or
 * selection never mutates the policy.
 *
 * Props:
 *   value        selected program id
 *   valueLabel   selected display label
 *   onChange     (id, program | null) => void
 *   disabled
 *   placeholder
 */
export default function ProgramPicker({
  value,
  valueLabel,
  onChange,
  disabled = false,
  placeholder = 'Search programs by number or name…'
}) {
  const [term, setTerm] = useState('');
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const rootRef = useRef(null);
  const abortRef = useRef(null);

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
        const response = await fetch(programsEndpoint(term), {
          headers: { 'X-EIA-Tenant': '11111111-1111-7111-8111-111111111111' },
          signal: controller.signal
        });
        if (!response.ok) throw new Error(`Program lookup failed (${response.status})`);
        const body = await response.json();
        if (controller.signal.aborted) return;
        setItems(normalizeProgramList(body));
      } catch (e) {
        if (e.name !== 'AbortError' && !controller.signal.aborted) {
          setItems([]);
          setError(e.message);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 160);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [term, open]);

  function choose(program) {
    onChange(program.id, program);
    setOpen(false);
    setTerm('');
    setItems([]);
  }

  if (value) {
    return (
      <div className="eia-picker" ref={rootRef} data-testid="program-picker">
        <div className="eia-picker-selected">
          <span className="value">
            <b>{valueLabel || value}</b>
            <small>{value}</small>
          </span>
          <button type="button" disabled={disabled} onClick={() => onChange('', null)}>
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="eia-picker" ref={rootRef} data-testid="program-picker">
      <input
        type="search"
        value={term}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        aria-label={placeholder}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
      />
      {!open && (
        <span className="eia-picker-hint">
          Focus the field to browse the program catalog, then type to narrow it.
        </span>
      )}
      {open && (
        <div className="eia-picker-results" role="listbox" aria-label="Program catalog results">
          {loading && <div className="eia-picker-empty">Searching…</div>}
          {!loading && error && <div className="eia-picker-empty">{error}</div>}
          {!loading && !error && items.length === 0 && (
            <div className="eia-picker-empty">
              {term.trim()
                ? 'No matching programs.'
                : 'No programs in the catalog yet. Create a program to start one.'}
            </div>
          )}
          {!loading && !error && items.map((program, index) => (
            <button
              type="button"
              key={program.id || `${program.number || 'program'}-${index}`}
              className="eia-picker-option"
              role="option"
              aria-selected={false}
              onClick={() => choose(program)}
            >
              <span className="value">
                <b>{programDisplayLabel(program)}</b>
                <small>
                  {programTypeLabel(program.type)} · {programTermLabel(program)}
                </small>
              </span>
              <span className="status">{program.status || '—'}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
