'use client';

import { useState, useTransition } from 'react';
import { PASSPORT_COUNTRY_NAMES } from '@thc/domain';
import { Pill, toast } from '@thc/ui';
import { useSavedFlash } from '../../_lib/useSavedFlash';
import { savePassportCountry } from './actions';

/**
 * Passport country on the Overview card "Contacts & identity" (ADR-0159).
 *
 * The country that issued the worker's passport, for the New Starter
 * (HMRC) report. The AI read of an uploaded passport fills it when none is
 * on file; the office sets or corrects it here — and is the only way a
 * worker onboarded before the read existed, or whose passport could not be
 * read, gets one. Any office login that may write;
 * `set_staff_passport_country()` refuses a viewer and a removed worker
 * whatever this shows.
 */
export function PassportCountryField({
  staffId,
  country,
  editable,
  removed = false,
}: {
  staffId: string;
  /** Null: not on file. Undefined: could not be read. */
  country: string | null | undefined;
  editable: boolean;
  /** §1.7: a removed worker's passport country was wiped with the rest. */
  removed?: boolean;
}) {
  const [shown, setShown] = useState(country);
  // Follow the stored value when the page re-reads it (a router refresh).
  const [stored, setStored] = useState(country);
  if (country !== stored) {
    setStored(country);
    setShown(country);
  }
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // ADR-0137 §1: a field that saves on change says that it did.
  const [saved, flashSaved] = useSavedFlash();

  if (shown === undefined || removed) return <span className="muted">—</span>;

  const change = (next: string) => {
    const value = next || null;
    setFailure(null);
    start(async () => {
      const result = await savePassportCountry(staffId, value);
      if (result.ok) {
        setShown(value);
        flashSaved();
        toast('Passport country saved', { tone: 'green' });
      } else setFailure(result.message);
    });
  };

  return (
    <span>
      {editable ? (
        <select
          className="input"
          style={{ height: 32, width: 220 }}
          aria-label="Passport country"
          value={shown ?? ''}
          disabled={pending}
          onChange={(event) => change(event.target.value)}
        >
          <option value="">Not recorded</option>
          {PASSPORT_COUNTRY_NAMES.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      ) : shown ? (
        shown
      ) : (
        <Pill tone="amber">not recorded</Pill>
      )}
      {shown === null ? (
        <>
          <br />
          <span className="muted sm">
            The New Starter report sends it to payroll — blank there until it is recorded.
          </span>
        </>
      ) : null}
      {pending ? (
        <span className="muted sm saved-note" role="status">
          {' '}
          Saving…
        </span>
      ) : saved ? (
        <span className="saved-note" role="status">
          {' '}
          <Pill tone="green">Saved</Pill>
        </span>
      ) : null}
      {failure ? (
        <>
          <br />
          <span className="coral sm">{failure}</span>
        </>
      ) : null}
    </span>
  );
}
