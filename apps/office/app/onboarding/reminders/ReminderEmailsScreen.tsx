'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  Alert,
  Button,
  KpiTile,
  Modal,
  Panel,
  Pill,
  SegToggle,
  TableScroll,
  TileGrid,
  useTimeFormat,
} from '@thc/ui';
import { ukStampFull } from '../../_lib/rtwCheck';
import type { ReminderPreview } from './previews';
import {
  GROUPS,
  REMINDER_EMAILS,
  TRACK_LABEL,
  countsFor,
  sentTodayTotal,
  stageTotals,
} from './reminders';
import type { OnboardingEmailReport, ReminderEmail, ReminderTrack } from './reminders';
import './reminders.css';

const TRACKS: readonly ReminderTrack[] = ['interview', 'activation', 'app'];

/**
 * /onboarding/reminders (ADR-0187): who is being chased through onboarding,
 * which reminders have gone to them, and a View of each exactly as it is sent.
 * The numbers are `onboarding_email_report()`'s; the words are the register's.
 */
export function ReminderEmailsScreen({
  report,
  previews,
  problem,
}: {
  report: OnboardingEmailReport | null;
  previews: ReminderPreview[];
  problem: string | null;
}) {
  const format = useTimeFormat();
  const [open, setOpen] = useState<string | null>(null);
  const byId = new Map(previews.map((p) => [p.id, p]));
  const email = REMINDER_EMAILS.find((e) => e.id === open) ?? null;
  const preview = open ? (byId.get(open) ?? null) : null;
  const totals = report ? stageTotals(report) : null;
  const n = (v: number) => v.toLocaleString('en-GB');

  return (
    <>
      <p className="muted sm">
        Everyone whose next move in onboarding is their own is reminded every day, between 10:00 and
        18:00 (UK time), until they move on or are rejected. Candidates waiting on the office (an
        interview to decide, documents to review) are not reminded. Sent today counts from midnight,
        UK time.
      </p>
      {problem ? <Alert tone="coral">{problem}</Alert> : null}

      {report && totals ? (
        <>
          <TileGrid columns={4}>
            <KpiTile
              flat
              small
              label="Being reminded now"
              value={totals.waiting}
              description="Candidates whose next move is their own"
            />
            <KpiTile
              flat
              small
              label="Reminded today"
              value={totals.remindedToday}
              tone={totals.remindedToday > 0 ? 'ok' : 'default'}
              description={`${n(sentTodayTotal(report))} emails and pushes sent today`}
            />
            <KpiTile
              flat
              small
              label="Stalled"
              value={totals.stalled}
              tone={totals.stalled > 0 ? 'warn' : 'default'}
              description={`${report.stalledAfter}+ reminders and no progress: phone them`}
            />
            <KpiTile
              flat
              small
              label="Last reminder not delivered"
              value={totals.lastFailed}
              tone={totals.lastFailed > 0 ? 'warn' : 'default'}
              description="A bounce, or a push they could not receive"
            />
          </TileGrid>

          <Panel title="Where they are stuck">
            <TableScroll label="Candidates being reminded" minWidth="44rem">
              <table className="tbl rem-stages">
                <thead>
                  <tr>
                    <th>Stage</th>
                    <th className="num">Being reminded</th>
                    <th className="num">Reminded today</th>
                    <th className="num">Stalled</th>
                    <th className="num">Not delivered</th>
                  </tr>
                </thead>
                <tbody>
                  {TRACKS.map((track) => {
                    const s = report.stages[track];
                    return (
                      <tr key={track}>
                        <td>
                          <b>{TRACK_LABEL[track]}</b>
                          {track === 'app' && s.waiting > 0 ? (
                            <div className="sm muted">
                              {n(s.withPush)} with notifications on · {n(s.waiting - s.withPush)}{' '}
                              without
                            </div>
                          ) : null}
                        </td>
                        <td className="num">{n(s.waiting)}</td>
                        <td className="num">{n(s.remindedToday)}</td>
                        <td className="num">{n(s.stalled)}</td>
                        <td className="num">{n(s.lastFailed)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
            {report.steps.length > 0 ? (
              <>
                <h3 className="rem-h">In the app, by the step they are on</h3>
                <ul className="rem-steps">
                  {report.steps.map((s) => (
                    <li key={s.step}>
                      <b>{n(s.n)}</b> · {s.step}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {totals.stalled > 0 ? (
              <p className="sm">
                <Link href="/onboarding?attention=stalled">Show the stalled candidates ↗</Link>
              </p>
            ) : null}
          </Panel>
        </>
      ) : null}

      <Panel title="The reminders">
        <p className="muted sm">
          View shows each exactly as it is sent, with a sample name and step. A push has no layout,
          only its words. An Off pill means it is switched off in{' '}
          <Link href="/settings">Settings → Notifications</Link>.
        </p>
        {report && report.besidePush.sentTotal + report.besidePush.failedTotal > 0 ? (
          <p className="sm">
            Of the app emails, {n(report.besidePush.sentTotal)} went to a candidate who also gets
            the push ({n(report.besidePush.sentToday)} today); the rest went to candidates with
            notifications off, who would otherwise hear nothing.
          </p>
        ) : null}
        <TableScroll label="The reminders" minWidth="56rem">
          <table className="tbl rem-emails">
            <thead>
              <tr>
                <th>Reminder</th>
                <th>Who gets it, and when</th>
                <th className="num">Sent today</th>
                <th className="num">Sent in all</th>
                <th className="num">People</th>
                <th className="num">Not delivered</th>
                <th className="num">Waiting</th>
                <th aria-label="View" className="cell-actions" />
              </tr>
            </thead>
            {GROUPS.map((group) => (
              <tbody key={group.key}>
                <tr className="rem-group">
                  <th colSpan={8} scope="colgroup">
                    {group.title} <span className="muted sm">· {group.note}</span>
                  </th>
                </tr>
                {REMINDER_EMAILS.filter((e) => e.group === group.key).map((e) => (
                  <Row
                    key={e.id}
                    e={e}
                    report={report}
                    subject={byId.get(e.id)?.subject}
                    onView={() => setOpen(e.id)}
                    stamp={(iso) => ukStampFull(iso, format)}
                  />
                ))}
              </tbody>
            ))}
          </table>
        </TableScroll>
      </Panel>
      <PreviewDialog email={email} preview={preview} onClose={() => setOpen(null)} />
    </>
  );
}

function Row({
  e,
  report,
  subject,
  onView,
  stamp,
}: {
  e: ReminderEmail;
  report: OnboardingEmailReport | null;
  subject: string | undefined;
  onView: () => void;
  stamp: (iso: string) => string;
}) {
  const c = countsFor(report, e.id);
  const on = report ? report.switches[e.template] : true;
  const cell = (v: number) => (report ? v.toLocaleString('en-GB') : '—');
  return (
    <tr>
      <td>
        <b>{e.name}</b> {e.channel === 'push' ? <Pill tone="purple">Push</Pill> : null}
        {!on ? <Pill tone="amber">Off</Pill> : null}
        <div className="sm muted">{subject}</div>
      </td>
      <td className="sm">
        {e.to}.<div className="muted">{e.when}.</div>
      </td>
      <td className="num">{cell(c.sentToday)}</td>
      <td className="num">
        {cell(c.sentTotal)}
        {c.lastSentAt ? <div className="sm muted">last {stamp(c.lastSentAt)}</div> : null}
      </td>
      <td className="num">{cell(c.people)}</td>
      <td className="num">{cell(c.failedTotal)}</td>
      <td className="num">
        {cell(c.queued)}
        {c.queued > 0 && c.nextAt ? <div className="sm muted">from {stamp(c.nextAt)}</div> : null}
      </td>
      <td className="cell-actions">
        <Button
          size="sm"
          tone="outline"
          disabled={!subject}
          onClick={onView}
          aria-label={`View the reminder: ${e.name}`}
        >
          View
        </Button>
      </td>
    </tr>
  );
}

/** One reminder, as the candidate sees it: the HTML in a sandboxed frame, or the plain text. */
function PreviewDialog({
  email,
  preview,
  onClose,
}: {
  email: ReminderEmail | null;
  preview: ReminderPreview | null;
  onClose: () => void;
}) {
  const [view, setView] = useState<'html' | 'text'>('html');
  return (
    <Modal
      open={email !== null && preview !== null}
      title={email?.name ?? ''}
      onClose={onClose}
      wide
      footer={
        <Button tone="primary" onClick={onClose}>
          Close
        </Button>
      }
    >
      {email && preview ? (
        <>
          <dl className="rem-meta sm">
            <dt>{email.channel === 'push' ? 'Title' : 'Subject'}</dt>
            <dd>
              <b>{preview.subject}</b>
            </dd>
            <dt>To</dt>
            <dd>{email.to}</dd>
            <dt>When</dt>
            <dd>{email.when}</dd>
          </dl>
          {preview.html ? (
            <>
              <div className="rem-view">
                <SegToggle
                  small
                  aria-label="Show the email as"
                  value={view}
                  onChange={setView}
                  options={[
                    { value: 'html', label: 'As sent' },
                    { value: 'text', label: 'Plain text' },
                  ]}
                />
              </div>
              {view === 'html' ? (
                // No scripts, no same-origin: the email can do nothing to the page.
                <iframe
                  className="rem-frame"
                  title={`The email: ${preview.subject}`}
                  sandbox="allow-popups allow-popups-to-escape-sandbox"
                  srcDoc={preview.html}
                />
              ) : (
                <pre className="rem-text">{preview.text}</pre>
              )}
            </>
          ) : (
            <pre className="rem-text">{preview.text}</pre>
          )}
        </>
      ) : null}
    </Modal>
  );
}
