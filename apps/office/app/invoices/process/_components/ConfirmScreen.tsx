'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Alert, Button, Input, Note, Panel, Select, UkDateField } from '@thc/ui';
import { checkPoDuplicates, confirmJob } from '../actions';
import {
  addEmptyGroup,
  dateRange,
  gbp,
  hoursLabel,
  moveRow,
  plural,
  removeGroup,
  singleGroup,
  splitByWeek,
  splitGroupAfter,
  summariseGroup,
  toConfirmed,
  ukDate,
} from '../view-model';
import type { DraftGroup, GroupDefaults } from '../view-model';
import { isIsoDate, validateGroups } from '../validators';
import type { InvoiceFormat, PoDuplicate, ShiftRow, TimesheetClient } from '../types';

/**
 * Step 3 · Confirm (audit §2.2): the approved rows become invoices. One
 * invoice by default; split by week, after a date, or by moving rows into
 * another invoice (one per PO). Each invoice has its own PO, invoice date,
 * event dates and format. A PO the client has already been invoiced for is
 * warned about. The totals are the printed lines added up — display only;
 * `issue_timesheet_invoice()` prices the invoice.
 */
export function ConfirmScreen({
  jobId,
  client,
  rows,
  vatRate,
  today,
  canAct,
}: {
  jobId: string;
  client: TimesheetClient;
  /** Approved, not yet invoiced. */
  rows: ShiftRow[];
  vatRate: number;
  today: string;
  canAct: boolean;
}) {
  const router = useRouter();
  const defaults: GroupDefaults = useMemo(
    () => ({ invoiceDate: today, format: client.invoiceFormat }),
    [today, client.invoiceFormat],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const [groups, setGroups] = useState<DraftGroup[]>(() => singleGroup(rows, defaults));
  const [duplicates, setDuplicates] = useState<PoDuplicate[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showProblems, setShowProblems] = useState(false);
  const [splitAt, setSplitAt] = useState<Record<string, string>>({});
  const latest = useRef(0);

  const problems = useMemo(
    () =>
      validateGroups(toConfirmed(groups), {
        poRequired: client.poRequired,
        approvedIds: rows.map((r) => r.id),
      }),
    [groups, client.poRequired, rows],
  );

  // The same PO twice in this set is as suspicious as one already invoiced.
  const poKey = groups.map((g) => g.poNumber.trim()).join('\u0000');
  useEffect(() => {
    const pos = groups.map((g) => g.poNumber.trim()).filter(Boolean);
    const ticket = ++latest.current;
    if (pos.length === 0) {
      setDuplicates([]);
      return;
    }
    const timer = setTimeout(async () => {
      const result = await checkPoDuplicates(client.id, pos);
      if (ticket === latest.current && 'ok' in result) setDuplicates(result.duplicates);
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poKey, client.id]);

  const update = (key: string, patch: Partial<DraftGroup>) =>
    setGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));

  const totals = useMemo(() => {
    const all = groups.map((g) =>
      summariseGroup(
        g.shiftIds.map((id) => byId.get(id)).filter((r): r is ShiftRow => !!r),
        vatRate,
      ),
    );
    const sum = (f: (s: (typeof all)[number]) => number) => Math.round(all.reduce((a, s) => a + f(s) * 100, 0)) / 100;
    return { all, subtotal: sum((s) => s.subtotal), vat: sum((s) => s.vat), total: sum((s) => s.total) };
  }, [groups, byId, vatRate]);

  async function confirm() {
    setShowProblems(true);
    if (problems.length > 0) return;
    setBusy(true);
    setError(null);
    const result = await confirmJob(jobId, toConfirmed(groups));
    if ('error' in result) {
      setBusy(false);
      setError(result.error);
      return;
    }
    router.push(`/invoices/process/${jobId}`);
    router.refresh();
  }

  if (rows.length === 0) {
    return (
      <Panel>
        <p className="strong">There are no approved rows to invoice.</p>
        <p className="sm muted">Approve rows on the Review step first.</p>
        <Link className="btn" href={`/invoices/process/${jobId}`}>
          Back to review
        </Link>
      </Panel>
    );
  }

  return (
    <div className="pr-confirm stack">
      <div className="pr-confirm-head">
        <div>
          <h2 className="pr-h2">{client.name}</h2>
          <p className="sm muted">
            {plural(rows.length, 'approved row')} to split into invoices.
            {client.poRequired ? ' This client requires a PO number on every invoice.' : ''}
          </p>
        </div>
        <div className="row pr-actions">
          <Button size="sm" disabled={!canAct || busy} onClick={() => setGroups(singleGroup(rows, defaults))}>
            One invoice
          </Button>
          <Button size="sm" disabled={!canAct || busy} onClick={() => setGroups(splitByWeek(rows, defaults))}>
            Split by week
          </Button>
          <Button
            size="sm"
            disabled={!canAct || busy}
            onClick={() => setGroups((g) => addEmptyGroup(g, defaults))}
            title="Add another invoice, then move rows into it — one invoice per PO"
          >
            Split by PO (add an invoice)
          </Button>
        </div>
      </div>

      {groups.map((group, index) => {
        const groupRows = group.shiftIds.map((id) => byId.get(id)).filter((r): r is ShiftRow => !!r);
        const summary = totals.all[index]!;
        const po = group.poNumber.trim().toUpperCase();
        const dup = po ? duplicates.filter((d) => d.poNumber.trim().toUpperCase() === po) : [];
        const sameSet = po ? groups.filter((g) => g !== group && g.poNumber.trim().toUpperCase() === po).length : 0;
        const mine = problems.filter((p) => p.group === index);
        const range = dateRange(groupRows);
        const splitDate = splitAt[group.key] ?? '';
        return (
          <Panel
            key={group.key}
            title={`Invoice ${index + 1}`}
            actions={
              groups.length > 1 && group.shiftIds.length === 0 ? (
                <Button size="sm" tone="ghost" disabled={!canAct || busy} onClick={() => setGroups((g) => removeGroup(g, group.key))}>
                  Remove
                </Button>
              ) : null
            }
          >
            <div className="pr-group-grid">
              <Input
                label={client.poRequired ? 'PO number *' : 'PO number'}
                value={group.poNumber}
                disabled={!canAct || busy}
                maxLength={100}
                error={showProblems && mine.some((p) => p.message.includes('PO number')) ? 'Required for this client.' : undefined}
                onChange={(e) => update(group.key, { poNumber: e.currentTarget.value })}
              />
              <UkDateField
                label="Invoice date"
                value={group.invoiceDate}
                disabled={!canAct || busy}
                onChange={(v) => update(group.key, { invoiceDate: v })}
              />
              <UkDateField
                label="Event date from"
                value={group.eventDateStart}
                disabled={!canAct || busy}
                onChange={(v) => update(group.key, { eventDateStart: v, datesEdited: true })}
              />
              <UkDateField
                label="Event date to"
                value={group.eventDateEnd}
                disabled={!canAct || busy}
                onChange={(v) => update(group.key, { eventDateEnd: v, datesEdited: true })}
              />
              <Select
                label="Format"
                value={group.format}
                disabled={!canAct || busy}
                onChange={(e) => update(group.key, { format: e.currentTarget.value as InvoiceFormat })}
              >
                <option value="named">Named staff</option>
                <option value="aggregated">Role aggregated</option>
              </Select>
            </div>

            {dup.length > 0 ? (
              <Note tone="amber">
                <b>PO {group.poNumber.trim()}</b> was already invoiced for {client.name}:{' '}
                {dup.map((d, i) => (
                  <span key={d.invoiceNumber}>
                    {i > 0 ? ', ' : ''}invoice #{d.invoiceNumber} ({ukDate(d.invoiceDate)}
                    {d.status === 'drawing' || d.status === 'failed' ? `, ${d.status}` : ''})
                  </span>
                ))}
                . Check this is not a repeat before you confirm.
              </Note>
            ) : null}
            {sameSet > 0 ? (
              <Note tone="amber">Another invoice in this set uses the same PO number.</Note>
            ) : null}

            <dl className="pr-summary">
              <div>
                <dt>Rows</dt>
                <dd>{summary.rows}</dd>
              </div>
              <div>
                <dt>Hours</dt>
                <dd>{hoursLabel(summary.hours)}</dd>
              </div>
              <div>
                <dt>Subtotal</dt>
                <dd>{gbp(summary.subtotal)}</dd>
              </div>
              <div>
                <dt>VAT {vatRate}%</dt>
                <dd>{gbp(summary.vat)}</dd>
              </div>
              <div className="total">
                <dt>Total</dt>
                <dd>{gbp(summary.total)}</dd>
              </div>
            </dl>

            {showProblems && mine.length > 0 ? (
              <ul className="pr-problems" role="alert">
                {mine.map((p, i) => (
                  <li key={i}>{p.message}</li>
                ))}
              </ul>
            ) : null}

            <details className="pr-rows-detail">
              <summary>
                {plural(groupRows.length, 'row')} · {range.start ? `${ukDate(range.start)} – ${ukDate(range.end)}` : 'no dates'}
              </summary>
              <div className="pr-move-wrap">
                <div className="row pr-split-row">
                  <UkDateField
                    label="Split after this date"
                    value={splitDate}
                    disabled={!canAct || busy || groupRows.length < 2}
                    onChange={(v) => setSplitAt((s) => ({ ...s, [group.key]: v }))}
                  />
                  <Button
                    size="sm"
                    disabled={!canAct || busy || !isIsoDate(splitDate)}
                    onClick={() => {
                      setGroups((g) => splitGroupAfter(g, index, splitDate, byId, defaults));
                      setSplitAt((s) => ({ ...s, [group.key]: '' }));
                    }}
                  >
                    Split by date range
                  </Button>
                </div>
                <table className="mini pr-move">
                  <thead>
                    <tr>
                      <th scope="col">Date</th>
                      <th scope="col">Name</th>
                      <th scope="col">Role</th>
                      <th scope="col">Hours</th>
                      <th scope="col">Total</th>
                      {groups.length > 1 ? <th scope="col">Invoice</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {groupRows.map((r) => (
                      <tr key={r.id}>
                        <td className="mono">{ukDate(r.workDate)}</td>
                        <td>{r.kind === 'custom' ? r.description : r.staffName}</td>
                        <td>{r.kind === 'custom' ? 'Expense' : (r.roleName ?? client.defaultRole ?? '')}</td>
                        <td className="mono">{r.kind === 'custom' ? (r.quantity ?? '—') : hoursLabel(r.hours)}</td>
                        <td className="mono">{gbp(r.amount)}</td>
                        {groups.length > 1 ? (
                          <td>
                            <select
                              className="input pr-cell"
                              aria-label={`Move ${r.kind === 'custom' ? r.description : r.staffName} to invoice`}
                              value={group.key}
                              disabled={!canAct || busy}
                              onChange={(e) => setGroups((g) => moveRow(g, r.id, e.currentTarget.value, byId))}
                            >
                              {groups.map((g, i) => (
                                <option key={g.key} value={g.key}>
                                  Invoice {i + 1}
                                </option>
                              ))}
                            </select>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Panel>
        );
      })}

      {showProblems && problems.some((p) => p.group === null) ? (
        <Alert tone="coral">{problems.filter((p) => p.group === null).map((p) => p.message).join(' ')}</Alert>
      ) : null}
      {error ? <Alert tone="coral">{error}</Alert> : null}

      <div className="pr-footer pr-footer-card">
        <p className="pr-total">
          {plural(groups.length, 'invoice')} · Subtotal <b>{gbp(totals.subtotal)}</b> · VAT <b>{gbp(totals.vat)}</b> · Total{' '}
          <b>{gbp(totals.total)}</b>
        </p>
        <div className="row pr-actions">
          <Link className="btn" href={`/invoices/process/${jobId}`}>
            Back to review
          </Link>
          <Button tone="primary" disabled={!canAct || busy} onClick={confirm}>
            {busy ? 'Confirming…' : `Confirm ${plural(groups.length, 'invoice')}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
