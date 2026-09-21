'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, EmptyState, Note, Panel, Pill } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { RoleModal } from './RoleModal';
import { DeleteRoleModal } from './DeleteRoleModal';
import { formatAddition, formatPounds, toPence } from './money';
import type { Role } from './types';
import './roles.css';

export interface RolesScreenProps {
  roles: Role[];
  problem: string | null;
}

/**
 * /roles — THC's internal catalogue of roles and their base rates (§9.8).
 *
 * The three money columns are the point of the screen: the base rate the
 * manager edits, the holiday element at 12.07% broken out beside it as a
 * permanently visible label rather than a tooltip, and the final rate every
 * margin in the system is computed from. None of the three is held here —
 * they come from `role_directory_v`.
 */
export function RolesScreen({ roles, problem }: RolesScreenProps) {
  const router = useRouter();
  /** `null` = closed, `'new'` = create, a role = edit it. */
  const [editing, setEditing] = useState<Role | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Role | null>(null);

  const totals = useMemo(
    () => ({
      onCards: roles.filter((role) => role.rate_card_count > 0).length,
      unused: roles.filter((role) => role.rate_card_count === 0).length,
    }),
    [roles],
  );

  const close = () => {
    setEditing(null);
    setDeleting(null);
  };

  const saved = () => {
    close();
    router.refresh();
  };

  return (
    <OfficeShell
      activeHref="/roles"
      title="Roles & rates"
      crumbs={
        <>
          THC&rsquo;s internal role catalogue ·{' '}
          <b>
            {roles.length} {roles.length === 1 ? 'role' : 'roles'}
          </b>{' '}
          · base £/h
          {totals.unused > 0 ? ` · ${totals.unused} on no rate card yet` : null}
        </>
      }
      // §9.8: "New role at the top right" — unlike Venues, where §9.11 is
      // explicit that the button sits in a toolbar under the title instead.
      actions={
        <Button tone="primary" size="sm" onClick={() => setEditing('new')}>
          + New role
        </Button>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <Panel
        title="Roles"
        actions={
          <span className="hol-lbl">
            <Pill tone="amber">Holiday +12.07%</Pill>
            <span className="muted xs">calculated, never stored (§1.5)</span>
          </span>
        }
        flush
      >
        <div className="panel-b tight">
          {roles.length === 0 ? (
            <EmptyState>
              <h3>No roles yet</h3>
              <p>
                A role has to exist here before it can be added to a client&rsquo;s rate card, and
                before anyone can be booked for it.
              </p>
            </EmptyState>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Description</th>
                  <th className="money">Staff pay rate ✎</th>
                  <th className="money">Holiday +12.07%</th>
                  <th className="money">Final rate</th>
                  <th>On rate cards</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {roles.map((role) => (
                  <tr key={role.id}>
                    <td>
                      <button type="button" className="role-name" onClick={() => setEditing(role)}>
                        {role.name}
                      </button>
                    </td>
                    <td className="sm muted desc">{role.description ?? '—'}</td>
                    <td className="money">{formatPounds(toPence(role.pay_rate))}</td>
                    <td className="money hol">{formatAddition(toPence(role.holiday_rate))}</td>
                    <td className="money fin">{formatPounds(toPence(role.final_rate))}</td>
                    <td className="sm">
                      {role.rate_card_count === 0 ? (
                        <span className="muted">0 clients</span>
                      ) : (
                        <>
                          {role.rate_card_count} {role.rate_card_count === 1 ? 'client' : 'clients'}
                        </>
                      )}
                    </td>
                    <td className="actions">
                      <Button size="sm" onClick={() => setEditing(role)}>
                        Edit
                      </Button>
                      <Button size="sm" tone="danger" onClick={() => setDeleting(role)}>
                        Delete
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>

      <div className="grid c2">
        <Note>
          <b>Final rate</b> = base + holiday (12.07%). All margin across the system is calculated
          from this figure: margin/h = the client&rsquo;s charge rate − the final rate (§9.8, §9.1).
          In the app the worker only ever sees the base rate — never the +12.07% (§9.8, §10.1).
        </Note>
        <Note>
          <b>Dress code is not set here</b> — it is client-specific, not role-specific (Waiting
          Staff at the Dorchester vs at the Mandarin Oriental). It is managed per client on that
          client&rsquo;s rate card (§9.7) and pulled from there when an event is built (§3.2).
          Charge rates likewise live on the client card only.
        </Note>
      </div>

      {editing !== null ? (
        <RoleModal
          key={editing === 'new' ? 'new' : editing.id}
          role={editing === 'new' ? null : editing}
          onClose={close}
          onSaved={saved}
        />
      ) : null}

      {deleting ? (
        <DeleteRoleModal key={deleting.id} role={deleting} onClose={close} onDeleted={saved} />
      ) : null}
    </OfficeShell>
  );
}
