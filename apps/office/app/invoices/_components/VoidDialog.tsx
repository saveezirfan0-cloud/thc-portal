'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Textarea, toast } from '@thc/ui';
import { voidInvoice } from '../_lib/actions';

/**
 * Void Invoice (audit §2.5 "Danger Zone", ADR-0210 §5). A reason is required.
 * The copy says what really happens: the number is never reused (a gap in
 * the series is a void, not a mistake), and the timesheet rows go back to
 * review so the invoice can be raised again on a new number. An invoice
 * already in Xero is told to be voided there too — the platform never edits
 * Xero after the push.
 */
export function VoidDialog({
  invoiceId,
  number,
  source,
  xeroNote,
  open,
  onClose,
}: {
  invoiceId: string;
  number: number;
  source: 'events' | 'timesheet';
  /** Set when the invoice is already in Xero (`voidXeroNote`). */
  xeroNote: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const close = () => {
    if (pending) return;
    setError(null);
    setReason('');
    onClose();
  };

  const submit = () => {
    if (reason.trim() === '') {
      setError('Say why the invoice is being voided.');
      return;
    }
    setError(null);
    start(async () => {
      const result = await voidInvoice(invoiceId, reason);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      toast(`Invoice ${number} voided.`, { tone: 'amber' });
      setReason('');
      onClose();
      router.refresh();
    });
  };

  return (
    <Modal
      open={open}
      title={`Void invoice #${number}`}
      onClose={close}
      dismissible={!pending}
      dirty={reason.trim() !== ''}
      onSubmit={submit}
      footer={
        <>
          <Button tone="ghost" onClick={close} disabled={pending}>
            Keep invoice
          </Button>
          <Button tone="danger" solid type="submit" disabled={pending || reason.trim() === ''}>
            {pending ? 'Voiding…' : 'Void invoice'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="sm">
          The invoice is marked void and keeps its number: <b>the number is never reused</b>, so the
          series shows a void, not a gap.
          {source === 'timesheet'
            ? ' Its timesheet rows go back to review, ready to be invoiced again on a new number.'
            : ' Its events stay as they are.'}
        </p>
        {xeroNote ? <Alert tone="amber">{xeroNote}</Alert> : null}
        <Textarea
          label="Reason (required)"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={3}
          maxLength={500}
          autoFocus
          hint="Kept on the invoice and in the activity log."
        />
        {error ? <Alert tone="coral">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
