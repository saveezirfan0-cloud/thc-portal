'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, EmptyState, Note, Pill } from '@thc/ui';
import { DeleteFeedbackModal, EditFeedbackModal } from '../../feedback/_components/FeedbackDialogs';
import { OfficeFeedbackForm } from '../../feedback/_components/OfficeFeedbackForm';
import { Stars } from '../../feedback/_components/Stars';
import { quoted, ukNumericDate } from '../../feedback/view-model';
import type { EventOption, FeedbackEntry } from '../../feedback/types';
import { feedbackState } from './profile';
import type { ProfileRow, ShiftRow } from './types';
import '../../feedback/feedback.css';

/**
 * The Feedback tab (§9.6, §9.10): a star input and a feed of entries —
 * stars · author · date · comment.
 *
 * The office adds its own entries here as well as on /feedback, and edits
 * or deletes them from either place. The author is the manager's own name.
 *
 * Client entries are read-only here, and deliberately so: §9.10 puts
 * "Mark as read" on the Feedback screen alone, and an unread client entry
 * does not count toward the rating until it is marked there. The state is
 * shown; the action is not. The one exception is §1.7's — once the worker
 * has been removed, a client entry can be deleted to redact a name.
 */
export function Feedback({
  profile,
  feedback,
  shifts,
  managerName,
}: {
  profile: ProfileRow;
  feedback: FeedbackEntry[];
  shifts: ShiftRow[];
  managerName: string | null;
}) {
  const [editing, setEditing] = useState<FeedbackEntry | null>(null);
  const [deleting, setDeleting] = useState<FeedbackEntry | null>(null);

  // The events this worker was booked on — the only ones an entry may name.
  const events: EventOption[] = shifts.map((shift) => ({
    id: shift.event_id,
    title: shift.event_title,
    date: shift.event_date,
    client: shift.client_name,
  }));

  return (
    <div className="grid c2 fb-profile">
      <div className="stack">
        {profile.removed ? (
          <Note>
            This worker has been removed (§1.7), so no new feedback can be added. Their history
            stays: office entries can still be edited to redact a name, and client entries deleted
            if asked.
          </Note>
        ) : (
          <OfficeFeedbackForm
            variant="profile"
            managerName={managerName}
            worker={{ id: profile.id, name: profile.display_name }}
            events={events}
          />
        )}
        <Note>
          Client feedback here is read-only — it arrives from the Client Portal and &ldquo;Mark as
          read&rdquo; lives only on the <Link href="/feedback">Feedback screen</Link>; it counts
          toward the rating only once marked read. Office entries can be edited or deleted from here
          or from the Feedback screen (§9.10).
        </Note>
      </div>

      <div className="stack" role="list" aria-label="Feedback entries">
        {feedback.length === 0 ? (
          <EmptyState>No feedback yet.</EmptyState>
        ) : (
          feedback.map((entry) => (
            <div className={`fb ${entry.author_kind}`} key={entry.id} role="listitem">
              <div className="h">
                <Stars rating={entry.rating} />
                <span className="who">
                  {/* §9.10: an office entry names the manager; a client entry the client. */}
                  {entry.author_kind === 'office'
                    ? (entry.author_name ?? 'Unknown manager')
                    : (entry.client_name ?? entry.author_name ?? 'Client')}
                </span>
                <Pill tone={entry.author_kind === 'client' ? 'cyan' : 'purple'}>
                  {entry.author_kind}
                </Pill>
                <span className="when">
                  {ukNumericDate(entry.created_at)}
                  {entry.event_title ? ` · ${entry.event_title}` : null}
                  {entry.updated_at ? ' · edited' : null}
                </span>
                {entry.author_kind === 'client' ? (
                  <span className="row ml-auto" style={{ gap: 4 }}>
                    <Pill tone={entry.counts_toward_rating ? 'green' : 'amber'}>
                      {feedbackState(entry)}
                    </Pill>
                    {entry.deletable ? (
                      <Button size="sm" tone="ghost" onClick={() => setDeleting(entry)}>
                        Delete
                      </Button>
                    ) : null}
                  </span>
                ) : (
                  <span className="row ml-auto" style={{ gap: 4 }}>
                    <Button size="sm" tone="ghost" onClick={() => setEditing(entry)}>
                      Edit
                    </Button>
                    <Button size="sm" tone="ghost" onClick={() => setDeleting(entry)}>
                      Delete
                    </Button>
                  </span>
                )}
              </div>
              {quoted(entry.text) ? <div className="sm">{quoted(entry.text)}</div> : null}
            </div>
          ))
        )}
      </div>

      {editing ? (
        <EditFeedbackModal entry={editing} events={events} onClose={() => setEditing(null)} />
      ) : null}
      {deleting ? <DeleteFeedbackModal entry={deleting} onClose={() => setDeleting(null)} /> : null}
    </div>
  );
}
