import Link from 'next/link';
import { Alert, EmptyState, Panel, Pill } from '@thc/ui';
import { HISTORY_LIMIT, loadFeedbackHistory } from '../data';
import type { FeedbackEntry } from '../data';
import { ukDateShort } from '../format';
import { isRemoved } from '../rules';

/**
 * "Feedback you've given" (ADR-0134 N4) — every entry the customer has left,
 * newest first: worker · event · date · their stars · when they sent it, and
 * the comment they wrote. Read-only: the portal still has no edit or delete
 * (§11.5), and only the customer's OWN entries come back
 * (`client_lineup_v`'s feedback columns, author_kind = client) — the
 * office's notes on the same people never do (§9.10).
 *
 * A server component: nothing here is interactive, and the comments are
 * rendered into the page rather than shipped as props.
 */
export const metadata = { title: 'Feedback you’ve given · THC Client Portal' };

export const dynamic = 'force-dynamic';

export default async function FeedbackHistoryPage() {
  const { entries, truncated, problem } = await loadFeedbackHistory();

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="sm back-link" href="/client">
            ← Your events
          </Link>
          <h1>Feedback you&rsquo;ve given</h1>
          <div className="desc">
            Your own entries, newest first · read-only · once sent, feedback cannot be edited or
            withdrawn from the portal
          </div>
        </div>
      </div>

      {problem ? (
        <Alert tone="amber">{problem}</Alert>
      ) : entries.length === 0 ? (
        <Panel title="Your feedback">
          <EmptyState>
            <h3>No feedback yet</h3>
            <p>
              Once an event has started, you can leave feedback on each person from the
              event&rsquo;s page. It appears here after you send it.
            </p>
          </EmptyState>
        </Panel>
      ) : (
        <Panel
          className="fbh-panel"
          title="Your feedback"
          actions={<Pill>{entries.length === 1 ? '1 entry' : `${entries.length} entries`}</Pill>}
          flush
        >
          <div className="fbh-table">
            <table className="tbl">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Event</th>
                  <th>Your rating</th>
                  <th>Sent</th>
                  <th>Your comment</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.bookingId}>
                    <td>
                      <b className={isRemoved(e) ? 'muted' : undefined}>{e.name}</b>
                      <span className="sub">{e.role}</span>
                    </td>
                    <td>
                      <Link href={`/client/events/${e.eventId}`}>{e.eventTitle}</Link>
                      <span className="sub">
                        {ukDateShort(e.eventStartsAt)} · {e.venueName}
                      </span>
                    </td>
                    <td>
                      <Stars rating={e.rating} />
                    </td>
                    <td className="fbh-sent">{e.sentAt ? ukDateShort(e.sentAt) : '—'}</td>
                    <td className="fbh-text">
                      <Comment entry={e} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* The same entries as cards on a phone; nothing is dropped (§1.2). */}
          <ul className="fbh-cards">
            {entries.map((e) => (
              <li key={e.bookingId} className="ecard">
                <div className="fbh-card-top">
                  <b className={isRemoved(e) ? 'muted' : undefined}>{e.name}</b>
                  <Stars rating={e.rating} />
                </div>
                <div className="m">
                  {e.role} · <Link href={`/client/events/${e.eventId}`}>{e.eventTitle}</Link> ·{' '}
                  {ukDateShort(e.eventStartsAt)}
                </div>
                <div className="fbh-text">
                  <Comment entry={e} />
                </div>
                <div className="sm muted">
                  Sent {e.sentAt ? ukDateShort(e.sentAt) : '—'} · {e.venueName}
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {truncated ? (
        <p className="sm muted mt-16">
          Showing your latest {HISTORY_LIMIT.toLocaleString('en-GB')} entries. For anything older,
          contact THC.
        </p>
      ) : null}
    </>
  );
}

/** "★★★★☆", read out as "4 of 5 stars". */
function Stars({ rating }: { rating: number | null }) {
  if (typeof rating !== 'number' || rating < 1 || rating > 5)
    return <span className="muted">—</span>;
  return (
    <span className="fbh-stars" role="img" aria-label={`${rating} of 5 stars`}>
      {'★'.repeat(rating)}
      <span className="off">{'☆'.repeat(5 - rating)}</span>
    </span>
  );
}

/** The customer's own words, or why there are none. */
function Comment({ entry }: { entry: FeedbackEntry }) {
  if (entry.text) return <q>{entry.text}</q>;
  // §1.7: a removed worker's comment is withheld (the office redacts it by
  // hand); the stars still stand.
  if (isRemoved(entry)) return <span className="muted">Comment not shown — account removed</span>;
  return <span className="muted">No comment</span>;
}
