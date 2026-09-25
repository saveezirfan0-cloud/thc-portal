'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Alert, Avatar, Chip, EmptyState, Note, Panel, Pill, SegToggle, Select } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { StudentVisaView } from './StudentVisaView';
import {
  capReason,
  employeeId,
  formatRating,
  formatShowRate,
  formatUkDate,
  isWorker,
  limitReached,
  matchesFilter,
  matchesQuery,
  ratingTone,
  sortRows,
  statusLabel,
} from './staff';
import type { Filter, Sort } from './staff';
import { formatUkStamp } from './[id]/profile';
import type { StaffRow, StudentRow } from './types';
import './staff.css';

export interface StaffScreenProps {
  staff: StaffRow[];
  students: StudentRow[];
  problem: string | null;
  /** `/staff?view=student` lands on the Student visa view (linked from /compliance). */
  initialView?: 'directory' | 'student';
}

const PAGE_SIZE = 15;

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
  initialView = 'directory',
}: StaffScreenProps) {
  const [view, setView] = useState<'directory' | 'student'>(initialView);
  const [filter, setFilter] = useState<Filter>('all');
  const [role, setRole] = useState('');
  const [sort, setSort] = useState<Sort>('name');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);

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
        (role === '' || row.role_names.includes(role)),
    );
    // §9.6: the Inactive tab is newest first whatever the sort says
    // (`sortRows`), so the office works through P45s in arrival order.
    return sortRows(rows, filter, sort);
  }, [staff, filter, query, role, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages - 1);
  const shown = filtered.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(0);
    };

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
    >
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      <div className="toolbar">
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
          onChange={reset<Filter>(setFilter)}
          small
          aria-label="Filter by status"
        />
        <SegToggle
          options={[
            { value: 'directory', label: 'Directory' },
            { value: 'student', label: 'Student visa', count: students.length },
          ]}
          value={view}
          onChange={setView}
          small
          aria-label="Directory or student visa view"
        />
        <div className="right">
          <div className="search">
            <input
              className="input"
              style={{ height: 32, width: 240 }}
              type="search"
              value={query}
              onChange={(event) => reset<string>(setQuery)(event.target.value)}
              placeholder="Search name, Employee ID, role"
              aria-label="Search name, Employee ID, role"
            />
          </div>
          {view === 'directory' ? (
            <>
              <Select
                value={role}
                onChange={(event) => reset<string>(setRole)(event.target.value)}
                aria-label="Filter by role"
                style={{ height: 32, width: 160 }}
              >
                <option value="">Any role</option>
                {roles.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </Select>
              <Select
                value={sort}
                onChange={(event) => setSort(event.target.value as Sort)}
                aria-label="Sort staff"
                style={{ height: 32, width: 160 }}
              >
                <option value="name">Sort: name A–Z</option>
                <option value="rating">Sort: rating</option>
                <option value="show">Sort: show-rate</option>
                <option value="newest">Sort: newest</option>
              </Select>
            </>
          ) : null}
        </div>
      </div>

      {view === 'student' ? (
        <StudentVisaView students={students} query={query} />
      ) : (
        <>
          {filter === 'inactive' ? (
            <Alert tone="cyan">
              Everyone who left through the app (&ldquo;Request my P45&rdquo;, §10.6) — one place to
              work through outstanding P45s and final pay. Leaving is not a punishment: show-rate,
              rating and feedback are untouched. The only way back is <b>Reset to candidate</b> on
              the profile (§2.12).
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
                  leaver's stamp beside the reason. Its last three columns
                  (last completed shift, released shifts, P45) need columns
                  staff_directory_v does not carry yet.
                */
                <table className="tbl card-rows">
                  <thead>
                    <tr>
                      <th />
                      <th>Name</th>
                      <th>Employee ID</th>
                      <th>Left</th>
                      <th>Reason given</th>
                      <th>Role(s)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <InactiveTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              ) : (
                <table className="tbl card-rows">
                  <thead>
                    <tr>
                      <th />
                      <th>Name</th>
                      <th>Employee ID</th>
                      <th>Role(s)</th>
                      <th>Rating</th>
                      <th>Show-rate</th>
                      <th>Compliance status</th>
                      <th>Right to work</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((row) => (
                      <StaffTableRow key={row.id} row={row} />
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            {filtered.length > PAGE_SIZE ? (
              <div className="panel-h pager">
                <span className="muted sm">
                  Showing {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + shown.length} of{' '}
                  {filtered.length.toLocaleString('en-GB')}
                </span>
                <div className="right">
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={current === 0}
                    onClick={() => setPage(current - 1)}
                  >
                    ‹ Prev
                  </button>
                  <span className="mono sm">
                    {current + 1} / {pages}
                  </span>
                  <button
                    type="button"
                    className="btn sm ghost"
                    disabled={current >= pages - 1}
                    onClick={() => setPage(current + 1)}
                  >
                    Next ›
                  </button>
                </div>
              </div>
            ) : null}
          </Panel>

          <div className="row wrap sm muted" style={{ gap: 16 }}>
            <span>
              Rating colour: <span className="rating coral">★ 0–2.9</span> ·{' '}
              <span className="rating amber">★ 3.0–3.9</span> ·{' '}
              <span className="rating green">★ 4.0+</span>
            </span>
            <span>
              &ldquo;Limit reached&rdquo; is a per-week condition, not a status — it never replaces
              Compliant / Blocked / Removed (§9.6, RULE-20).
            </span>
          </div>

          <Note>
            A removed worker stays in the list as &ldquo;Deleted account #id&rdquo;: §1.7 anonymises
            the person and keeps the history, so their roles and rating are still here (§1.7).
            Blocking, unblocking and Reset to candidate live on the profile (§4.3, §2.12).
          </Note>
        </>
      )}
    </OfficeShell>
  );
}

function StaffTableRow({ row }: { row: StaffRow }) {
  const tone = ratingTone(row.rating);
  const atLimit = limitReached(row);

  return (
    <tr>
      <td className="cell-lead">
        <Avatar
          name={row.removed ? '#' : row.display_name}
          src={row.removed ? undefined : (row.photo_url ?? undefined)}
          size="sm"
        />
      </td>
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
      </td>
      <td data-label="Employee ID" className="mono sm">
        {employeeId(row.employee_id)}
      </td>
      <td data-label="Role(s)">
        <div className="chips">
          {row.role_names.map((name) => (
            <Chip key={name}>{name}</Chip>
          ))}
        </div>
      </td>
      <td data-label="Rating">
        <span className={`rating ${tone}`}>★ {formatRating(row.rating)}</span>
      </td>
      <td data-label="Show-rate" className="mono">
        {formatShowRate(row.reliability)}
      </td>
      <td data-label="Compliance status" className="status">
        <StatusPill row={row} />
        {atLimit ? (
          // A per-week condition, beside the status and never instead of it.
          <span
            className="limit"
            title={`${capReason(row.weekly_cap_band, row.weekly_cap_hours)} · ${row.weekly_booked_hours ?? 0} h booked this week`}
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
      <td data-label="Right to work" className="sm muted">
        {describeRightToWork(row)}
      </td>
    </tr>
  );
}

/** The wireframe's Inactive tab row: who, when they left, and the reason they gave. */
function InactiveTableRow({ row }: { row: StaffRow }) {
  return (
    <tr>
      <td className="cell-lead">
        <Avatar name={row.display_name} src={row.photo_url ?? undefined} size="sm" />
      </td>
      <td className="name cell-title">
        <Link href={`/staff/${row.id}`} className="staff-name">
          {row.display_name}
        </Link>
      </td>
      <td data-label="Employee ID" className="mono sm">
        {employeeId(row.employee_id)}
      </td>
      <td data-label="Left" className="mono sm">
        {formatUkStamp(row.left_at)}
      </td>
      <td data-label="Reason given">
        {row.leave_reason ? (
          `“${row.leave_reason}”`
        ) : (
          <span className="muted">— no reason given</span>
        )}
      </td>
      <td data-label="Role(s)">
        <div className="chips">
          {row.role_names.map((name) => (
            <Chip key={name}>{name}</Chip>
          ))}
        </div>
      </td>
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
