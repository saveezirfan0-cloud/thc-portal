'use client';

import { useState, useTransition } from 'react';
import { Addon, Alert, Button, Chip, Input, InputRow, Panel, TableScroll, toast } from '@thc/ui';
import { useConfirm } from '../../_components/useConfirm';
import { addTimesheetRate, removeTimesheetRate, updateTimesheetRate } from './timesheetActions';
import { cleanAliases, parseRate, rateProblem, splitList } from './timesheetInvoicing';
import type { TimesheetRateRow } from './types';

const gbp = (n: number) =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', minimumFractionDigits: 2 }).format(n);

interface Draft {
  id: string | null;
  roleName: string;
  aliases: string;
  charge: string;
}

const EMPTY: Draft = { id: null, roleName: '', aliases: '', charge: '' };

/**
 * The timesheet rate card (ADR-0210): the role name or alias on a timesheet
 * -> what the client is charged per hour. Matching ignores case and spacing,
 * and a client charged one rate for every role needs no alias per wording
 * (`timesheet_rate_for`). The invoice prints the timesheet's own wording.
 *
 * Staff pay is deliberately not here: invoicing screens never carry it
 * (ADR-0210 §7). Written directly under `timesheet_rates`' policy: finance
 * and write, so a viewer sees the table and no controls.
 */
export function TimesheetRates({
  clientId,
  rows,
  canWrite,
}: {
  clientId: string;
  rows: TimesheetRateRow[];
  canWrite: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSaving] = useTransition();
  const { ask, dialog } = useConfirm();

  const edit = (row: TimesheetRateRow) =>
    setDraft({
      id: row.id,
      roleName: row.role_name,
      aliases: row.aliases.join(', '),
      charge: row.charge_rate.toFixed(2),
    });

  const save = () => {
    if (!draft) return;
    const charge = parseRate(draft.charge);
    if (charge === null) {
      setError('The charge rate is in pounds and pence, e.g. 18.98.');
      return;
    }
    const input = {
      roleName: draft.roleName.trim(),
      aliases: cleanAliases(draft.roleName, splitList(draft.aliases)),
      chargeRate: charge,
    };
    const problem = rateProblem(input);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    startSaving(async () => {
      const result = draft.id
        ? await updateTimesheetRate(clientId, draft.id, input)
        : await addTimesheetRate(clientId, input);
      if (result.ok) {
        toast(draft.id ? 'Rate saved.' : 'Role added to the rate card.', { tone: 'green' });
        setDraft(null);
      } else setError(result.message);
    });
  };

  const remove = (row: TimesheetRateRow) =>
    ask({
      title: `Remove ${row.role_name}?`,
      body: (
        <>
          Invoices already issued keep the rate they were issued at. A timesheet row for this role (or its
          aliases) gets no rate until it is added again.
        </>
      ),
      confirm: 'Remove role',
      onConfirm: () =>
        startSaving(async () => {
          const result = await removeTimesheetRate(clientId, row.id);
          if (result.ok) toast(`${row.role_name} removed.`, { tone: 'amber' });
          else toast(result.message, { tone: 'coral' });
        }),
    });

  return (
    <Panel
      title="Timesheet rate card"
      actions={
        canWrite && !draft ? (
          <Button size="sm" tone="primary" onClick={() => setDraft({ ...EMPTY })}>
            + Add role
          </Button>
        ) : (
          <span className="muted xs">role or alias on the timesheet → charge rate per hour</span>
        )
      }
      flush
    >
      <div className="panel-b tight">
        <TableScroll label="Timesheet rate card" minWidth="34rem">
          <table className="tbl">
            <thead>
              <tr>
                <th>Role</th>
                <th>Aliases</th>
                <th className="money">Charge £/h</th>
                {canWrite ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={canWrite ? 4 : 3} className="muted">
                    No roles yet. A timesheet row can only be priced once its role is here.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <b>{row.role_name}</b>
                    </td>
                    <td>
                      {row.aliases.length > 0 ? (
                        <span className="row wrap">
                          {row.aliases.map((alias) => (
                            <Chip key={alias}>{alias}</Chip>
                          ))}
                        </span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="money">{gbp(row.charge_rate)}</td>
                    {canWrite ? (
                      <td className="rp-nowrap">
                        <Button size="sm" onClick={() => edit(row)} disabled={saving}>
                          Edit
                        </Button>{' '}
                        <Button size="sm" tone="danger" onClick={() => remove(row)} disabled={saving}>
                          Remove
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
      </div>

      {canWrite && draft ? (
        <div className="panel-b stack">
          <b>{draft.id ? `Edit ${draft.roleName || 'role'}` : 'Add a role'}</b>
          <Input
            label="Role"
            value={draft.roleName}
            onChange={(event) => setDraft({ ...draft, roleName: event.target.value })}
            maxLength={120}
            autoFocus
            hint="As the client's timesheet names it."
          />
          <Input
            label="Aliases"
            value={draft.aliases}
            onChange={(event) => setDraft({ ...draft, aliases: event.target.value })}
            placeholder="KP, Kitchen Porter (St Paul's)"
            hint="Other wordings that mean the same role, separated by commas."
          />
          <InputRow>
            <Addon leading>£</Addon>
            <Input
              label="Charge per hour"
              inputMode="decimal"
              value={draft.charge}
              onChange={(event) => setDraft({ ...draft, charge: event.target.value })}
              placeholder="18.98"
              mono
            />
          </InputRow>
          {error ? <Alert tone="coral">{error}</Alert> : null}
          <div className="row">
            <Button tone="primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : draft.id ? 'Save' : 'Add role'}
            </Button>
            <Button
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
      {dialog}
    </Panel>
  );
}
