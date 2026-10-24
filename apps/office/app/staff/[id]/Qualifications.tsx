'use client';

import { useId, useState, useTransition } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Chip,
  Modal,
  Note,
  Panel,
  Select,
  Switch,
  TableScroll,
  Textarea,
  toast,
} from '@thc/ui';
import { formatUkDate } from '../staff';
import { useConfirm } from '../../_components/useConfirm';
import { barFromClient, grantQualification, revokeQualification, setDoNotReturn } from './actions';
import type { ClientOption, ProfileRow, QualificationRow, RoleOption } from './types';

/**
 * The Client qualification tab (§9.6).
 *
 * The screen's whole job is to keep two things apart that look alike:
 *
 *   Remove — the worker is no longer cleared here. §9.6 is explicit that
 *   this does NOT stop a later clean shift re-granting it, so the button
 *   says so rather than implying permanence.
 *
 *   Do not return — the worker is excluded from this client outright: not
 *   invited in either wave, never on their Radar, cannot be invited
 *   manually. It is the only hard gate on the profile, so it takes a
 *   reason and it is what a manager uses when a client has asked for
 *   somebody not to come back.
 *
 * The database enforces the distinction too — an entry carrying the flag
 * cannot be removed until it is switched off — so a mis-click here is
 * refused rather than silently un-barring somebody.
 *
 *   Bar from a client (ADR-0146) — Do not return at ANY client, in one
 *   step, including one the worker has no entry at. That writes a
 *   bar-only row, shown as "All roles · not cleared here"; switching it
 *   off deletes it rather than leaving a clearance nobody gave.
 */
export function Qualifications({
  profile,
  qualifications,
  clients,
  roles,
}: {
  profile: ProfileRow;
  qualifications: QualificationRow[];
  clients: ClientOption[];
  roles: RoleOption[];
}) {
  const [adding, setAdding] = useState(false);
  const [barring, setBarring] = useState<QualificationRow | null>(null);
  const [barringClient, setBarringClient] = useState(false);
  const [barClientId, setBarClientId] = useState('');
  const [clientId, setClientId] = useState('');
  // §9.6: "then one or more of that worker's roles" — a set, not a pick.
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const rolesId = useId();
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // Release audit B1: a refusal from inside a dialog is shown IN the
  // dialog, not above the panel behind it.
  const [dialogProblem, setDialogProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // §9.6: an entry names "a client and ONE OF THAT WORKER'S ROLES", so the
  // dropdown offers only the roles they hold. Offering the whole catalogue
  // would let a manager build a row auto-assign will never read.
  const held = roles.filter((role) => profile.role_names.includes(role.name));

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; message: string }>,
    after: () => void,
    where: 'panel' | 'dialog' = 'panel',
  ) => {
    setProblem(null);
    setDialogProblem(null);
    start(async () => {
      const result = await work();
      if (result.ok) after();
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
  const closeBarringClient = () => {
    setBarringClient(false);
    setDialogProblem(null);
  };
  // ADR-0137 §1: Remove used to happen on the click.
  const confirm = useConfirm();

  return (
    <div className="stack">
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <Panel
        title="Client qualification"
        actions={
          <>
            <span className="muted sm">
              which client + role combinations this worker is cleared for — auto-assign&rsquo;s
              first wave
            </span>
            <Button
              size="sm"
              tone="danger"
              onClick={() => {
                setDialogProblem(null);
                setBarClientId('');
                setReason('');
                setBarringClient(true);
              }}
              disabled={profile.removed}
            >
              Bar from a client
            </Button>
            <Button
              size="sm"
              tone="primary"
              onClick={() => {
                setDialogProblem(null);
                setAdding(true);
              }}
              disabled={profile.removed}
            >
              + Add client
            </Button>
          </>
        }
        flush
      >
        {qualifications.length === 0 ? (
          <div className="empty">
            Not cleared at any client yet. A clean shift adds the first entry by itself. To keep
            this worker away from a client, use <b>Bar from a client</b>.
          </div>
        ) : (
          <TableScroll label="Client qualification" minWidth="44rem">
            {/* `card-rows`: below 760px each entry is a card titled by the
                client, every other cell naming its column. */}
            <table className="tbl card-rows">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Role</th>
                  <th>Granted by</th>
                  <th>Date</th>
                  <th>Note (internal)</th>
                  <th className="cell-actions">Do not return</th>
                  <th className="cell-actions" aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {qualifications.map((row) => (
                  <tr key={row.id} className={row.do_not_return ? 'barred' : undefined}>
                    <td className="cell-title">
                      <b>{row.client_name}</b>
                    </td>
                    <td data-label="Role">
                      <Chip>{row.bar_only ? 'All roles' : row.role_name}</Chip>
                    </td>
                    <td data-label="Granted by" className="sm">
                      {row.bar_only ? (
                        <>
                          barred{row.granted_by_name ? ` by ${row.granted_by_name}` : ''} — not
                          cleared here
                        </>
                      ) : row.granted_how === 'automatic' ? (
                        <>
                          automatically from{' '}
                          <b>{row.granted_from_event_title ?? 'a completed shift'}</b>
                          {row.granted_from_event_date
                            ? ` ${formatUkDate(row.granted_from_event_date)}`
                            : ''}
                        </>
                      ) : (
                        <>manual{row.granted_by_name ? ` by ${row.granted_by_name}` : ''}</>
                      )}
                    </td>
                    <td data-label="Date" className="mono sm">
                      {formatUkDate(row.granted_at)}
                    </td>
                    <td data-label="Note (internal)" className="sm">
                      {row.note ?? <span className="muted">—</span>}
                    </td>
                    <td data-label="Do not return" className="cell-actions dnr">
                      <Switch
                        checked={row.do_not_return}
                        disabled={pending || profile.removed}
                        aria-label={`Do not return · ${row.client_name} · ${row.bar_only ? 'All roles' : row.role_name}`}
                        onChange={(next) => {
                          if (next) {
                            // Switching it ON opens the reason dialog: an
                            // unexplained bar is one nobody can decide to lift.
                            setReason('');
                            setDialogProblem(null);
                            setBarring(row);
                          } else {
                            run(
                              () => setDoNotReturn(profile.id, row.id, false, ''),
                              () => undefined,
                            );
                          }
                        }}
                      />
                    </td>
                    <td className="right-align cell-actions">
                      <Button
                        size="sm"
                        tone="ghost"
                        disabled={pending || row.do_not_return || profile.removed}
                        title={
                          row.do_not_return
                            ? 'Switch Do not return off first — removing the row would un-bar this worker'
                            : undefined
                        }
                        onClick={() =>
                          confirm.ask({
                            title: `Remove ${row.role_name} at ${row.client_name}?`,
                            body: `They stop being first choice (Wave 1) for ${row.role_name} at ${row.client_name}. A later clean shift there may grant it again automatically; to keep them away, switch Do not return on instead.`,
                            confirm: 'Remove qualification',
                            onConfirm: () =>
                              run(
                                () => revokeQualification(profile.id, row.id),
                                () => toast('Qualification removed', { tone: 'green' }),
                              ),
                          })
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      <div className="grid c2">
        <Note>
          <b>Add client:</b> pick a client, then one or more of this worker&rsquo;s roles; each
          entry can carry an internal note. The same list is editable from the client card.
        </Note>
        <Note tone="coral">
          <b>Removing ≠ barring.</b> Removing an automatic grant does not stop it being re-granted
          by the next clean shift. To keep someone away from a client, switch <b>Do not return</b>{' '}
          on, or use <b>Bar from a client</b> for a client they have no entry at: not invited in
          either wave, never on their Radar, cannot be invited manually — the only hard gate on this
          tab.
        </Note>
      </div>

      <Modal
        open={adding}
        title="Add a client qualification"
        onClose={closeAdding}
        footer={
          <>
            <Button tone="ghost" onClick={closeAdding}>
              Cancel
            </Button>
            <Button
              tone="primary"
              disabled={pending || clientId === '' || roleIds.length === 0}
              onClick={() =>
                run(
                  // One entry per role, as the table holds them (client +
                  // one role, RULE-17). The first refusal stops the run so
                  // the message names the role that failed.
                  async () => {
                    for (const roleId of roleIds) {
                      const result = await grantQualification(profile.id, clientId, roleId, note);
                      if (!result.ok) return result;
                    }
                    return { ok: true } as const;
                  },
                  () => {
                    setAdding(false);
                    setClientId('');
                    setRoleIds([]);
                    setNote('');
                  },
                  'dialog',
                )
              }
            >
              {roleIds.length > 1 ? `Add ${roleIds.length} entries` : 'Add'}
            </Button>
          </>
        }
      >
        {dialogProblem ? <Alert tone="coral">{dialogProblem}</Alert> : null}
        {/* Named controls (release audit 14.10.2026): the label is the
            field's own, not a loose span beside it. */}
        <Select
          label="Client"
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
        >
          <option value="">Choose a client…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
        <div className="field" role="group" aria-labelledby={`${rolesId}-label`}>
          <span className="label" id={`${rolesId}-label`}>
            Role(s)
          </span>
          {held.length === 0 ? (
            // TK-26: name the place roles are added — the Roles line at the
            // top of this profile — and that it comes first.
            <span className="amber sm">
              This worker has no roles yet, so there is nothing to qualify them for. Add their
              role(s) first — in <b>Roles</b> at the top of this profile — then come back here.
            </span>
          ) : (
            <div className="stack">
              {held.map((role) => (
                <Checkbox
                  key={role.id}
                  checked={roleIds.includes(role.id)}
                  onChange={(next) =>
                    setRoleIds(
                      next ? [...roleIds, role.id] : roleIds.filter((id) => id !== role.id),
                    )
                  }
                >
                  {role.name}
                </Checkbox>
              ))}
            </div>
          )}
          <span className="hint">
            One or more of the roles this worker already holds — a qualification for any other role
            is a row auto-assign never reads.
          </span>
        </div>
        <Textarea
          label="Note (internal, optional)"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="e.g. Client asked for her on the front desk"
        />
      </Modal>

      <Modal
        open={barring !== null}
        title={barring ? `Do not return · ${barring.client_name}` : ''}
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
                  () => setDoNotReturn(profile.id, barring.id, true, reason),
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
          This is a hard gate, not a preference. {profile.display_name} will not be invited in
          either wave, the shift will never appear on their Radar, and they cannot be invited
          manually to this client.
        </Alert>
        <Textarea
          label={
            <>
              Reason <span className="coral">*</span>
            </>
          }
          aria-required="true"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Client complaint 02.09.2026, service attitude"
          hint={
            <>
              Shown under Unavailable → Do not return on this client&rsquo;s events. It is kept if
              the flag is ever switched off, because it is what the next decision rests on.
            </>
          }
        />
      </Modal>
      <Modal
        open={barringClient}
        title="Bar from a client"
        onClose={closeBarringClient}
        footer={
          <>
            <Button tone="ghost" onClick={closeBarringClient}>
              Cancel
            </Button>
            <Button
              tone="danger"
              solid
              disabled={pending || barClientId === '' || reason.trim() === ''}
              onClick={() =>
                run(
                  () => barFromClient(profile.id, barClientId, reason),
                  () => {
                    setBarringClient(false);
                    toast('Marked Do not return', { tone: 'green' });
                  },
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
          This is a hard gate, not a preference. {profile.display_name} will not be invited in
          either wave, the client&rsquo;s shifts will never appear on their Radar, and they cannot
          be invited manually to this client. It does not cancel a booking they already hold.
        </Alert>
        <Select
          label="Client"
          value={barClientId}
          onChange={(event) => setBarClientId(event.target.value)}
        >
          <option value="">Choose a client…</option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name}
            </option>
          ))}
        </Select>
        <Textarea
          label={
            <>
              Reason <span className="coral">*</span>
            </>
          }
          aria-required="true"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="e.g. Client asked for them not to return, 15.10.2026"
          hint={
            <>
              Shown under Unavailable → Do not return on this client&rsquo;s events. It does not
              clear them for the client: switching the bar off later removes the entry again.
            </>
          }
        />
      </Modal>
      {confirm.dialog}
    </div>
  );
}
