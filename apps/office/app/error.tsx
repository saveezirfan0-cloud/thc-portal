'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Alert, Button, Content, PageHead } from '@thc/ui';

/**
 * The Back Office's route-level error boundary (Next.js `error.tsx`).
 *
 * The message is never the exception's own text: in production Next.js
 * replaces it anyway, and in development it can carry SQL or a row that
 * belongs in the server log, not on a screen. The digest is what an
 * operator matches against that log. No chrome: this boundary also
 * covers /login, where an anonymous visitor must not see the admin sidebar.
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
    <Content>
      <PageHead title="Something went wrong" description="This screen could not be loaded." />
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
      <div className="row" style={{ gap: 'var(--sp-10)' }}>
        <Button tone="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link className="btn" href="/dashboard">
          Back to the dashboard
        </Link>
      </div>
    </Content>
  );
}
