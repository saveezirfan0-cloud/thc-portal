'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Avatar, Button, Chip, Panel, Pill, Switch } from '@thc/ui';
import { formatUkWindow } from '../../staff/[id]/profile';
import { PoolTable } from './PoolTable';
import {
  GATE_REASON,
  appliedAgo,
  confirmationLine,
  confirmedRows,
  fillLine,
  fillTone,
  invitedRows,
  showsFillingLists,
  unavailableRows,
} from './board';
import type {
  BoardEvent,
  BoardSection as Section,
  CandidateRow,
  PoolPerson,
  RosterRow,
} from './types';

/**
 * One role section on the event board (§3.3).
 *
 * Four sub-lists in the scope's order: Confirmed → Invited → Potential
 * pool → Unavailable. Two of them are conditional, and the condition is
 * not the clock:
 *
 * §3.3 hides Invited and Potential pool "once a role is fully confirmed
 * and stable", and brings them back when a shortfall reopens on an
 * already-Ongoing event — a no-show mid-event leaves the role short and
 * the manager needs the pool again. `showsFillingLists` is that rule.
 *
 * A no-show does NOT get its own list. It stays in Confirmed with a badge
 * and a Get back action, so the manager sees who needs replacing without
 * losing their place in the roster (§3.3).
 */
export function BoardSection({
  event,
  section,
  roster,
  candidates,
  people,
  pending,
  onInvite,
  onWithdraw,
  onNoShow,
  onGetBack,
  onAutoAssign,
}: {
  event: BoardEvent;
  section: Section;
  roster: RosterRow[];
  candidates: CandidateRow[];
  people: Record<string, PoolPerson>;
  pending: boolean;
  onInvite: (shiftId: string, staffId: string) => void;
  onWithdraw: (row: RosterRow) => void;
  onNoShow: (row: RosterRow) => void;
  onGetBack: (row: RosterRow) => void;
  onAutoAssign: (shiftId: string, on: boolean) => void;
}) {
  const [open, setOpen] = useState(true);

  const confirmed = confirmedRows(roster, section.id);
  const invited = invitedRows(roster, section.id);
  const unavailable = unavailableRows(candidates);
  const filling = showsFillingLists(event, section);
  const locked = event.status === 'cancelled' || event.status === 'completed';

  return (
    <Panel flush>
      <div className="panel-h">
        <button type="button" className="sec-h" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="muted">{open ? '▾' : '▸'}</span>
          <h3>{section.role_name}</h3>
          <span className="win">{formatUkWindow(section.starts_at, section.ends_at)} UK</span>
          {section.dress_code ? <Chip>{section.dress_code}</Chip> : null}
          <span className="muted xs">
            £{Number(section.pay_rate).toFixed(2)} base · £
            {Number(section.final_pay_rate).toFixed(2)} final · £
            {Number(section.charge_rate).toFixed(2)} charge
          </span>
          <span className={`fill ${fillTone(section)}`}>{fillLine(section)}</span>
        </button>
        <div className="right">
          {/*
            §3.4 runs a section only when BOTH switches are on, so the
            role-level one is disabled — not hidden — while the event's is
            off: the manager can still see which roles they excluded.
          */}
          <Switch
            checked={section.auto_assign}
            disabled={pending || locked || !event.auto_assign}
            purple
            aria-label={`Auto-Assign · ${section.role_name}`}
            onChange={(on) => onAutoAssign(section.id, on)}
          />
          <span className="muted xs">Auto-Assign</span>
        </div>
      </div>

      {open ? (
        <div className="panel-b stack">
          <div className="stack">
            <span className="label">Confirmed · {confirmed.length}</span>
            {confirmed.length === 0 ? (
              <div className="empty">Nobody confirmed yet.</div>
            ) : (
              <div className="people-grid">
                {confirmed.map((row) => (
                  <div className={`pcard${row.no_show ? ' noshow' : ''}`} key={row.booking_id}>
                    <Avatar name={row.display_name} size="sm" />
                    <div className="who">
                      <div className="n">
                        <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
                      </div>
                      <div className="s">{confirmationLine(row)}</div>
                      <div className="row">
                        {row.no_show ? (
                          <>
                            <Pill tone="coral">No show</Pill>
                            <Button size="sm" disabled={pending} onClick={() => onGetBack(row)}>
                              Get back
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="sm"
                              tone="ghost"
                              disabled={pending || locked}
                              onClick={() => onWithdraw(row)}
                            >
                              Withdraw
                            </Button>
                            <Button
                              size="sm"
                              tone="ghost"
                              disabled={pending}
                              onClick={() => onNoShow(row)}
                            >
                              No show
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {filling ? (
            <>
              <div className="stack">
                <span className="label">Invited · awaiting response · {invited.length}</span>
                {invited.length === 0 ? (
                  <div className="empty">No invitations outstanding.</div>
                ) : (
                  <div className="people-grid">
                    {invited.map((row) => (
                      <div className="pcard" key={row.booking_id}>
                        <Avatar name={row.display_name} size="sm" />
                        <div className="who">
                          <div className="n">
                            <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
                          </div>
                          <div className="s">
                            {row.status === 'applied'
                              ? 'Applied from the Radar'
                              : `Invited · wave ${row.qualified_here ? 1 : 2}`}
                          </div>
                          {/*
                            §3.3: a worker already here who also self-applies
                            is not duplicated into the pool — "the marker
                            shows on their existing Invited entry instead".
                          */}
                          {row.applied_at ? (
                            <Pill tone="purple">{appliedAgo(row.applied_at)}</Pill>
                          ) : null}
                          <div className="row">
                            <Button
                              size="sm"
                              tone="ghost"
                              disabled={pending || locked}
                              onClick={() => onWithdraw(row)}
                            >
                              Withdraw
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <PoolTable
                section={section}
                candidates={candidates}
                people={people}
                roster={roster}
                clientName={event.client_name}
                disabled={locked}
                pending={pending}
                onInvite={(staffId) => onInvite(section.id, staffId)}
              />
            </>
          ) : (
            <span className="muted sm">
              {event.status === 'completed' || event.status === 'cancelled'
                ? 'Invited and Potential pool are hidden: nothing can be filled after the fact (§3.3).'
                : 'Fully confirmed — Invited and Potential pool are hidden until a shortfall reopens (§3.3).'}
            </span>
          )}

          {unavailable.length > 0 ? (
            <div className="stack">
              <span className="label">Unavailable · {unavailable.length}</span>
              <div className="people-grid three dim">
                {unavailable.map((row) => {
                  const person = people[row.staff_id];
                  return (
                    <div className="pcard" key={row.staff_id}>
                      <Avatar name={person?.display_name ?? '?'} size="sm" />
                      <div className="who">
                        <div className="n">{person?.display_name ?? 'Unknown worker'}</div>
                        <div className="s">{row.gate ? GATE_REASON[row.gate] : ''}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
              <span className="muted xs">
                Workers who are not qualified for this role never appear here (§6) — in an agency
                this size they would bury the section.
              </span>
            </div>
          ) : null}
        </div>
      ) : null}
    </Panel>
  );
}
