'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button } from '@thc/ui';
import type { ChangeKind } from '@thc/domain';
import { requestHref } from '../change-requests';
import type { StatusLine } from '../change-requests';
import { withdrawChange } from './request/actions';

/**
 * The status line under a locked field (ADR-0045):
 *
 *   pending   amber — "Name change requested · with the office" + Withdraw
 *   rejected  coral — "Not changed: {reason}" + Request again
 *
 * The office's reason is required on a rejection and is shown to the
 * worker as written (the `compliance_docs.rejection_reason` precedent).
 */
export function ChangeStatus({ kind, line }: { kind: ChangeKind; line: StatusLine }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!line) return null;

  if (line.state === 'rejected') {
    return (
      <div className="req-status coral" role="status">
        <span>{line.text}</span>
        <Link className="btn ghost sm" href={requestHref(kind)}>
          Request again
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="req-status amber" role="status">
        <span>{line.text}</span>
        <Button
          tone="ghost"
          size="sm"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await withdrawChange(line.id);
              if (!result.ok) setError(result.message);
              else router.refresh();
            })
          }
        >
          Withdraw
        </Button>
      </div>
      <div className="xs muted">{line.detail}</div>
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </>
  );
}
