'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert } from '@thc/ui';
import { useConfirm } from '../_components/useConfirm';
import { deleteTicket } from './actions';
import { ticketRef } from './view-model';

/** "Delete this report" (ADR-0202): owners, behind a confirm; refused while time is logged on it. */
export function DeleteTicket({ id, no }: { id: string; no: number }) {
  const router = useRouter();
  const { ask, dialog } = useConfirm();
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = () =>
    start(async () => {
      setProblem(null);
      const result = await deleteTicket(id);
      if (!result.ok) return setProblem(result.message);
      router.push('/tickets');
    });

  return (
    <div className="tk-delete">
      <button
        type="button"
        className="btn sm danger"
        disabled={pending}
        onClick={() =>
          ask({
            title: `Delete ${ticketRef(no)}?`,
            body: 'The report and its whole thread go for good. This cannot be undone.',
            confirm: 'Delete this report',
            onConfirm: run,
          })
        }
      >
        Delete this report
      </button>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      {dialog}
    </div>
  );
}
