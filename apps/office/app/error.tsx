'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Alert, AuthCard, Button } from '@thc/ui';

/**
 * The Back Office's route-level error boundary (Next.js `error.tsx`).
 *
 * The message is never the exception's own text: in production Next.js
 * replaces it anyway, and in development it can carry SQL or a row that
 * belongs in the server log, not on a screen. The digest is what an
 * operator matches against that log. No chrome: this boundary also
 * covers /login, where an anonymous visitor must not see the admin sidebar,
 * so it is the sign-in card's shape: brand, one message, two ways out.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[office] unhandled error', { digest: error.digest });
  }, [error]);

  return (
    <AuthCard product="Back Office" heading="Something went wrong">
      <div className="stack">
        <p className="sm muted" style={{ textAlign: 'center' }}>
          This screen could not be loaded.
        </p>
        <Alert tone="coral">
          Try again. If it keeps happening, tell the platform team
          {error.digest ? (
            <>
              {' '}
              and quote reference <span className="mono">{error.digest}</span>
            </>
          ) : null}
          .
        </Alert>
        <Button tone="primary" size="lg" block onClick={() => reset()}>
          Try again
        </Button>
        <Link className="btn block" href="/dashboard">
          Back to the dashboard
        </Link>
      </div>
    </AuthCard>
  );
}
