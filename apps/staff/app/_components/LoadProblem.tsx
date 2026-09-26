import { Alert } from '@thc/ui';
import { SUPPORT_EMAIL } from '@thc/domain';
import { RetryButton } from './RetryButton';

/**
 * What a screen shows when its read failed — never an empty state.
 *
 * Audit D18: the loaders used to drop the RPC error, so a timeout rendered
 * as "No shifts booked", "Nothing open" or "No open invitations", and a
 * shift the worker really has rendered as a 404. A worker who believes
 * they have no shift does not turn up, and that is a No-show on their
 * record. So a failed read says so, in the worker's words, and offers the
 * retry.
 */
export function loadProblemCopy(what: string): string {
  return `We couldn’t load ${what} — pull to refresh or try again.`;
}

export function LoadProblem({ what }: { what: string }) {
  return (
    <div className="load-problem" data-load-problem="">
      <Alert tone="coral">
        <b>{loadProblemCopy(what)}</b>
        <br />
        <span className="xs">
          Check your connection. If it keeps happening, contact the office at{' '}
          <b className="cyan">{SUPPORT_EMAIL}</b>
        </span>
      </Alert>
      <RetryButton />
    </div>
  );
}
