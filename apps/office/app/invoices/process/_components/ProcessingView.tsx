'use client';

import { useRouter } from 'next/navigation';
import { Panel, useVisibleInterval } from '@thc/ui';

/**
 * Step 1–2 while the server reads the files (`uploaded` / `extracting`).
 * The page re-reads itself every few seconds and moves on by itself when
 * the job reaches review or error.
 */
export function ProcessingView({
  status,
  clientName,
  fileNames,
  stalled,
}: {
  status: 'uploaded' | 'extracting';
  clientName: string;
  fileNames: string[];
  /** Nothing has changed for a long time: say so rather than spin for ever. */
  stalled: boolean;
}) {
  const router = useRouter();
  useVisibleInterval(() => router.refresh(), 2500);
  return (
    <Panel title={status === 'uploaded' ? 'Upload received' : 'Reading your files'}>
      <div className="pr-processing" role="status" aria-live="polite">
        <span className="pr-spinner" aria-hidden="true" />
        <div>
          <p className="strong">
            {status === 'uploaded'
              ? 'Starting…'
              : 'Reading the timesheet — this can take a minute or two.'}
          </p>
          <p className="sm muted">
            {clientName} · {fileNames.length === 1 ? fileNames[0] : `${fileNames.length} files`}.
            This page updates by itself; you can leave it and come back from Process timesheet.
          </p>
        </div>
      </div>
      {stalled ? (
        <p className="sm coral" role="alert">
          This is taking much longer than usual. If it is still here in a few minutes, tell a
          developer.
        </p>
      ) : null}
    </Panel>
  );
}
