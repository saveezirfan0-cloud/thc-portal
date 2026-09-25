'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Avatar, Button, EmptyState, Note, Pill, Select } from '@thc/ui';
import {
  DOCUMENT_FILTERS,
  actionsFor,
  documentLine,
  filterQueue,
  foundLine,
  queueRowCheck,
  ukStamp,
  verifyAllowed,
  uploadedLine,
  verifyHint,
  whoLine,
} from './queue';
import { RtwCheckPanel } from '../_components/RtwCheckPanel';
import { useReviewDialogs } from './ReviewDialogs';
import type { WhoFilter } from './queue';
import type { ActionResult, QueueRow } from './types';

/**
 * Tab 1 · Needs review (§4.1).
 *
 * One row per item waiting on the office, oldest first. Verify and Reject on
 * every row; there is deliberately no "send reminder" anywhere on this screen
 * — the ladder runs itself (§4.2).
 *
 * The completion letter's Verify opens a confirmation rather than acting on
 * the click: the requirement (§2.2) makes the reviewer confirm the course
 * completion date and the visa expiry, and the database refuses the approval
 * without both. So does the Verify of a visa document, a status document or
 * a share code report: the reviewer confirms the right-to-work date it
 * carries, because that date is the per-shift hard stop (20260923200000).
 *
 * The automated gov.uk check (ADR-0025): while it is on, a share code
 * reaches this queue only when its check needs review — with the reason,
 * what gov.uk returned, the report and "Run check again" — and only then is
 * the hand-typed date offered. A check that found no right to work is an
 * item of its own (kind `rtw_check`), cleared with "Mark reviewed".
 *
 * The rtw_date row (20260927160000) is that same confirmation on a share
 * code report verified BEFORE the date was required: the report stays
 * verified, only the date is written — so no Reject, no re-check, no N8.
 */
export function ReviewTab({
  rows,
  rtwCheckEnabled = false,
}: {
  rows: QueueRow[];
  rtwCheckEnabled?: boolean;
}) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [who, setWho] = useState<WhoFilter>('all');
  const [document, setDocument] = useState('any');
  const [result, setResult] = useState<ActionResult | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();

  const visible = useMemo(
    () => filterQueue(rows, { query, who, document }),
    [rows, query, who, document],
  );

  const run = (id: string, action: () => Promise<ActionResult>, after?: () => void) => {
    setResult(null);
    setPendingId(id);
    start(async () => {
      const outcome = await action();
      setResult(outcome);
      setPendingId(null);
      if (outcome.ok) {
        after?.();
        router.refresh();
      }
    });
  };

  // Which action a row's Verify / Reject runs, and the dialogs that ask for a
  // date or a reason first: shared with the /staff/:id Documents tab.
  const { verify, reject, dialogs } = useReviewDialogs({
    run,
    busy: (id) => pendingId === id,
  });

  return (
    <section className="stack" aria-label="Needs review">
      <div className="toolbar">
        <div className="search">
          <input
            className="input"
            style={{ height: 32, width: 240 }}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name"
            aria-label="Search by name"
          />
        </div>
        <Select
          value={who}
          onChange={(event) => setWho(event.target.value as WhoFilter)}
          aria-label="Candidates or staff"
          style={{ height: 32, width: 170 }}
        >
          <option value="all">Candidates + staff</option>
          <option value="candidates">Candidates only</option>
          <option value="staff">Staff only</option>
        </Select>
        <Select
          value={document}
          onChange={(event) => setDocument(event.target.value)}
          aria-label="Document type"
          style={{ height: 32, width: 220 }}
        >
          {DOCUMENT_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <div className="right">
          <span className="muted sm">Oldest first · the menu counter is this number</span>
        </div>
      </div>

      <Alert tone="cyan">
        <b>Why this tab exists:</b> a current worker who re-uploads after an expiry or a rejection
        never reappears on the onboarding kanban. Every profile with a document — or a Criminal
        Record declaration answered Yes (onboarding or in-employment, §10.7) — in the “under review”
        state lands here, candidates and staff alike (§4.1). So does a share code verified before
        the right-to-work date was required — “Right-to-work date missing — re-verify” — until the
        date off the gov.uk report is confirmed (§2.6, §4.4).
      </Alert>

      {result ? (
        <Alert tone={result.ok ? 'green' : 'coral'}>{result.message ?? 'Done.'}</Alert>
      ) : null}

      <div className="panel">
        <div className="panel-b tight">
          {visible.length === 0 ? (
            <EmptyState>
              <h3>{rows.length === 0 ? 'Nothing waiting on the office' : 'Nothing matches'}</h3>
              <p>
                Uploads and Yes declarations appear here the moment they are submitted. Rejected
                candidates and removed workers drop out by themselves.
              </p>
            </EmptyState>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Document</th>
                  <th>Uploaded</th>
                  <th>AI found</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => (
                  <QueueLine
                    key={row.item_id}
                    row={row}
                    rtwCheckEnabled={rtwCheckEnabled}
                    busy={pendingId === row.item_id}
                    onVerify={() => verify(row)}
                    onReject={() => reject(row)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Note>
        <b>Dropped out automatically:</b> once someone is Rejected or Removed their outstanding
        documents no longer need review and leave this queue (§4.1). A “No” Criminal Record answer
        is auto-verified on submission and never appears here (§2.10). References are never reviewed
        and never queue (§2.10). The Official University Completion Letter is reviewed here too:
        approving it confirms the completion date and visa expiry, and the cap follows from the
        completion date (completion letter requirement §2.2–2.3).
      </Note>

      {dialogs}
    </section>
  );
}

function QueueLine({
  row,
  rtwCheckEnabled,
  busy,
  onVerify,
  onReject,
}: {
  row: QueueRow;
  rtwCheckEnabled: boolean;
  busy: boolean;
  onVerify: () => void;
  onReject: () => void;
}) {
  const who = whoLine(row);
  const found = foundLine(row);
  const hint = verifyHint(row);
  const actions = actionsFor(row);
  return (
    <tr>
      <td>
        <div className="person">
          <Avatar name={row.display_name} size="sm" />
          <div>
            <div className="n">
              <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
            </div>
            <div className="s">
              {who.text}
              {who.blocked ? (
                <>
                  {' · '}
                  <span className="coral">{who.blocked}</span>
                </>
              ) : null}
            </div>
          </div>
        </div>
      </td>
      <td>
        <b>{row.item_label}</b>{' '}
        {row.kind === 'declaration' && row.declaration_source === 'in_employment' ? (
          <Pill tone="purple">in-employment</Pill>
        ) : null}
        {row.is_reupload ? <Pill tone="amber">re-upload</Pill> : null}
        {row.kind === 'rtw_check' ? <Pill tone="coral">no right to work</Pill> : null}
        {row.kind === 'rtw_date' ? <Pill tone="coral">re-verify</Pill> : null}
        <span className="sub">
          {documentLine(row)}
          {row.kind === 'declaration' && row.declaration_details ? (
            <> · “{row.declaration_details}” · details visible to Admin only</>
          ) : null}
        </span>
        {row.item_type === 'share_code_report' && row.kind !== 'rtw_date' ? (
          <RtwCheckPanel
            compact
            row={queueRowCheck(row)}
            docId={row.kind === 'document' ? row.item_id : ''}
            docStatus={row.kind === 'document' ? 'pending' : 'rejected'}
            enabled={rtwCheckEnabled}
          />
        ) : null}
      </td>
      <td className="mono sm">
        {ukStamp(row.submitted_at)}
        <span className="sub">{uploadedLine(row)}</span>
      </td>
      <td>
        <span
          className={
            found.confidence === null && row.kind === 'declaration' ? 'found muted' : 'found'
          }
        >
          {found.text}
        </span>
        {found.confidence === 'manual' ? (
          <span className="ai manual">needs manual review</span>
        ) : found.confidence ? (
          <span className={`ai ${found.confidence}`}>
            AI {Math.round((row.ai_confidence ?? 0) * 100)}%
          </span>
        ) : null}
      </td>
      <td style={{ textAlign: 'right' }}>
        {verifyAllowed(row) ? (
          <Button size="sm" tone="green" onClick={onVerify} disabled={busy}>
            {actions.verify}
          </Button>
        ) : null}
        {actions.reject ? (
          <>
            {' '}
            <Button size="sm" tone="danger" onClick={onReject} disabled={busy}>
              Reject
            </Button>
          </>
        ) : null}
        {hint ? <span className="sub muted xs">{hint}</span> : null}
      </td>
    </tr>
  );
}
