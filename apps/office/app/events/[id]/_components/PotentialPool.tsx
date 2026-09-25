'use client';

import { useMemo, useState, useTransition } from 'react';
import { Alert, Avatar, Button, Pill, Score, SearchInput, SegToggle } from '@thc/ui';
import { type ScoreWeights, appliedAgo } from '@thc/domain';
import {
  type PoolEntry,
  type PoolFilter,
  type PoolSort,
  factorChips,
  queryPool,
  scoreBreakdownLines,
  weightPercent,
} from '../board-model';
import { inviteWorker } from '../actions';
import { ApplicationActions } from './ApplicationActions';

/** Rows drawn before "Show all" — a role's pool can hold most of the workforce. */
const FIRST_PAGE = 40;

/**
 * The Potential pool for one role section — Scope §3.3, §3.4, §6.
 *
 * Ranked exactly as the engine ranks (wave 1 — qualified at this client
 * and role — first, then wave 2, each by the §6 score); the rank number is
 * the engine's and never renumbers under a search or a re-sort. Search is
 * for manual selection; the seg and the sort are §3.3's "sort/filter the
 * pool by application status". Hovering (or focusing) a score shows the
 * breakdown by factor.
 *
 * Invite sends a manual invitation (`office_invite_worker`): every hard
 * gate is re-checked at the press, and N5 is queued as for auto-assign. A
 * Radar applicant is taken forward with Accept application instead (N10) —
 * they have already said yes.
 */
export function PotentialPool({
  eventId,
  shiftId,
  clientName,
  roleName,
  entries,
  weights,
  problem,
  canInvite,
  escalation = false,
}: {
  eventId: string;
  shiftId: string;
  clientName: string;
  roleName: string;
  entries: PoolEntry[];
  weights: ScoreWeights;
  problem: string | null;
  /** False once the section has ended (RULE-16): the pool is read-only. */
  canInvite: boolean;
  /**
   * The section has started: this is the escalation pool — only workers
   * inside the radius, nearest first within each wave (§3.4).
   */
  escalation?: boolean;
}) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<PoolFilter>('all');
  const [sort, setSort] = useState<PoolSort>('score');
  const [showAll, setShowAll] = useState(false);

  const shown = useMemo(() => queryPool(entries, { q, filter, sort }), [entries, q, filter, sort]);
  const visible = showAll ? shown : shown.slice(0, FIRST_PAGE);
  const appliedCount = entries.filter((e) => e.appliedAt).length;
  // Where wave 1 ends in the engine's order: the dashed line in the wireframe.
  const firstWave2 = entries.find((e) => e.wave === 2)?.rank ?? null;

  return (
    <div className="sub">
      <div className="subh">
        Potential pool <span className="n">{entries.length}</span>
        <span className="right pooltools">
          <SearchInput
            label="Search the pool by name"
            placeholder="Search by name"
            value={q}
            onChange={(event) => setQ(event.target.value)}
          />
          <SegToggle<PoolFilter>
            small
            aria-label="Filter by application status"
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: 'All' },
              { value: 'applied', label: 'Applied', count: appliedCount },
              { value: 'not_applied', label: 'Not applied' },
            ]}
          />
          <select
            className="input"
            aria-label="Sort the pool"
            value={sort}
            onChange={(event) => setSort(event.target.value as PoolSort)}
          >
            <option value="score">{escalation ? 'Sort: nearest ↓' : 'Sort: score ↓'}</option>
            <option value="applied">Sort: applied first</option>
            <option value="name">Sort: name</option>
          </select>
        </span>
      </div>

      <div className="legend">
        <span>Score =</span>
        <span>
          <b>{weightPercent(weights.show)}</b> show-rate
        </span>
        <span>
          <b>{weightPercent(weights.rating)}</b> client rating
        </span>
        <span>
          <b>{weightPercent(weights.proximity)}</b> proximity
        </span>
        <span>
          <b>{weightPercent(weights.fair)}</b> fair rotation
        </span>
        <span>
          <b>{weightPercent(weights.venue)}</b> venue history
        </span>
        <span className="muted">
          · weights editable in /settings · hover a score for the breakdown
        </span>
        {escalation ? (
          <span className="muted">
            · the shift has started: same-day escalation — inside the radius only, nearest first
            within each wave
          </span>
        ) : null}
      </div>

      {problem ? (
        <div className="prow">
          <Alert tone="coral">{problem}</Alert>
        </div>
      ) : null}

      {!problem && entries.length === 0 ? (
        <div className="prow muted">
          Nobody else is eligible for this role right now — see Unavailable for why.
        </div>
      ) : null}
      {entries.length > 0 && shown.length === 0 ? (
        <div className="prow muted">Nobody in the pool matches.</div>
      ) : null}

      {visible.map((entry) => (
        <PoolRow
          key={entry.staffId}
          entry={entry}
          eventId={eventId}
          shiftId={shiftId}
          clientName={clientName}
          roleName={roleName}
          weights={weights}
          canInvite={canInvite}
          waveBreak={sort === 'score' && entry.rank === firstWave2 && entry.rank > 1}
        />
      ))}

      {!showAll && shown.length > FIRST_PAGE ? (
        <div className="prow">
          <Button size="sm" tone="ghost" onClick={() => setShowAll(true)}>
            Show all {shown.length}
          </Button>
        </div>
      ) : null}

      <div className="prow muted sm">
        <span>
          <b>Qualified first:</b> the qualified wave is exhausted before any unqualified worker is
          invited, whatever the score. Qualification is a priority wave, not a hard gate: Invite
          works on anyone here. Accepting an applicant sends N10; when the role fills, the remaining
          applicants get N10c.
        </span>
      </div>
    </div>
  );
}

function PoolRow({
  entry,
  eventId,
  shiftId,
  clientName,
  roleName,
  weights,
  canInvite,
  waveBreak,
}: {
  entry: PoolEntry;
  eventId: string;
  shiftId: string;
  clientName: string;
  roleName: string;
  weights: ScoreWeights;
  canInvite: boolean;
  waveBreak: boolean;
}) {
  const lines = scoreBreakdownLines(entry, weights);
  const total = Math.round(entry.breakdown.total);

  return (
    <div className={`prow${waveBreak ? ' wave-break' : ''}`}>
      <span className="rank">{entry.rank}</span>
      <Avatar name={entry.name} />
      <div className="who">
        <div className="n">{entry.name}</div>
        <div className="s">{entry.roles.length > 0 ? entry.roles.join(' · ') : roleName}</div>
      </div>
      {entry.qualified ? (
        <Pill tone="cyan">
          Qualified — {clientName} · {roleName}
        </Pill>
      ) : null}
      {entry.appliedAt ? (
        <span className="applied">{appliedAgo(new Date(entry.appliedAt))}</span>
      ) : null}
      {/* An earlier booking here ended; §3.6 bars only a self-cancel, so the
          manager can invite them again. A person-decided end (declined,
          withdrawn, released at 12:05) is never re-invited by auto-assign. */}
      {entry.endedLabel ? (
        <span
          className="muted xs"
          title={
            entry.autoInvitable
              ? 'Auto-assign may invite them again.'
              : 'Only a manual invitation reaches them: auto-assign does not re-invite after a decision.'
          }
        >
          earlier: {entry.endedLabel}
          {entry.autoInvitable ? '' : ' · manual only'}
        </span>
      ) : null}
      <div className="factors">
        {factorChips(entry).map((chip) => (
          <span className="fc" title={chip.title} key={chip.title}>
            {chip.label}
          </span>
        ))}
      </div>
      <div className="right">
        <span
          className="score-tip"
          tabIndex={0}
          aria-label={`Score ${total}, wave ${entry.wave}. ${lines.join('; ')}`}
        >
          <Score value={entry.breakdown.total} wave2={entry.wave === 2} />
          <span className="tipbox" role="tooltip">
            <span className="k">
              Wave {entry.wave} · {entry.name}
            </span>
            {lines.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </span>
        </span>
        {!canInvite ? null : entry.applicationId ? (
          <ApplicationActions eventId={eventId} bookingId={entry.applicationId} name={entry.name} />
        ) : (
          <InviteButton
            eventId={eventId}
            shiftId={shiftId}
            staffId={entry.staffId}
            name={entry.name}
          />
        )}
      </div>
    </div>
  );
}

function InviteButton({
  eventId,
  shiftId,
  staffId,
  name,
}: {
  eventId: string;
  shiftId: string;
  staffId: string;
  name: string;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const invite = () => {
    setError(null);
    startTransition(async () => {
      const result = await inviteWorker(eventId, shiftId, staffId);
      if ('error' in result) setError(result.error);
    });
  };

  return (
    <>
      {error ? (
        <span className="error sm" role="alert">
          {error}
        </span>
      ) : null}
      <Button
        size="sm"
        tone="outline"
        disabled={pending}
        onClick={invite}
        aria-label={`Invite ${name}`}
      >
        {pending ? 'Inviting…' : 'Invite'}
      </Button>
    </>
  );
}
