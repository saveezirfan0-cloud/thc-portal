'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Alert, Button, Pill } from '@thc/ui';
import { DecideDialog } from '../requests/DecideDialog';
import type { DecideStage } from '../requests/DecideDialog';
import { nameBefore, nameRequested, ukStamp } from '../requests/model';
import type { ChangeRequestView } from '../requests/types';

/**
 * The pending change-request banner on /staff/:id (ADR-0045),
 * `wireframes/backoffice/change-requests.html` → "Overview cards".
 *
 * One line per pending request — at most one name and one photo, the
 * database allows no more — with Review opening the same decide dialog the
 * /staff/requests queue uses, so the two places cannot decide differently.
 * When the requests could not be read it says so (audit D18): no banner
 * would tell the office nothing is pending.
 */
export function ChangeRequestBanner({
  requests,
  problem = null,
}: {
  requests: ChangeRequestView[];
  problem?: string | null;
}) {
  const [open, setOpen] = useState<{ id: string; stage: DecideStage } | null>(null);
  const current = requests.find((row) => row.id === open?.id) ?? null;

  if (problem) {
    return (
      <Alert tone="coral">
        The change requests could not be read: {problem}{' '}
        <Link href="/staff/requests">Open the queue</Link>
      </Alert>
    );
  }
  if (requests.length === 0) return null;
  return (
    <>
      {requests.map((row) => (
        <div className="cr-banner" key={row.id}>
          <Pill tone="amber">Pending</Pill>
          <span>
            {row.kind === 'name' ? (
              <>
                Name change requested —{' '}
                <b>
                  {nameBefore(row) ?? '—'} → {nameRequested(row) ?? '—'}
                </b>
              </>
            ) : (
              <>Photo change requested</>
            )}{' '}
            · <span className="mono sm">{ukStamp(row.created_at)}</span>
          </span>
          <span className="ml-auto row">
            <Link href="/staff/requests" className="sm">
              All requests
            </Link>
            <Button size="sm" onClick={() => setOpen({ id: row.id, stage: 'review' })}>
              Review
            </Button>
          </span>
        </div>
      ))}
      <DecideDialog
        key={open?.id ?? 'none'}
        request={current}
        stage={open?.stage ?? 'review'}
        onStage={(stage) => setOpen((was) => (was ? { ...was, stage } : was))}
        onClose={() => setOpen(null)}
      />
    </>
  );
}
