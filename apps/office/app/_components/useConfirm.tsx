'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { Button, Modal } from '@thc/ui';

export interface ConfirmRequest {
  title: string;
  /** What goes, and what stays. */
  body: ReactNode;
  /** The button that does it: "Remove role". */
  confirm: string;
  onConfirm: () => void;
}

/**
 * The confirm in front of a one-click destructive action (ADR-0137 §1,
 * release audit m3): removing a role from a worker, a qualification or a
 * rate-card role used to happen on the click, with nothing to undo it.
 * `ask(...)` opens the dialog; render `dialog` once in the screen.
 */
export function useConfirm(): { ask: (request: ConfirmRequest) => void; dialog: ReactNode } {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const close = () => setRequest(null);
  const dialog = (
    <Modal
      open={request !== null}
      title={request?.title ?? ''}
      onClose={close}
      footer={
        <>
          <Button tone="ghost" onClick={close} autoFocus>
            Keep it
          </Button>
          <Button
            tone="danger"
            onClick={() => {
              const go = request?.onConfirm;
              close();
              go?.();
            }}
          >
            {request?.confirm ?? 'Remove'}
          </Button>
        </>
      }
    >
      <p className="sm">{request?.body}</p>
    </Modal>
  );
  return { ask: setRequest, dialog };
}
