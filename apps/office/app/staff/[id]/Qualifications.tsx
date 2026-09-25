'use client';

import { useState, useTransition } from 'react';
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
} from '@thc/ui';
import { formatUkDate } from '../staff';
import { grantQualification, revokeQualification, setDoNotReturn } from './actions';
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
  const [clientId, setClientId] = useState('');
  // §9.6: "then one or more of that worker's roles" — a set, not a pick.
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // §9.6: an entry names "a client and ONE OF THAT WORKER'S ROLES", so the
  // dropdown offers only the roles they hold. Offering the whole catalogue
  // would let a manager build a row auto-assign will never read.
  const held = roles.filter((role) => profile.role_names.includes(role.name));

  const run = (
    work: () => Promise<{ ok: true } | { ok: false; message: string }>,
    after: () => void,
  ) => {
    setProblem(null);
    start(async () => {
      const result = await work();
      if (result.ok) after();
      else setProblem(result.message);
    });
  };

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
              tone="primary"
              onClick={() => setAdding(true)}
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
            Not cleared at any client yet. A clean shift adds the first entry by itself.
          </div>
        ) : (
          <TableScroll>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Role</th>
                  <th>Granted by</th>
                  <th>Date</th>
                  <th>Note (internal)</th>
                  <th>Do not return</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {qualifications.map((row) => (
                  <tr key={row.id} className={row.do_not_return ? 'barred' : undefined}>
                    <td>
                      <b>{row.client_name}</b>
                    </td>
                    <td>
                      <Chip>{row.role_name}</Chip>
                    </td>
                    <td className="sm">
                      {row.granted_how === 'automatic' ? (
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
                    <td className="mono sm">{formatUkDate(row.granted_at)}</td>
                    <td className="sm">{row.note ?? <span className="muted">—</span>}</td>
                    <td>
                      <Switch
                        checked={row.do_not_return}
                        disabled={pending || profile.removed}
                        aria-label={`Do not return · ${row.client_name} · ${row.role_name}`}
                        onChange={(next) => {
                          if (next) {
                            // Switching it ON opens the reason dialog: an
                            // unexplained bar is one nobody can decide to lift.
                            setReason('');
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
                    <td className="right-align">
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
                          run(
                            () => revokeQualification(profile.id, row.id),
                            () => undefined,
                          )
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
          on: not invited in either wave, never on their Radar, cannot be invited manually — the
          only hard gate on this tab.
        </Note>
      </div>

      <Modal
        open={adding}
        title="Add a client qualification"
        onClose={() => setAdding(false)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setAdding(false)}>
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
                )
              }
            >
              {roleIds.length > 1 ? `Add ${roleIds.length} entries` : 'Add'}
            </Button>
          </>
        }
      >
        <div className="field">
          <span className="label">Client</span>
          <Select value={clientId} onChange={(event) => setClientId(event.target.value)}>
            <option value="">Choose a client…</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="field">
          <span className="label">Role(s)</span>
          {held.length === 0 ? (
            <span className="muted sm">
              This worker holds no role yet — add one on the Overview.
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
        <div className="field">
          <span className="label">Note (internal, optional)</span>
          <Textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="e.g. Client asked for her on the front desk"
          />
        </div>
      </Modal>

      <Modal
        open={barring !== null}
        title={barring ? `Do not return · ${barring.client_name}` : ''}
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
                  () => setDoNotReturn(profile.id, barring.id, true, reason),
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
          This is a hard gate, not a preference. {profile.display_name} will not be invited in
          either wave, the shift will never appear on their Radar, and they cannot be invited
          manually to this client.
        </Alert>
        <div className="field">
          <span className="label">
            Reason <span className="coral">*</span>
          </span>
          <Textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="e.g. Client complaint 02.09.2026, service attitude"
          />
          <span className="hint">
            Shown under Unavailable → Do not return on this client&rsquo;s events. It is kept if the
            flag is ever switched off, because it is what the next decision rests on.
          </span>
        </div>
      </Modal>
    </div>
  );
}
