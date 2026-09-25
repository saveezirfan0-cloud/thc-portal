'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Alert, AuthCard, Button } from '@thc/ui';

/**
 * The Client Portal's route-level error boundary (Next.js `error.tsx`).
 *
 * The branded card the portal's sign-in uses, and no top bar: this boundary
 * also covers /login and /forgot, where there is nobody signed in to name,
 * and the bar's company line comes from a read that may be what failed.
 *
 * The message is never the exception's own text. In production Next.js
 * replaces it anyway, and in development it can carry SQL or a row that
 * belongs in the server log — and a customer must never see another
 * client's data, even in an error (§11.1). The digest is what an operator
 * matches against that log.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[client] unhandled error', { digest: error.digest });
  }, [error]);

  return (
    <AuthCard product="Client Portal" heading="Something went wrong">
      <Alert tone="coral">
        This page couldn’t be loaded. Please try again. If it keeps happening, email
        admin@thehospitalitycompany.co.uk
        {error.digest ? (
          <>
            {' '}
            and quote reference <span className="mono">{error.digest}</span>
          </>
        ) : null}
        .
      </Alert>
      <div className="row" style={{ gap: 'var(--sp-10)' }}>
        <Button tone="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link className="btn" href="/client">
          Back to your events
        </Link>
      </div>
    </AuthCard>
  );
}
