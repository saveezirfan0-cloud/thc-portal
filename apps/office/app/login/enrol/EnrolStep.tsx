'use client';

import { TwoStepSetup } from '../../account/TwoStepPanel';
import { ENROL_INTRO } from './copy';

/**
 * The enrol step's form (ADR-0164): /account's set-up, word for word, with
 * the reason it is being asked first. Once the first code is right the
 * session is at aal2, so the whole page is reloaded at `next` — a full
 * navigation, so the middleware sees the upgraded cookies.
 */
export function EnrolStep({ next }: { next: string }) {
  return (
    <TwoStepSetup
      intro={ENROL_INTRO}
      className="twostep-form"
      onTurnedOn={() => window.location.assign(next)}
    />
  );
}
