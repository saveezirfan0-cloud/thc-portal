'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Button, Modal, Note, Pill, Select, SegToggle, TableScroll, toast } from '@thc/ui';
import {
  addRow,
  approveAllClean,
  changeClient,
  deleteRow,
  setShiftStatus,
  updateShift,
} from '../actions';
import type { RowResult } from '../actions';
import {
  FILTERS,
  ISSUE_FIX,
  WEEKLY_BANNER,
  countRows,
  filterRows,
  gbp,
  hasWeeklyRows,
  hoursEditable,
  hoursLabel,
  isWeekly,
  issueLabel,
  plural,
  sortRows,
} from '../view-model';
import type { ShiftPatch, StatusFilter } from '../view-model';
import { CLEAN_CONFIDENCE } from '../view-model';
import type { ShiftRow, SourceFile, TimesheetClient } from '../types';
import { ClockCell, DateCell, NumberCell, TextCell } from './Cells';
import { SourcePane } from './SourcePane';

/**
 * Step 2 · Review (audit §2.2): the source on the left, the rows on the
 * right, every cell editable. Nothing is priced here — each edit is
 * written to `timesheet_shifts` and the database's own row (hours, rate,
 * amount, issues) replaces what was on screen. A row with issues cannot be
 * approved; the database raises `shift_incomplete` if it is tried anyway
 * and the reason appears under the row.
 */
export interface ReviewScreenProps {
  jobId: string;
  client: TimesheetClient | null;
  clients: TimesheetClient[];
  initialRows: ShiftRow[];
  sources: SourceFile[];
  /** Owner / manager: may edit. A viewer sees but cannot act. */
  canAct: boolean;
}

export function ReviewScreen({
  jobId,
  client: initialClient,
  clients,
  initialRows,
  sources,
  canAct,
}: ReviewScreenProps) {
  const router = useRouter();
  const [rows, setRows] = useState<ShiftRow[]>(() => sortRows(initialRows));
  const [client, setClient] = useState(initialClient);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(true);
  const [focus, setFocus] = useState<{
    fileId: string | null;
    source: ShiftRow['source'];
    nonce: number;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [clientModal, setClientModal] = useState(false);

  const counts = useMemo(() => countRows(rows), [rows]);
  const shown = useMemo(() => filterRows(rows, filter), [rows, filter]);
  const weekly = hasWeeklyRows(rows);
  const showCount =
    rows.some((r) => r.kind === 'shift' && r.staffCount > 1) ||
    client?.invoiceFormat === 'aggregated';
  const disabled = !canAct;

  const setError = useCallback((id: string, message: string | null) => {
    setErrors((prev) => {
      const next = { ...prev };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }, []);

  const apply = useCallback(
    (id: string, result: RowResult) => {
      if ('ok' in result) {
        setRows((prev) => prev.map((r) => (r.id === id ? result.row : r)));
        setError(id, null);
        if (result.notice) toast(result.notice);
      } else {
        if (result.row) {
          const reverted = result.row;
          setRows((prev) => prev.map((r) => (r.id === id ? reverted : r)));
        }
        setError(id, result.error);
      }
    },
    [setError],
  );

  const edit = useCallback(
    async (row: ShiftRow, patch: ShiftPatch) => {
      setBusy(row.id);
      try {
        apply(row.id, await updateShift(jobId, row.id, patch));
      } finally {
        setBusy(null);
      }
    },
    [apply, jobId],
  );

  async function decide(row: ShiftRow, status: 'approved' | 'rejected' | 'extracted') {
    setBusy(row.id);
    try {
      apply(row.id, await setShiftStatus(jobId, row.id, status));
    } finally {
      setBusy(null);
    }
  }

  async function approveClean() {
    setBusy('all');
    const result = await approveAllClean(jobId);
    setBusy(null);
    if ('error' in result) {
      toast(result.error);
      return;
    }
    setRows(sortRows(result.rows));
    setErrors({});
    toast(`${plural(result.approved, 'row')} approved.`);
  }

  async function add(kind: 'shift' | 'custom') {
    setBusy('add');
    const result = await addRow(jobId, kind, sources[0]?.id ?? null);
    setBusy(null);
    if ('error' in result) {
      toast(result.error);
      return;
    }
    setRows((prev) => sortRows([...prev, result.row]));
    setFilter('all');
    setSelected(result.row.id);
  }

  async function remove(row: ShiftRow) {
    setBusy(row.id);
    const result = await deleteRow(jobId, row.id);
    setBusy(null);
    if ('error' in result) {
      setError(row.id, result.error);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setError(row.id, null);
  }

  function choose(row: ShiftRow) {
    setSelected(row.id);
    setFocus({ fileId: row.fileId, source: row.source, nonce: Date.now() });
  }

  const clientName = client?.name ?? 'No client';
  const columns = 10 + (showCount ? 1 : 0) + 1;

  return (
    <div className="pr-review">
      <div className="pr-review-head">
        <div>
          <h2 className="pr-h2">{clientName}</h2>
          <p className="sm muted" aria-live="polite">
            {plural(counts.total, 'row')} · {counts.approved} approved · {counts.flagged} flagged
          </p>
        </div>
        <div className="row pr-actions">
          <Button size="sm" onClick={() => setShowSource((v) => !v)} aria-pressed={showSource}>
            {showSource ? 'Hide source' : 'Show source'}
          </Button>
          <Button
            size="sm"
            disabled={disabled || busy !== null}
            onClick={() => setClientModal(true)}
          >
            Change client
          </Button>
          <Button
            size="sm"
            tone="primary"
            disabled={disabled || counts.clean === 0 || busy !== null}
            onClick={approveClean}
            title={`Approves every row with no issues and a reading of ${CLEAN_CONFIDENCE * 100}% or better`}
          >
            Approve all clean{counts.clean > 0 ? ` (${counts.clean})` : ''}
          </Button>
        </div>
      </div>

      <div className="pr-chips">
        <SegToggle
          small
          aria-label="Filter rows by status"
          value={filter}
          onChange={setFilter}
          options={FILTERS.map((f) => ({
            value: f.id,
            label: f.label,
            count: f.id === 'all' ? counts.total : counts[f.id],
          }))}
        />
      </div>

      {weekly ? <Note tone="amber">{WEEKLY_BANNER}</Note> : null}

      <div className={`pr-split${showSource ? '' : ' no-source'}`}>
        {showSource ? (
          <section className="panel pr-source-panel" aria-label="Source document">
            <div className="panel-h">
              <h3>Source document</h3>
            </div>
            <div className="panel-b">
              <SourcePane files={sources} focus={focus} />
            </div>
          </section>
        ) : null}

        <section className="panel pr-rows-panel" aria-label="Rows">
          {rows.length === 0 ? (
            <div className="panel-b">
              <p className="strong">
                Nothing was read from the file{sources.length > 1 ? 's' : ''}.
              </p>
              <p className="sm muted">
                Add the rows by hand below, or go back and upload a clearer copy.
              </p>
            </div>
          ) : null}
          {rows.length > 0 && shown.length === 0 ? (
            <div className="panel-b">
              <p className="sm muted">No rows are {filter} right now.</p>
            </div>
          ) : null}
          {shown.length > 0 ? (
            <TableScroll label="Timesheet rows" minWidth="62rem">
              <table className="tbl pr-table">
                <thead>
                  <tr>
                    <th scope="col" className="pr-col-status">
                      Status
                    </th>
                    <th scope="col">Name</th>
                    <th scope="col">Staff ID</th>
                    <th scope="col">Event date</th>
                    <th scope="col">Role</th>
                    <th scope="col">Start</th>
                    <th scope="col">End</th>
                    <th scope="col">Break (min)</th>
                    {showCount ? <th scope="col">Staff</th> : null}
                    <th scope="col">Hours</th>
                    <th scope="col">Rate</th>
                    <th scope="col" className="money">
                      Total
                    </th>
                    <th scope="col">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row) => (
                    <RowView
                      key={row.id}
                      row={row}
                      columns={columns}
                      showCount={showCount}
                      defaultRole={client?.defaultRole ?? null}
                      disabled={disabled || row.invoiceId !== null}
                      pending={busy === row.id}
                      selected={selected === row.id}
                      error={errors[row.id] ?? null}
                      onChoose={() => choose(row)}
                      onEdit={(patch) => edit(row, patch)}
                      onBad={(message) => setError(row.id, message)}
                      onDecide={(status) => decide(row, status)}
                      onDelete={() => remove(row)}
                    />
                  ))}
                </tbody>
              </table>
            </TableScroll>
          ) : null}

          <div className="pr-add">
            <Button size="sm" disabled={disabled || busy !== null} onClick={() => add('shift')}>
              + Add staff row
            </Button>
            <Button size="sm" disabled={disabled || busy !== null} onClick={() => add('custom')}>
              + Add expense line
            </Button>
          </div>

          <div className="pr-footer">
            <p className="pr-total" aria-live="polite">
              Approved: <b>{plural(counts.approved, 'row')}</b> · Hours:{' '}
              <b>{hoursLabel(counts.approvedHours)}</b> · Total: <b>{gbp(counts.approvedTotal)}</b>{' '}
              <span className="xs muted">ex VAT</span>
            </p>
            <Button
              tone="primary"
              disabled={disabled || counts.approved === 0}
              onClick={() => router.push(`/invoices/process/${jobId}?step=confirm`)}
            >
              Continue with {plural(counts.approved, 'approved row')}
            </Button>
          </div>
        </section>
      </div>

      {clientModal ? (
        <ChangeClientModal
          current={client}
          clients={clients}
          onClose={() => setClientModal(false)}
          onChanged={(next, nextRows, demoted) => {
            setClient(next);
            setRows(sortRows(nextRows));
            setErrors({});
            setClientModal(false);
            toast(
              demoted > 0
                ? `Client changed. ${plural(demoted, 'approved row')} could not be priced and went back to Extracted.`
                : 'Client changed and the rows are priced again.',
            );
            router.refresh();
          }}
          jobId={jobId}
        />
      ) : null}
    </div>
  );
}

function RowView({
  row,
  columns,
  showCount,
  defaultRole,
  disabled,
  pending,
  selected,
  error,
  onChoose,
  onEdit,
  onBad,
  onDecide,
  onDelete,
}: {
  row: ShiftRow;
  columns: number;
  showCount: boolean;
  defaultRole: string | null;
  disabled: boolean;
  pending: boolean;
  selected: boolean;
  error: string | null;
  onChoose: () => void;
  onEdit: (patch: ShiftPatch) => Promise<unknown>;
  onBad: (message: string) => void;
  onDecide: (status: 'approved' | 'rejected' | 'extracted') => void;
  onDelete: () => void;
}) {
  const custom = row.kind === 'custom';
  const has = (code: string) => row.issues.includes(code);
  const lowConfidence = row.confidence !== null && row.confidence < CLEAN_CONFIDENCE;
  const label = custom ? row.description || 'expense line' : row.staffName || 'staff row';
  const weekly = isWeekly(row);
  const locked = disabled || pending;
  const approved = row.status === 'approved';
  const rejected = row.status === 'rejected';
  const cannotApprove = row.issues.length > 0;

  return (
    <>
      <tr
        className={`pr-row ${row.status}${selected ? ' sel' : ''}${pending ? ' pending' : ''}`}
        data-row-id={row.id}
        aria-busy={pending || undefined}
      >
        <td className="pr-col-status">
          <button
            type="button"
            className="pr-dot-btn"
            onClick={onChoose}
            title={`${row.status} — show in the source`}
            aria-label={`${label}: ${row.status}. Show in source`}
          >
            <span className={`pr-dot ${row.status}`} aria-hidden="true" />
          </button>
          <span className="pr-status-word xs">{row.status}</span>
        </td>
        <td className="pr-name">
          {custom ? (
            <TextCell
              ariaLabel="Expense description"
              value={row.description ?? ''}
              placeholder="Expense (e.g. train fare)"
              disabled={locked}
              invalid={has('no_description')}
              onCommit={(v) => onEdit({ description: v })}
            />
          ) : (
            <TextCell
              ariaLabel="Staff name"
              value={row.staffName}
              placeholder="Name"
              disabled={locked}
              invalid={has('no_name')}
              onCommit={(v) => onEdit({ staffName: v })}
            />
          )}
          {row.issues.length > 0 || lowConfidence || custom ? (
            <div className="pr-tags">
              {custom ? <Pill tone="purple">Expense</Pill> : null}
              {row.issues.map((code) => (
                <Pill key={code} tone="coral" title={ISSUE_FIX[code]}>
                  {issueLabel(code)}
                </Pill>
              ))}
              {lowConfidence ? (
                <Pill
                  tone="amber"
                  title="The reading of this row was not confident — check it against the source"
                >
                  Check reading {Math.round((row.confidence ?? 0) * 100)}%
                </Pill>
              ) : null}
            </div>
          ) : null}
        </td>
        <td>
          {custom ? (
            <span className="muted">—</span>
          ) : (
            <TextCell
              ariaLabel={`Staff ID for ${label}`}
              mono
              value={row.staffRef ?? ''}
              disabled={locked}
              onCommit={(v) => onEdit({ staffRef: v })}
            />
          )}
        </td>
        <td>
          <DateCell
            ariaLabel={`Event date for ${label}`}
            value={row.workDate}
            disabled={locked}
            invalid={has('no_date')}
            onBad={onBad}
            onCommit={(v) => onEdit({ workDate: v })}
          />
        </td>
        <td>
          {custom ? (
            <span className="muted">—</span>
          ) : (
            <TextCell
              ariaLabel={`Role for ${label}`}
              value={row.roleName ?? ''}
              placeholder={defaultRole ?? 'Role'}
              disabled={locked}
              onCommit={(v) => onEdit({ roleName: v })}
            />
          )}
        </td>
        <td>
          {custom ? (
            <span className="muted">—</span>
          ) : (
            <ClockCell
              ariaLabel={`Start time for ${label} (UK time)`}
              value={row.startTime}
              disabled={locked}
              onCommit={(v) => onEdit({ startTime: v })}
            />
          )}
        </td>
        <td>
          {custom ? (
            <span className="muted">—</span>
          ) : (
            <ClockCell
              ariaLabel={`End time for ${label} (UK time)`}
              value={row.endTime}
              disabled={locked}
              onCommit={(v) => onEdit({ endTime: v })}
            />
          )}
        </td>
        <td>
          {custom ? (
            <span className="muted">—</span>
          ) : (
            <NumberCell
              ariaLabel={`Break in minutes for ${label}`}
              integer
              value={row.breakMin}
              disabled={locked}
              onCommit={(v) =>
                v === null || Number.isNaN(v)
                  ? onBad('A break is a whole number of minutes.')
                  : onEdit({ breakMin: v })
              }
            />
          )}
        </td>
        {showCount ? (
          <td>
            {custom ? (
              <span className="muted">—</span>
            ) : (
              <NumberCell
                ariaLabel={`Number of staff for ${label}`}
                integer
                value={row.staffCount}
                disabled={locked}
                onCommit={(v) =>
                  v === null || Number.isNaN(v)
                    ? onBad('Enter the number of staff.')
                    : onEdit({ staffCount: v })
                }
              />
            )}
          </td>
        ) : null}
        <td>
          {custom ? (
            <NumberCell
              ariaLabel={`Quantity for ${label}`}
              value={row.quantity}
              invalid={has('no_quantity')}
              disabled={locked}
              onCommit={(v) =>
                Number.isNaN(v) ? onBad('Enter a quantity.') : onEdit({ quantity: v })
              }
            />
          ) : hoursEditable(row) && weekly ? (
            <NumberCell
              ariaLabel={`Hours for ${label}`}
              value={row.hours}
              invalid={has('no_hours')}
              disabled={locked}
              onCommit={(v) =>
                Number.isNaN(v) ? onBad('Enter the hours as a number.') : onEdit({ hours: v })
              }
            />
          ) : (
            <span className={`mono pr-calc${has('no_hours') ? ' bad' : ''}`}>
              {hoursLabel(row.hours)}
            </span>
          )}
        </td>
        <td>
          <NumberCell
            ariaLabel={custom ? `Unit price for ${label}` : `Rate for ${label}`}
            value={row.rate}
            invalid={has('no_rate')}
            disabled={locked}
            placeholder="No rate"
            onCommit={(v) =>
              Number.isNaN(v) ? onBad('Enter the rate as a number.') : onEdit({ rate: v })
            }
          />
        </td>
        <td className="money mono">{gbp(row.amount)}</td>
        <td className="cell-actions">
          <div className="pr-buttons">
            <Button
              size="sm"
              icon
              tone={approved ? 'green' : 'default'}
              aria-pressed={approved}
              aria-label={approved ? `Un-approve ${label}` : `Approve ${label}`}
              title={
                approved
                  ? 'Approved — click to take it back'
                  : cannotApprove
                    ? `Cannot approve: ${row.issues.map(issueLabel).join(', ').toLowerCase()}`
                    : 'Approve'
              }
              disabled={locked || (!approved && cannotApprove)}
              onClick={() => onDecide(approved ? 'extracted' : 'approved')}
            >
              ✓
            </Button>
            <Button
              size="sm"
              icon
              tone={rejected ? 'danger' : 'default'}
              aria-pressed={rejected}
              aria-label={rejected ? `Restore ${label}` : `Reject ${label}`}
              title={rejected ? 'Rejected — click to restore' : 'Reject'}
              disabled={locked}
              onClick={() => onDecide(rejected ? 'extracted' : 'rejected')}
            >
              ✕
            </Button>
            <Button
              size="sm"
              icon
              tone="ghost"
              aria-label={`Delete ${label}`}
              title="Delete row"
              disabled={locked}
              onClick={onDelete}
            >
              🗑
            </Button>
          </div>
        </td>
      </tr>
      {error ? (
        <tr className="pr-row-error">
          <td colSpan={columns}>
            <span className="error" role="alert">
              {error}
            </span>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ChangeClientModal({
  jobId,
  current,
  clients,
  onClose,
  onChanged,
}: {
  jobId: string;
  current: TimesheetClient | null;
  clients: TimesheetClient[];
  onClose: () => void;
  onChanged: (client: TimesheetClient, rows: ShiftRow[], demoted: number) => void;
}) {
  const [pick, setPick] = useState(current?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    const result = await changeClient(jobId, pick);
    setBusy(false);
    if ('error' in result) {
      setError(result.error);
      return;
    }
    onChanged(result.client, result.rows, result.demoted);
  }

  return (
    <Modal
      open
      title="Change client"
      onClose={onClose}
      dismissible={!busy}
      onSubmit={submit}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" tone="primary" disabled={busy || !pick || pick === current?.id}>
            {busy ? 'Changing…' : 'Change client'}
          </Button>
        </>
      }
    >
      <div className="stack">
        <p className="sm">
          The rows are priced again from the new client’s rate card: any rate you typed on a staff
          row is cleared. Expense lines keep their price.
        </p>
        <Select label="Client" value={pick} onChange={(e) => setPick(e.currentTarget.value)}>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </Select>
        {error ? <Alert tone="coral">{error}</Alert> : null}
      </div>
    </Modal>
  );
}
