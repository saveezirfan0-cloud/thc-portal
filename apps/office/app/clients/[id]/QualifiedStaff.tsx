'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Checkbox,
  Chip,
  Modal,
  Note,
  Panel,
  SearchInput,
  Switch,
  TableScroll,
  Textarea,
} from '@thc/ui';
import {
  employeeId,
  formatRating,
  formatShowRate,
  formatUkDate,
  ratingTone,
} from '../../staff/staff';
import { qualifyStaff, revokeQualification, setDoNotReturn } from './actions';
import { grantedHow, groupByRole } from './card';
import type { QualifiedStaffRow, RateCardRow, StaffOption } from './types';

/**
 * Block 3 — qualified staff (§9.7).
 *
 * The same list as the profile's Client qualification tab, from the other
 * end and through the same functions, so the two screens cannot drift.
 *
 * Grouped by role with a counter, because §9.7 says what the counter is
 * FOR: "A counter per role group shows how deep the first-choice pool is
 * … which is what tells a manager whether auto-assign is likely to fill
 * that role section from Wave 1 alone." A worker marked Do not return is
 * in the list and out of the count — they are excluded from the client
 * outright, so counting them would overstate the pool by exactly the
 * people auto-assign will refuse.
 */
export function QualifiedStaff({
  clientId,
  rows,
  rateCard,
  staff,
}: {
  clientId: string;
  rows: QualifiedStaffRow[];
  rateCard: RateCardRow[];
  staff: StaffOption[];
}) {
  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [adding, setAdding] = useState(false);
  const [barring, setBarring] = useState<QualifiedStaffRow | null>(null);
  const [pickedStaff, setPickedStaff] = useState<string[]>([]);
  const [pickedRoles, setPickedRoles] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const groups = useMemo(() => {
    const matching = rows.filter(
      (row) =>
        query.trim() === '' ||
        row.display_name.toLowerCase().includes(query.trim().toLowerCase()) ||
        employeeId(row.employee_id).toLowerCase().includes(query.trim().toLowerCase()),
    );
    return groupByRole(matching);
  }, [rows, query]);

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; message: string }>,
    after?: () => void,
  ) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (result.ok) after?.();
      else setProblem(result.message);
    });
  };

  /**
   * §9.6: a worker can only be cleared for a role they already hold. The
   * picker shows the whole compliant directory but disables anyone who
   * holds none of the chosen roles, so the refusal is visible before the
   * manager bulk-adds twelve people and gets two failures back.
   */
  const rolesByName = new Map(rateCard.map((row) => [row.role_id, row.role_name]));
  const chosenNames = pickedRoles.map((id) => rolesByName.get(id)).filter(Boolean) as string[];
  const eligible = (worker: StaffOption) =>
    chosenNames.length === 0 || chosenNames.some((name) => worker.role_names.includes(name));

  return (
    <Panel
      title={
        <>
          <span className="blk-n">3</span> Qualified staff
        </>
      }
      actions={
        <>
          <span className="muted sm">
            cleared to work at this client, grouped by role — auto-assign&rsquo;s first wave
            (RULE-17)
          </span>
          <SearchInput
            value={query}
            placeholder="Search name"
            aria-label="Search qualified staff"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button size="sm" tone="primary" onClick={() => setAdding(true)}>
            + Add staff
          </Button>
        </>
      }
      flush
    >
      {problem ? (
        <div className="panel-b">
          <Alert tone="coral">{problem}</Alert>
        </div>
      ) : null}

      {groups.length === 0 ? (
        <div className="empty">
          <h3>Nobody is cleared at this client yet</h3>
          <p>
            Add workers above, or let the first clean shift here add them by itself — a completed
            shift with no unresolved violation grants the qualification automatically (§9.6).
          </p>
        </div>
      ) : (
        <div className="panel-b stack">
          {groups.map((group) => (
            <div className="grp" key={group.role}>
              <button
                type="button"
                className="gh"
                aria-expanded={!collapsed[group.role]}
                onClick={() => setCollapsed({ ...collapsed, [group.role]: !collapsed[group.role] })}
              >
                <span className="muted">{collapsed[group.role] ? '▸' : '▾'}</span>
                <h4>{group.role}</h4>
                <span className="cnt">{group.count} qualified</span>
                {group.workers.length !== group.count ? (
                  <span className="muted xs">
                    — {group.workers.length - group.count} barred, not counted in the pool
                  </span>
                ) : null}
              </button>
              {collapsed[group.role] ? null : (
                <TableScroll>
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>Worker</th>
                        <th>Role(s) at this client</th>
                        <th>Rating</th>
                        <th>Show-rate</th>
                        <th>How granted</th>
                        <th>Date</th>
                        <th>Do not return</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {group.workers.map((row) => {
                        // role_ids, role_names and qualification_ids are
                        // aggregated in the same order by the view, so the
                        // entry behind this group's row is the one at the
                        // role's index — never the first, which would remove
                        // a different role's clearance.
                        const index = row.role_names.indexOf(group.role);
                        const qualificationId = row.qualification_ids[index] ?? '';
                        return (
                          <tr
                            key={`${row.staff_id}-${group.role}`}
                            className={row.do_not_return ? 'barred' : undefined}
                          >
                            <td>
                              <div className="person">
                                <Avatar name={row.display_name} size="sm" />
                                <div>
                                  <div className="n">
                                    <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
                                  </div>
                                  <div className="s">{employeeId(row.employee_id)}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              {row.role_names.map((name) => (
                                <Chip key={name}>{name}</Chip>
                              ))}
                            </td>
                            <td>
                              {/*
                                `.rating` is display:inline-flex in the
                                design system, so it goes on a span — on
                                the cell it collapses the row.
                              */}
                              <span className={`rating ${ratingTone(row.rating)}`}>
                                ★ {formatRating(row.rating)}
                              </span>
                            </td>
                            <td className="mono">{formatShowRate(row.reliability)}</td>
                            <td className="sm">
                              {grantedHow(row)}
                              {row.notes ? <span className="sub">{row.notes}</span> : null}
                            </td>
                            <td className="mono sm">{formatUkDate(row.last_granted_at)}</td>
                            <td>
                              <Switch
                                checked={row.do_not_return}
                                disabled={pending}
                                aria-label={`Do not return · ${row.display_name}`}
                                onChange={(next) => {
                                  if (next) {
                                    setReason('');
                                    setBarring(row);
                                  } else {
                                    run(() => setDoNotReturn(clientId, qualificationId, false, ''));
                                  }
                                }}
                              />
                            </td>
                            <td className="right-align">
                              <Button
                                size="sm"
                                tone="ghost"
                                disabled={pending || row.do_not_return}
                                title={
                                  row.do_not_return
                                    ? 'Switch Do not return off first — removing the row would un-bar this worker (§9.6)'
                                    : `Removes ${group.role} only. A later clean shift here may re-grant it (§9.6).`
                                }
                                onClick={() =>
                                  run(() => revokeQualification(clientId, qualificationId))
                                }
                              >
                                Remove
                              </Button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="panel-b">
        <span className="muted sm">
          A row exists only where a worker is cleared — there is no &ldquo;unqualified&rdquo;
          record. Working a Waiting Staff shift here does not qualify somebody as Bar Staff here.
          Removing an automatic grant does not stop the next clean shift re-granting it; to keep
          someone away, switch <b>Do not return</b> on — they are then Unavailable → Do not return
          on every event of this client, with the reason attached (§9.6, §9.7).
        </span>
      </div>

      <Modal
        open={adding}
        title="Add qualified staff"
        onClose={() => setAdding(false)}
        wide
        footer={
          <>
            <Button tone="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={pending || pickedStaff.length === 0 || pickedRoles.length === 0}
              onClick={() =>
                run(
                  () => qualifyStaff(clientId, pickedStaff, pickedRoles, note),
                  () => {
                    setAdding(false);
                    setPickedStaff([]);
                    setPickedRoles([]);
                    setNote('');
                  },
                )
              }
            >
              Add {pickedStaff.length * pickedRoles.length || ''}
            </Button>
          </>
        }
      >
        <div className="field">
          <span className="label">Roles at this client</span>
          <div className="row wrap">
            {rateCard.length === 0 ? (
              <span className="muted sm">
                This client has no rate card yet — add a role above before clearing anyone for it.
              </span>
            ) : (
              rateCard.map((row) => (
                <Checkbox
                  key={row.role_id}
                  checked={pickedRoles.includes(row.role_id)}
                  onChange={(on) =>
                    setPickedRoles(
                      on
                        ? [...pickedRoles, row.role_id]
                        : pickedRoles.filter((id) => id !== row.role_id),
                    )
                  }
                >
                  {row.role_name}
                </Checkbox>
              ))
            )}
          </div>
          <span className="hint">
            Each worker is cleared for each role you pick — &ldquo;Waiting Staff at this
            client&rdquo; and &ldquo;Bar Staff at this client&rdquo; are separate entries (§9.6).
          </span>
        </div>
        <div className="field">
          <span className="label">Workers</span>
          <div className="picker">
            {staff.map((worker) => (
              <Checkbox
                key={worker.id}
                checked={pickedStaff.includes(worker.id)}
                disabled={!eligible(worker)}
                onChange={(on) =>
                  setPickedStaff(
                    on ? [...pickedStaff, worker.id] : pickedStaff.filter((id) => id !== worker.id),
                  )
                }
              >
                {worker.display_name}{' '}
                <span className="muted xs">{employeeId(worker.employee_id)}</span>
                {!eligible(worker) ? (
                  <span className="muted xs"> — does not hold the chosen role</span>
                ) : null}
              </Checkbox>
            ))}
          </div>
        </div>
        <div className="field">
          <span className="label">Note (internal, optional)</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. team that already works here — site induction done"
          />
        </div>
      </Modal>

      <Modal
        open={barring !== null}
        title={barring ? `Do not return · ${barring.display_name}` : ''}
        onClose={() => setBarring(null)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setBarring(null)}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending || reason.trim() === ''}
              onClick={() =>
                barring &&
                run(
                  () => setDoNotReturn(clientId, barring.qualification_ids[0] ?? '', true, reason),
                  () => setBarring(null),
                )
              }
            >
              Do not return
            </Button>
          </>
        }
      >
        <Alert tone="coral">
          This is a hard gate, not a preference. {barring?.display_name} will not be invited to this
          client in either wave, the shift will never appear on their Radar, and they cannot be
          invited manually. It covers every role they hold here.
        </Alert>
        <div className="field">
          <span className="label">
            Reason <span className="coral">*</span>
          </span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. client asked not to re-engage after the February banquet"
          />
          <span className="hint">
            Shown under Unavailable → Do not return on this client&rsquo;s events (§9.6), and kept
            if the flag is ever switched off.
          </span>
        </div>
      </Modal>

      <Note>
        Removing a qualification is not barring somebody. §9.6 is explicit that a removed automatic
        grant can be re-granted by the next clean shift — where a client has asked for someone not
        to return, switch the toggle rather than deleting the row.
      </Note>
    </Panel>
  );
}
