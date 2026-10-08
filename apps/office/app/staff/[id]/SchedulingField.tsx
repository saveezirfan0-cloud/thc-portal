'use client';

import { useState, useTransition } from 'react';
import { Button, Pill } from '@thc/ui';
import { saveScheduling } from './actions';

/** The words on the profile, and in the email the worker was sent (ADR-0104). */
export const SPUDBROS_LABEL = 'SpudBros Express Staff Only – scheduling on Connecteam';

/**
 * Scheduling on the Overview card "Contacts & identity" (ADR-0104).
 *
 * SpudBros Express staff do their Right to Work check and onboarding with
 * us and nothing else: their shifts stay on Connecteam. A few also work THC
 * shifts, and this is where the office switches that on for them, one by
 * one. "Onboarding only" closes Shifts, Invites and Radar in the Staff App
 * and keeps them out of auto-assign and every invitation;
 * `set_staff_scheduling()` refuses a viewer, a removed worker, and closing
 * the app on someone with an upcoming shift, whatever this shows.
 */
export function SchedulingField({
  staffId,
  spudbros,
  thcShifts,
  editable,
  removed = false,
}: {
  staffId: string;
  /** Undefined: could not be read. */
  spudbros: boolean | undefined;
  thcShifts: boolean | undefined;
  editable: boolean;
  removed?: boolean;
}) {
  const [state, setState] = useState({ spudbros, thcShifts });
  // Follow the stored value when the page re-reads it (a router refresh).
  const [stored, setStored] = useState({ spudbros, thcShifts });
  if (spudbros !== stored.spudbros || thcShifts !== stored.thcShifts) {
    setStored({ spudbros, thcShifts });
    setState({ spudbros, thcShifts });
  }
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (state.spudbros === undefined || removed) return <span className="muted">—</span>;

  const change = (nextSpudbros: boolean, nextShifts: boolean) => {
    setFailure(null);
    start(async () => {
      const result = await saveScheduling(staffId, nextSpudbros, nextShifts);
      if (result.ok) setState({ spudbros: nextSpudbros, thcShifts: nextSpudbros && nextShifts });
      else setFailure(result.message);
    });
  };

  const onboardingOnly = state.spudbros && !state.thcShifts;

  return (
    <span>
      {state.spudbros ? (
        <Pill tone="cyan">
          {onboardingOnly ? SPUDBROS_LABEL : 'SpudBros Express · also works THC shifts'}
        </Pill>
      ) : (
        <span>THC shifts</span>
      )}
      {editable ? (
        <>
          <br />
          {state.spudbros ? (
            <>
              <Button
                size="sm"
                tone={onboardingOnly ? 'primary' : 'outline'}
                disabled={pending}
                onClick={() => change(true, !state.thcShifts)}
              >
                {onboardingOnly ? 'Switch on THC shifts' : 'Switch off THC shifts'}
              </Button>{' '}
              <Button
                size="sm"
                tone="outline"
                disabled={pending}
                onClick={() => change(false, false)}
                title="Not SpudBros Express staff after all: ordinary THC staff."
              >
                Not SpudBros staff
              </Button>
            </>
          ) : (
            <Button size="sm" tone="outline" disabled={pending} onClick={() => change(true, false)}>
              Mark as SpudBros Express staff
            </Button>
          )}
        </>
      ) : null}
      {state.spudbros ? (
        <>
          <br />
          <span className="muted sm">
            {onboardingOnly
              ? 'Right to Work and onboarding only. Not offered, invited or auto-assigned THC shifts; the Staff App closes Shifts, Invites and Radar.'
              : 'THC scheduling is switched on for this person, so they are offered and invited shifts like anyone else.'}
          </span>
        </>
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
