'use client';

import { useState } from 'react';
import { Button } from '@thc/ui';
import { EmailModal } from './EmailModal';
import type { EmailInit } from './EmailModal';
import { RedrawButton } from './RedrawButton';
import { VoidDialog } from './VoidDialog';

/**
 * The header buttons of an invoice (audit §2.5): Download PDF, Download
 * Excel, Email Invoice, Void Invoice — and Re-draw while a timesheet invoice
 * has no PDF. Re-generate is not carried over (ADR-0210: an issued invoice is
 * never rewritten; a correction is a void and a new invoice).
 *
 * `canWrite` is the viewer's `office_can('write')` (ADR-0060): without it the
 * write buttons are not drawn, the downloads stay.
 */
export function InvoiceActions({
  invoiceId,
  number,
  source,
  can,
  hasExcel,
  canWrite,
  xeroNote,
  mail,
}: {
  invoiceId: string;
  number: number;
  source: 'events' | 'timesheet';
  can: { void: boolean; email: boolean; redraw: boolean; files: boolean };
  hasExcel: boolean;
  canWrite: boolean;
  xeroNote: string | null;
  /** Present for a timesheet invoice that can be emailed. */
  mail: EmailInit | null;
}) {
  const [emailing, setEmailing] = useState(false);
  const [voiding, setVoiding] = useState(false);

  return (
    <div className="inv-actions">
      {can.files ? (
        <a className="btn" href={`/api/invoices/${invoiceId}`}>
          Download PDF
        </a>
      ) : null}
      {can.files && hasExcel ? (
        <a className="btn" href={`/api/invoices/${invoiceId}/excel`}>
          Download Excel
        </a>
      ) : null}
      {canWrite && can.email && mail ? (
        <Button tone="green" onClick={() => setEmailing(true)}>
          Email Invoice
        </Button>
      ) : null}
      {canWrite && can.redraw ? <RedrawButton invoiceId={invoiceId} /> : null}
      {canWrite && can.void ? (
        <Button tone="danger" onClick={() => setVoiding(true)}>
          Void Invoice
        </Button>
      ) : null}

      {mail ? (
        <EmailModal
          invoiceId={invoiceId}
          number={number}
          init={mail}
          open={emailing}
          onClose={() => setEmailing(false)}
        />
      ) : null}
      <VoidDialog
        invoiceId={invoiceId}
        number={number}
        source={source}
        xeroNote={xeroNote}
        open={voiding}
        onClose={() => setVoiding(false)}
      />
    </div>
  );
}
