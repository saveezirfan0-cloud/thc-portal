'use client';

import { useState, useTransition } from 'react';
import { Addon, Alert, Button, Chip, Input, InputRow, Panel, Select, TableScroll } from '@thc/ui';
import { addRole, removeRole, updateRole } from './actions';
import { gbp, marginTone } from './card';
import type { RateCardRow, RoleOption } from './types';

/**
 * Block 2 — the rate card (§9.7).
 *
 * The only place a charge rate or a dress code can be set. Both are
 * individual to this client: the same role can require a different dress
 * code at the Dorchester and at the Mandarin Oriental, which is exactly
 * why §9.8 keeps dress codes out of the Roles catalogue.
 *
 * Roles are added explicitly from that catalogue and never appear here by
 * themselves. If the role is not in the dropdown it has to be created in
 * Roles first — the database refuses an unknown one rather than creating
 * it, so a typo cannot fill the catalogue from this screen.
 *
 * Picking a role opens a DRAFT row — empty charge rate, empty dress codes —
 * and nothing is written until Save. §9.7: "the manager sets and edits the
 * charge rate"; a row saved at the role's base pay before anyone typed a
 * figure read as a negative margin here and became the event form's
 * default charge (events/data.ts), a rate nobody had set.
 *
 * Final pay and margin are read, not calculated here. `final_rate()` in
 * SQL is the single definition of the 12.07% (§9.8) and every margin in
 * the system is derived from it; a second implementation in TypeScript is
 * how two screens come to disagree about what a client is worth.
 */
export function RateCard({
  clientId,
  rows,
  roles,
}: {
  clientId: string;
  rows: RateCardRow[];
  roles: RoleOption[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [codeDraft, setCodeDraft] = useState('');
  const [adding, setAdding] = useState('');
  /** A role picked from the catalogue, on screen but not yet saved. */
  const [draft, setDraft] = useState<RoleOption | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const unlisted = roles.filter(
    (role) => !rows.some((row) => row.role_id === role.id) && role.id !== draft?.id,
  );

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

  const open = (row: RateCardRow) => {
    setDraft(null);
    setEditing(row.id);
    setRate(row.charge_rate.toFixed(2));
    setCodes(row.dress_codes);
    setCodeDraft('');
  };

  const startDraft = (role: RoleOption) => {
    setEditing(null);
    setDraft(role);
    setRate('');
    setCodes([]);
    setCodeDraft('');
  };

  const addCode = () => {
    const value = codeDraft.trim();
    if (!value || codes.includes(value)) {
      setCodeDraft('');
      return;
    }
    setCodes([...codes, value]);
    setCodeDraft('');
  };

  return (
    <Panel
      title={
        <>
          <span className="blk-n">2</span> Rate card
        </>
      }
      actions={
        <>
          <span className="muted sm">
            charge rate and dress codes are individual to this client and edited only here (§9.7)
          </span>
          <Select
            value={adding}
            aria-label="Add a role from the Roles catalogue"
            disabled={pending}
            onChange={(event) => {
              const id = event.target.value;
              setAdding('');
              const role = roles.find((entry) => entry.id === id);
              if (role) startDraft(role);
            }}
          >
            <option value="">+ Add role from the Roles catalogue…</option>
            {unlisted.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name} · base {gbp(role.pay_rate)}
              </option>
            ))}
          </Select>
        </>
      }
      flush
    >
      {problem ? (
        <div className="panel-b">
          <Alert tone="coral">{problem}</Alert>
        </div>
      ) : null}

      {rows.length === 0 && draft === null ? (
        <div className="empty">
          <h3>No roles on this rate card</h3>
          <p>
            Add one from the Roles catalogue above. A role that is not there yet has to be created
            in <b>Roles</b> first (§9.8).
          </p>
        </div>
      ) : (
        <TableScroll>
          <table className="tbl">
            <thead>
              <tr>
                <th>Role</th>
                <th className="right-align">Charge rate ✎</th>
                <th className="right-align">Base pay</th>
                <th className="right-align">Final pay (×1.1207)</th>
                <th className="right-align">Margin</th>
                <th>Dress codes for this client</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {draft ? (
                <EditingRow
                  roleName={draft.name}
                  basePay={gbp(draft.pay_rate)}
                  finalPay="on Save"
                  rate={rate}
                  setRate={setRate}
                  codes={codes}
                  setCodes={setCodes}
                  codeDraft={codeDraft}
                  setCodeDraft={setCodeDraft}
                  addCode={addCode}
                  pending={pending}
                  saveDisabled={rate.trim() === ''}
                  onCancel={() => setDraft(null)}
                  onSave={() =>
                    run(
                      () => addRole(clientId, draft.id, Number(rate), codes),
                      () => setDraft(null),
                    )
                  }
                />
              ) : null}
              {rows.map((row) =>
                editing === row.id ? (
                  <EditingRow
                    key={row.id}
                    roleName={row.role_name}
                    basePay={gbp(row.base_pay_rate)}
                    finalPay={gbp(row.final_pay_rate)}
                    rate={rate}
                    setRate={setRate}
                    codes={codes}
                    setCodes={setCodes}
                    codeDraft={codeDraft}
                    setCodeDraft={setCodeDraft}
                    addCode={addCode}
                    pending={pending}
                    saveDisabled={false}
                    onCancel={() => setEditing(null)}
                    onSave={() =>
                      run(
                        () => updateRole(clientId, row.id, Number(rate), codes),
                        () => setEditing(null),
                      )
                    }
                  />
                ) : (
                  <tr key={row.id}>
                    <td>
                      <b>{row.role_name}</b>
                    </td>
                    <td className="right-align mono">{gbp(row.charge_rate)}</td>
                    <td className="right-align mono">{gbp(row.base_pay_rate)}</td>
                    <td className="right-align mono">{gbp(row.final_pay_rate)}</td>
                    <td className={`right-align mono ${marginTone(row.margin_pct)}`}>
                      {row.margin_per_hour >= 0 ? '+' : ''}
                      {gbp(row.margin_per_hour)}/h
                      <span className="sub muted">
                        {row.margin_pct === null ? '—' : `${row.margin_pct}%`}
                      </span>
                    </td>
                    <td>
                      <div className="dcs">
                        {row.dress_codes.length === 0 ? (
                          <span className="muted sm">
                            None yet — the event form will offer only &ldquo;Other&rdquo; for this
                            role
                          </span>
                        ) : (
                          row.dress_codes.map((code) => <Chip key={code}>{code}</Chip>)
                        )}
                      </div>
                    </td>
                    <td className="right-align">
                      <Button size="sm" onClick={() => open(row)} disabled={pending}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        tone="ghost"
                        disabled={pending}
                        title={
                          row.section_count > 0
                            ? `${row.section_count} built role sections keep the rate they were built with (§3.2) — this only removes the role from the next event's options`
                            : undefined
                        }
                        onClick={() => run(() => removeRole(clientId, row.id))}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </TableScroll>
      )}

      <div className="panel-b">
        <span className="muted sm">
          Base pay comes from the Roles catalogue (§9.8); final = base × 1.1207; margin = charge −
          final, as a share of the charge. Both staff pay and charge rates change during the year,
          so editing stays open. This dress-code list is what the event form offers for this client
          and role; the event-level &ldquo;Other&rdquo; is a one-off and is not saved back here
          (§3.2).
        </span>
      </div>
    </Panel>
  );
}

/**
 * One row in edit mode — the wireframe's open £ input and dress-code chips
 * with × / + Add. Used for a new role before its first Save and for an
 * existing row being edited, so the two cannot drift apart. Final pay comes
 * from the database's final_rate(); a draft has none yet and says so.
 */
function EditingRow({
  roleName,
  basePay,
  finalPay,
  rate,
  setRate,
  codes,
  setCodes,
  codeDraft,
  setCodeDraft,
  addCode,
  pending,
  saveDisabled,
  onCancel,
  onSave,
}: {
  roleName: string;
  basePay: string;
  finalPay: string;
  rate: string;
  setRate: (value: string) => void;
  codes: string[];
  setCodes: (value: string[]) => void;
  codeDraft: string;
  setCodeDraft: (value: string) => void;
  addCode: () => void;
  pending: boolean;
  saveDisabled: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  return (
    <tr>
      <td>
        <b>{roleName}</b>
      </td>
      <td>
        <InputRow>
          <Addon>£</Addon>
          <Input
            className="mono"
            value={rate}
            inputMode="decimal"
            placeholder="0.00"
            aria-label={`Charge rate for ${roleName}`}
            onChange={(event) => setRate(event.target.value)}
          />
        </InputRow>
      </td>
      <td className="right-align mono">{basePay}</td>
      <td className="right-align mono">{finalPay}</td>
      <td className="right-align muted sm">saved on Save</td>
      <td>
        <div className="dcs">
          {codes.map((code) => (
            <Chip key={code}>
              {code}
              <button
                type="button"
                className="x"
                aria-label={`Remove ${code}`}
                onClick={() => setCodes(codes.filter((entry) => entry !== code))}
              >
                ×
              </button>
            </Chip>
          ))}
          <Input
            placeholder="Add a dress code"
            value={codeDraft}
            aria-label="Add a dress code"
            onChange={(event) => setCodeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCode();
              }
            }}
          />
          <Button size="sm" onClick={addCode}>
            + Add
          </Button>
        </div>
      </td>
      <td className="right-align">
        <Button size="sm" tone="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" tone="primary" disabled={pending || saveDisabled} onClick={onSave}>
          Save
        </Button>
      </td>
    </tr>
  );
}
