'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, Button, Panel, Pill, useVisibleInterval } from '@thc/ui';
import type { Tone } from '@thc/ui';
import { backToReview, generateInvoices, redrawInvoice } from '../actions';
import { gbp, invoiceTotalValue, plural, ukDate } from '../view-model';
import type { IssuedInvoice } from '../types';

/**
 * Step 4 · Generate (audit §2.2). "Generate" numbers every confirmed
 * invoice that has no number yet and draws its PDF; pressing it twice, or
 * refreshing mid-way, only ever issues what is still missing. A PDF that
 * fails to draw keeps its number — Re-draw tries again.
 */
const STATUS: Readonly<Record<string, { label: string; tone: Tone }>> = {
  generated: { label: 'Generated', tone: 'green' },
  queued: { label: 'Sent', tone: 'cyan' },
  drawing: { label: 'Drawing…', tone: 'amber' },
  failed: { label: 'PDF failed', tone: 'coral' },
  void: { label: 'Void', tone: 'neutral' },
};

export function GenerateScreen({
  jobId,
  status,
  invoices,
  pendingGroups,
  canAct,
}: {
  jobId: string;
  status: 'confirmed' | 'complete';
  invoices: IssuedInvoice[];
  /** Confirmed groups that have no invoice yet (computed on the server). */
  pendingGroups: number;
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [redrawing, setRedrawing] = useState<string | null>(null);
  const inFlight = useRef(false);

  const pending = pendingGroups;
  const drawing = invoices.some((i) => i.status === 'drawing' && !i.stale);
  useVisibleInterval(() => {
    if (drawing) router.refresh();
  }, 3000);

  async function generate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await generateInvoices(jobId);
      if ('error' in result) {
        setError(result.error);
      } else {
        setFailed(Object.fromEntries(result.drawFailed.map((f) => [f.invoiceId, f.error])));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
      router.refresh();
    }
  }

  async function redraw(invoiceId: string) {
    setRedrawing(invoiceId);
    const result = await redrawInvoice(invoiceId);
    setRedrawing(null);
    setFailed((prev) => {
      const next = { ...prev };
      if ('error' in result) next[invoiceId] = result.error;
      else delete next[invoiceId];
      return next;
    });
    router.refresh();
  }

  async function goBack() {
    setBusy(true);
    const result = await backToReview(jobId);
    setBusy(false);
    if ('error' in result) setError(result.error);
    else router.push(`/invoices/process/${jobId}`);
    router.refresh();
  }

  const live = invoices.filter((i) => i.status !== 'void');
  const value = invoiceTotalValue(invoices);
  const noInvoices = invoices.length === 0;

  return (
    <div className="pr-generate stack">
      {status === 'confirmed' && pending > 0 ? (
        <Panel title="Ready to generate">
          <p className="sm">
            {plural(pending, 'invoice')} will be numbered and drawn. Each takes the next invoice
            number, so this cannot be undone — an invoice can only be voided afterwards.
          </p>
          <div className="row pr-actions">
            {invoices.length === 0 ? (
              <Button disabled={!canAct || busy} onClick={goBack}>
                Back to review
              </Button>
            ) : null}
            <Button tone="primary" disabled={!canAct || busy} onClick={generate}>
              {busy ? 'Generating…' : `Generate ${plural(pending, 'invoice')}`}
            </Button>
          </div>
        </Panel>
      ) : null}

      {error ? <Alert tone="coral">{error}</Alert> : null}

      {status === 'complete' && noInvoices ? (
        <Panel>
          <p className="strong">This job was closed without any invoice.</p>
          <p className="sm muted">
            It was discarded from the review list, or every invoice made from it has been voided.
          </p>
        </Panel>
      ) : null}

      {live.length > 0 ? (
        <Alert tone="green">
          <b>
            {plural(live.length, 'invoice')} {live.length === 1 ? 'is' : 'are'} generated.
          </b>{' '}
          Total value {gbp(value)} including VAT.
        </Alert>
      ) : null}

      {invoices.map((inv) => {
        const info = STATUS[inv.status] ?? { label: inv.status, tone: 'neutral' as Tone };
        const problem = failed[inv.id] ?? (inv.status === 'failed' ? inv.lastError : null);
        const canRedraw = inv.status === 'failed' || (inv.status === 'drawing' && inv.stale);
        const ready = inv.status === 'generated' || inv.status === 'queued';
        return (
          <Panel key={inv.id} className="pr-invoice">
            <div className="pr-invoice-head">
              <div>
                <h3 className="pr-h3">Invoice #{inv.number}</h3>
                <div className="pr-badges">
                  <Pill tone={info.tone}>{info.label}</Pill>
                  <Pill>{inv.format === 'aggregated' ? 'Role aggregated' : 'Named staff'}</Pill>
                </div>
                <p className="sm muted">
                  {inv.clientName}
                  {inv.poNumber ? ` · PO ${inv.poNumber}` : ''} · {ukDate(inv.invoiceDate)}
                </p>
              </div>
              <div className="pr-invoice-amount">
                <span className="mono strong">{gbp(inv.total)}</span>
                <span className="xs muted">
                  {gbp(inv.net)} + VAT {gbp(inv.vat)}
                </span>
              </div>
            </div>

            {problem || canRedraw ? (
              <Alert tone="coral">
                The PDF for this invoice could not be drawn{problem ? `: ${problem}` : '.'} The
                number #{inv.number} is kept — nothing is lost.
              </Alert>
            ) : null}
            {inv.status === 'drawing' && !inv.stale ? (
              <p className="sm muted" role="status">
                Drawing the PDF…
              </p>
            ) : null}

            <div className="row pr-actions">
              {ready ? (
                <>
                  <Button
                    size="sm"
                    aria-expanded={preview === inv.id}
                    onClick={() => setPreview(preview === inv.id ? null : inv.id)}
                  >
                    {preview === inv.id ? 'Hide preview' : 'Preview'}
                  </Button>
                  <a className="btn sm" href={`/api/invoices/${inv.id}`} download>
                    Download PDF
                  </a>
                  <a className="btn sm" href={`/api/invoices/${inv.id}/excel`} download>
                    Download Excel
                  </a>
                  <Link className="btn sm primary" href={`/invoices/${inv.id}?email=1`}>
                    Email invoice
                  </Link>
                </>
              ) : null}
              {canRedraw ? (
                <Button
                  size="sm"
                  tone="primary"
                  disabled={!canAct || redrawing === inv.id}
                  onClick={() => redraw(inv.id)}
                >
                  {redrawing === inv.id ? 'Drawing…' : 'Re-draw'}
                </Button>
              ) : null}
              <Link className="btn sm ghost" href={`/invoices/${inv.id}`}>
                Open invoice
              </Link>
            </div>

            {preview === inv.id ? (
              <iframe
                className="pr-frame pr-preview"
                title={`Invoice ${inv.number} preview`}
                src={`/api/invoices/${inv.id}`}
              />
            ) : null}
          </Panel>
        );
      })}

      <div className="pr-footer-links">
        <Link className="btn" href="/invoices">
          ← Back to Invoices
        </Link>
        <Link className="btn primary" href="/invoices/process">
          Process another timesheet
        </Link>
      </div>
    </div>
  );
}
