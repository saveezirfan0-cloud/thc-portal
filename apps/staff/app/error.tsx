'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AppBody, AppFrame, AppHeader, Logo, StaticScreen } from '@thc/ui';
import { SUPPORT_EMAIL } from '@thc/domain';
import { RetryButton } from './_components/RetryButton';
import './chrome.css';

/**
 * The Staff App's route-level error boundary (Next.js `error.tsx`).
 *
 * Where a screen's read fails outright — the profile a lock is computed
 * from, the onboarding state, earnings — the loaders now THROW rather than
 * return an empty answer (audit D16, D18), and this is where they land.
 *
 * It fails CLOSED: the phone chrome without the four tabs and without the
 * avatar, because the lock that decides which tabs a worker may have is
 * exactly what could not be read. The message is the worker's, never the
 * exception's text (in production Next.js replaces it anyway; in
 * development it can carry SQL); the digest is what the office quotes to
 * whoever reads the server log.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[staff] unhandled error', { digest: error.digest });
  }, [error]);

  return (
    <AppFrame>
      <AppHeader
        title="The Hospitality Company"
        brand={<Logo size="sm" label="The Hospitality Company" />}
      />
      <AppBody className="center">
        <div className="load-problem">
          <StaticScreen title="We couldn’t load this screen">
            Check your connection, then try again. If it keeps happening, contact the office at{' '}
            <b className="cyan">{SUPPORT_EMAIL}</b>
            {error.digest ? (
              <>
                {' '}
                and quote reference <span className="mono">{error.digest}</span>
              </>
            ) : null}
            .
          </StaticScreen>
          <RetryButton onRetry={reset} />
          <Link className="btn ghost block" href="/shifts">
            Back to Shifts
          </Link>
        </div>
      </AppBody>
    </AppFrame>
  );
}
