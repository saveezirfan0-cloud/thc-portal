import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, Note, Pill } from '@thc/ui';
import type { DocRowView, DocumentsView, OptOutView } from '../model';

/**
 * The Documents tab — §10.4, `wireframes/staff/documents.html`.
 *
 * Presentational and hook-free: `buildDocumentsView()` has already decided
 * every state, so this renders on the server and in a test with nothing in
 * front of it. The one interactive piece — pull to refresh — is the page's.
 *
 * The rows are the wireframe's `.docrow` markup rather than `DocRow` from
 * packages/ui, because the phone's meta line carries a tone (coral for a
 * rejection reason, amber for an expiry) and that component is another
 * session's to change (docs/10 §3). Same classes, same styles.
 */
export function DocumentsHub({
  view,
  notice,
  locked,
  refresh,
  flash,
}: {
  view: DocumentsView;
  /** Lock case 1's alert (§10.1), drawn above everything when locked. */
  notice?: ReactNode;
  /** True while Shifts, Invites and Radar are closed (§4.3). */
  locked: boolean;
  /** The pull-to-refresh control. */
  refresh?: ReactNode;
  /** A one-line confirmation after an upload or a signature. */
  flash?: string | null;
}) {
  return (
    <>
      {notice}
      {refresh}
      {flash ? <Alert tone="green">{flash}</Alert> : null}

      <div className="docs-status">
        <Pill tone={view.statusPill.tone} dot>
          {view.statusPill.text}
        </Pill>
        {view.capLine ? <span className="xs muted">{view.capLine}</span> : null}
      </div>

      {view.attention ? (
        <Alert tone="amber">
          <b>{view.attention.headline}</b>
          {view.attention.detail ? <> {view.attention.detail}</> : null}
        </Alert>
      ) : null}

      <div className="mlist docs-list" data-testid="documents-list">
        {view.rows.map((row) => (
          <Row key={row.key} row={row} />
        ))}
        {view.completion ? <Row row={view.completion} /> : null}
        {view.rows.length === 0 && !view.completion ? (
          <p className="sm muted">No documents on file yet.</p>
        ) : null}
      </div>

      {view.optOut ? <OptOutRow optOut={view.optOut} /> : null}

      {view.history.length > 0 ? (
        <>
          <div className="docs-section-h">Earlier records · read-only</div>
          <div className="mlist docs-list">
            {view.history.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </div>
        </>
      ) : null}

      {locked ? (
        <Note>
          <span className="xs">
            Shifts, Invites and Radar are locked until every document is verified and in date.
            Shifts you were removed from aren’t restored — they may already have gone to someone
            else.
          </span>
        </Note>
      ) : null}

      {view.canDeclare ? (
        <div className="declare">
          <div className="t">Declare a criminal conviction</div>
          <div className="xs muted">
            Your agreement requires you to tell us about any unspent conviction that happens while
            you work for us.
          </div>
          <Link className="btn ghost block sm" href="/documents/declare">
            Declare a criminal conviction ›
          </Link>
        </div>
      ) : null}
    </>
  );
}

function Row({ row }: { row: DocRowView }) {
  const className = [
    'docrow',
    row.tone,
    row.state === 'optional' && 'optional',
    row.state === 'superseded' && 'superseded',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={className} data-state={row.state} data-kind={row.kind}>
      <span className="ico" aria-hidden="true">
        {row.icon}
      </span>
      <div>
        <div className="t">{row.title}</div>
        <div className={row.metaTone ? `m ${row.metaTone}` : 'm'}>{row.meta}</div>
      </div>
      {row.action || row.pill ? (
        <div className="right">
          {row.action ? (
            <Link
              className={row.action.primary ? 'btn primary sm' : 'btn sm'}
              href={row.action.href}
            >
              {row.action.label}
            </Link>
          ) : row.pill ? (
            <Pill tone={row.pill.tone}>{row.pill.text}</Pill>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function OptOutRow({ optOut }: { optOut: OptOutView }) {
  return (
    <div className="mlist docs-list">
      <div className="docrow" data-state={`optout:${optOut.state}`}>
        <span className="ico" aria-hidden="true">
          48
        </span>
        <div>
          <div className="t">{optOut.title}</div>
          <div className="m">{optOut.meta}</div>
        </div>
        <div className="right">
          <Link className="btn sm" href={optOut.action.href}>
            {optOut.action.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
