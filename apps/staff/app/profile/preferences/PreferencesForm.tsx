'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, SegToggle } from '@thc/ui';
import { clockLabel } from '@thc/domain';
import type { TimeFormat } from '@thc/domain';
import { saveTimeFormatPreference } from './actions';

/**
 * Preferences — Time format (ADR-0085).
 *
 * 24-hour is the default for everyone; this switches the worker's own view
 * to 12-hour and back. It changes how a time is WRITTEN and how a typed time
 * is read, nothing else: shifts, rules and the UK-first display of §1.8 are
 * the same on both. The example under the control is the same moment on each
 * clock, so the choice can be judged before it is saved.
 *
 * Saved by a server action, then `router.refresh()` re-reads every server
 * component on the new clock, so the whole app flips without a reload.
 */
const EXAMPLE = '17:30';

export function PreferencesForm({ saved }: { saved: TimeFormat }) {
  const router = useRouter();
  const [stored, setStored] = useState<TimeFormat>(saved);
  const [choice, setChoice] = useState<TimeFormat>(saved);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const changed = choice !== stored;

  function submit() {
    setNote(null);
    setError(null);
    start(async () => {
      const result = await saveTimeFormatPreference(choice);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setStored(choice);
      setNote(result.note ?? 'Saved.');
      router.refresh();
    });
  }

  return (
    <>
      <section className="pref" aria-labelledby="time-format-label">
        <div className="t" id="time-format-label">
          Time format
        </div>
        <SegToggle<TimeFormat>
          block
          options={[
            { value: '24h', label: '24-hour (default)' },
            { value: '12h', label: '12-hour' },
          ]}
          value={choice}
          onChange={(value) => {
            setChoice(value);
            setNote(null);
            setError(null);
          }}
          aria-label="24-hour or 12-hour clock"
        />
        <div className="sm muted mono" aria-live="polite">
          e.g. {clockLabel(EXAMPLE, choice)}
        </div>
        <p className="xs muted">
          Changes how times are written and how you type them. Shifts and their UK times stay
          exactly as they are.
        </p>
      </section>

      {error ? <Alert tone="coral">{error}</Alert> : null}
      {note ? <Alert tone="green">{note}</Alert> : null}

      <Button tone="primary" size="lg" block disabled={pending || !changed} onClick={submit}>
        {pending ? 'Saving…' : 'Save changes'}
      </Button>
    </>
  );
}
