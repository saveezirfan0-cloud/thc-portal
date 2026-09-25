import Link from 'next/link';
import { AppBody, AppFrame, AppHeader, Logo, StaticScreen } from '@thc/ui';
import { SUPPORT_EMAIL } from '@thc/domain';
import './chrome.css';

export const metadata = { title: 'Not found · THC Staff' };

/**
 * The Staff App's 404 (Next.js `not-found.tsx`).
 *
 * Reached by an unknown URL, or by a screen that called `notFound()` for a
 * booking that is not the worker's — another worker's id, or a stale push
 * for an invitation they declined. A read that FAILED no longer comes here
 * (audit D18): that is `<LoadProblem>` with a retry, because telling a
 * worker their shift does not exist when the database simply did not
 * answer is how a No-show happens.
 *
 * Phone chrome without the tabs: a 404 has no profile read behind it to say
 * which tabs this worker may have.
 */
export default function NotFound() {
  return (
    <AppFrame>
      <AppHeader
        title="The Hospitality Company"
        brand={<Logo size="sm" label="The Hospitality Company" />}
      />
      <AppBody className="center">
        <div className="load-problem">
          <StaticScreen title="We couldn’t find that">
            The link may be out of date, or this is no longer yours to view. If you think something
            is missing, contact the office at <b className="cyan">{SUPPORT_EMAIL}</b>
          </StaticScreen>
          <Link className="btn primary block" href="/shifts">
            Back to Shifts
          </Link>
        </div>
      </AppBody>
    </AppFrame>
  );
}
