'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Avatar,
  Button,
  Chip,
  ColumnCells,
  ColumnChooser,
  ColumnHeads,
  EmptyState,
  Note,
  Panel,
  Pill,
  SaveBar,
  SegToggle,
  Select,
  TableScroll,
  useColumns,
  useTimeFormat,
} from '@thc/ui';
import type { Columns, ColumnDef } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { Pager } from '../_components/Pager';
import { oneOf, pageIndex, pageParam, sizeOf, useListQuery } from '../_lib/listQuery';
import { SendPush } from './SendPush';
import { StudentVisaView } from './StudentVisaView';
import {
  CAP_FILTER_LABEL,
  capReason,
  employeeId,
  formatRating,
  formatShowRate,
  formatUkDate,
  isWorker,
  limitReached,
  matchesFilter,
  matchesGroup,
  matchesQuery,
  ratingTone,
  sortRows,
  statusLabel,
} from './staff';
import type { CapFilter, Filter, GroupFilter, Sort } from './staff';
import { formatUkStamp } from './[id]/profile';
import type { StaffRow, StudentRow } from './types';
import './staff.css';

export interface StaffScreenProps {
  staff: StaffRow[];
  students: StudentRow[];
  problem: string | null;
  /**
   * Pending name/photo change requests (ADR-0045) — "Change requests (N)".
   * Null when the count could not be read: "(?)", never a claimed 0 (D18).
   */
  pendingRequests?: number | null;
  /**
   * ADR-0082: tick workers and Send push to them — any office login that
   * may write. send_staff_message() refuses a viewer whatever this says.
   */
  canMessage?: boolean;
}

/**
 * The directory's columns and the Inactive tab's, declared once each
 * (ADR-0139): a separate choice per view, since their columns differ. The
 * lead cell (tick box, avatar) is not a column; Name stays first.
 */
const DIRECTORY_COLUMNS = [
  { id: 'name', label: 'Name', required: true },
  { id: 'employee-id', label: 'Employee ID', width: 's' },
  { id: 'roles', label: 'Role(s)' },
  { id: 'rating', label: 'Rating', width: 'xs' },
  { id: 'show-rate', label: 'Show-rate', width: 'xs' },
  { id: 'status', label: 'Compliance status', width: 'l' },
  { id: 'rtw', label: 'Right to work' },
] as const satisfies readonly ColumnDef[];
type DirectoryColumn = (typeof DIRECTORY_COLUMNS)[number]['id'];

const INACTIVE_COLUMNS = [
  { id: 'name', label: 'Name', required: true },
  { id: 'employee-id', label: 'Employee ID', width: 's' },
  { id: 'left', label: 'Left', width: 'm' },
  { id: 'reason', label: 'Reason given' },
  { id: 'roles', label: 'Role(s)' },
  { id: 'last-shift', label: 'Last completed shift', width: 'm' },
  { id: 'released', label: 'Released shifts', width: 's' },
  { id: 'p45', label: 'P45', width: 'm' },
] as const satisfies readonly ColumnDef[];
type InactiveColumn = (typeof INACTIVE_COLUMNS)[number]['id'];

/** The lead cell's share of the table's minimum width (ADR-0136), in rem. */
const LEAD_REM = 4;

/** A worker ticked for Send push: the id it sends, the name the dialog shows. */
type Picked = ReadonlyMap<string, string>;

/** The pager's two sizes, as the wireframe offers them ("15 / page", "50 / page"). */
export const PAGE_SIZES = [15, 50] as const;

const FILTERS: readonly Filter[] = ['all', 'compliant', 'blocked', 'inactive', 'removed'];
const GROUPS: readonly GroupFilter[] = ['all', 'spudbros', 'thc'];
const SORTS: readonly Sort[] = ['name', 'rating', 'show', 'newest'];
const CAPS = Object.keys(CAP_FILTER_LABEL) as CapFilter[];

/**
 * The list's state in the URL (release audit L1). `/staff?view=student`
 * lands on the Student visa view — the link /compliance uses — and `?tab=`
 * on a status tab (the Inactive tab is its own table, §9.6).
 */
const QUERY = {
  view: 'directory',
  tab: 'all',
  q: '',
  role: '',
  group: 'all',
  sort: 'name',
  cap: 'all',
  page: '1',
  size: String(PAGE_SIZES[0]),
} as const satisfies Record<string, string>;

/**
 * /staff — the worker directory (§9.6) and the §4.5 Student visa view.
 *
 * Two things this screen is careful about:
 *
 * A removed worker is listed, not hidden. §1.7 keeps the history and
 * anonymises the person, so the row reads "Deleted account #id" with the
 * roles and rating intact — and the anonymisation is the view's, so this
 * screen could not print a real name even if it tried.
 *
 * "Limit reached" sits beside the compliance status and never replaces
 * it. RULE-20's cap is a per-week condition, not a value in the
 * Staff.status machine (§2.12), and the filter tabs treat it that way.
 */
export function StaffScreen({
  staff: everyone,
  students,
  problem,
  pendingRequests = 0,
  canMessage = false,
}: StaffScreenProps) {
  const [url, setUrl] = useListQuery(QUERY);
  const view = url.view === 'student' ? 'student' : 'directory';
  const filter = oneOf(url.tab, FILTERS, 'all');
  const capFilter = oneOf(url.cap, CAPS, 'all');
  const pageSize = sizeOf(url.size, PAGE_SIZES, PAGE_SIZES[0]);
  const role = url.role;
  const group = oneOf(url.group, GROUPS, 'all');
  const sort = oneOf(url.sort, SORTS, 'name');
  const query = url.q;
  const page = pageIndex(url.page);
  // ADR-0082: kept across pages, tabs and searches, so a list can be built
  // up from several of them; cleared after a send.
  const [picked, setPicked] = useState<Picked>(new Map());
  const directoryColumns = useColumns('staff.directory', DIRECTORY_COLUMNS);
  const inactiveColumns = useColumns('staff.inactive', INACTIVE_COLUMNS);

  // §9.6 lists workers. Candidates and rejected applicants come through the
  // same view but belong to /onboarding, so they are neither counted nor
  // listed here (`isWorker`).
  const staff = useMemo(() => everyone.filter(isWorker), [everyone]);

  const counts = useMemo(
    () => ({
      all: staff.length,
      compliant: staff.filter((row) => matchesFilter(row, 'compliant')).length,
      blocked: staff.filter((row) => matchesFilter(row, 'blocked')).length,
      inactive: staff.filter((row) => matchesFilter(row, 'inactive')).length,
      removed: staff.filter((row) => matchesFilter(row, 'removed')).length,
    }),
    [staff],
  );

  const roles = useMemo(() => [...new Set(staff.flatMap((row) => row.role_names))].sort(), [staff]);

  const filtered = useMemo(() => {
    const rows = staff.filter(
      (row) =>
        matchesFilter(row, filter) &&
        matchesQuery(row, query) &&
        matchesGroup(row, group) &&
        (role === '' || row.role_names.includes(role)),
    );
    // §9.6: the Inactive tab is newest first whatever the sort says
    // (`sortRows`), so the office works through P45s in arrival order.
    return sortRows(rows, filter, sort);
  }, [staff, filter, query, role, group, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * pageSize, current * pageSize + pageSize);

  // A removed worker cannot be messaged (§1.7), so never offers a tick.
  const pickable = canMessage ? shown.filter((row) => !row.removed) : [];
  const allShownPicked = pickable.length > 0 && pickable.every((row) => picked.has(row.id));

  const pick = (row: StaffRow, on: boolean) =>
    setPicked((current) => {
      const next = new Map(current);
      if (on) next.set(row.id, row.display_name);
      else next.delete(row.id);
      return next;
    });
  const pickShown = (on: boolean) =>
    setPicked((current) => {
      const next = new Map(current);
      for (const row of pickable) {
        if (on) next.set(row.id, row.display_name);
        else next.delete(row.id);
      }
      return next;
    });
  const pickerFor = (row: StaffRow): RowPicker | undefined =>
    canMessage && !row.removed
      ? { checked: picked.has(row.id), onChange: (on) => pick(row, on) }
      : undefined;
  const headPicker = canMessage ? (
    <th className="pick col-lead">
      <label className="pick-hit">
        <input
          type="checkbox"
          aria-label="Select everyone on this page"
          checked={allShownPicked}
          disabled={pickable.length === 0}
          onChange={(event) => pickShown(event.target.checked)}
        />
      </label>
    </th>
  ) : (
    <th className="col-lead" />
  );

  // Every filter change goes back to the first page: the pager would
  // otherwise be left past the end of a shorter list.
  const reset = (patch: Partial<Record<keyof typeof QUERY, string>>) =>
    setUrl({ ...patch, page: '1' });

  return (
    <OfficeShell
      activeHref="/staff"
      title="Staff"
      crumbs={
        <>
          directory · <b>{counts.all.toLocaleString('en-GB')} workers</b> · {counts.compliant}{' '}
          compliant · {counts.blocked} blocked · {counts.inactive} inactive · {counts.removed}{' '}
          removed
        </>
      }
      // In the top bar, not a band of their own above the status tabs that
      // was empty but for two links on the right (release audit L19).
      actions={
        <span className="row staff-requests-link">
          {/* ADR-0045: the office's queue for the name and photo §10.1 locks. */}
          <Link
            href="/staff/requests"
            className="btn sm ghost"
            {...(pendingRequests === null
              ? { title: 'The pending count could not be read — open the queue to see it.' }
              : {})}
          >
            Change requests ({pendingRequests ?? '?'})
          </Link>
          {/* ADR-0107: who is SpudBros Express, and each person's Payroll ID. */}
          <Link href="/staff/roster" className="btn sm ghost">
            Invite list
          </Link>
        </span>
      }
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <div className="toolbar filters">
        <SegToggle
          options={[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'compliant', label: 'Compliant', count: counts.compliant },
            {
              value: 'blocked',
              label: 'Blocked',
              count: counts.blocked,
              alert: counts.blocked > 0,
            },
            { value: 'inactive', label: 'Inactive', count: counts.inactive },
            { value: 'removed', label: 'Removed', count: counts.removed },
          ]}
          value={filter}
          onChange={(tab) => reset({ tab })}
          small
          aria-label="Filter by status"
        />
        <SegToggle
          options={[
            { value: 'directory', label: 'Directory' },
            { value: 'student', label: 'Student visa', count: students.length },
          ]}
          value={view}
          onChange={(next) => setUrl({ view: next })}
          small
          aria-label="Directory or student visa view"
        />
        <div className="right">
          <div className="search">
            <input
              className="input"
              style={{ width: 240 }}
              type="search"
              value={query}
              onChange={(event) => setUrl({ q: event.target.value, page: '1' }, 'replace')}
              placeholder="Search name, Employee ID, Payroll ID, role"
              aria-label="Search name, Employee ID, Payroll ID, role"
            />
          </div>
          {view === 'directory' ? (
            <>
              <Select
                value={role}
                onChange={(event) => reset({ role: event.target.value })}
                aria-label="Filter by role"
                style={{ width: 160 }}
              >
                <option value="">Any role</option>
                {roles.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              {/* ADR-0107: SpudBros Express staff are onboarding-only. */}
              <Select
                value={group}
                onChange={(event) => reset({ group: event.target.value })}
                aria-label="Filter by group"
                style={{ width: 160 }}
              >
                <option value="all">All groups</option>
                <option value="spudbros">SpudBros Express</option>
                <option value="thc">THC only</option>
              </Select>
              <Select
                value={sort}
                onChange={(event) => setUrl({ sort: event.target.value })}
                aria-label="Sort staff"
                style={{ width: 160 }}
              >
                <option value="name">Sort: name A–Z</option>
                <option value="rating">Sort: rating</option>
                <option value="show">Sort: show-rate</option>
                <option value="newest">Sort: newest</option>
              </Select>
              {filter === 'inactive' ? (
                <ColumnChooser columns={inactiveColumns} label="Inactive workers" />
              ) : (
                <ColumnChooser columns={directoryColumns} label="Staff" />
              )}
            </>
          ) : (
            // The Student visa view's own filter (wireframe: All caps ·
            // 20 h · term time · 48 h · holiday · 48 h · graduated · Blocked).
            <Select
              value={capFilter}
              onChange={(event) => setUrl({ cap: event.target.value })}
              aria-label="Filter by weekly cap"
              style={{ width: 170 }}
            >
              {CAPS.map((key) => (
                <option key={key} value={key}>
                  {CAP_FILTER_LABEL[key]}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      {view === 'student' ? (
        <StudentVisaView students={students} query={query} capFilter={capFilter} />
      ) : (
        <>
          {filter === 'inactive' ? (
            <Alert tone="cyan">
              Everyone who left through the app (&ldquo;Request my P45&rdquo;) — one place to work
              through outstanding P45s and final pay. Leaving is not a punishment: show-rate, rating
              and feedback are untouched. The only way back is <b>Reset to candidate</b> on the
              profile.
            </Alert>
          ) : null}

          <Panel flush>
            <div className="panel-b tight">
              {shown.length === 0 ? (
                <EmptyState>
                  <h3>No worker matches</h3>
                  <p>Search runs over the name, the Employee ID and the worker&rsquo;s roles.</p>
                </EmptyState>
              ) : filter === 'inactive' ? (
                /*
                  §9.6: "showing the date they left and the reason they gave"
                  — the wireframe's Inactive tab is its own table, with the
                  leaver's stamp beside the reason, then what the office
                  works through: the last shift actually worked, the shifts
                  the leaving released (E8's list), and the P45 request.
                */
                <TableScroll
                  label="Inactive workers"
                  fixed
                  pin={2}
                  minWidth={inactiveColumns.minWidth('66rem', LEAD_REM)}
                >
                  <table className="tbl card-rows">
                    <thead>
                      <tr>
                        {headPicker}
                        <ColumnHeads columns={inactiveColumns} />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => (
                        <InactiveTableRow
                          key={row.id}
                          row={row}
                          picker={pickerFor(row)}
                          columns={inactiveColumns}
                        />
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              ) : (
                <TableScroll
                  label="Staff"
                  fixed
                  pin={2}
                  minWidth={directoryColumns.minWidth('56rem', LEAD_REM)}
                >
                  <table className="tbl card-rows">
                    <thead>
                      <tr>
                        {headPicker}
                        <ColumnHeads columns={directoryColumns} />
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((row) => (
                        <StaffTableRow
                          key={row.id}
                          row={row}
                          picker={pickerFor(row)}
                          columns={directoryColumns}
                        />
                      ))}
                    </tbody>
                  </table>
                </TableScroll>
              )}
            </div>
            {filtered.length > PAGE_SIZES[0] ? (
              <Pager
                total={filtered.length}
                page={current}
                pageSize={pageSize}
                sizes={PAGE_SIZES}
                onPage={(next) => setUrl({ page: pageParam(next) })}
                onPageSize={(size) => reset({ size: String(size) })}
              />
            ) : null}
          </Panel>

          {picked.size > 0 ? (
            <SaveBar
              label="Selected workers"
              status={`${picked.size} selected`}
              hint="Send them a push in your own words — booked or not. Ticks stay while you change page, tab or search."
            >
              <Button size="sm" onClick={() => setPicked(new Map())}>
                Clear
              </Button>
              <SendPush
                tone="primary"
                recipients={[...picked].map(([id, name]) => ({ id, name }))}
                onSent={() => setPicked(new Map())}
              />
            </SaveBar>
          ) : null}

          <div className="row wrap sm muted" style={{ gap: 16 }}>
            <span>
              Rating colour: <span className="rating coral">★ 0–2.9</span> ·{' '}
              <span className="rating amber">★ 3.0–3.9</span> ·{' '}
              <span className="rating green">★ 4.0+</span>
            </span>
            <span>
              &ldquo;Limit reached&rdquo; is a per-week condition, not a status — it never replaces
              Compliant / Blocked / Removed.
            </span>
          </div>

          <Note>
            A removed worker stays in the list as &ldquo;Deleted account #id&rdquo;: removal
            anonymises the person and keeps the history, so their roles and rating are still here.
            Blocking, unblocking and Reset to candidate live on the profile.
          </Note>
        </>
      )}
    </OfficeShell>
  );
}

/** The row's Send push tick (ADR-0082); absent where it cannot be messaged. */
interface RowPicker {
  checked: boolean;
  onChange: (on: boolean) => void;
}

function PickBox({ picker, name }: { picker: RowPicker | undefined; name: string }) {
  if (!picker) return null;
  return (
    <label className="pick-hit">
      <input
        type="checkbox"
        className="pick"
        aria-label={`Select ${name}`}
        checked={picker.checked}
        onChange={(event) => picker.onChange(event.target.checked)}
      />
    </label>
  );
}

function StaffTableRow({
  row,
  picker,
  columns,
}: {
  row: StaffRow;
  picker?: RowPicker;
  columns: Columns<DirectoryColumn>;
}) {
  const tone = ratingTone(row.rating);
  const atLimit = limitReached(row);

  const cells: Record<DirectoryColumn, ReactNode> = {
    name: (
      <td className="name cell-title">
        {/*
          §9.6: "The name is clickable → the profile." A removed worker's
          is too — §1.7 keeps the record openable with its non-personal
          history visible, and the label is already the anonymised one.
        */}
        <Link
          href={`/staff/${row.id}`}
          className={row.removed ? 'staff-name removed' : 'staff-name'}
        >
          {row.display_name}
        </Link>
        {row.spudbros_express && !row.removed ? (
          <>
            {' '}
            <Pill
              tone="cyan"
              title={
                row.thc_shifts_enabled
                  ? 'SpudBros Express — also works THC shifts'
                  : 'SpudBros Express Staff Only – scheduling on Connecteam'
              }
            >
              SpudBros
            </Pill>
          </>
        ) : null}
      </td>
    ),
    'employee-id': (
      <td data-label="Employee ID" className="mono sm emp-id">
        {employeeId(row.employee_id)}
        {row.payroll_id && !row.removed ? (
          <div className="xs muted">Payroll {row.payroll_id}</div>
        ) : null}
      </td>
    ),
    roles: (
      <td data-label="Role(s)">
        <div className="chips">
          {row.role_names.map((name) => (
            <Chip key={name}>{name}</Chip>
          ))}
        </div>
      </td>
    ),
    rating: (
      <td data-label="Rating">
        <span className={`rating ${tone}`}>★ {formatRating(row.rating)}</span>
      </td>
    ),
    'show-rate': (
      <td data-label="Show-rate" className="mono">
        {formatShowRate(row.reliability)}
      </td>
    ),
    status: (
      <td data-label="Compliance status" className="status">
        <StatusPill row={row} />
        {atLimit ? (
          // A per-week condition, beside the status and never instead of it.
          <span
            className="limit"
            title={`${capReason(row.weekly_cap_band, row.weekly_cap_hours, row.weekly_cap_until)} · ${row.weekly_booked_hours ?? 0} h booked this week`}
          >
            Limit reached
          </span>
        ) : null}
        {row.block_reason ? <span className="sub">{row.block_reason}</span> : null}
        {row.unresolved_violations > 0 ? (
          <span className="sub coral">
            {row.unresolved_violations} unresolved{' '}
            {row.unresolved_violations === 1 ? 'violation' : 'violations'}
          </span>
        ) : null}
        {row.do_not_return_clients.length > 0 ? (
          <span className="sub">Do not return: {row.do_not_return_clients.join(', ')}</span>
        ) : null}
        {row.status === 'inactive' && row.leave_reason ? (
          <span className="sub">Left: {row.leave_reason}</span>
        ) : null}
      </td>
    ),
    rtw: (
      <td data-label="Right to work" className="sm muted">
        {describeRightToWork(row)}
      </td>
    ),
  };

  return (
    <tr className={picker?.checked ? 'picked' : undefined}>
      <td className="cell-lead">
        <PickBox picker={picker} name={row.display_name} />
        <Avatar
          name={row.removed ? '#' : row.display_name}
          src={row.removed ? undefined : (row.photo_url ?? undefined)}
          size="sm"
        />
      </td>
      <ColumnCells columns={columns} cells={cells} />
    </tr>
  );
}

/**
 * The wireframe's Inactive tab row: who, when they left, the reason they
 * gave, their last worked shift, how many shifts the leaving released and
 * the P45 request (§9.6, §10.6). "Issued" has no column yet — the office
 * marks nothing when the P45 goes out, so the pill stays at Requested.
 */
function InactiveTableRow({
  row,
  picker,
  columns,
}: {
  row: StaffRow;
  picker?: RowPicker;
  columns: Columns<InactiveColumn>;
}) {
  const format = useTimeFormat();
  const cells: Record<InactiveColumn, ReactNode> = {
    name: (
      <td className="name cell-title">
        <Link href={`/staff/${row.id}`} className="staff-name">
          {row.display_name}
        </Link>
      </td>
    ),
    'employee-id': (
      <td data-label="Employee ID" className="mono sm emp-id">
        {employeeId(row.employee_id)}
      </td>
    ),
    left: (
      <td data-label="Left" className="mono sm">
        {formatUkStamp(row.left_at, format)}
      </td>
    ),
    reason: (
      <td data-label="Reason given">
        {row.leave_reason ? (
          `“${row.leave_reason}”`
        ) : (
          <span className="muted">— no reason given</span>
        )}
      </td>
    ),
    roles: (
      <td data-label="Role(s)">
        <div className="chips">
          {row.role_names.map((name) => (
            <Chip key={name}>{name}</Chip>
          ))}
        </div>
      </td>
    ),
    'last-shift': (
      <td data-label="Last completed shift" className="sm">
        {row.last_shift_at ? (
          formatUkDate(row.last_shift_at)
        ) : (
          <span className="muted">— none worked</span>
        )}
      </td>
    ),
    released: (
      <td data-label="Released shifts" className="sm mono">
        {row.released_shift_count}
      </td>
    ),
    p45: (
      <td data-label="P45">
        {row.p45_requested_at ? (
          <>
            <Pill tone="amber">Requested</Pill>
            <span className="sub">E8 sent {formatUkStamp(row.p45_requested_at, format)}</span>
          </>
        ) : (
          <span className="muted">—</span>
        )}
      </td>
    ),
  };

  return (
    <tr className={picker?.checked ? 'picked' : undefined}>
      <td className="cell-lead">
        <PickBox picker={picker} name={row.display_name} />
        <Avatar name={row.display_name} src={row.photo_url ?? undefined} size="sm" />
      </td>
      <ColumnCells columns={columns} cells={cells} />
    </tr>
  );
}

function StatusPill({ row }: { row: StaffRow }) {
  const { label, tone } = statusLabel(row);
  return <Pill tone={tone === 'neutral' ? undefined : tone}>{label}</Pill>;
}

const BRANCH_LABEL: Record<string, string> = {
  uk_irish: 'UK / Irish citizen',
  eu_settled: 'EU settled',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant / other',
};

function describeRightToWork(row: StaffRow): string {
  if (row.removed) return '—';
  const branch = row.rtw_branch ? (BRANCH_LABEL[row.rtw_branch] ?? row.rtw_branch) : '—';
  if (!row.right_to_work_until) return branch;
  return `${branch} · to ${formatUkDate(row.right_to_work_until)}`;
}
