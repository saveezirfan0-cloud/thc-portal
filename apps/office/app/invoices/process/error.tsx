'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { Alert, Button, Content, PageHead } from '@thc/ui';

/** Route-level error for /invoices/process: never the exception's own text. */
export default function ProcessError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[invoices/process] unhandled error', { digest: error.digest });
  }, [error]);
  return (
    <Content>
      <PageHead title="Process timesheet" description="This screen could not be loaded." />
      <Alert tone="coral">
        Nothing was lost: uploaded files, approved rows and invoice numbers are kept. Try again
        {error.digest ? (
          <>
            {' '}
            — if it keeps happening, quote reference <span className="mono">{error.digest}</span>
          </>
        ) : null}
        .
      </Alert>
      <div className="row" style={{ gap: 'var(--sp-10)' }}>
        <Button tone="primary" onClick={() => reset()}>
          Try again
        </Button>
        <Link className="btn" href="/invoices/process">
          Back to Process timesheet
        </Link>
      </div>
    </Content>
  );
}
