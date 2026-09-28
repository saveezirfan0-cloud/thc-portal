import { Alert } from '@thc/ui';
import { dobClaimLine } from '../_lib/dobCorrection';
import type { DobClaim } from '../_lib/dobCorrection';

/**
 * ADR-0069: beside a pending share code whose worker entered a different
 * date of birth with it — "Date of birth entered with this code:
 * 15.06.1995 (profile: 31.12.1994)" — because gov.uk is asked with that
 * date and Verify copies it to the profile. Shown on /compliance,
 * /staff/:id (Documents) and /onboarding/:id, next to the gov.uk check.
 * Nothing when the dates agree or there is no claim.
 */
export function DobClaimNote({ claim }: { claim: DobClaim | null | undefined }) {
  const line = dobClaimLine(claim);
  if (!line) return null;
  return (
    <div className="stack mt-8">
      <Alert tone="amber">
        <b>{line.text}</b>
        <br />
        <span className="xs">{line.detail}</span>
      </Alert>
      {line.warning ? <Alert tone="coral">{line.warning}</Alert> : null}
    </div>
  );
}
