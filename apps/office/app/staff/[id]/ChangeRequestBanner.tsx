'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Pill } from '@thc/ui';
import { DecideDialog } from '../requests/DecideDialog';
import type { DecideStage } from '../requests/DecideDialog';
import { nameBefore, nameRequested, ukStamp } from '../requests/model';
import type { ChangeRequestView } from '../requests/types';

/**
 * The pending change-request banner on /staff/:id (ADR-0038),
 * `wireframes/backoffice/change-requests.html` → "Overview cards".
 *
 * One line per pending request — at most one name and one photo, the
 * database allows no more — with Review opening the same decide dialog the
 * /staff/requests queue uses, so the two places cannot decide differently.
 */
export function ChangeRequestBanner({ requests }: { requests: ChangeRequestView[] }) {
  const [open, setOpen] = useState<{ id: string; stage: DecideStage } | null>(null);
  const current = requests.find((row) => row.id === open?.id) ?? null;

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
