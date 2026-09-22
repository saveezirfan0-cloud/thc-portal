'use client';

import { Note, Panel, Pill } from '@thc/ui';
import { formatUkDate } from '../staff';
import { feedbackState } from './profile';
import type { FeedbackRow } from './types';

/**
 * The Feedback tab (§9.6): client and office entries, stars and comments.
 *
 * Read-only, and deliberately. §9.10 puts "Mark as read" on the Feedback
 * screen alone, and an unread client entry does not count toward the
 * rating until it is marked there — so a second control here would be a
 * second place for the displayed rating to drift from the one the
 * auto-assign score uses (§6). The state is shown; the action is not.
 */
function stars(rating: number): string {
  return '★'.repeat(rating) + '☆'.repeat(5 - rating);
}

export function Feedback({ feedback }: { feedback: FeedbackRow[] }) {
  return (
    <div className="stack">
      <Panel
        title="Feedback"
        actions={<span className="muted sm">from clients and from the office (§9.10)</span>}
      >
        {feedback.length === 0 ? (
          <div className="empty">No feedback yet.</div>
        ) : (
          <div className="stack">
            {feedback.map((row) => (
              <div className={`fb ${row.author_kind}`} key={row.id}>
                <div className="h">
                  <span
                    className={`stars ${row.rating >= 4 ? 'green' : row.rating >= 3 ? 'amber' : 'coral'}`}
                  >
                    {stars(row.rating)}
                  </span>
                  <span className="who">{row.author_name ?? 'Unknown'}</span>
                  <Pill tone={row.author_kind === 'client' ? 'cyan' : 'purple'}>
                    {row.author_kind}
                  </Pill>
                  <span className="when">
                    {formatUkDate(row.created_at)} · {row.event_title}
                  </span>
                  <Pill tone={row.counts_toward_rating ? 'green' : 'amber'} className="ml-auto">
                    {feedbackState(row)}
                  </Pill>
                </div>
                {row.text ? <div className="sm">{row.text}</div> : null}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Note>
        Client feedback is read-only here: it arrives from the Client Portal and &ldquo;Mark as
        read&rdquo; lives only on the <b>Feedback</b> screen, where it starts counting toward the
        rating. Office entries are added and edited there too (§9.10).
      </Note>
    </div>
  );
}
