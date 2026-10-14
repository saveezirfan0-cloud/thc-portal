'use client';

import { useState, useTransition } from 'react';
import { Button, Pill, toast } from '@thc/ui';
import { formatLanguages, normaliseLanguages } from '@thc/domain';
import { LanguagePicker } from '../../_components/LanguagePicker';
import { useSavedFlash } from '../../_lib/useSavedFlash';
import { saveLanguages } from './actions';

/**
 * Languages on the Overview card "Contacts & identity" (ADR-0080).
 *
 * The worker gives them on onboarding step 2. An event that needs a
 * language besides English books only staff shown to speak it, so a worker
 * with none on file — onboarded before step 2 asked, or brought across
 * from payroll — is left out of those events until the office records them
 * here. Any office login that may write; `set_staff_languages()` refuses a
 * viewer and a removed worker whatever this shows.
 */
export function LanguagesField({
  staffId,
  languages,
  editable,
  removed = false,
}: {
  staffId: string;
  /** Null: never asked. Undefined: could not be read. */
  languages: string[] | null | undefined;
  editable: boolean;
  /** §1.7: a removed worker's languages were wiped with the rest. */
  removed?: boolean;
}) {
  const [shown, setShown] = useState(languages);
  // Follow the stored value when the page re-reads it (a router refresh).
  const [stored, setStored] = useState(languages);
  if (languages !== stored) {
    setStored(languages);
    setShown(languages);
  }
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();
  // ADR-0137 §1: a field that saves on change says that it did.
  const [saved, flashSaved] = useSavedFlash();

  if (shown === undefined || removed) return <span className="muted">—</span>;

  const change = (next: string[]) => {
    const value = normaliseLanguages(next);
    setFailure(null);
    start(async () => {
      const result = await saveLanguages(staffId, value);
      if (result.ok) {
        setShown(value);
        flashSaved();
        toast('Languages saved', { tone: 'green' });
      } else setFailure(result.message);
    });
  };

  return (
    <span>
      {editable ? (
        <LanguagePicker
          value={shown ?? []}
          unrecorded={shown === null}
          disabled={pending}
          onChange={change}
        />
      ) : shown ? (
        formatLanguages(shown)
      ) : (
        <Pill tone="amber">not recorded</Pill>
      )}
      {shown === null ? (
        <>
          <br />
          <span className="muted sm">
            Not asked yet. Needed for events that need a language besides English — they are left
            out of those until it is recorded.
          </span>
          {editable ? (
            <>
              {' '}
              <Button size="sm" disabled={pending} onClick={() => change([])}>
                English only
              </Button>
            </>
          ) : null}
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
