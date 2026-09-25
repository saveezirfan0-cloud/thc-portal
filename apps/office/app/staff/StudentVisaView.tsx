'use client';

import { Avatar, EmptyState, Note, Panel, Pill } from '@thc/ui';
import { capReason, employeeId, formatUkDate } from './staff';
import type { StudentRow } from './types';

export interface StudentVisaViewProps {
  students: StudentRow[];
  query: string;
}

/**
 * The Student visa view (§4.5).
 *
 * Its reason for existing is in the wireframe's own subtitle: the whole
 * student population in one place, not one profile at a time. A manager
 * checking whether a term letter is about to expire across 38 students
 * should not open 38 profiles.
 *
 * Every cap here is derived on the date it is read (RULE-20, §4.4) — 20 h
 * in term, 48 h in a holiday range, 48 h from the course completion date
 * once a completion letter is approved (§4.5 and the completion letter
 * requirement). None of it is stored, so nothing on this screen can be
 * stale.
 *
 * This is also the completion letter requirement's §4 report: "all
 * student-visa workers, their current cap, evidence status, and visa expiry
 * dates" — evidence status including a letter under review or rejected,
 * and the days left on the visa once it is inside the 60-day alert window.
 */
export function StudentVisaView({ students, query }: StudentVisaViewProps) {
  const needle = query.trim().toLowerCase();
  const rows = needle
    ? students.filter(
        (row) =>
          row.display_name.toLowerCase().includes(needle) ||
          employeeId(row.employee_id).toLowerCase().includes(needle),
      )
    : students;

  const bands = {
    term: students.filter(
      (row) =>
        row.weekly_cap_band === 'student_term_20' || row.weekly_cap_band === 'student_term_10',
    ).length,
    holiday: students.filter((row) => row.weekly_cap_band === 'student_holiday_48').length,
    graduated: students.filter((row) => row.weekly_cap_band === 'graduated_48').length,
  };

  return (
    <>
      <div className="grid c4">
        <div className="kpi">
          <span className="label">On the International student branch</span>
          <span className="v">{students.length}</span>
          <span className="d">every worker on branch 4 (§2.5)</span>
        </div>
        <div className="kpi warn">
          <span className="label">20 h · term time this week</span>
          <span className="v">{bands.term}</span>
          <span className="d">hard-gated at 20 h Mon–Sun (RULE-20)</span>
        </div>
        <div className="kpi ok">
          <span className="label">48 h · university holiday</span>
          <span className="v">{bands.holiday}</span>
          <span className="d">holiday range from the verified letter</span>
        </div>
        <div className="kpi accent">
          <span className="label">48 h · graduated</span>
          <span className="v">{bands.graduated}</span>
          <span className="d">completion letter verified — term dates no longer apply (§4.5)</span>
        </div>
      </div>

      <Panel
        title="Student visa · caps and evidence"
        actions={
          <span className="muted sm">
            the whole student population in one place, not one profile at a time (§4.5)
          </span>
        }
        flush
      >
        <div className="panel-b tight">
          {rows.length === 0 ? (
            <EmptyState>
              <h3>No student matches</h3>
              <p>This view holds every worker on the International student branch (§2.5).</p>
            </EmptyState>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Worker</th>
                  <th>Current weekly cap</th>
                  <th>Evidence set</th>
                  <th>Right-to-work expiry</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <div className="person">
                        <Avatar
                          name={row.display_name}
                          src={row.photo_url ?? undefined}
                          size="sm"
                        />
                        <div>
                          <div className="n">{row.display_name}</div>
                          <div className="s">{employeeId(row.employee_id)}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className={`cap ${capClass(row)}`}>{capLabel(row)}</span>
                      <span className="sub">
                        {capReason(row.weekly_cap_band, row.weekly_cap_hours)}
                        {row.weekly_booked_hours !== null
                          ? ` · ${row.weekly_booked_hours} h booked this week`
                          : null}
                        {releaseLine(row)}
                      </span>
                    </td>
                    <td className="sm">
                      <Evidence row={row} />
                    </td>
                    <td className="mono sm">
                      {row.right_to_work_until ? formatUkDate(row.right_to_work_until) : '—'}
                      {row.rtw_days_left !== null && row.rtw_days_left <= 60 ? (
                        <>
                          {' '}
                          <Pill tone={row.rtw_days_left <= 14 ? 'coral' : 'amber'}>
                            {row.rtw_days_left} d
                          </Pill>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {row.status === 'blocked' ? (
                        <Pill tone="coral">Blocked</Pill>
                      ) : (
                        <Pill tone="green">Compliant</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Panel>

      <Note>
        The cap is never typed or stored — it is derived on the date it is evaluated from the
        verified term dates (RULE-20, §4.4): 20 h in term (10 h below degree level), 48 h in a
        holiday range, 48 h from the course completion date on an approved completion letter — never
        before it, and never past the right-to-work expiry. The 48h opt-out cannot lift the in-term
        visa limit. Push N14 tells the worker on the morning a band changes (§7). Completion letters
        are approved in Compliance → Needs review.
      </Note>
    </>
  );
}

/** No ceiling: `uncapped` is the enum's own word, `opted_out_none` the older one. */
function isUncapped(row: StudentRow): boolean {
  return row.weekly_cap_band === 'uncapped' || row.weekly_cap_band === 'opted_out_none';
}

function capLabel(row: StudentRow): string {
  // A cap that cannot be calculated is not a cap of none: §4.5's blocked
  // student has no verified term dates and cannot be booked at all.
  if (row.weekly_cap_hours === null) {
    return isUncapped(row) ? '48 h/week + opt-out' : '—';
  }
  return `${row.weekly_cap_hours} h/week`;
}

function capClass(row: StudentRow): string {
  if (row.weekly_cap_hours === null && !isUncapped(row)) return 'none';
  if (row.weekly_cap_band === 'visa_expired_0') return 'none';
  if (row.weekly_cap_band === 'student_term_20' || row.weekly_cap_band === 'student_term_10') {
    return 't';
  }
  if (row.weekly_cap_band === 'graduated_48' || isUncapped(row)) return 'g';
  return 'h';
}

/**
 * Completion letter requirement §2.3 / §7: an approved letter whose release
 * has not started yet — a completion date in the future — says when it will.
 * And a cancelled opt-out says when the 48 comes back (§2.4).
 */
function releaseLine(row: StudentRow): string | null {
  const today = new Date().toISOString().slice(0, 10);
  const parts: string[] = [];
  if (row.completion_effective_from && row.completion_effective_from > today) {
    parts.push(`48 h from ${formatUkDate(row.completion_effective_from)} (completion letter)`);
  }
  if (row.wtr_optout_cancelled_from && row.wtr_optout_cancelled_from > today) {
    parts.push(
      `opt-out cancelled — 48 h again from ${formatUkDate(row.wtr_optout_cancelled_from)}`,
    );
  }
  return parts.length ? ` · ${parts.join(' · ')}` : null;
}

/**
 * The two documents RULE-20 actually reads: the term dates letter that
 * produces the 20/48 split, and the completion letter that ends it (§4.5).
 */
function Evidence({ row }: { row: StudentRow }) {
  if (row.completion_letter_verified_at) {
    return (
      <>
        Official University Completion Letter · verified{' '}
        {formatUkDate(row.completion_letter_verified_at.slice(0, 10))}
        {row.course_completion_date
          ? ` · course completed ${formatUkDate(row.course_completion_date)}`
          : null}
        <span className="sub">
          Term Dates Letter retained as history — no longer drives the cap once the course has
          completed
        </span>
        <CompletionLetterStatus row={row} />
      </>
    );
  }
  if (!row.term_letter_verified_at) {
    return (
      <span className="coral">
        No verified University Term Dates Letter — no cap can be calculated
      </span>
    );
  }
  return (
    <>
      University Term Dates Letter · verified{' '}
      {formatUkDate(row.term_letter_verified_at.slice(0, 10))}
      {row.term_letter_expires_at ? ` · expires ${formatUkDate(row.term_letter_expires_at)}` : null}
      <CompletionLetterStatus row={row} />
      {row.below_degree_level ? (
        <span className="sub">Below degree level — 10 h/week in term</span>
      ) : null}
    </>
  );
}

/**
 * The evidence status the requirement's §4 report asks for, beyond "verified":
 * a letter waiting on the office (with the date the worker entered) and one
 * the office rejected (with the reason the worker was sent).
 */
function CompletionLetterStatus({ row }: { row: StudentRow }) {
  if (row.completion_letter_in_review || row.completion_letter_status === 'pending') {
    return (
      <span className="sub amber">
        Official University Completion Letter · under review
        {row.completion_date_claimed
          ? ` · completion date entered ${formatUkDate(row.completion_date_claimed)}`
          : null}
      </span>
    );
  }
  if (row.completion_letter_status === 'rejected') {
    return (
      <span className="sub coral">
        Official University Completion Letter · rejected
        {row.completion_letter_rejection ? ` — ${row.completion_letter_rejection}` : null}
      </span>
    );
  }
  return null;
}
