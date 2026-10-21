'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Modal, Note, Pill } from '@thc/ui';
import { setCriminalRecordsReviewer } from './criminalRecordsActions';
import type { AccountRow } from './data';

/**
 * "Can review criminal records" on a Back Office login (ADR-0180). Only
 * the logins named here decide criminal declarations — Verify, Reject, Ask
 * for more details and Reverse rejection; while nobody is named, owners
 * do. The whole of /users is the owners', and the database refuses anyone
 * else. Not offered on a viewer, who changes nothing.
 */
export function CriminalRecordsToggle({
  account,
  anyoneNamed,
}: {
  account: AccountRow;
  /** Whether any Back Office login is named today. */
  anyoneNamed: boolean;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const on = Boolean(account.reviews_criminal_records);
  if (account.role !== 'admin') return null;
  if (!on && account.office_role === 'viewer') return null;

  const save = () => {
    setProblem(null);
    start(async () => {
      const result = await setCriminalRecordsReviewer(account.id, !on);
      if (!result.ok) {
        setProblem(result.message);
        return;
      }
      setAsking(false);
      router.refresh();
    });
  };

  return (
    <>
      {on ? <Pill tone="purple">Reviews criminal records</Pill> : null}{' '}
      <Button size="sm" tone="ghost" onClick={() => setAsking(true)}>
        {on ? 'Stop criminal record reviews' : 'Allow criminal record reviews'}
      </Button>
      <Modal
        open={asking}
        title={on ? 'Stop reviewing criminal records' : 'Allow reviewing criminal records'}
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setAsking(false)} disabled={pending}>
              Cancel
            </Button>
            <Button tone="primary" onClick={save} disabled={pending}>
              {pending ? 'Saving…' : on ? 'Stop' : 'Allow'}
            </Button>
          </>
        }
      >
        <p className="sm">
          {account.full_name}{' '}
          {on
            ? 'will no longer be able to decide criminal declarations.'
            : 'will be able to decide criminal declarations: Verify, Reject, Ask for more details and Reverse rejection.'}
        </p>
        <Note>
          Only the people allowed here decide criminal declarations; every other office login can
          read them but not decide them. While nobody is allowed, owners decide.
          {!on && !anyoneNamed
            ? ' Allowing this person means owners who are not on the list stop deciding them.'
            : null}
          {on ? ' If they are the last one allowed, owners decide again.' : null} The change is
          recorded in the activity log.
        </Note>
        {problem ? <Note tone="coral">{problem}</Note> : null}
      </Modal>
    </>
  );
}
