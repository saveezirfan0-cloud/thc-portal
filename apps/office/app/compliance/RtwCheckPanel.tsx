'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Pill } from '@thc/ui';
import { rerunRtwCheck, rtwCheckPhotos } from './rtwCheckActions';
import { RTW_COMPARE_PHOTOS } from './rtwCheck';
import type { RerunResult, RtwCheckView } from './rtwCheck';
import './rtwCheck.css';

/**
 * The gov.uk share-code check's result, the same on all three screens that
 * show a share code report (ADR-0025): the candidate profile, the staff
 * profile's Documents tab and the Compliance queue's Verify / Reject.
 *
 * It shows what the check found and nothing more. Verify and Reject stay
 * each screen's own existing actions (ADR-0018); this panel only adds the
 * result, the photo comparison and "Run check again".
 */
export function RtwCheckPanel({
  docId,
  check,
  canRerun,
  hideUntil = false,
  onOpenReport,
}: {
  docId: string;
  check: RtwCheckView;
  /** A pending share code report (canRerunRtwCheck). */
  canRerun: boolean;
  /** The host shows the right-to-work-until itself, as the thing Verify confirms. */
  hideUntil?: boolean;
  /** Where the host has no "Open report" of its own. */
  onOpenReport?: () => void;
}) {
  const done = check.state === 'done';
  return (
    <div className="rtwcheck stack" aria-label="gov.uk right-to-work check">
      <div className="row wrap">
        <Pill tone={check.tone}>{check.headline}</Pill>
        <span className="rtwcheck-source">{check.source}</span>
      </div>

      {check.reasons.length > 0 ? (
        <ul className="rtwcheck-reasons">
          {check.reasons.map((reason, i) => (
            <li key={i}>{reason}</li>
          ))}
        </ul>
      ) : null}

      {check.state === 'failed' ? (
        <div className="muted sm">
          The automatic check did not get a result. Check the share code by hand on
          gov.uk/view-right-to-work, then Verify or Reject as usual.
        </div>
      ) : null}

      {done ? (
        <div className="rtwcheck-kv">
          <span className="k">Source</span>
          <span>{check.source}</span>
          <span className="k">Checked</span>
          <span>{check.checkedAt ?? '—'}</span>
          {check.holderName ? (
            <>
              <span className="k">Name on gov.uk</span>
              <span>{check.holderName}</span>
            </>
          ) : null}
          {hideUntil ? null : (
            <>
              <span className="k">Right to work until</span>
              <span>
                <b>{check.untilLabel ?? '—'}</b>
              </span>
            </>
          )}
          <span className="k">Permission</span>
          <span>{check.permissionType ?? '—'}</span>
          <span className="k">Conditions</span>
          <span>{check.conditions ?? '—'}</span>
        </div>
      ) : null}

      {done ? <RtwPhotoCompare docId={docId} version={check.checkedAt} /> : null}

      <div className="row wrap">
        {onOpenReport && check.hasReport ? (
          <Button size="sm" onClick={onOpenReport}>
            Open report
          </Button>
        ) : null}
        {canRerun ? <RtwRerunButton docId={docId} disabled={check.state === 'checking'} /> : null}
      </div>
    </div>
  );
}

/**
 * "Run check again". Also used on its own where a pending share code has
 * no check at all (submitted before the check was switched on), so the
 * office can start one — or learn that it is switched off.
 */
export function RtwRerunButton({
  docId,
  disabled = false,
  label = 'Run check again',
}: {
  docId: string;
  disabled?: boolean;
  label?: string;
}) {
  const router = useRouter();
  const [busy, start] = useTransition();
  const [result, setResult] = useState<RerunResult | null>(null);
  return (
    <>
      <Button
        size="sm"
        tone="ghost"
        disabled={disabled || busy}
        onClick={() => {
          setResult(null);
          start(async () => {
            const outcome = await rerunRtwCheck(docId);
            setResult(outcome);
            if (outcome.ok) router.refresh();
          });
        }}
      >
        {busy ? 'Queuing…' : label}
      </Button>
      {result ? (
        <div className="rtwcheck-result">
          <Alert tone={result.ok ? 'cyan' : 'amber'}>{result.message}</Alert>
        </div>
      ) : null}
    </>
  );
}

/**
 * The gov.uk photo beside the app selfie. Signed on demand by a server
 * action that reads both paths itself — the browser never names a path.
 */
function RtwPhotoCompare({ docId, version }: { docId: string; version: string | null }) {
  const [urls, setUrls] = useState<{ gov: string | null; selfie: string | null } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setUrls(null);
    setProblem(null);
    rtwCheckPhotos(docId).then(
      (result) => {
        if (!live) return;
        if (result.ok) setUrls({ gov: result.govPhotoUrl, selfie: result.selfieUrl });
        else setProblem(result.message);
      },
      () => {
        if (live) setProblem('The photos could not be loaded.');
      },
    );
    return () => {
      live = false;
    };
  }, [docId, version]);

  return (
    <div className="rtwcheck-photos stack">
      <div className="rtwcheck-label">{RTW_COMPARE_PHOTOS}</div>
      {problem ? <div className="muted sm">{problem}</div> : null}
      <div className="rtwcheck-pair">
        <PhotoFrame
          caption="gov.uk photo"
          url={urls?.gov ?? null}
          loading={urls === null && !problem}
        />
        <PhotoFrame
          caption="App selfie"
          url={urls?.selfie ?? null}
          loading={urls === null && !problem}
        />
      </div>
    </div>
  );
}

function PhotoFrame({
  caption,
  url,
  loading,
}: {
  caption: string;
  url: string | null;
  loading: boolean;
}) {
  return (
    <figure className="rtwcheck-photo">
      <div className="frame">
        {url ? (
          <img src={url} alt={caption} />
        ) : (
          <span className="muted xs">{loading ? 'Loading…' : 'No photo'}</span>
        )}
      </div>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}
