'use client';

import { useMemo, useState } from 'react';
import { Button, Chip, Pill, SearchInput, Select, TableScroll } from '@thc/ui';
import { appliedAgo, poolSearch, rankedPool, sortPool } from './board';
import type { PoolSort } from './board';
import type { BoardSection, CandidateRow, PoolPerson, RosterRow } from './types';

/**
 * The Potential pool (§3.3, §3.4, §6).
 *
 * Ranked by `rankPool` from @thc/domain — the same function the engine
 * ranks with — so the order on screen is the order the next round will
 * invite in. That is the whole point of showing it: a manager picking by
 * hand should default to the same first-choice pool auto-assign uses.
 *
 * RULE-17 is why the wave chip is not decoration. Every eligible wave-1
 * worker is invited before any wave-2 worker, whatever they score, so the
 * score bar is muted on wave-2 rows: a 94 below a 61 looks like a sorting
 * bug unless the eye is told the list is in two blocks.
 */
export function PoolTable({
  section,
  candidates,
  people,
  roster,
  clientName,
  disabled,
  pending,
  onInvite,
}: {
  section: BoardSection;
  candidates: CandidateRow[];
  people: Record<string, PoolPerson>;
  roster: RosterRow[];
  clientName: string;
  disabled: boolean;
  pending: boolean;
  onInvite: (staffId: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<PoolSort>('rank');

  // Everyone holding a live booking here is already on the board above.
  const booked = useMemo(
    () =>
      new Set(
        roster
          .filter((row) => row.shift_id === section.id && row.status !== 'cancelled')
          .map((row) => row.staff_id),
      ),
    [roster, section.id],
  );

  const appliedAt = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of roster) {
      if (row.shift_id === section.id && row.applied_at) map.set(row.staff_id, row.applied_at);
    }
    return map;
  }, [roster, section.id]);

  const rows = useMemo(
    () => poolSearch(sortPool(rankedPool(candidates, booked), sort, appliedAt), people, query),
    [candidates, booked, sort, appliedAt, people, query],
  );

  return (
    <div className="stack">
      <div className="toolbar">
        <span className="label">Potential pool</span>
        <div className="right">
          <SearchInput
            value={query}
            placeholder="Search name or ID"
            aria-label="Search the potential pool"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Select
            value={sort}
            aria-label="Sort the pool"
            onChange={(event) => setSort(event.target.value as PoolSort)}
          >
            <option value="rank">Sort: match score</option>
            <option value="applied">Sort: applied first</option>
          </Select>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty">
          {query.trim() === ''
            ? 'Nobody left in the pool for this role.'
            : 'No worker in the pool matches that search.'}
        </div>
      ) : (
        <TableScroll>
          <table className="tbl">
            <thead>
              <tr>
                <th />
                <th>Worker</th>
                <th>Wave</th>
                <th>Match score</th>
                <th>Distance</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const person = people[row.subject.staff_id];
                const applied = appliedAgo(appliedAt.get(row.subject.staff_id) ?? null);
                const total = Math.round(row.breakdown.total);
                return (
                  <tr key={row.subject.staff_id}>
                    <td>
                      <span className="avatar sm">{(person?.display_name ?? '?').slice(0, 1)}</span>
                    </td>
                    <td>
                      <b>{person?.display_name ?? 'Unknown worker'}</b>
                      <span className="sub">
                        ★ {person?.rating?.toFixed(1) ?? '—'} ·{' '}
                        {person?.reliability === null || person?.reliability === undefined
                          ? '—'
                          : `${Math.round(person.reliability)}%`}{' '}
                        show-rate
                      </span>
                    </td>
                    <td>
                      {row.wave === 1 ? (
                        <Chip tone="cyan">
                          Qualified — {clientName} · {section.role_name}
                        </Chip>
                      ) : (
                        <Chip outline>Wave 2 — not qualified here</Chip>
                      )}
                      {applied ? (
                        <Pill tone="purple" className="mt-8">
                          {applied}
                        </Pill>
                      ) : null}
                    </td>
                    <td>
                      {/*
                        The per-factor breakdown is why `score` returns the
                        parts: §6's weights are the manager's answer to
                        "why is this person above that one".
                      */}
                      <div
                        className={`mscore${row.wave === 2 ? ' wave2' : ''}`}
                        title={`show ${Math.round(row.breakdown.show)} · rating ${Math.round(
                          row.breakdown.rating,
                        )} · proximity ${Math.round(row.breakdown.proximity)} · fair ${Math.round(
                          row.breakdown.fair,
                        )} · venue ${Math.round(row.breakdown.venue)}`}
                      >
                        <span className="track">
                          <i style={{ width: `${Math.max(0, Math.min(100, total))}%` }} />
                        </span>
                        <span className="n">{total}</span>
                      </div>
                    </td>
                    <td className="mono sm">{Number(row.subject.distance_km).toFixed(1)} km</td>
                    <td className="right-align">
                      <Button
                        size="sm"
                        disabled={disabled || pending}
                        onClick={() => onInvite(row.subject.staff_id)}
                      >
                        Invite
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      )}

      <span className="muted xs">
        RULE-17: every eligible wave-1 worker is invited before any wave-2 worker, so a wave-2
        worker scoring 94 still comes after a wave-1 worker scoring 61. A manual pick overrides that
        — which is what this table is for.
      </span>
    </div>
  );
}
