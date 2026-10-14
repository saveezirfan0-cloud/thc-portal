'use client';

import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { Alert, Avatar, Button, Modal, Textarea } from '@thc/ui';
import { FEEDBACK_SIGNED_OUT, FEEDBACK_TEXT_MAX, FEEDBACK_TOO_LONG, starsHint } from '../../rules';
import type { LineupRow } from '../../rules';
import { leaveFeedback } from './actions';
import { StarIcon, isAlreadyLeft, sessionLapsed, starForKey } from './FeedbackModal';
import { sendLabel, sendQueue, sendSummary, tooLong } from './rate-all';
import type { RateDraft, RateState } from './rate-all';

/**
 * "Rate everyone" (ADR-0134 P4): one dialog for every worker on the visible
 * line-up still to rate, instead of one popup each.
 *
 * No new write path: each rated row is sent through `leaveFeedback` —
 * `submit_client_feedback()` — on its own, one after another, so the
 * database applies every rule to every entry and one refusal is reported on
 * its own row while the rest go through. A row left without stars is
 * skipped. The single-person "Leave feedback" stays exactly as it was.
 *
 * The list is taken when the dialog opens and held until it closes: each
 * send re-reads the page (the action revalidates it), and the rows must not
 * vanish from under the customer as their entries land.
 */
const FAILED = 'Could not be sent. Check your connection and try again.';

export function RateEveryone({
  eventId,
  eventTitle,
  eventDate,
  people,
  photos,
  onSent,
}: {
  eventId: string;
  eventTitle: string;
  /** "Fri 19 Sep 2026", as the single popup's subtitle. */
  eventDate: string;
  /** Everyone still to rate (`stillToRate`), in the page's order. */
  people: LineupRow[];
  /** Signed photo URLs keyed by `bookingId`. */
  photos: Record<string, string>;
  /** These rows are saved: the page marks them "✓ Feedback sent" at once. */
  onSent: (bookingIds: string[]) => void;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [roster, setRoster] = useState<LineupRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, RateDraft>>({});
  const [states, setStates] = useState<Record<string, RateState>>({});
  const [comments, setComments] = useState<ReadonlySet<string>>(() => new Set());
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null);
  const [signedOut, setSignedOut] = useState(false);
  const pending = progress !== null;

  function start() {
    setRoster(people);
    setDrafts({});
    setStates({});
    setComments(new Set());
    setSignedOut(false);
    setOpen(true);
  }

  function close() {
    if (pending) return;
    setOpen(false);
  }

  const draft = (id: string): RateDraft => drafts[id] ?? { rating: 0, text: '' };
  const setDraft = (id: string, patch: Partial<RateDraft>) =>
    setDrafts((all) => ({ ...all, [id]: { rating: 0, text: '', ...all[id], ...patch } }));
  const setState = (id: string, state: RateState) => setStates((all) => ({ ...all, [id]: state }));

  const queue = sendQueue(roster, drafts, states);

  async function send() {
    if (queue.length === 0 || pending) return;
    const over = tooLong(drafts, queue);
    if (over.length > 0) {
      for (const id of over) setState(id, { state: 'failed', message: FEEDBACK_TOO_LONG });
      return;
    }
    setSignedOut(false);
    const saved: string[] = [];
    let failed = 0;
    for (const [i, id] of queue.entries()) {
      setProgress({ done: i, of: queue.length });
      setState(id, { state: 'sending' });
      const { rating, text } = draft(id);
      let result: Awaited<ReturnType<typeof leaveFeedback>>;
      try {
        result = await leaveFeedback(eventId, id, rating, text);
      } catch {
        // The action never ran: a dropped connection, or a lapsed session
        // turned away to /login before it could (FeedbackModal's probe).
        const lapsed = await sessionLapsed();
        setState(id, { state: 'failed', message: lapsed ? FEEDBACK_SIGNED_OUT : FAILED });
        failed += 1;
        if (lapsed) {
          setSignedOut(true);
          break;
        }
        continue;
      }
      if (result.ok || isAlreadyLeft(result as { error?: string; code?: string | null })) {
        setState(id, { state: 'sent' });
        saved.push(id);
      } else {
        setState(id, { state: 'failed', message: result.error });
        failed += 1;
        if (result.signedOut) {
          setSignedOut(true);
          break;
        }
      }
    }
    setProgress(null);
    if (saved.length > 0) onSent(saved);
    // Everything went: done. Anything left is on its row, with "try again".
    if (failed === 0 && saved.length === queue.length) {
      setOpen(false);
      router.refresh();
    }
  }

  const summary = sendSummary(states);
  const sentCount = Object.values(states).filter((s) => s.state === 'sent').length;

  return (
    <>
      <Button onClick={start} className="rate-all-open">
        Rate everyone ({people.length})
      </Button>
      {open ? (
        <Modal
          open
          wide
          title={`Rate everyone · ${eventTitle}`}
          onClose={close}
          dismissible={!pending}
          footer={
            <>
              <Button tone="ghost" onClick={close} disabled={pending}>
                {sentCount > 0 ? 'Close' : 'Cancel'}
              </Button>
              <Button tone="primary" onClick={send} disabled={pending || queue.length === 0}>
                {sendLabel(queue.length, progress)}
              </Button>
            </>
          }
        >
          <p className="sm muted rate-all-intro">
            Choose stars for each person you want to rate — leave a row empty to skip it. Each entry
            is sent on its own: one per person per event, seen by The Hospitality Company office,
            not by the worker, and it cannot be edited or withdrawn from the portal.
          </p>
          {/* Read out after each send: how many went, and how many did not. */}
          <div className="rate-all-status" aria-live="polite">
            {summary ? (
              <Alert tone={signedOut || summary.includes("couldn't") ? 'amber' : 'green'}>
                {summary}
                {signedOut ? (
                  <>
                    {' '}
                    <a
                      href={`/login?next=${encodeURIComponent(`/client/events/${eventId}`)}`}
                      target="_blank"
                      rel="noopener"
                    >
                      Sign in again (opens a new tab)
                    </a>
                  </>
                ) : null}
              </Alert>
            ) : null}
          </div>
          <ul className="rate-all-list">
            {roster.map((p) => (
              <RateRow
                key={p.bookingId}
                person={p}
                photo={photos[p.bookingId]}
                subtitle={`${p.role} · ${eventDate}`}
                draft={draft(p.bookingId)}
                state={states[p.bookingId] ?? { state: 'idle' }}
                commentOpen={comments.has(p.bookingId)}
                locked={pending}
                onRate={(rating) => setDraft(p.bookingId, { rating })}
                onText={(text) => setDraft(p.bookingId, { text })}
                onToggleComment={() =>
                  setComments((all) => {
                    const next = new Set(all);
                    if (next.has(p.bookingId)) next.delete(p.bookingId);
                    else next.add(p.bookingId);
                    return next;
                  })
                }
              />
            ))}
          </ul>
        </Modal>
      ) : null}
    </>
  );
}

const STARS = [1, 2, 3, 4, 5] as const;

/** One person: face, name, five stars, an optional comment, and how it went. */
function RateRow({
  person,
  photo,
  subtitle,
  draft,
  state,
  commentOpen,
  locked,
  onRate,
  onText,
  onToggleComment,
}: {
  person: LineupRow;
  photo?: string;
  subtitle: string;
  draft: RateDraft;
  state: RateState;
  commentOpen: boolean;
  locked: boolean;
  onRate: (rating: number) => void;
  onText: (text: string) => void;
  onToggleComment: () => void;
}) {
  const id = useId();
  const starRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const sent = state.state === 'sent';
  const disabled = locked || sent;

  // One tab stop per row (roving tabindex); the arrows, Home and End move
  // and choose, as in the single popup (WAI-ARIA APG radio group).
  function onKey(e: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const next = starForKey(e.key, draft.rating);
    if (next === null) return;
    e.preventDefault();
    onRate(next);
    starRefs.current[next - 1]?.focus();
  }

  return (
    <li className={sent ? 'rate-row sent' : 'rate-row'}>
      <div className="rate-who">
        <Avatar name={person.name} src={photo} silhouette />
        <div className="who">
          <div className="n" id={`${id}-name`}>
            {person.name}
          </div>
          <div className="s">{subtitle}</div>
        </div>
      </div>
      <div className="rate-pick">
        <div
          className="stars-row"
          role="radiogroup"
          aria-labelledby={`${id}-name`}
          aria-describedby={`${id}-hint`}
          onKeyDown={onKey}
        >
          {STARS.map((n) => (
            <button
              key={n}
              ref={(el) => {
                starRefs.current[n - 1] = el;
              }}
              type="button"
              role="radio"
              aria-checked={draft.rating === n}
              tabIndex={n === (draft.rating || 1) ? 0 : -1}
              aria-label={`${n} ${n === 1 ? 'star' : 'stars'} for ${person.name}`}
              className={n <= draft.rating ? 'star on' : 'star'}
              onClick={() => onRate(n)}
              disabled={disabled}
            >
              <StarIcon />
            </button>
          ))}
        </div>
        <span className="hint" id={`${id}-hint`}>
          {draft.rating > 0 ? starsHint(draft.rating) : 'Not rated — skipped'}
        </span>
      </div>
      <div className="rate-more">
        {sent ? (
          <span className="rate-done">✓ Feedback sent</span>
        ) : (
          <Button
            size="sm"
            tone="ghost"
            aria-expanded={commentOpen}
            aria-controls={`${id}-comment`}
            onClick={onToggleComment}
            disabled={locked}
          >
            {commentOpen ? 'Hide comment' : 'Add a comment'}
          </Button>
        )}
      </div>
      {commentOpen && !sent ? (
        <div className="rate-comment" id={`${id}-comment`}>
          <Textarea
            label={`Comment for ${person.name}`}
            hint="Optional · seen by The Hospitality Company office, not by the worker."
            rows={3}
            maxLength={FEEDBACK_TEXT_MAX}
            value={draft.text}
            onChange={(e) => onText(e.currentTarget.value)}
            disabled={locked}
          />
        </div>
      ) : null}
      {state.state === 'failed' ? (
        <p className="rate-error sm">{state.message}</p>
      ) : state.state === 'sending' ? (
        <p className="rate-progress sm muted">Sending…</p>
      ) : null}
    </li>
  );
}
