'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  EmptyState,
  Modal,
  Note,
  OptionRow,
  Panel,
  Pill,
  SearchInput,
  Textarea,
  useTimeFormat,
} from '@thc/ui';
import { dismissUnmatchedWillo, linkUnmatchedWillo } from './actions';
import { shortDay } from './view-model';
import {
  linkConsequence,
  linkOptions,
  seenLine,
  shortKey,
  unmatchedEventLabel,
  unmatchedEventTone,
  unmatchedHeading,
} from './unmatched';
import type { LinkOption } from './unmatched';
import type { CandidateRow, UnmatchedWilloRead, UnmatchedWilloRow } from './types';

type Pending = { kind: 'link' | 'dismiss'; row: UnmatchedWilloRow } | null;

const STATUS_WORD: Record<string, string> = {
  interview_requested: 'Interview requested',
  interview_completed: 'Interview completed',
};

/**
 * "Unmatched Willo responses" on /onboarding (ADR-0087) — an addition to
 * `wireframes/backoffice/onboarding.html`, which has no such panel.
 *
 * A person who finished (or was moved on) in Willo, whom the portal has no
 * candidate for, used to vanish: the receiver answered 200 and wrote one
 * audit row nobody read. They are listed here until the office links each to
 * a candidate (which replays what Willo said) or dismisses it with a reason.
 *
 * States: nothing to show (renders nothing); the read failed (a coral alert —
 * silence is what this panel exists to end); no Supabase project (a neutral
 * note); a link or dismissal in flight (the row dims and its buttons wait).
 */
export function UnmatchedWilloPanel({
  read,
  candidates,
  canResolve,
}: {
  read: UnmatchedWilloRead | undefined;
  /** The board's own candidates: the picker offers those still waiting on the interview. */
  candidates: readonly CandidateRow[];
  /** Owners and managers (`canResolveUnmatchedWillo`); the database refuses the rest. */
  canResolve: boolean;
}) {
  const router = useRouter();
  const format = useTimeFormat();
  const [pending, setPending] = useState<Pending>(null);
  const [query, setQuery] = useState('');
  const [chosen, setChosen] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const rows = read?.rows ?? [];
  const options = useMemo(
    () => (pending?.kind === 'link' ? linkOptions(candidates, pending.row, query) : []),
    [candidates, pending, query],
  );

  const picked = options.find((option) => option.id === chosen);

  if (!read) return null;
  if (read.noProject) {
    return (
      <Note>
        Unmatched Willo responses cannot be read here: this environment has no Supabase project.
      </Note>
    );
  }
  if (read.problem) {
    // Not "none": a response that matched nobody must not be hidden by a failed read.
    return (
      <Alert tone="coral">
        The Willo responses that match no candidate could not be read, so any would not show here:{' '}
        {read.problem}
      </Alert>
    );
  }
  if (rows.length === 0 && !done) return null;

  const close = () => {
    setPending(null);
    setQuery('');
    setChosen(null);
    setReason('');
    setProblem(null);
  };
  const open = (kind: 'link' | 'dismiss', row: UnmatchedWilloRow) => {
    close();
    setDone(null);
    setPending({ kind, row });
  };

  const confirm = () => {
    if (!pending) return;
    setProblem(null);
    const { kind, row } = pending;
    start(async () => {
      const result =
        kind === 'link'
          ? picked
            ? await linkUnmatchedWillo(row.willo_candidate_id, picked.id, picked.name)
            : { ok: false as const, message: 'Pick the candidate this response belongs to.' }
          : await dismissUnmatchedWillo(row.willo_candidate_id, reason);
      if (result.ok) {
        setDone(
          result.message ??
            (kind === 'link' ? 'Linked.' : 'Dismissed — it is kept in the audit log.'),
        );
        close();
        router.refresh();
      } else {
        setProblem(result.message);
      }
    });
  };

  const who = (row: UnmatchedWilloRow) => row.name ?? row.email ?? 'Name not in the delivery';

  return (
    <>
      {done ? (
        <Alert tone="green">
          <span className="unmatched-done">
            <span>{done}</span>
            <Button size="sm" tone="ghost" onClick={() => setDone(null)}>
              OK
            </Button>
          </span>
        </Alert>
      ) : null}
      {rows.length > 0 ? (
        <Panel
          className="unmatched-willo"
          aria-busy={busy}
          title="Unmatched Willo responses"
          actions={<Pill tone="amber">{rows.length}</Pill>}
          flush
        >
          <div className="unmatched-intro">
            <b>{unmatchedHeading(rows.length)}.</b> Willo sent an interview response for someone the
            portal has no candidate for — created in Willo by hand, or before the portal sent
            invitations. Open the interview in Willo to see who it is, then link it to their
            candidate so the card moves, or dismiss it.
          </div>
          <div className="table-scroll">
            <table className="tbl card-rows unmatched-table">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Willo response</th>
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.willo_candidate_id} className={busy ? 'is-busy' : undefined}>
                    <td data-label="Who" className="cell-title">
                      <b>{who(row)}</b>
                      {row.name && row.email ? <span className="sub">{row.email}</span> : null}
                      <span className="sub mono" title={row.willo_candidate_id}>
                        Willo key {shortKey(row.willo_candidate_id)}
                      </span>
                    </td>
                    <td data-label="Willo response">
                      <span className="unmatched-events">
                        {row.events.length === 0 ? (
                          <Pill>No event named</Pill>
                        ) : (
                          row.events.map((event) => (
                            <Pill key={event} tone={unmatchedEventTone(event)}>
                              {unmatchedEventLabel(event)}
                            </Pill>
                          ))
                        )}
                      </span>
                      <span className="sub">{seenLine(row, format)} (UK time)</span>
                    </td>
                    <td data-label="Actions" className="unmatched-actions">
                      {row.review_url ? (
                        <a
                          className="btn sm"
                          href={row.review_url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open in Willo ↗
                        </a>
                      ) : (
                        <span
                          className="sub"
                          title="Set the Willo review link in Settings (willo_review_url_template)"
                        >
                          Willo link not set
                        </span>
                      )}
                      {canResolve ? (
                        <>
                          <Button
                            size="sm"
                            tone="primary"
                            disabled={busy}
                            onClick={() => open('link', row)}
                          >
                            Link to candidate
                          </Button>
                          <Button
                            size="sm"
                            tone="ghost"
                            disabled={busy}
                            onClick={() => open('dismiss', row)}
                          >
                            Dismiss
                          </Button>
                        </>
                      ) : (
                        <span className="sub">An owner or manager resolves these.</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      <Modal
        open={pending !== null}
        title={pending?.kind === 'link' ? 'Link to a candidate' : 'Dismiss this Willo response'}
        onClose={close}
        footer={
          <>
            <Button tone="ghost" onClick={close}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={
                busy || (pending?.kind === 'link' ? picked === undefined : reason.trim() === '')
              }
              onClick={confirm}
            >
              {busy ? 'Saving…' : pending?.kind === 'link' ? 'Link and replay' : 'Dismiss'}
            </Button>
          </>
        }
      >
        {pending ? (
          <div className="stack" aria-busy={busy}>
            <div className="sm muted">
              {who(pending.row)}
              {pending.row.name && pending.row.email ? ` · ${pending.row.email}` : ''} · Willo key{' '}
              {shortKey(pending.row.willo_candidate_id)} ·{' '}
              {pending.row.events.map(unmatchedEventLabel).join(', ') || 'no event named'} · first
              seen {shortDay(pending.row.first_seen)}
            </div>
            {pending.kind === 'link' ? (
              <LinkPicker
                events={pending.row.events}
                options={options}
                boardEmpty={candidates.length === 0}
                query={query}
                onQuery={setQuery}
                chosen={chosen}
                onChoose={setChosen}
                busy={busy}
              />
            ) : (
              <>
                <div className="note">
                  The response leaves this list and the decision is kept in the audit log. If Willo
                  sends anything more for this person, it comes back.
                </div>
                <Textarea
                  label="Reason *"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  disabled={busy}
                />
              </>
            )}
            {problem ? <Alert tone="coral">{problem}</Alert> : null}
          </div>
        ) : null}
      </Modal>
    </>
  );
}

/**
 * The body of the "Link to a candidate" dialog: a search, the candidates it
 * finds (those whose name or email matches what Willo sent first), and what
 * linking will do given the events on file. Exported for the render test.
 */
export function LinkPicker({
  events,
  options,
  boardEmpty,
  query,
  onQuery,
  chosen,
  onChoose,
  busy,
}: {
  events: readonly string[];
  options: readonly LinkOption[];
  boardEmpty: boolean;
  query: string;
  onQuery: (query: string) => void;
  chosen: string | null;
  onChoose: (id: string) => void;
  busy: boolean;
}) {
  return (
    <>
      <SearchInput
        label="Search candidates"
        placeholder="Search by name, email or phone"
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        disabled={busy}
      />
      {options.length === 0 ? (
        <EmptyState>
          <span className="sm">
            {boardEmpty
              ? 'There are no candidates on the board.'
              : 'No candidate waiting on the interview matches. Only Interview requested and Interview completed candidates not yet linked to Willo can be chosen.'}
          </span>
        </EmptyState>
      ) : (
        <div role="radiogroup" aria-label="Candidate" className="unmatched-options">
          {options.map((option) => (
            <OptionRow
              key={option.id}
              selected={chosen === option.id}
              onSelect={() => onChoose(option.id)}
              title={
                <>
                  {option.name}
                  {option.suggested ? (
                    <>
                      {' '}
                      <Pill tone="green">Matches the Willo details</Pill>
                    </>
                  ) : null}
                </>
              }
              description={`${option.email} · ${STATUS_WORD[option.status] ?? option.status} · applied ${shortDay(option.appliedAt)}`}
            />
          ))}
        </div>
      )}
      <div className="note">
        {linkConsequence(events).map((line) => (
          <div key={line}>{line}</div>
        ))}
      </div>
    </>
  );
}
