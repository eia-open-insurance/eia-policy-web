import React, { useEffect, useMemo, useRef, useState } from 'react';

/**
 * Searchable directory person lookup for the referral dialogs.
 *
 * The directory is already loaded into memory, so filtering is local and every
 * person is a valid choice: typing narrows the list by display name or email,
 * and the arrow keys/Enter move through it without a request per keystroke.
 * A selected person is shown by name and the form value is the person's
 * directory id.
 */

export function matchesPerson(person, term) {
  const query = String(term || '').trim().toLowerCase();
  if (!query) return true;
  return [person.displayName, person.email, person.role]
    .some((value) => String(value || '').toLowerCase().includes(query));
}

export function filterDirectoryPeople(people, term) {
  if (!Array.isArray(people)) return [];
  return people.filter((person) => matchesPerson(person, term));
}

export default function DirectoryPersonPicker({
  id = 'directoryPersonSearch',
  people = [],
  value = '',
  valueLabel = '',
  onChange,
  disabled = false,
  loading = false,
  placeholder = 'Search the directory by name or email…'
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);

  const matches = useMemo(() => filterDirectoryPeople(people, term), [people, term]);
  const selected = value ? people.find((person) => person.id === value) || null : null;
  const selectedName = selected?.displayName || valueLabel || value;

  useEffect(() => {
    const onDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  /**
   * Keep the highlighted option valid as the term narrows the list. Opening the
   * list highlights the first match so Enter always selects the visible default.
   */
  useEffect(() => {
    if (!open || matches.length === 0) {
      setActiveIndex(-1);
      return;
    }
    setActiveIndex((current) => (
      current >= 0 && current < matches.length ? current : 0
    ));
  }, [open, matches]);

  function choose(person) {
    onChange(person);
    setOpen(false);
    setTerm('');
    setActiveIndex(-1);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      // Close only the suggestion list; the dialog must stay open.
      if (open) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
      return;
    }

    if (!open) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        setOpen(true);
      }
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (
        matches.length === 0 ? -1 : (current + 1) % matches.length
      ));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (
        matches.length === 0 ? -1 : current <= 0 ? matches.length - 1 : current - 1
      ));
      return;
    }

    if (event.key === 'Enter' && activeIndex >= 0 && matches[activeIndex]) {
      event.preventDefault();
      choose(matches[activeIndex]);
      return;
    }

    if (event.key === 'Tab') setOpen(false);
  }

  if (value) {
    return (
      <div
        className="eia-picker eia-directory-picker"
        ref={rootRef}
        data-testid="directory-person-picker"
      >
        <div className="eia-picker-selected" data-testid="directory-person-selected">
          <span className="value">
            <b data-testid="directory-person-selected-name">{selectedName}</b>
            {(selected?.role || selected?.email) && (
              <small>{[selected.role, selected.email].filter(Boolean).join(' · ')}</small>
            )}
            <small className="eia-mono">{value}</small>
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            aria-label="Change person"
            data-testid="directory-person-change"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="eia-picker eia-directory-picker"
      ref={rootRef}
      data-testid="directory-person-picker"
    >
      <input
        id={id}
        type="search"
        role="combobox"
        aria-label={placeholder}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={`${id}-listbox`}
        aria-autocomplete="list"
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        value={term}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setTerm(event.target.value);
          setOpen(true);
        }}
        onKeyDown={handleKeyDown}
        data-testid="directory-person-search"
      />
      {open && (
        <div
          className="eia-picker-results"
          role="listbox"
          id={`${id}-listbox`}
          aria-label="Directory people"
          data-testid="directory-person-results"
        >
          {loading && <div className="eia-picker-empty">Loading the directory…</div>}
          {!loading && people.length === 0 && (
            <div className="eia-picker-empty" data-testid="directory-person-empty">
              No directory people are available. Retry the directory lookup.
            </div>
          )}
          {!loading && people.length > 0 && matches.length === 0 && (
            <div className="eia-picker-empty" data-testid="directory-person-no-match">
              No directory people match “{term.trim()}”.
            </div>
          )}
          {!loading && matches.map((person, index) => (
            <button
              type="button"
              key={person.id}
              id={`${id}-option-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`eia-picker-option${index === activeIndex ? ' active' : ''}`}
              data-testid={`directory-person-option-${person.id}`}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(person)}
            >
              <span className="value">
                <b>{person.displayName}</b>
                <small>
                  {[person.email, person.role].filter(Boolean).join(' · ') || person.id}
                </small>
              </span>
              {Array.isArray(person.teams) && person.teams.length > 0 && (
                <span className="status">{person.teams.join(', ')}</span>
              )}
            </button>
          ))}
        </div>
      )}
      {!open && (
        <span className="eia-picker-hint">
          Search the people directory; the selected person is recorded by id.
        </span>
      )}
    </div>
  );
}
