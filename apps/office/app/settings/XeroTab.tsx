'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Input, Note, Pill, Select, Switch } from '@thc/ui';
import { xeroProblems } from '../api/xero/_lib/settings';
import type { XeroInvoiceStatus, XeroSettings } from '../api/xero/_lib/settings';
import { Block, Feedback, SaveAction, useSave } from './blocks';
import { saveXero } from './actions';
import { retryXeroInvoice } from './xeroActions';
import type { XeroTabData } from './xeroData';

/**
 * /settings → Xero (ADR-0210 §6, ADR-0211): connect the organisation, say how
 * invoices are posted, and see what did not reach Xero. Owners only, like the
 * rest of /settings. The tokens are never shown or sent to the browser.
 */

const FLASH: Record<string, { tone: 'green' | 'coral'; text: string }> = {
  connected: { tone: 'green', text: 'Xero is connected.' },
  denied: { tone: 'coral', text: 'Xero did not give access, so nothing was connected.' },
  bad_state: {
    tone: 'coral',
    text: 'That sign-in to Xero expired or did not start here. Try Connect again.',
  },
  signed_out: {
    tone: 'coral',
    text: 'Your Back Office sign-in ended. Sign in and try Connect again.',
  },
  forbidden: { tone: 'coral', text: 'Only an owner can connect Xero.' },
  no_organisation: {
    tone: 'coral',
    text: 'No Xero organisation came back. Choose one on the Xero consent screen.',
  },
  not_configured: {
    tone: 'coral',
    text: 'Xero is not set up on this deployment (XERO_* variables missing).',
  },
  failed: { tone: 'coral', text: 'Xero could not be connected. Try again, or ask your developer.' },
};

const STATUS_LABEL: Record<XeroInvoiceStatus, string> = {
  DRAFT: 'Draft (THC checks and approves in Xero)',
  SUBMITTED: 'Awaiting approval',
  AUTHORISED: 'Approved (cannot be edited in Xero)',
};

const ROW_LABEL = {
  pending: 'Waiting',
  syncing: 'Sending',
  failed: 'Failed',
  mismatch: 'Total differs',
} as const;

export function XeroTab({ data, flash }: { data: XeroTabData; flash?: string | null }) {
  const message = flash ? FLASH[flash] : undefined;
  return (
    <div className="stack">
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}
      <div className="settings-grid">
        <ConnectionBlock data={data} />
        <PostingBlock settings={data.settings} />
        <QueueBlock data={data} />
      </div>
    </div>
  );
}

function ConnectionBlock({ data }: { data: XeroTabData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const call = (path: string, done: (body: Record<string, unknown>) => string) => {
    setNote(null);
    setError(null);
    start(async () => {
      try {
        const res = await fetch(path, { method: 'POST' });
        const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok || body['ok'] === false) {
          setError('That did not work. Try again, or ask an owner.');
        } else {
          setNote(done(body));
          router.refresh();
        }
      } catch {
        setError('That did not work. Try again, or ask an owner.');
      }
    });
  };

  const syncSummary = (body: Record<string, unknown>) => {
    if (body['ran'] === false) {
      return body['reason'] === 'disabled'
        ? 'Sending to Xero is switched off below.'
        : 'Nothing to send: Xero is not connected.';
    }
    const c = (body['counts'] ?? {}) as Record<string, number>;
    return `Sent ${c['synced'] ?? 0}, total differs ${c['mismatch'] ?? 0}, failed ${c['failed'] ?? 0}.`;
  };

  return (
    <Block
      title="Connection"
      sub="Every invoice is sent to one Xero organisation, connected once here."
      actions={
        <Pill tone={data.connected ? 'green' : 'neutral'}>
          {data.connected ? 'Connected' : 'Not connected'}
        </Pill>
      }
    >
      {!data.envConfigured ? (
        <Note>
          Xero is not set up on this deployment: XERO_CLIENT_ID, XERO_CLIENT_SECRET and
          XERO_REDIRECT_URI are missing. Nothing is sent to Xero until they are added (see
          docs/12-keys-and-assets.md).
        </Note>
      ) : null}
      {data.connected ? (
        <p>
          Organisation: <b>{data.tenantName ?? 'Xero organisation'}</b>
          <br />
          <span className="sm muted">
            {data.open === 0
              ? 'Nothing waiting.'
              : `${data.open} invoice${data.open === 1 ? '' : 's'} not yet in Xero.`}
          </span>
        </p>
      ) : (
        <p className="sm muted">
          Connect opens Xero. Sign in there, choose the organisation and allow access; you come back
          here. If you have several organisations the first one Xero returns is used and shown here.
        </p>
      )}
      <Feedback note={note} error={error} />
      {data.connected ? (
        <>
          <Button
            tone="primary"
            disabled={pending}
            onClick={() => call('/api/xero/sync', syncSummary)}
          >
            {pending ? 'Working…' : 'Sync now'}
          </Button>
          <Button
            tone="ghost"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm('Disconnect Xero? Nothing more is sent until you connect again.')
              ) {
                call('/api/xero/disconnect', () => 'Xero is disconnected.');
              }
            }}
          >
            Disconnect
          </Button>
        </>
      ) : (
        <Button
          tone="primary"
          disabled={!data.envConfigured}
          onClick={() => window.location.assign('/api/xero/connect')}
        >
          Connect to Xero
        </Button>
      )}
    </Block>
  );
}

function PostingBlock({ settings }: { settings: XeroSettings }) {
  const [draft, setDraft] = useState<XeroSettings>(settings);
  const { note, error, pending, run } = useSave();
  const problems = xeroProblems(draft);
  const shown = (field: keyof typeof problems) => (error && problems[field]) || undefined;
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  return (
    <Block
      title="What is sent"
      sub="Invoices from this number on are sent to Xero as sales invoices in GBP, one Xero line per invoice line."
      actions={
        <Pill tone={settings.enabled ? 'green' : 'neutral'}>{settings.enabled ? 'On' : 'Off'}</Pill>
      }
    >
      <Switch
        checked={draft.enabled}
        onChange={(enabled) => setDraft((d) => ({ ...d, enabled }))}
        label={
          draft.enabled ? 'On — new invoices are sent to Xero' : 'Off — nothing is sent to Xero'
        }
      />
      <Input
        label="First invoice number sent"
        type="number"
        step="1"
        min="1"
        mono
        value={String(draft.from_number)}
        hint="Earlier numbers (the old tool's history) are never sent."
        error={shown('from_number')}
        onChange={(e) =>
          setDraft((d) => ({
            ...d,
            from_number: e.target.value === '' ? Number.NaN : Number(e.target.value),
          }))
        }
      />
      <Select
        label="Status in Xero"
        value={draft.invoice_status}
        hint="Draft lets the accounts team check each invoice before it counts."
        error={shown('invoice_status')}
        onChange={(e) =>
          setDraft((d) => ({ ...d, invoice_status: e.target.value as XeroInvoiceStatus }))
        }
      >
        {(Object.keys(STATUS_LABEL) as XeroInvoiceStatus[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </Select>
      <Input
        label="Sales account code"
        mono
        value={draft.sales_account_code}
        hint="The Xero account every line is posted to (200 is Sales in a standard UK chart)."
        error={shown('sales_account_code')}
        onChange={(e) => setDraft((d) => ({ ...d, sales_account_code: e.target.value }))}
      />
      <Input
        label="Tax type"
        mono
        value={draft.tax_type}
        hint="OUTPUT2 is 20% (VAT on Income). A 0% VAT rate on an invoice is sent as ZERORATEDOUTPUT."
        error={shown('tax_type')}
        onChange={(e) => setDraft((d) => ({ ...d, tax_type: e.target.value }))}
      />
      <Switch
        checked={draft.attach_pdf}
        onChange={(attach_pdf) => setDraft((d) => ({ ...d, attach_pdf }))}
        label={
          draft.attach_pdf ? 'The invoice PDF is attached in Xero' : 'No PDF is attached in Xero'
        }
      />
      <Note>
        A total that differs from ours by even a penny is flagged below, not accepted. An invoice
        voided here after it reached Xero is not voided in Xero: do that there.
      </Note>
      <Feedback note={note} error={error} />
      <SaveAction id="xero" title="Xero" dirty={dirty}>
        <Button tone="primary" disabled={pending} onClick={() => run(() => saveXero(draft))}>
          {pending ? 'Saving…' : 'Save Xero settings'}
        </Button>
      </SaveAction>
    </Block>
  );
}

function QueueBlock({ data }: { data: XeroTabData }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const retry = (id: string) => {
    setError(null);
    start(async () => {
      const result = await retryXeroInvoice(id);
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  };

  return (
    <Block
      className="settings-wide"
      title="Not yet in Xero"
      sub="Invoices waiting, failed, or whose Xero total differs from ours. Failed ones are retried every 15 minutes."
    >
      {data.rows.length === 0 ? (
        <Note>Nothing is waiting.</Note>
      ) : (
        <table className="tbl">
          <thead>
            <tr>
              <th>Invoice</th>
              <th>State</th>
              <th>Detail</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.invoiceId}>
                <td className="mono">{r.number ?? '—'}</td>
                <td>
                  <Pill
                    tone={r.status === 'failed' || r.status === 'mismatch' ? 'coral' : 'neutral'}
                  >
                    {ROW_LABEL[r.status]}
                  </Pill>
                </td>
                <td className="sm">
                  {r.lastError ?? (r.status === 'pending' ? 'Waiting for the next run.' : '')}
                </td>
                <td>
                  {r.status === 'failed' || r.status === 'mismatch' ? (
                    <Button
                      size="sm"
                      tone="ghost"
                      disabled={pending}
                      onClick={() => retry(r.invoiceId)}
                    >
                      Try again
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {error ? <Alert tone="coral">{error}</Alert> : null}
    </Block>
  );
}
