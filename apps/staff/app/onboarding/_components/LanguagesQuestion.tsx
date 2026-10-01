'use client';

import { Chip } from '@thc/ui';
import { ENGLISH, LANGUAGES, normaliseLanguages } from '@thc/domain';

/**
 * "Which languages do you speak?" on step 2 (ADR-0080).
 *
 * English is ticked and fixed — the induction, the quiz and the contract
 * are all in English, so everyone we book speaks it. Any other language
 * comes from the fixed list, so it matches the words the office uses when
 * a client asks for, say, Spanish speakers.
 */
export function LanguagesQuestion({
  value,
  onChange,
  disabled = false,
}: {
  value: readonly string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  const chosen = normaliseLanguages(value);
  const remaining = LANGUAGES.filter((language) => !chosen.includes(language));

  return (
    <div className="field">
      <label className="label" htmlFor="onboarding-add-language">
        Which languages do you speak?
      </label>
      <div className="row wrap" style={{ alignItems: 'center' }}>
        {chosen.map((language) =>
          language === ENGLISH ? (
            <Chip key={language}>{language}</Chip>
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
      </div>
      <select
        id="onboarding-add-language"
        className="input"
        value=""
        disabled={disabled}
        onChange={(event) => {
          if (event.target.value) onChange(normaliseLanguages([...chosen, event.target.value]));
        }}
      >
        <option value="">Add another language…</option>
        {remaining.map((language) => (
          <option key={language} value={language}>
            {language}
          </option>
        ))}
      </select>
      <span className="hint">
        Some events need staff who speak a particular language — we offer those shifts to the people
        who speak it. Only add languages you can hold a conversation in at work.
      </span>
    </div>
  );
}
