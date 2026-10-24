'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, toast } from '@thc/ui';
import { formatUkDate } from '../staff/staff';
import { useConfirm } from '../_components/useConfirm';
import { setAsideTermLetter } from './letterActions';

/**
 * "Not needed — graduated" on a Term Dates Letter (ADR-0213, TK-19), offered
 * only when the worker has told us of a course completion date that has
 * passed. The letter leaves the queue with no message to the worker.
 */
export function TermLetterNotNeededButton({
  docId,
  name,
  completed,
  disabled = false,
}: {
  docId: string;
  name: string;
  /** The completion date they have told us of (ISO). */
  completed: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [pending, start] = useTransition();
  return (
    <>
      <Button
        size="sm"
        tone="ghost"
        disabled={disabled || pending}
        title="They have graduated, so this letter is not needed. Nothing is sent to them."
        onClick={() =>
          confirm.ask({
            title: `Set aside ${name}’s Term Dates Letter?`,
            body: (
              <>
                They have told us their course was completed on <b>{formatUkDate(completed)}</b>, so
                a Term Dates Letter is not needed. It leaves Needs review and nothing is sent to
                them. Their app asks for an Official University Completion Letter instead — approve
                that as usual.
              </>
            ),
            confirm: 'Set aside — not needed',
            onConfirm: () =>
              start(async () => {
                const result = await setAsideTermLetter(docId);
                toast(result.message ?? (result.ok ? 'Set aside.' : 'This could not be done.'), {
                  tone: result.ok ? 'green' : 'coral',
                });
                router.refresh();
              }),
          })
        }
      >
        {pending ? 'Setting aside…' : 'Not needed — graduated'}
      </Button>
      {confirm.dialog}
    </>
  );
}
