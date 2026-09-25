'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Avatar, Button, Checkbox, Panel, Pill, SegToggle, Select } from '@thc/ui';
import { displayTimeRange } from '@thc/domain';
import { createClient } from '@thc/db/browser';
import { MonitorTable } from './MonitorTable';
import { ResolveModal } from './ResolveModal';
import { VIOLATION_LABEL, logTime, missingWorkers, needsAttention } from './status';
import { useViewerZone } from './useViewerZone';
import type { MonitorRow, ViolationRow } from './types';

/**
 * /checkin — the §9.5 live monitor.
 *
 * "Live" has two mechanisms, because either alone is wrong here. Realtime
 * on the four tables the board is made of catches a check-in the moment it
 * happens; a 30-second refresh catches the states that arrive by the clock
 * rather than by a write — Due becoming the 30-minute red alert, and a
 * shift crossing end+4h into No check-out. Nothing writes a row at those
 * moments, so a purely event-driven board would sit there looking calm.
 */
export function MonitorScreen({
  rows,
  violations,
}: {
  rows: MonitorRow[];
  violations: ViolationRow[];
}) {
  const router = useRouter();
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [eventFilter, setEventFilter] = useState('all');
  const [showResolved, setShowResolved] = useState(false);
  const [open, setOpen] = useState<ViolationRow | null>(null);

  useEffect(() => {
    const timer = setInterval(() => router.refresh(), 30_000);
    let cleanup = () => {};
    try {
      const supabase = createClient();
      const channel = supabase.channel('checkin-monitor');
      for (const table of ['check_logs', 'bookings', 'violations', 'location_pings']) {
        channel.on('postgres_changes', { event: '*', schema: 'public', table }, () =>
          router.refresh(),
        );
      }
      channel.subscribe();
      cleanup = () => {
        void supabase.removeChannel(channel);
      };
    } catch {
      // No Supabase in this environment: the 30-second refresh still runs.
    }
    return () => {
      clearInterval(timer);
      cleanup();
    };
  }, [router]);

  const events = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) seen.set(r.eventId, r.eventTitle);
    return [...seen.entries()];
  }, [rows]);

  const visible = rows.filter(
    (r) =>
      (eventFilter === 'all' || r.eventId === eventFilter) && (!attentionOnly || needsAttention(r)),
  );
  const attentionCount = rows.filter(needsAttention).length;
  const shownViolations = violations.filter((v) => showResolved || !v.resolved);

  // Mount-guarded (§1.8): the first paint is UK on both sides, the reader's
  // zone arrives once mounted. One read, handed to every part of the board.
  const zone = useViewerZone();

  return (
    <div className="stack" style={{ gap: 16 }}>
      <EventStrip rows={rows} zone={zone} />

      <Panel
        title="Today’s events · live"
        flush
        actions={
          <div className="row" style={{ gap: 8 }}>
            <SegToggle
              value={attentionOnly ? 'attention' : 'all'}
              onChange={(v) => setAttentionOnly(v === 'attention')}
              small
              options={[
                { value: 'all', label: 'All' },
                {
                  value: 'attention',
                  label: 'Needs attention',
                  count: attentionCount,
                  alert: attentionCount > 0,
                },
              ]}
            />
            <Select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)}>
              <option value="all">All events today</option>
              {events.map(([id, title]) => (
                <option key={id} value={id}>
                  {title}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        <MonitorTable rows={visible} zone={zone} />
      </Panel>

      <Panel
        title="Violation log"
        flush
        actions={
          <Checkbox checked={showResolved} onChange={setShowResolved}>
            Show resolved
          </Checkbox>
        }
      >
        {shownViolations.length === 0 ? (
          <p className="muted sm">
            {violations.length === 0
              ? 'No violations logged.'
              : 'Nothing unresolved. Tick “Show resolved” to see closed entries.'}
          </p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Staff</th>
                <th>Event</th>
                <th>Violation</th>
                <th>Time</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shownViolations.map((v) => (
                /* §9.5: "The row itself is clickable, with a 'Details' button
                   alongside as the keyboard path" — and "coral highlighting"
                   (`.tbl tr.violation`) for an entry still open; a resolved
                   one is dimmed instead, as in checkin.html. */
                <tr
                  key={v.id}
                  className={v.resolved ? 'clickable' : 'violation clickable'}
                  style={v.resolved ? { opacity: 0.45 } : undefined}
                  onClick={() => setOpen(v)}
                >
                  <td>
                    <div className="person">
                      <Avatar name={v.staffName} src={v.photoUrl ?? undefined} size="sm" />
                      <div className="n">{v.staffName}</div>
                    </div>
                  </td>
                  <td>
                    {v.eventTitle}
                    <span className="sub">
                      {v.venueName} · {v.roleName}
                    </span>
                  </td>
                  <td>
                    <b>{VIOLATION_LABEL[v.type]}</b>
                    {v.resolved ? (
                      <>
                        {' '}
                        <Pill tone="green">Resolved</Pill>
                      </>
                    ) : null}
                  </td>
                  {/* An actual stamp: the reader's own zone, with the day
                      spelled unless it was today (§1.8, checkin.html). */}
                  <td className="mono sm">{logTime(v.detectedAt, zone)}</td>
                  <td style={{ textAlign: 'right' }}>
                    <Button
                      size="sm"
                      tone={v.resolved ? 'ghost' : 'default'}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpen(v);
                      }}
                    >
                      Details
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      {open ? <ResolveModal violation={open} zone={zone} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/**
 * The strip above the table. §9.5's "−1 worker" flag is the point of it:
 * the manager sees an event is short before it becomes a failure, and
 * still has time to pull someone from the buffer.
 *
 * The card's window is the EVENT window — earliest role start to latest
 * role end (CLAUDE.md) — and a scheduled time, so it carries both zones
 * like the WINDOW column (§1.8: "the same dual display applies on the
 * event card").
 */
export function EventStrip({ rows, zone }: { rows: MonitorRow[]; zone: string }) {
  const byEvent = new Map<string, MonitorRow[]>();
  for (const r of rows) byEvent.set(r.eventId, [...(byEvent.get(r.eventId) ?? []), r]);

  if (byEvent.size === 0) return null;

  return (
    <div className="evstrip">
      {[...byEvent.entries()].map(([id, group]) => {
        const first = group[0]!;
        const short = missingWorkers(group);
        const win = displayTimeRange(
          new Date(Math.min(...group.map((r) => Date.parse(r.startsAt)))),
          new Date(Math.max(...group.map((r) => Date.parse(r.endsAt)))),
          zone,
        );
        const onShift = group.filter((r) => r.status === 'on_shift').length;
        const offSite = group.filter((r) => r.status === 'off_site').length;
        const out = group.filter((r) => r.status === 'checked_out').length;
        return (
          <div key={id} className={short > 0 ? 'evcard flag' : 'evcard'}>
            <div className="t">
              {first.eventTitle}
              {short > 0 ? <span className="evflag">−{short} worker</span> : null}
            </div>
            <div className="m">
              <span className="win2">
                {win.primary}
                {win.secondary ? <span className="l2">{win.secondary}</span> : null}
              </span>
            </div>
            <div className="c">
              {onShift > 0 ? <span className="green">{onShift} on shift</span> : null}
              {offSite > 0 ? <span className="amber">{offSite} off-site</span> : null}
              {out > 0 ? <span className="green">{out} checked out</span> : null}
              {short > 0 ? <span className="coral">{short} not checked in</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
