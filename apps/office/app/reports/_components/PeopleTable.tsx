'use client';

import { Fragment, useMemo, useState } from 'react';
import { Avatar, Chip, Panel, Pill } from '@thc/ui';
import type { PayrollLine, PayrollPerson } from '../data';
import { breakLabel, dayLabel, employeeId, hours, pounds } from '../view-model';
import { UK_ZONE, formatTimeIn } from '@thc/domain';
import { ActualTime, ScheduledWindow, useViewerZone } from './zone';

const PAGE = 25;

/** §5.1: a check-in inside the first 30 minutes is paid from the scheduled start. */
const GRACE_MS = 30 * 60_000;

/**
 * The per-person breakdown (§9.9 Tab 2): click a person to expand ALL their
 * shifts, scheduled next to actual. Client-side only for the expand, the
 * search and the paging — every figure in it arrived priced.
 */
export function PeopleTable({ people, lines }: { people: PayrollPerson[]; lines: PayrollLine[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

  const byPerson = useMemo(() => {
    const map = new Map<string, PayrollLine[]>();
    for (const line of lines) {
      if (line.kind === 'no_show' && !line.exported_at) continue;
      const list = map.get(line.staff_id) ?? [];
      list.push(line);
      map.set(line.staff_id, list);
    }
    return map;
  }, [lines]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        (p.staff_name ?? '').toLowerCase().includes(q) ||
        employeeId(p.employee_id).toLowerCase().includes(q),
    );
  }, [people, query]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE, current * PAGE + PAGE);

  function toggle(id: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <Panel
      title="Breakdown by person"
      actions={
        <>
          <span className="muted sm">
            click a person to expand ALL their shifts, scheduled next to actual
          </span>
          <input
            className="input rp-search"
            placeholder="Search name / Employee ID"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            aria-label="Search name or Employee ID"
          />
        </>
      }
      flush
    >
      <div className="panel-b tight table-scroll">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }} />
              <th>Staff</th>
              <th>Employee ID</th>
              <th className="money">Shifts</th>
              <th className="money">Payable hours</th>
              <th className="money">Base</th>
              <th className="money">Holiday +12.07%</th>
              <th className="money">Total payroll</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={8} className="muted">
                  {people.length === 0
                    ? 'Nobody worked a shift in this period.'
                    : 'Nobody matches that search.'}
                </td>
              </tr>
            ) : null}
            {shown.map((person) => {
              const id = person.staff_id ?? '';
              const isOpen = open.has(id);
              return (
                <Fragment key={id}>
                  <tr
                    className={`rp-person${isOpen ? ' open' : ''}`}
                    onClick={() => toggle(id)}
                    aria-expanded={isOpen}
                  >
                    <td className={isOpen ? 'rp-green' : 'muted'}>{isOpen ? '▾' : '▸'}</td>
                    <td>
                      <span className="person">
                        <Avatar
                          name={person.staff_name ?? ''}
                          size="sm"
                          deleted={Boolean(person.removed)}
                        />
                        <span className={person.removed ? 'muted' : undefined}>
                          {person.removed ? (
                            <i>{person.staff_name}</i>
                          ) : isOpen ? (
                            <b>{person.staff_name}</b>
                          ) : (
                            person.staff_name
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="mono sm">{employeeId(person.employee_id)}</td>
                    <td className="money">{person.shifts}</td>
                    <td className="money">
                      {hours(person.payable_min)}
                      {person.pending > 0 ? (
                        <span className="sub rp-amber">+ {person.pending} pending</span>
                      ) : null}
                    </td>
                    <td className="money">{pounds(person.base)}</td>
                    <td className="money muted">{pounds(person.holiday)}</td>
                    <td className="money">
                      <b>{pounds(person.total)}</b>
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="rp-shifts">
                      <td colSpan={8}>
                        <div className="inner">
                          <ShiftTable person={person} lines={byPerson.get(id) ?? []} />
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {filtered.length > PAGE ? (
        <div className="rp-pager">
          <span className="muted sm">
            Showing {current * PAGE + 1}–{Math.min(filtered.length, (current + 1) * PAGE)} of{' '}
            {filtered.length} workers
          </span>
          <div className="right">
            <button
              className="btn sm ghost"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            >
              ‹ Prev
            </button>
            <span className="mono sm">
              {current + 1} / {pages}
            </span>
            <button
              className="btn sm ghost"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      ) : null}
    </Panel>
  );
}

function ShiftTable({ person, lines }: { person: PayrollPerson; lines: PayrollLine[] }) {
  const payable = lines.filter((l) => l.status === 'settled' && l.kind !== 'no_show').length;
  const pending = lines.filter((l) => l.status === 'pending').length;
  return (
    <table className="tbl">
      <thead>
        <tr>
          <th>Event</th>
          <th>Client</th>
          <th>Role</th>
          <th>Date</th>
          <th>Start – End (scheduled)</th>
          <th>Check in / out (actual)</th>
          <th className="money">Payable hours</th>
          <th className="money">Rate</th>
          <th className="money">Payroll</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => (
          <ShiftRow key={line.booking_id} line={line} />
        ))}
        <tr className="rp-total">
          <td colSpan={6}>
            <b>{person.staff_name} · period total</b>{' '}
            <span className="muted sm">
              ({payable} payable {payable === 1 ? 'shift' : 'shifts'}
              {pending > 0 ? ` + ${pending} pending` : ''})
            </span>
          </td>
          <td className="money">
            <b>{hours(person.payable_min)}</b>
          </td>
          <td />
          <td className="money">
            <b>{pounds(person.base)}</b>
            <span className="sub muted">
              + holiday {pounds(person.holiday)} = {pounds(person.total)}
            </span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function ShiftRow({ line }: { line: PayrollLine }) {
  const pending = line.status === 'pending';
  return (
    <tr className={pending ? 'rp-pending' : undefined}>
      <td>{line.event_title}</td>
      <td>{line.client_name}</td>
      <td>
        <Chip>{line.role_name}</Chip>
      </td>
      <td className="mono rp-nowrap">{dayLabel(line.shift_date)}</td>
      <td className="rp-nowrap">
        <ScheduledWindow startsAt={line.starts_at} endsAt={line.ends_at} />
      </td>
      <td>
        <Actual line={line} />
      </td>
      <td className="money">
        {pending ? (
          <Pill tone="coral">Pending</Pill>
        ) : (
          <>
            {hours(line.payable_min)}
            {line.unpaid_break_min &&
            line.unpaid_break_min > 0 &&
            line.kind === 'worked' &&
            !line.floor_applied ? (
              <span className="sub">
                {hours((line.payable_min ?? 0) + line.unpaid_break_min)} −{' '}
                {breakLabel(line.unpaid_break_min)} break
              </span>
            ) : null}
            {line.floor_applied ? <span className="sub">4 h minimum (RULE-14)</span> : null}
          </>
        )}
      </td>
      <td className="money">{pounds(line.rate)}</td>
      <td className="money">
        {pending ? (
          <>
            <Pill tone="coral">Pending</Pill>
            <span className="sub">
              excluded from the CSV until resolved; rolls forward to the next Monday (BG-08)
            </span>
          </>
        ) : (
          <>
            {pounds(line.base)}
            {line.changed_since_export ? (
              <span className="sub rp-amber">
                exported as {pounds(line.exported_total)} incl. holiday — changed since, not
                corrected; notify Finance
              </span>
            ) : null}
          </>
        )}
      </td>
    </tr>
  );
}

function Actual({ line }: { line: PayrollLine }) {
  const zone = useViewerZone();
  if (line.kind === 'turned_away') {
    const onTime = (line.payable_min ?? 0) > 0;
    return (
      <>
        <Pill tone="amber">Turned away</Pill>
        <span className="sub">
          strict buffer · attempt logged{' '}
          {line.attempted_at ? formatTimeIn(new Date(line.attempted_at), zone) : '—'},{' '}
          {onTime ? 'on time → fixed 4 h, absorbed by THC (RULE-15)' : 'late → nothing (RULE-15)'}
        </span>
      </>
    );
  }
  if (line.kind === 'cancelled_on_day') {
    return (
      <>
        <Pill>Event cancelled on the day</Pill>
        <span className="sub">full scheduled hours paid and billed (§3.3)</span>
      </>
    );
  }
  if (line.kind === 'no_show') {
    return (
      <>
        <Pill tone="coral">No-show</Pill>
        <span className="sub rp-amber">
          recorded after this shift was exported — not reversed; notify Finance
        </span>
      </>
    );
  }
  return (
    <span className="mono">
      <ActualTime at={line.check_in_at} className={line.late_check_in ? 'rp-amber' : undefined} /> ·{' '}
      {line.status === 'pending' ? (
        <span className="rp-coral">—</span>
      ) : (
        <ActualTime
          at={line.check_out_at}
          className={line.early_check_out ? 'rp-amber' : undefined}
        />
      )}
      {line.status === 'pending' ? (
        <span className="sub rp-coral">No check-out — unresolved</span>
      ) : line.late_check_in ? (
        <span className="sub rp-amber">
          late check-in —{' '}
          {line.check_in_at &&
          new Date(line.check_in_at).getTime() - new Date(line.starts_at).getTime() < GRACE_MS
            ? `inside the 30-min grace, paid from ${formatTimeIn(new Date(line.starts_at), UK_ZONE)} UK`
            : 'paid from arrival (RULE-01)'}
        </span>
      ) : line.early_check_out ? (
        <span className="sub rp-amber">early check-out — paid to the actual finish</span>
      ) : null}
    </span>
  );
}
