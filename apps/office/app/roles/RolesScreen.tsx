'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Button,
  ColumnCells,
  ColumnChooser,
  ColumnHeads,
  EmptyState,
  Note,
  Panel,
  Pill,
  TableScroll,
  useColumns,
} from '@thc/ui';
import type { ColumnDef } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { RoleModal } from './RoleModal';
import { DeleteRoleModal } from './DeleteRoleModal';
import { DEFAULT_PAY_FLOOR_PENCE, formatAddition, formatPounds, toPence } from './money';
import type { Role } from './types';
import './roles.css';

/**
 * The catalogue's columns, declared once (ADR-0139). The three rates are
 * money: the page is finance-only already (ADR-0056), and the flag keeps
 * them out of the chooser should that ever change (ADR-0061).
 */
const COLUMNS = [
  { id: 'role', label: 'Role', required: true, width: 'l' },
  { id: 'description', label: 'Description' },
  { id: 'pay', label: 'Staff pay rate ✎', className: 'money', finance: true },
  { id: 'holiday', label: 'Holiday +12.07%', className: 'money', finance: true },
  { id: 'final', label: 'Final rate', className: 'money', finance: true },
  { id: 'cards', label: 'On rate cards' },
  { id: 'actions', label: 'Actions', required: true, className: 'actions cell-actions' },
] as const satisfies readonly ColumnDef[];
type ColumnId = (typeof COLUMNS)[number]['id'];

export interface RolesScreenProps {
  roles: Role[];
  problem: string | null;
  /** Today's National Living Wage, pence: no base rate below it (ADR-0137). */
  payFloorPence?: number;
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
export function RolesScreen({
  roles,
  problem,
  payFloorPence = DEFAULT_PAY_FLOOR_PENCE,
}: RolesScreenProps) {
  const router = useRouter();
  const columns = useColumns('roles', COLUMNS);
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
            <span className="muted xs">calculated, never stored</span>
            <ColumnChooser columns={columns} label="Roles" />
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
            <TableScroll label="Roles" minWidth={columns.minWidth('48rem')}>
              <table className="tbl card-rows">
                <thead>
                  <tr>
                    <ColumnHeads columns={columns} />
                  </tr>
                </thead>
                <tbody>
                  {roles.map((role) => {
                    const cells: Record<ColumnId, ReactNode> = {
                      role: (
                        <td className="cell-title">
                          <button
                            type="button"
                            className="role-name"
                            onClick={() => setEditing(role)}
                          >
                            {role.name}
                          </button>
                        </td>
                      ),
                      description: <td className="sm muted desc">{role.description ?? '—'}</td>,
                      pay: (
                        <td data-label="Staff pay rate" className="money">
                          {/* Release audit L8: the ✎ in the header promised the
                              figure opens the edit; now it does, as the client
                              card's charge rate does. */}
                          <button
                            type="button"
                            className="rate-open"
                            title="Edit staff pay rate"
                            aria-label={`Edit staff pay rate for ${role.name}`}
                            onClick={() => setEditing(role)}
                          >
                            {formatPounds(toPence(role.pay_rate))}
                          </button>
                        </td>
                      ),
                      holiday: (
                        <td data-label="Holiday +12.07%" className="money hol">
                          {formatAddition(toPence(role.holiday_rate))}
                        </td>
                      ),
                      final: (
                        <td data-label="Final rate" className="money fin">
                          {formatPounds(toPence(role.final_rate))}
                        </td>
                      ),
                      cards: (
                        <td data-label="On rate cards" className="sm">
                          {role.rate_card_count === 0 ? (
                            <span className="muted">0 clients</span>
                          ) : (
                            <>
                              {role.rate_card_count}{' '}
                              {role.rate_card_count === 1 ? 'client' : 'clients'}
                            </>
                          )}
                        </td>
                      ),
                      actions: (
                        <td className="actions cell-actions">
                          <Button size="sm" onClick={() => setEditing(role)}>
                            Edit
                          </Button>
                          <Button size="sm" tone="danger" onClick={() => setDeleting(role)}>
                            Delete
                          </Button>
                        </td>
                      ),
                    };
                    return (
                      <tr key={role.id}>
                        <ColumnCells columns={columns} cells={cells} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          )}
        </div>
      </Panel>

      <div className="grid c2">
        <Note>
          <b>Final rate</b> = base + holiday (12.07%). All margin across the system is calculated
          from this figure: margin/h = the client&rsquo;s charge rate − the final rate. In the app
          the worker only ever sees the base rate — never the +12.07%.
        </Note>
        <Note>
          <b>Dress code is not set here</b> — it is client-specific, not role-specific (Waiting
          Staff at the Dorchester vs at the Mandarin Oriental). It is managed per client on that
          client&rsquo;s rate card and pulled from there when an event is built. Charge rates
          likewise live on the client card only.
        </Note>
      </div>

      {editing !== null ? (
        <RoleModal
          key={editing === 'new' ? 'new' : editing.id}
          role={editing === 'new' ? null : editing}
          floorPence={payFloorPence}
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
