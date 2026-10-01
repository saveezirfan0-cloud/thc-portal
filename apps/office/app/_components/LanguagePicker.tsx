'use client';

import { useId } from 'react';
import { Chip } from '@thc/ui';
import { ENGLISH, LANGUAGES, normaliseLanguages } from '@thc/domain';

/**
 * Languages as chips plus an "Add a language…" select (ADR-0080) — the
 * Shift Builder's "Languages staff must speak" and the staff profile's
 * Languages row.
 *
 * English is always there and cannot be removed: it is the base every THC
 * worker has, and the database refuses a list without it. Every other
 * language comes from the fixed list in `@thc/domain`, so a requirement
 * and a worker's answer always use the same words.
 */
export function LanguagePicker({
  value,
  onChange,
  label,
  hint,
  disabled = false,
  unrecorded = false,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  label?: string;
  hint?: string;
  disabled?: boolean;
  /**
   * Nothing on file yet (a worker never asked): no chips, so English does
   * not read as recorded. Adding a language records English with it.
   */
  unrecorded?: boolean;
}) {
  const id = useId();
  const chosen = unrecorded ? [] : normaliseLanguages(value);
  const remaining = LANGUAGES.filter((language) => !chosen.includes(language));

  return (
    <div className="field">
      {/* With no select to point at (read-only), the label is plain text. */}
      {label && !disabled ? (
        <label className="label" htmlFor={`${id}-add`}>
          {label}
        </label>
      ) : label ? (
        <span className="label">{label}</span>
      ) : null}
      <div className="row wrap" style={{ alignItems: 'center' }}>
        {chosen.map((language) =>
          language === ENGLISH ? (
            <Chip key={language} title="Everyone THC books speaks English">
              {language}
            </Chip>
          ) : (
            <Chip
              key={language}
              tone="cyan"
              onRemove={
                disabled
                  ? undefined
                  : () => onChange(chosen.filter((existing) => existing !== language))
              }
            >
              {language}
            </Chip>
          ),
        )}
        {disabled ? null : (
          <select
            id={`${id}-add`}
            className="input"
            style={{ height: 32, width: 190 }}
            aria-label={label ? undefined : 'Add a language'}
            value=""
            onChange={(event) => {
              if (event.target.value) onChange(normaliseLanguages([...chosen, event.target.value]));
            }}
          >
            <option value="">Add a language…</option>
            {remaining.map((language) => (
              <option key={language} value={language}>
                {language}
              </option>
            ))}
          </select>
        )}
      </div>
      {hint ? <span className="hint">{hint}</span> : null}
    </div>
  );
}
