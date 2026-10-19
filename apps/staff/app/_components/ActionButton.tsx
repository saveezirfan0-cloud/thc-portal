'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal } from '@thc/ui';
import type { ButtonTone } from '@thc/ui';
import type { ActionResult, Refusal } from '../actions';
import { isStaleDeploy, reloadForNewBuild } from '../_lib/stale-deploy';

/**
 * Go-live audit B5: the press got no answer at all (no signal, a gateway
 * timeout). Without this the rejection escaped to error.tsx and replaced
 * the whole screen.
 */
export const NO_ANSWER: Refusal = {
  title: 'That didn’t go through',
  body: 'We couldn’t reach THC. Check your signal and try again.',
};

/**
 * One of the worker's buttons, with the confirmation dialog §10.4 puts in
 * front of it and the refusal dialog the server may answer with.
 *
 * Both halves are here rather than on each screen because the refusals are
 * the part that matters and the part nobody remembers to build: "Sorry, this
 * shift has been taken", "You're already booked for an overlapping shift",
 * "Sorry, this shift is now full". Every one of them is a race the worker
 * lost between the screen loading and the tap, and each has its own words.
 */
export function ActionButton({
  label,
  tone,
  solid,
  block,
  size,
  action,
  confirm,
  disabled,
  disabledLabel,
  onDone,
}: {
  label: string;
  tone?: ButtonTone;
  solid?: boolean;
  block?: boolean;
  size?: 'sm' | 'lg';
  /** A server action already bound to its booking or shift id. */
  action: () => Promise<ActionResult>;
  /** The dialog shown BEFORE it runs. Omitted, the press is immediate. */
  confirm?: { title: string; body: string; confirmLabel: string; keepLabel: string };
  disabled?: boolean;
  /** What the button reads when disabled — "Limit Reached" (RULE-20). */
  disabledLabel?: string;
  /**
   * Where to go once it succeeds. The shift screen's Cancel shift uses it:
   * the booking it was showing is no longer the worker's to look at.
   */
  onDone?: string;
}) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run() {
    start(async () => {
      let result: ActionResult;
      try {
        result = await action();
      } catch (e) {
        setAsking(false);
        // A phone on an older build than the server: load the new one.
        if (isStaleDeploy(e) && reloadForNewBuild()) return;
        setRefusal(NO_ANSWER);
        return;
      }
      setAsking(false);
      if ('refusal' in result) setRefusal(result.refusal);
      else if (result.note) setNote(result.note);
      else if (onDone) router.replace(onDone);
    });
  }

  if (disabled) {
    return (
      <Button block={block} {...(size ? { size } : {})} disabled>
        {disabledLabel ?? label}
      </Button>
    );
  }

  return (
    <>
      <Button
        block={block}
        {...(size ? { size } : {})}
        {...(tone ? { tone } : {})}
        {...(solid ? { solid } : {})}
        disabled={pending}
        onClick={() => (confirm ? setAsking(true) : run())}
      >
        {pending ? 'Working…' : label}
      </Button>

      {confirm ? (
        <Modal
          open={asking}
          title={confirm.title}
          onClose={() => setAsking(false)}
          footer={
            <>
              <Button onClick={() => setAsking(false)}>{confirm.keepLabel}</Button>
              <Button
                {...(tone ? { tone } : { tone: 'primary' as ButtonTone })}
                solid
                disabled={pending}
                onClick={run}
              >
                {pending ? 'Working…' : confirm.confirmLabel}
              </Button>
            </>
          }
        >
          <p className="muted">{confirm.body}</p>
        </Modal>
      ) : null}

      <Modal
        open={refusal !== null}
        title={refusal?.title ?? ''}
        onClose={() => setRefusal(null)}
        footer={
          <>
            <Button onClick={() => setRefusal(null)}>OK</Button>
            {refusal?.action ? (
              <Link className="btn primary solid" href={refusal.action.href}>
                {refusal.action.label}
              </Link>
            ) : null}
          </>
        }
      >
        <p className="muted">{refusal?.body}</p>
      </Modal>

      <Modal
        open={note !== null}
        title="Booked"
        onClose={() => setNote(null)}
        footer={<Button onClick={() => setNote(null)}>OK</Button>}
      >
        <Alert tone="cyan">{note}</Alert>
      </Modal>
    </>
  );
}
