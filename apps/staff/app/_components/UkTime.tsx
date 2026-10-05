'use client';

import { UK_ZONE, formatTimeIn, needsDualZone } from '@thc/domain';
import { useTimeFormat } from '@thc/ui';
import { useViewerZone } from './useViewerZone';

/**
 * One scheduled instant inside a sentence, per §1.8: "16:30 (UK)", and —
 * when the phone is in another zone — "16:30 (UK) · 17:30 your time".
 *
 * `ShiftTime` does the same for a whole window on its own line; this is
 * for the check-in and lock times the shift screen and the today card
 * quote in running text, which a worker abroad would otherwise read as
 * their own clock. Written on the viewer's clock (ADR-0085).
 */
export function UkTime({ at }: { at: Date | string }) {
  const zone = useViewerZone();
  const format = useTimeFormat();
  const instant = typeof at === 'string' ? new Date(at) : at;
  const uk = formatTimeIn(instant, UK_ZONE, format);
  if (!needsDualZone(zone)) return <>{uk} (UK)</>;
  return (
    <>
      {uk} (UK) · {formatTimeIn(instant, zone, format)} your time
    </>
  );
}
