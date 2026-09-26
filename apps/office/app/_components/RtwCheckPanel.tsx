'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Pill } from '@thc/ui';
import { rtwCheckView } from '../_lib/rtwCheck';
import type { RtwCheckRow } from '../_lib/rtwCheck';
import { markRtwCheckReviewed, rtwReportLink, runRtwCheckAgain } from '../_lib/rtwCheckActions';
import { RtwCheckPhotos } from './RtwCheckPhotos';
import './rtwCheck.css';

/**
 * The automated gov.uk right-to-work check on one share-code document
 * (§2.3, §2.6; ADR-0025): status, source, when, the right-to-work-until
 * gov.uk returned, the conditions, the office's reason when it needs
 * review, "Download gov.uk report", and "Run check again".
 *
 * The same panel on /onboarding/:id, /staff/:id (Documents) and /compliance,
 * so the three never disagree. Every decision it shows is rtwCheckView's.
 *
 * ADR-0041: a finished check (needs review, or passed) sets the gov.uk
 * photo beside the worker's selfie — the admin compares them, then presses
 * the document's own Verify or Reject.
 */
export function RtwCheckPanel({
  row,
  docId,
  docStatus,
  enabled,
  compact = false,
}: {
  row: RtwCheckRow | null;
  docId: string;
  /** compliance_docs.review_status of the document. */
  docStatus: string;
  /** settings.rtw_check.enabled. */
  enabled: boolean;
  compact?: boolean;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const view = rtwCheckView(row, { docStatus, enabled });

  if (!view.status && !view.canRunAgain) return null;

  const act = (work: () => Promise<{ ok: boolean; message?: string; url?: string }>) => {
    setNotice(null);
    start(async () => {
      const result = await work();
      if (result.ok && result.url) {
        window.open(result.url, '_blank', 'noopener');
        return;
      }
      setNotice({ ok: result.ok, text: result.message ?? (result.ok ? 'Done.' : 'Failed.') });
      if (result.ok) router.refresh();
    });
  };

  return (
    <div className={compact ? 'rtwcheck compact' : 'rtwcheck'}>
      <div className="row wrap">
        <b>Automatic gov.uk check</b>
        {view.status ? (
          <Pill tone={view.status.tone}>{view.status.label}</Pill>
        ) : (
          <Pill>Not run yet</Pill>
        )}
      </div>
      {view.reason ? (
        <div
          className={
            view.recommendation === 'verify'
              ? 'rtwcheck-reason verify sm'
              : view.recommendation === 'reject'
                ? 'rtwcheck-reason reject sm'
                : 'rtwcheck-reason sm'
          }
        >
          {view.reason}
        </div>
      ) : null}
      {view.lines.length > 0 ? (
        <dl className="rtwcheck-kv">
          {view.lines.map((line) => (
            <div key={line.k} className="rtwcheck-line">
              <dt>{line.k}</dt>
              <dd>{line.v}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {row && (row.status === 'needs_review' || row.status === 'passed') ? (
        <RtwCheckPhotos key={row.check_id} checkId={row.check_id} />
      ) : null}
      {view.hasReport || view.canRunAgain || view.canMarkReviewed ? (
        <div className="row wrap">
          {view.hasReport && row ? (
            <Button
              size="sm"
              disabled={busy}
              onClick={() => act(() => rtwReportLink(row.check_id))}
            >
              Download gov.uk report
            </Button>
          ) : null}
          {view.canRunAgain ? (
            <Button
              size="sm"
              tone="outline"
              disabled={busy}
              onClick={() => act(() => runRtwCheckAgain(docId))}
            >
              {row ? 'Run check again' : 'Run gov.uk check'}
            </Button>
          ) : null}
          {view.canMarkReviewed && row ? (
            <Button
              size="sm"
              tone="green"
              disabled={busy}
              onClick={() => act(() => markRtwCheckReviewed(row.check_id))}
            >
              Mark reviewed
            </Button>
          ) : null}
        </div>
      ) : null}
      {notice ? <div className={notice.ok ? 'sm muted' : 'sm coral'}>{notice.text}</div> : null}
    </div>
  );
}
