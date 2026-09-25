'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { Avatar, EmptyState, KpiTile, Panel, Pill, SegToggle, Select, TileGrid } from '@thc/ui';
import {
  DOCUMENT_FILTERS,
  daysLabel,
  daysTone,
  filterRadar,
  radarCounts,
  radarStatus,
  remindersLine,
  ukDate,
  ukStamp,
} from './queue';
import type { RadarFilter } from './queue';
import type { RadarRow, WarningRow } from './types';

const PAGE = 10;

const BRANCH: Record<string, string> = {
  uk_irish: 'UK / Irish citizen',
  eu_settled: 'EU settled / pre-settled',
  work_visa: 'Work visa',
  international_student: 'International student',
  dependant_other: 'Dependant / other',
};

/**
 * Tab 2 · Radar (§4.1, §4.2).
 *
 * Counters, then every dated document on a live worker, soonest first. The
 * set is `compliance_radar_v`, which is exactly what `compliance_daily()`
 * judges, so nothing here can read "expired · blocking" for a document the
 * 05:00 job does not block. There is no "Send reminder": the ladder runs
 * itself, and the Reminders column shows the rungs it actually queued.
 */
export function RadarTab({
  rows,
  warnings,
  mode,
}: {
  rows: RadarRow[];
  warnings: WarningRow[];
  mode: 'block' | 'warn';
}) {
  const [state, setState] = useState<RadarFilter>('all');
  const [query, setQuery] = useState('');
  const [document, setDocument] = useState('any');
  const [page, setPage] = useState(0);
  const counts = radarCounts(rows);
  const visible = useMemo(
    () => filterRadar(rows, state, query, document),
    [rows, state, query, document],
  );
  const pages = Math.max(1, Math.ceil(visible.length / PAGE));
  const shown = visible.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <section className="stack" aria-label="Radar">
      <TileGrid columns={3}>
        <KpiTile
          tone="danger"
          label="Expired · blocking"
          value={counts.expired}
          description="Auto-blocked on the expiry day (compliance_daily 05:00) · future bookings released · app locked to Documents (§4.3)"
        />
        <KpiTile
          tone="warn"
          label="Expiring · ≤ 30 days"
          value={counts.expiring}
          description="Push reminders at 1 month · 2 weeks · 1 week · expiry day — automatic, nothing to press (§4.2)"
        />
        <KpiTile
          label="Term letters · expire 31 Dec"
          value={counts.termLetters}
          description="Every University Term Dates Letter expires 31 December regardless of printed dates; reminders start 1 Dec"
        />
      </TileGrid>

      <div className="toolbar">
        <SegToggle
          options={[
            { value: 'all', label: 'All', count: rows.length },
            {
              value: 'expired',
              label: 'Expired',
              count: counts.expired,
              alert: counts.expired > 0,
            },
            { value: 'expiring', label: 'Expiring', count: counts.expiring },
          ]}
          value={state}
          onChange={(value) => {
            setState(value);
            setPage(0);
          }}
          small
          aria-label="Filter the radar"
        />
        <div className="search">
          <input
            className="input"
            style={{ height: 32, width: 220 }}
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(0);
            }}
            placeholder="Search by name"
            aria-label="Search by name"
          />
        </div>
        <Select
          value={document}
          onChange={(event) => {
            setDocument(event.target.value);
            setPage(0);
          }}
          aria-label="Document type"
          style={{ height: 32, width: 190 }}
        >
          {DOCUMENT_FILTERS.filter((f) =>
            ['any', 'id', 'rtw', 'visa', 'term'].includes(f.value),
          ).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <div className="right">
          <span className="muted sm">
            no manual “Send reminder” — the ladder runs itself (§4.1)
          </span>
        </div>
      </div>

      <div className="panel">
        <div className="panel-b tight">
          {shown.length === 0 ? (
            <EmptyState>
              <h3>Nothing on the radar</h3>
              <p>Every verified document with an expiry date on a live worker is listed here.</p>
            </EmptyState>
          ) : (
            <table className="tbl card-rows">
              <thead>
                <tr>
                  <th>Who</th>
                  <th>Document</th>
                  <th>Expiry date</th>
                  <th>Days left</th>
                  <th>Status</th>
                  <th>Reminders sent</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((row) => {
                  const status = radarStatus(row);
                  return (
                    <tr key={row.doc_id}>
                      <td className="cell-title">
                        <div className="person">
                          <Avatar name={row.display_name} size="sm" />
                          <div>
                            <div className="n">
                              <Link href={`/staff/${row.staff_id}`}>{row.display_name}</Link>
                            </div>
                            <div className="s">
                              {row.rtw_branch ? (BRANCH[row.rtw_branch] ?? row.rtw_branch) : '—'}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Document">{row.doc_label}</td>
                      <td data-label="Expiry date" className="mono">
                        {ukDate(row.expires_on)}
                      </td>
                      <td data-label="Days left">
                        <span className={`days ${daysTone(row.state)}`}>
                          {daysLabel(row.days_left)}
                        </span>
                      </td>
                      <td data-label="Status">
                        <Pill tone={status.tone}>{status.label}</Pill>
                        {row.replacement_in_review ? (
                          <span className="sub">a newer one is in Needs review</span>
                        ) : row.state === 'expired' ? (
                          <span className="sub">nothing re-uploaded yet</span>
                        ) : row.doc_type === 'university_term_dates_letter' ? (
                          <span className="sub">31 Dec rule — the printed dates are ignored</span>
                        ) : null}
                      </td>
                      <td data-label="Reminders" className="sm muted">
                        {remindersLine(row)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="panel-h" style={{ borderBottom: 0, borderTop: '1px solid var(--line)' }}>
          <span className="muted sm">
            Showing {shown.length} of {visible.length}
          </span>
          <div className="right">
            <button
              type="button"
              className="btn sm ghost"
              disabled={page === 0}
              onClick={() => setPage(page - 1)}
            >
              ‹ Prev
            </button>
            <span className="mono sm">
              {page + 1} / {pages}
            </span>
            <button
              type="button"
              className="btn sm ghost"
              disabled={page + 1 >= pages}
              onClick={() => setPage(page + 1)}
            >
              Next ›
            </button>
          </div>
        </div>
      </div>

      <div className="grid c2">
        <Panel
          title="Reminder ladder · push, not email"
          actions={<Pill>§4.2 · BG-04 / BG-05</Pill>}
        >
          <div className="ladder">
            <span className="k">1 month before</span>
            <span>N1 “Update your [document] — it expires on [date]”</span>
            <span className="k">2 weeks before</span>
            <span>N2 the same, more insistent</span>
            <span className="k">1 week before</span>
            <span>N3 final warning</span>
            <span className="k">Expiry day</span>
            <span>
              N4 “You have been blocked — update your document” + the automatic block fires at the
              same moment
            </span>
          </div>
        </Panel>
        <Panel title="What the block does · automatically" actions={<Pill>§4.3</Pill>}>
          <div className="sm stack tight">
            <div>
              1. Status → <b>blocked</b> · 2. removed from ALL future confirmed shifts → slots
              released to auto-assign · 3. open invitations withdrawn · 4. out of scoring · 5. app
              locked to the Documents tab.
            </div>
            <div className="muted">
              Unblock: the worker re-uploads → the office verifies in Needs review → the FULL
              compliance status is re-checked (every document in date + a Yes declaration verified)
              → unblocked automatically. No manual Unblock for an auto-block; a manual block needs
              the manager’s Unblock on the profile (§9.6).
            </div>
          </div>
        </Panel>
      </div>

      <RotaGuardPanel warnings={warnings} mode={mode} />
    </section>
  );
}

/**
 * Completion letter requirement §4: the rota guard warns or blocks on a
 * Working Time 48 breach, as `/settings` says. In block mode there is
 * nothing to list; in warn mode this is where the office sees what it let
 * through. Visa limits and right-to-work expiry are never on this list —
 * they are always refused.
 */
function RotaGuardPanel({ warnings, mode }: { warnings: WarningRow[]; mode: 'block' | 'warn' }) {
  if (mode === 'block' && warnings.length === 0) return null;
  return (
    <Panel
      title="Rota guard · 48-hour warnings"
      actions={
        <Pill tone={mode === 'warn' ? 'amber' : 'neutral'}>
          {mode === 'warn' ? 'warn mode' : 'block mode'} · Settings
        </Pill>
      }
    >
      {warnings.length === 0 ? (
        <p className="sm muted">
          Nobody has been rostered over 48 hours without an opt-out. Student visa limits and
          right-to-work expiry are always refused, whatever the setting.
        </p>
      ) : (
        <table className="tbl card-rows">
          <thead>
            <tr>
              <th>When</th>
              <th>Worker</th>
              <th>Shift</th>
              <th>Hours that week</th>
            </tr>
          </thead>
          <tbody>
            {warnings.map((w) => (
              <tr key={w.id}>
                <td data-label="When" className="mono sm">
                  {ukStamp(w.at)}
                </td>
                <td className="cell-title">
                  <Link href={`/staff/${w.staff_id}`}>{w.worker}</Link>
                </td>
                <td data-label="Shift" className="sm">
                  {w.event_title ?? '—'}
                  {w.starts_at ? <span className="sub">{ukStamp(w.starts_at)} (UK)</span> : null}
                </td>
                <td data-label="Hours that week" className="mono sm">
                  {Number(w.booked_hours ?? 0) + Number(w.shift_hours ?? 0)} h of{' '}
                  {w.cap_hours ?? '—'} h
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}
