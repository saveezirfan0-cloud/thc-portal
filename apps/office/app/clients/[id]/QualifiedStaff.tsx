'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import {
  Alert,
  Avatar,
  Button,
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
/** How many workers the picker draws at a time (release audit D-M6). */
const PICKER_PAGE = 50;

/** The workers whose name or Employee ID ("THC-00873", "873") contains the search. */
export function pickerResults(staff: StaffOption[], query: string): StaffOption[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return staff;
  return staff.filter(
    (worker) =>
      worker.display_name.toLowerCase().includes(needle) ||
      employeeId(worker.employee_id).toLowerCase().includes(needle) ||
      String(worker.employee_id ?? '').includes(needle),
  );
}

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
  const [viewingRoles, setViewingRoles] = useState<{
    row: QualifiedStaffRow;
    group: string;
  } | null>(null);
  const [pickedStaff, setPickedStaff] = useState<string[]>([]);
  // Release audit D-M6: the picker listed every worker, unsearchable, at
  // ~1,000. It searches by name or Employee ID and draws the results a
  // page at a time.
  const [pickQuery, setPickQuery] = useState('');
  const [pickLimit, setPickLimit] = useState(PICKER_PAGE);
  const [pickedRoles, setPickedRoles] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // Release audit B1: a refusal from inside a dialog is shown IN the
  // dialog. On the panel it rendered behind the still-open modal, where
  // the manager could not see why nothing happened.
  const [dialogProblem, setDialogProblem] = useState<string | null>(null);
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
    where: 'panel' | 'dialog' = 'panel',
  ) => {
    setProblem(null);
    setDialogProblem(null);
    start(async () => {
      const result = await work();
      if (result.ok) after?.();
      else if (where === 'dialog') setDialogProblem(result.message);
      else setProblem(result.message);
    });
  };

  const closeAdding = () => {
    setAdding(false);
    setDialogProblem(null);
  };
  const closeBarring = () => {
    setBarring(null);
    setDialogProblem(null);
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

  const results = pickerResults(staff, pickQuery);
  const visible = results.slice(0, pickLimit);
  const selectable = results.filter(eligible);
  const allSelected =
    selectable.length > 0 && selectable.every((worker) => pickedStaff.includes(worker.id));
  // Ticked, and still able to take one of the chosen roles: what Add sends.
  const sending = staff.filter((worker) => pickedStaff.includes(worker.id) && eligible(worker));
  const toggleWorker = (id: string, on: boolean) =>
    setPickedStaff((current) =>
      on ? [...new Set([...current, id])] : current.filter((other) => other !== id),
    );
  const toggleResults = (on: boolean) =>
    setPickedStaff((current) => {
      const ids = new Set(selectable.map((worker) => worker.id));
      return on ? [...new Set([...current, ...ids])] : current.filter((id) => !ids.has(id));
    });

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
          </span>
          <SearchInput
            value={query}
            placeholder="Search name"
            aria-label="Search qualified staff"
            onChange={(event) => setQuery(event.target.value)}
          />
          <Button
            size="sm"
            tone="primary"
            onClick={() => {
              setDialogProblem(null);
              setAdding(true);
            }}
          >
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
            shift with no unresolved violation grants the qualification automatically.
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
                <TableScroll label={`Qualified staff · ${group.role}`} minWidth="44rem">
                  <table className="tbl card-rows">
                    <thead>
                      <tr>
                        <th className="col-l">Worker</th>
                        <th>Role(s) at this client</th>
                        <th>Rating</th>
                        <th>Show-rate</th>
                        <th>How granted</th>
                        <th className="col-s">Date</th>
                        <th className="cell-actions">Do not return</th>
                        <th className="cell-actions" aria-label="Remove" />
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
                            <td className="cell-title">
                              <div className="person">
                                <Avatar
                                  name={row.display_name}
                                  src={row.photo_url ?? undefined}
                                  size="sm"
                                />
                                <div>
                                  <div className="n">
                                    <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
                                  </div>
                                  <div className="s">{employeeId(row.employee_id)}</div>
                                </div>
                              </div>
                            </td>
                            <td data-label="Role(s) at this client">
                              {/*
                                Collapsed to one button (ADR-0125): a worker
                                cleared for eighteen roles otherwise fills
                                four lines of chips on every group they
                                appear in. The list opens in a pop-up.
                              */}
                              <button
                                type="button"
                                className="chip roles-btn"
                                aria-haspopup="dialog"
                                title={row.role_names.join(', ')}
                                onClick={() => setViewingRoles({ row, group: group.role })}
                              >
                                {row.role_names.length}{' '}
                                {row.role_names.length === 1 ? 'role' : 'roles'}
                              </button>
                            </td>
                            <td data-label="Rating">
                              {/*
                                `.rating` is display:inline-flex in the
                                design system, so it goes on a span — on
                                the cell it collapses the row.
                              */}
                              <span className={`rating ${ratingTone(row.rating)}`}>
                                ★ {formatRating(row.rating)}
                              </span>
                            </td>
                            <td data-label="Show-rate" className="mono">
                              {formatShowRate(row.reliability)}
                            </td>
                            <td data-label="How granted" className="sm">
                              {grantedHow(row)}
                              {row.notes ? <span className="sub">{row.notes}</span> : null}
                            </td>
                            <td data-label="Date" className="mono sm">
                              {formatUkDate(row.last_granted_at)}
                            </td>
                            <td data-label="Do not return" className="cell-actions dnr">
                              <Switch
                                checked={row.do_not_return}
                                disabled={pending}
                                aria-label={`Do not return · ${row.display_name}`}
                                onChange={(next) => {
                                  if (next) {
                                    setReason('');
                                    setDialogProblem(null);
                                    setBarring(row);
                                  } else {
                                    run(() => setDoNotReturn(clientId, qualificationId, false, ''));
                                  }
                                }}
                              />
                            </td>
                            <td className="right-align cell-actions">
                              <Button
                                size="sm"
                                tone="ghost"
                                disabled={pending || row.do_not_return}
                                title={
                                  row.do_not_return
                                    ? 'Switch Do not return off first — removing the row would un-bar this worker'
                                    : `Removes ${group.role} only. A later clean shift here may re-grant it.`
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
          on every event of this client, with the reason attached.
        </span>
      </div>

      <Modal
        open={adding}
        title="Add qualified staff"
        onClose={closeAdding}
        wide
        footer={
          <>
            <Button tone="ghost" onClick={closeAdding}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={pending || sending.length === 0 || pickedRoles.length === 0}
              onClick={() =>
                run(
                  () =>
                    qualifyStaff(
                      clientId,
                      sending.map((worker) => worker.id),
                      pickedRoles,
                      note,
                    ),
                  () => {
                    setAdding(false);
                    setPickedStaff([]);
                    setPickedRoles([]);
                    setPickQuery('');
                    setPickLimit(PICKER_PAGE);
                    setNote('');
                  },
                  'dialog',
                )
              }
            >
              Add {sending.length * pickedRoles.length || ''}
            </Button>
          </>
        }
      >
        {dialogProblem ? <Alert tone="coral">{dialogProblem}</Alert> : null}
        <div className="field">
          <span className="label">Roles at this client</span>
          <div className="row wrap">
            {rateCard.length === 0 ? (
              <span className="muted sm">
                This client has no rate card yet — add a role above before clearing anyone for it.
              </span>
            ) : (
              rateCard.map((row) => (
                <label className="pick-row" key={row.role_id}>
                  <input
                    type="checkbox"
                    checked={pickedRoles.includes(row.role_id)}
                    onChange={(event) =>
                      setPickedRoles(
                        event.target.checked
                          ? [...pickedRoles, row.role_id]
                          : pickedRoles.filter((id) => id !== row.role_id),
                      )
                    }
                  />
                  {row.role_name}
                </label>
              ))
            )}
          </div>
          <span className="hint">
            Each worker is cleared for each role you pick — &ldquo;Waiting Staff at this
            client&rdquo; and &ldquo;Bar Staff at this client&rdquo; are separate entries.
          </span>
        </div>
        <div className="field">
          <div className="label-row">
            <span className="label" id="picker-label">
              Workers
            </span>
            <span className="label-action sm" aria-live="polite">
              <b>{sending.length}</b> selected
              {pickedStaff.length > 0 ? (
                <>
                  {' · '}
                  <Button size="sm" tone="link" onClick={() => setPickedStaff([])}>
                    Clear
                  </Button>
                </>
              ) : null}
            </span>
          </div>
          <SearchInput
            aria-label="Search workers by name or Employee ID"
            placeholder="Search name or Employee ID"
            value={pickQuery}
            onChange={(event) => {
              setPickQuery(event.target.value);
              setPickLimit(PICKER_PAGE);
            }}
          />
          <label className="pick-row pick-all">
            <input
              type="checkbox"
              checked={allSelected}
              disabled={selectable.length === 0}
              onChange={(event) => toggleResults(event.target.checked)}
            />
            Select all {selectable.length.toLocaleString('en-GB')}{' '}
            {pickQuery.trim() ? 'in these results' : 'who can be added'}
          </label>
          <ul className="picker" aria-labelledby="picker-label">
            {visible.length === 0 ? (
              <li className="muted sm">No worker matches “{pickQuery.trim()}”.</li>
            ) : (
              visible.map((worker) => (
                <li key={worker.id}>
                  <label className="pick-row">
                    <input
                      type="checkbox"
                      checked={pickedStaff.includes(worker.id)}
                      disabled={!eligible(worker)}
                      onChange={(event) => toggleWorker(worker.id, event.target.checked)}
                    />
                    <span className="pick-name">{worker.display_name}</span>
                    <span className="muted xs mono">{employeeId(worker.employee_id)}</span>
                    {!eligible(worker) ? (
                      <span className="muted xs">— does not hold the chosen role</span>
                    ) : null}
                  </label>
                </li>
              ))
            )}
          </ul>
          <div className="row picker-more">
            <span className="muted xs">
              Showing {visible.length.toLocaleString('en-GB')} of{' '}
              {results.length.toLocaleString('en-GB')}
            </span>
            {results.length > visible.length ? (
              <Button size="sm" tone="ghost" onClick={() => setPickLimit(pickLimit + PICKER_PAGE)}>
                Show {Math.min(PICKER_PAGE, results.length - visible.length)} more
              </Button>
            ) : null}
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
        onClose={closeBarring}
        footer={
          <>
            <Button tone="ghost" onClick={closeBarring}>
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
                  'dialog',
                )
              }
            >
              Do not return
            </Button>
          </>
        }
      >
        {dialogProblem ? <Alert tone="coral">{dialogProblem}</Alert> : null}
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
            Shown under Unavailable → Do not return on this client&rsquo;s events, and kept if the
            flag is ever switched off.
          </span>
        </div>
      </Modal>

      <Modal
        open={viewingRoles !== null}
        title={viewingRoles ? `Roles at this client · ${viewingRoles.row.display_name}` : ''}
        onClose={() => setViewingRoles(null)}
        footer={
          <Button tone="ghost" onClick={() => setViewingRoles(null)}>
            Close
          </Button>
        }
      >
        {viewingRoles ? (
          <>
            <div className="row wrap">
              {viewingRoles.row.role_names.map((name) => (
                <Chip key={name} tone={name === viewingRoles.group ? 'cyan' : 'neutral'}>
                  {name}
                </Chip>
              ))}
            </div>
            <span className="muted xs">
              {viewingRoles.row.role_names.length}{' '}
              {viewingRoles.row.role_names.length === 1 ? 'role' : 'roles'} cleared here ·{' '}
              {viewingRoles.group} highlighted. Remove a role from its own group&rsquo;s row.
            </span>
          </>
        ) : null}
      </Modal>

      <Note>
        Removing a qualification is not barring somebody. A removed automatic grant can be
        re-granted by the next clean shift — where a client has asked for someone not to return,
        switch the toggle rather than deleting the row.
      </Note>
    </Panel>
  );
}
