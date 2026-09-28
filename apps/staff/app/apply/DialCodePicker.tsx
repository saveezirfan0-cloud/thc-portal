'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { DIAL_CODES } from './form';
import { COMMON_COUNT, flagOf, searchDialCodes } from './dialSearch';
import type { DialCode } from './dialSearch';
import './dial-picker.css';

export interface DialCodePickerProps {
  /** The dialling code, e.g. `+44` — what the form stores (ADR-0009). */
  value: string;
  onChange: (code: string) => void;
  /** Submitted in a hidden input under this name, for a server-action form. */
  name?: string;
  disabled?: boolean;
}

/**
 * The international dialling-code picker (§2.1, ADR-0068; supersedes the
 * native `<select>` of ADR-0009).
 *
 * Closed, it is the wireframe's short `🇬🇧 +44` control. Open, it is a
 * search box over a list that names every country: "Common" (the
 * wireframe's nine) then "All countries" A → Z, each row flag · name · code.
 * Typing filters by name, word, initials, ISO code, a common other name or
 * the digits of the code (`dialSearch.ts`).
 *
 * ARIA combobox pattern: the search box is the `combobox`, it owns the
 * `listbox` and points at the highlighted row with `aria-activedescendant`,
 * so focus never leaves it. ↑/↓, Home/End, Enter picks, Escape closes and
 * returns to the button; a click outside closes without changing anything.
 */
export function DialCodePicker({ value, onChange, name, disabled }: DialCodePickerProps) {
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = DIAL_CODES.find((c) => c.code === value) ?? DIAL_CODES[0];
  const results = useMemo(() => searchDialCodes(query), [query]);
  const grouped = query.trim() === '';

  function openList() {
    if (disabled) return;
    setQuery('');
    setActive(Math.max(0, DIAL_CODES.indexOf(selected)));
    setOpen(true);
  }

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) buttonRef.current?.focus();
  }

  function pick(entry: DialCode) {
    onChange(entry.code);
    close(true);
  }

  // Focus the search box on open; keep the highlighted row in view.
  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    row?.scrollIntoView?.({ block: 'nearest' });
  }, [open, active, results]);

  // A press anywhere outside closes the list, leaving the value as it was.
  useEffect(() => {
    if (!open) return;
    function onDown(event: PointerEvent) {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    const last = results.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((i) => Math.min(last, i + 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((i) => Math.max(0, i - 1));
        break;
      case 'Home':
        event.preventDefault();
        setActive(0);
        break;
      case 'End':
        event.preventDefault();
        setActive(Math.max(0, last));
        break;
      case 'Enter':
        // Never submits the form from here.
        event.preventDefault();
        if (results[active]) pick(results[active]);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  const optionId = (i: number) => `${id}-opt-${i}`;

  return (
    <div className="dial-picker" ref={wrapRef}>
      {name ? <input type="hidden" name={name} value={selected.code} /> : null}
      <button
        ref={buttonRef}
        type="button"
        className="input dial-trigger"
        aria-label={`Country code: ${selected.name} ${selected.code}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close(false) : openList())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            openList();
          }
        }}
      >
        {selected.label}
      </button>

      {open ? (
        <div className="dial-pop">
          <input
            ref={searchRef}
            className="input dial-search"
            type="text"
            role="combobox"
            aria-label="Search country or code"
            aria-expanded="true"
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={results[active] ? optionId(active) : undefined}
            placeholder="Search country or code"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="done"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            onKeyDown={onSearchKey}
          />
          <ul className="dial-list" id={listId} role="listbox" aria-label="Countries" ref={listRef}>
            {results.map((entry, i) => (
              <DialRow
                key={entry.code}
                entry={entry}
                id={optionId(i)}
                index={i}
                heading={
                  grouped && i === 0
                    ? 'Common'
                    : grouped && i === COMMON_COUNT
                      ? 'All countries A–Z'
                      : null
                }
                active={i === active}
                selected={entry.code === selected.code}
                onHover={() => setActive(i)}
                onPick={() => pick(entry)}
              />
            ))}
          </ul>
          {results.length === 0 ? (
            <p className="dial-empty" role="status">
              No country matches “{query.trim()}”
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DialRow({
  entry,
  id,
  index,
  heading,
  active,
  selected,
  onHover,
  onPick,
}: {
  entry: DialCode;
  id: string;
  index: number;
  heading: string | null;
  active: boolean;
  selected: boolean;
  onHover: () => void;
  onPick: () => void;
}) {
  return (
    <>
      {heading ? (
        <li className="dial-group" role="presentation">
          {heading}
        </li>
      ) : null}
      <li
        id={id}
        data-index={index}
        role="option"
        aria-selected={selected}
        className={`dial-option${active ? ' active' : ''}`}
        onPointerMove={onHover}
        // Keep focus in the search box, so the list never steals the keyboard.
        onMouseDown={(event) => event.preventDefault()}
        onClick={onPick}
      >
        <span className="dial-flag" aria-hidden="true">
          {flagOf(entry)}
        </span>
        <span className="dial-name">{entry.name}</span>
        <span className="dial-code">{entry.code}</span>
      </li>
    </>
  );
}
