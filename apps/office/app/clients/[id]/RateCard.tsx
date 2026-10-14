'use client';

import { useState, useTransition } from 'react';
import type { ReactNode } from 'react';
import {
  Addon,
  Alert,
  Button,
  Chip,
  Input,
  InputRow,
  Modal,
  Panel,
  Select,
  TableScroll,
} from '@thc/ui';
import { DRESS_CODE_MAX, lengthHint } from '../../_lib/length';
import { finalPence, toPence } from '../../roles/money';
import { addRole, removeRole, updateRole } from './actions';
import {
  chargeRateInputProblem,
  chargeValue,
  defaultDressCodes,
  dressCodeSuggestions,
  gbp,
  marginPreview,
  marginTone,
  signedGbp,
  signedPct,
} from './card';
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
 * Saved final pay and margin are read, not calculated here. `final_rate()`
 * in SQL is the single definition of the 12.07% (§9.8) and every margin in
 * the system is derived from it. While a row is being typed it shows a
 * PREVIEW of both (release audit m8 — a new row said "on Save") from
 * `roles/money`, the screen-side twin that 150_roles_directory.sql holds
 * to final_rate() at every penny; what is stored is the database's.
 *
 * A charge below final pay is a loss on every hour worked, so Save asks
 * first and says by how much — "−£5.69/h" (release audit D-M7).
 *
 * ADR-0061: an office role without finance (a scheduler) gets the same
 * block as a list of roles and their dress codes — no rate, no margin and
 * none of the add / edit / remove controls the database would refuse.
 */
export function RateCard({
  clientId,
  rows,
  roles,
  dressCodeLibrary = [],
  ratesVisible = true,
}: {
  clientId: string;
  rows: RateCardRow[];
  roles: RoleOption[];
  /** Dress codes already stored on any client's card, offered while editing. */
  dressCodeLibrary?: string[];
  ratesVisible?: boolean;
}) {
  if (!ratesVisible) return <RateCardWithoutRates rows={rows} />;
  return (
    <EditableRateCard
      clientId={clientId}
      rows={rows}
      roles={roles}
      dressCodeLibrary={dressCodeLibrary}
    />
  );
}

function EditableRateCard({
  clientId,
  rows,
  roles,
  dressCodeLibrary,
}: {
  clientId: string;
  rows: RateCardRow[];
  roles: RoleOption[];
  dressCodeLibrary: string[];
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [rate, setRate] = useState('');
  const [codes, setCodes] = useState<string[]>([]);
  const [codeDraft, setCodeDraft] = useState('');
  const [adding, setAdding] = useState('');
  /** A role picked from the catalogue, on screen but not yet saved. */
  const [draft, setDraft] = useState<RoleOption | null>(null);
  /** The draft's dress codes were filled in from the client's other roles. */
  const [learned, setLearned] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** A save that would price this role below final pay, waiting on "Save anyway". */
  const [loss, setLoss] = useState<{
    role: string;
    charge: number;
    final: number;
    save: () => void;
  } | null>(null);
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
    setLearned(false);
    setEditing(row.id);
    setRate((row.charge_rate ?? 0).toFixed(2));
    setCodes(row.dress_codes);
    setCodeDraft('');
  };

  const startDraft = (role: RoleOption) => {
    setEditing(null);
    setDraft(role);
    setRate('');
    // The client's usual dress code carries over; see defaultDressCodes().
    const usual = defaultDressCodes(rows);
    setCodes(usual);
    setLearned(usual.length > 0);
    setCodeDraft('');
  };

  /**
   * The live preview for the row being typed and the guarded save: a
   * charge below final pay asks first.
   */
  const preview = (finalPayPence: number): { margin: ReactNode; issue: string | null } => {
    const issue = chargeRateInputProblem(rate);
    if (issue)
      return { margin: <span className="muted sm">—</span>, issue: rate.trim() ? issue : null };
    const { perHour, pct } = marginPreview(Math.round(chargeValue(rate) * 100), finalPayPence);
    return {
      issue: null,
      margin: (
        <span className={marginTone(pct)}>
          {signedGbp(perHour)}/h
          <span className="sub muted">{signedPct(pct)}</span>
        </span>
      ),
    };
  };
  // A draft's final pay, from the catalogue's base rate (preview).
  const draftFinal = finalPence(toPence(draft?.pay_rate ?? 0));
  const guardedSave = (role: string, finalPayPence: number, save: () => void) => {
    const charge = Math.round(chargeValue(rate) * 100);
    if (charge < finalPayPence) setLoss({ role, charge, final: finalPayPence, save });
    else save();
  };

  const addCode = (code = codeDraft) => {
    const value = code.trim();
    if (!value || codes.some((entry) => entry.toLowerCase() === value.toLowerCase())) {
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
            charge rate and dress codes are individual to this client and edited only here
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
            in <b>Roles</b> first.
          </p>
        </div>
      ) : (
        <TableScroll label="Rate card" minWidth="48rem">
          <table className="tbl card-rows">
            <thead>
              <tr>
                <th className="col-m">Role</th>
                <th className="right-align">Charge rate ✎</th>
                <th className="right-align">Base pay</th>
                <th className="right-align">Final pay (×1.1207)</th>
                <th className="right-align">Margin</th>
                <th>Dress codes for this client</th>
                <th className="cell-actions" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {draft ? (
                <EditingRow
                  roleName={draft.name}
                  basePay={gbp(draft.pay_rate)}
                  finalPay={gbp(draftFinal / 100)}
                  margin={preview(draftFinal).margin}
                  rateIssue={preview(draftFinal).issue}
                  rate={rate}
                  setRate={setRate}
                  codes={codes}
                  setCodes={setCodes}
                  codeDraft={codeDraft}
                  setCodeDraft={setCodeDraft}
                  addCode={addCode}
                  library={dressCodeLibrary}
                  learned={learned}
                  pending={pending}
                  saveDisabled={chargeRateInputProblem(rate) !== null}
                  onCancel={() => setDraft(null)}
                  onSave={() =>
                    guardedSave(draft.name, draftFinal, () =>
                      run(
                        () => addRole(clientId, draft.id, chargeValue(rate), codes),
                        () => setDraft(null),
                      ),
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
                    margin={preview(toPence(row.final_pay_rate ?? 0)).margin}
                    rateIssue={preview(toPence(row.final_pay_rate ?? 0)).issue}
                    rate={rate}
                    setRate={setRate}
                    codes={codes}
                    setCodes={setCodes}
                    codeDraft={codeDraft}
                    setCodeDraft={setCodeDraft}
                    addCode={addCode}
                    library={dressCodeLibrary}
                    pending={pending}
                    saveDisabled={chargeRateInputProblem(rate) !== null}
                    onCancel={() => setEditing(null)}
                    onSave={() =>
                      guardedSave(row.role_name, toPence(row.final_pay_rate ?? 0), () =>
                        run(
                          () => updateRole(clientId, row.id, chargeValue(rate), codes),
                          () => setEditing(null),
                        ),
                      )
                    }
                  />
                ) : (
                  <tr key={row.id}>
                    <td className="cell-title">
                      <b>{row.role_name}</b>
                    </td>
                    <td data-label="Charge rate" className="right-align mono">
                      {/* The ✎ in the header promises the figure itself opens
                          the edit — the row's Edit button sits after the dress
                          codes, which a long one can push out of sight. The
                          cell reads as the figure alone. */}
                      <button
                        type="button"
                        className="rate-open"
                        title="Edit charge rate"
                        aria-label={`Edit charge rate for ${row.role_name}`}
                        disabled={pending}
                        onClick={() => open(row)}
                      >
                        {gbp(row.charge_rate)}
                      </button>
                    </td>
                    <td data-label="Base pay" className="right-align mono">
                      {gbp(row.base_pay_rate)}
                    </td>
                    <td data-label="Final pay" className="right-align mono">
                      {gbp(row.final_pay_rate)}
                    </td>
                    <td
                      data-label="Margin"
                      className={`right-align mono ${marginTone(row.margin_pct)}`}
                    >
                      {signedGbp(row.margin_per_hour)}/h
                      <span className="sub muted">{signedPct(row.margin_pct)}</span>
                    </td>
                    <td data-label="Dress codes" className="dcs-cell">
                      <DressCodeList codes={row.dress_codes} />
                    </td>
                    <td className="right-align cell-actions">
                      <Button size="sm" onClick={() => open(row)} disabled={pending}>
                        Edit
                      </Button>
                      <Button
                        size="sm"
                        tone="ghost"
                        disabled={pending}
                        title={
                          row.section_count > 0
                            ? `${row.section_count} built role sections keep the rate they were built with — this only removes the role from the next event's options`
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

      <Modal
        open={loss !== null}
        title="This charge rate loses money"
        onClose={() => setLoss(null)}
        footer={
          <>
            <Button onClick={() => setLoss(null)}>Change the rate</Button>
            <Button
              tone="danger"
              onClick={() => {
                const save = loss?.save;
                setLoss(null);
                save?.();
              }}
            >
              Save anyway
            </Button>
          </>
        }
      >
        {loss ? (
          <p className="sm">
            Charging <b>{gbp(loss.charge / 100)}/h</b> for {loss.role} is below its final pay of{' '}
            <b>{gbp(loss.final / 100)}/h</b>: a margin of{' '}
            <b className="coral">{signedGbp((loss.charge - loss.final) / 100)}/h</b>
            {loss.charge > 0
              ? ` (${signedPct(marginPreview(loss.charge, loss.final).pct)})`
              : ''}{' '}
            on every hour worked at this client.
          </p>
        ) : null}
      </Modal>

      <div className="panel-b">
        <span className="muted sm">
          Base pay comes from the Roles catalogue; final = base × 1.1207; margin = charge − final,
          as a share of the charge. Both staff pay and charge rates change during the year, so
          editing stays open. This dress-code list is what the event form offers for this client and
          role; the event-level &ldquo;Other&rdquo; is a one-off and is not saved back here.
        </span>
      </div>
    </Panel>
  );
}

/**
 * The rate card for an office role without finance (ADR-0061): the roles
 * this client is set up for and the dress codes the event form offers —
 * what scheduling needs — and nothing that costs or earns.
 */
function RateCardWithoutRates({ rows }: { rows: RateCardRow[] }) {
  return (
    <Panel
      title={
        <>
          <span className="blk-n">2</span> Rate card
        </>
      }
      actions={<span className="muted sm">Rates hidden for your role</span>}
      flush
    >
      {rows.length === 0 ? (
        <div className="empty">
          <h3>No roles on this rate card</h3>
          <p>An owner or manager adds roles, charge rates and dress codes here.</p>
        </div>
      ) : (
        <TableScroll label="Rate card">
          <table className="tbl card-rows">
            <thead>
              <tr>
                <th className="col-l">Role</th>
                <th>Dress codes for this client</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="cell-title">
                    <b>{row.role_name}</b>
                  </td>
                  <td data-label="Dress codes">
                    <DressCodeList codes={row.dress_codes} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <div className="panel-b">
        <span className="muted sm">
          Owners and managers set the rates. This dress-code list is what the event form offers for
          this client and role.
        </span>
      </div>
    </Panel>
  );
}

/**
 * A saved row's dress codes, read-only. A code is free text and is often a
 * full description ("Plain BLACK Collared Long Sleeve Shirt (clean and
 * pressed); Plain Black Trousers …"), which is what the worker is shown on
 * the shift and so is kept whole in the database. Here each chip is cut to
 * one line with the full text on hover; Edit shows it in full.
 */
function DressCodeList({ codes }: { codes: string[] }) {
  if (codes.length === 0) {
    return (
      <span className="muted sm">
        None yet — the event form will offer only &ldquo;Other&rdquo; for this role
      </span>
    );
  }
  return (
    <div className="dcs dcs-view">
      {codes.map((code) => (
        <Chip key={code} title={code}>
          {code}
        </Chip>
      ))}
    </div>
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
  margin,
  rateIssue,
  rate,
  setRate,
  codes,
  setCodes,
  codeDraft,
  setCodeDraft,
  addCode,
  library,
  learned = false,
  pending,
  saveDisabled,
  onCancel,
  onSave,
}: {
  roleName: string;
  basePay: string;
  finalPay: string;
  /** The live margin preview for what is typed (release audit m8). */
  margin: ReactNode;
  /** Why the typed charge rate cannot be saved, shown under the field. */
  rateIssue: string | null;
  rate: string;
  setRate: (value: string) => void;
  codes: string[];
  setCodes: (value: string[]) => void;
  codeDraft: string;
  setCodeDraft: (value: string) => void;
  addCode: (code?: string) => void;
  /** Dress codes already stored for any client, offered as one-click adds. */
  library: string[];
  /** The codes were pre-filled from this client's other roles (new-role draft only). */
  learned?: boolean;
  pending: boolean;
  saveDisabled: boolean;
  onCancel: () => void;
  onSave: () => void;
}) {
  const suggestions = dressCodeSuggestions(library, codes, codeDraft);
  return (
    <tr>
      <td className="cell-title">
        <b>{roleName}</b>
      </td>
      <td data-label="Charge rate" className="rate-edit">
        <InputRow>
          <Addon leading>£</Addon>
          <Input
            className="mono"
            value={rate}
            inputMode="decimal"
            placeholder="0.00"
            aria-label={`Charge rate for ${roleName}`}
            aria-invalid={rateIssue ? true : undefined}
            onChange={(event) => setRate(event.target.value)}
          />
        </InputRow>
        {rateIssue ? (
          <span className="error sm" role="alert">
            {rateIssue}
          </span>
        ) : null}
      </td>
      <td data-label="Base pay" className="right-align mono">
        {basePay}
      </td>
      <td data-label="Final pay" className="right-align mono">
        {finalPay}
      </td>
      <td data-label="Margin" className="right-align mono" aria-live="polite">
        {margin}
      </td>
      <td data-label="Dress codes" className="dcs-cell">
        <div className="dcs dcs-edit">
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
            maxLength={DRESS_CODE_MAX}
            hint={lengthHint(codeDraft.length, DRESS_CODE_MAX)}
            onChange={(event) => setCodeDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                addCode();
              }
            }}
          />
          <Button size="sm" onClick={() => addCode()}>
            + Add
          </Button>
        </div>
        {learned ? (
          <div className="muted sm dcs-suggest">
            Pre-filled from this client&rsquo;s other roles &mdash; remove any that don&rsquo;t
            apply to {roleName}.
          </div>
        ) : null}
        {suggestions.length > 0 ? (
          <div className="dcs dcs-suggest" role="group" aria-label="Dress codes already stored">
            <span className="muted sm">Already stored — click to add:</span>
            {suggestions.map((code) => (
              <button
                key={code}
                type="button"
                className="chip outline"
                title={code}
                onClick={() => addCode(code)}
              >
                + {code}
              </button>
            ))}
          </div>
        ) : null}
      </td>
      <td className="right-align cell-actions">
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
