'use client';

import { useState } from 'react';
import {
  Alert,
  Button,
  KpiTile,
  Modal,
  Panel,
  Pill,
  SegToggle,
  TableScroll,
  TileGrid,
  useTimeFormat,
} from '@thc/ui';
import { ukStampFull } from '../../_lib/rtwCheck';
import type { EmailPreview } from './email-previews';
import { STAFF_EMAILS, countsFor } from './emails';
import type { EmailRecordKind, StaffEmail, StaffEmailReport } from './emails';
import { RecordsDialog } from './RecordsDialog';

/**
 * "Emails staff receive" on /staff/roster (ADR-0141): every email THC's own
 * staff get while moving onto the new app, how many of each have gone, and
 * a View that shows the email itself — rendered on the server from the
 * register exactly as it is sent, with a sample first name. Each number
 * opens the records behind it (ADR-0144): who, when, and why for one not
 * delivered.
 */
export function EmailsPanel({
  report,
  previews,
  problem,
}: {
  report: StaffEmailReport | null;
  previews: EmailPreview[];
  problem: string | null;
}) {
  const format = useTimeFormat();
  const [open, setOpen] = useState<string | null>(null);
  const [records, setRecords] = useState<{ email: StaffEmail; kind: EmailRecordKind } | null>(null);
  /** A count, as a link to its records when there are any to show. */
  const count = (e: StaffEmail, kind: EmailRecordKind, n: number, label: string) =>
    !report ? (
      '—'
    ) : n > 0 ? (
      <button
        type="button"
        className="linkish"
        onClick={() => setRecords({ email: e, kind })}
        aria-label={`${label}: ${n}. Show who, for ${e.name}`}
      >
        {n.toLocaleString('en-GB')}
      </button>
    ) : (
      0
    );
  const byId = new Map(previews.map((p) => [p.id, p]));
  const email = STAFF_EMAILS.find((e) => e.id === open) ?? null;
  const preview = open ? (byId.get(open) ?? null) : null;
  const notice = countsFor(report, 'OC1:existing_notice');

  return (
    <Panel title="Emails staff receive">
      <p className="muted sm">
        What THC staff are sent while they move onto the new Staff App, and how many of each have
        gone. Click a number to see who it went to. View shows the email exactly as it is sent, with
        a sample name. Sent today counts from midnight, UK time.
      </p>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}
      {report ? (
        <TileGrid columns={3}>
          <KpiTile
            flat
            small
            label="Registered, interview not done"
            value={report.interviewWaiting}
            tone={report.interviewWaiting > 0 ? 'warn' : 'default'}
            description="Getting the daily interview reminder"
          />
          <KpiTile
            flat
            small
            label="One-off notice · sent"
            value={notice.sentTotal}
            tone={notice.sentTotal > 0 ? 'ok' : 'default'}
            description={
              notice.queued > 0 && notice.nextAt
                ? `${notice.queued} waiting, from ${ukStampFull(notice.nextAt, format)}`
                : notice.failedTotal > 0
                  ? `${notice.failedTotal} not delivered`
                  : undefined
            }
          />
          <KpiTile
            flat
            small
            label="Sent today · all of these"
            value={STAFF_EMAILS.reduce((n, e) => n + countsFor(report, e.id).sentToday, 0)}
          />
        </TileGrid>
      ) : null}
      <TableScroll label="Emails staff receive" minWidth="52rem">
        <table className="tbl roster-emails">
          <thead>
            <tr>
              <th>Email</th>
              <th>Who gets it, and when</th>
              <th className="num">Sent today</th>
              <th className="num">Sent in all</th>
              <th className="num">People</th>
              <th className="num">Not delivered</th>
              <th className="num">Waiting</th>
              <th aria-label="View" className="cell-actions" />
            </tr>
          </thead>
          <tbody>
            {STAFF_EMAILS.map((e) => {
              const c = countsFor(report, e.id);
              const on = report ? report.switches[e.template] : true;
              return (
                <tr key={e.id}>
                  <td>
                    <b>{e.name}</b>
                    {!on ? (
                      <>
                        {' '}
                        <Pill tone="amber">Off</Pill>
                      </>
                    ) : null}
                    <div className="sm muted">{byId.get(e.id)?.subject}</div>
                  </td>
                  <td className="sm">
                    {e.to}.<div className="muted">{e.when}.</div>
                  </td>
                  <td className="num">{count(e, 'sent_today', c.sentToday, 'Sent today')}</td>
                  <td className="num">
                    {count(e, 'sent', c.sentTotal, 'Sent in all')}
                    {c.lastSentAt ? (
                      <div className="sm muted">last {ukStampFull(c.lastSentAt, format)}</div>
                    ) : null}
                  </td>
                  <td className="num">{count(e, 'people', c.people, 'People')}</td>
                  <td className="num">{count(e, 'failed', c.failedTotal, 'Not delivered')}</td>
                  <td className="num">{count(e, 'queued', c.queued, 'Waiting')}</td>
                  <td className="cell-actions">
                    <Button
                      size="sm"
                      tone="outline"
                      disabled={!byId.has(e.id)}
                      onClick={() => setOpen(e.id)}
                      aria-label={`View the email: ${e.name}`}
                    >
                      View
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <PreviewDialog email={email} preview={preview} onClose={() => setOpen(null)} />
      {records ? (
        <RecordsDialog
          key={`${records.email.id}:${records.kind}`}
          email={records.email}
          kind={records.kind}
          onClose={() => setRecords(null)}
        />
      ) : null}
    </Panel>
  );
}

/** One email, as staff see it: the HTML in a sandboxed frame, or the plain text. */
function PreviewDialog({
  email,
  preview,
  onClose,
}: {
  email: StaffEmail | null;
  preview: EmailPreview | null;
  onClose: () => void;
}) {
  const [view, setView] = useState<'html' | 'text'>('html');
  return (
    <Modal
      open={email !== null && preview !== null}
      title={email?.name ?? ''}
      onClose={onClose}
      wide
      footer={
        <Button tone="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {email && preview ? (
        <>
          <dl className="roster-email-meta sm">
            <dt>Subject</dt>
            <dd>
              <b>{preview.subject}</b>
            </dd>
            <dt>To</dt>
            <dd>{email.to}</dd>
            <dt>When</dt>
            <dd>{email.when}</dd>
          </dl>
          <div className="roster-email-view">
            <SegToggle
              small
              aria-label="Show the email as"
              value={view}
              onChange={setView}
              options={[
                { value: 'html', label: 'As sent' },
                { value: 'text', label: 'Plain text' },
              ]}
            />
          </div>
          {view === 'html' ? (
            // No scripts, no same-origin: the email can do nothing to the page.
            // Its links may open in a new tab.
            <iframe
              className="roster-email-frame"
              title={`The email: ${preview.subject}`}
              sandbox="allow-popups allow-popups-to-escape-sandbox"
              srcDoc={preview.html}
            />
          ) : (
            <pre className="roster-email-text">{preview.text}</pre>
          )}
        </>
      ) : null}
    </Modal>
  );
}
