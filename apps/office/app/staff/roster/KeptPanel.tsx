'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Button, Checkbox, Modal, Panel, Pill, TableScroll } from '@thc/ui';
import { keptRows, keptSafe, linkPlan, sheetName } from './bulk';
import type { KeptRow, LinkItem } from './bulk';
import type { RosterEntry } from './data';
import { KEPT_REASON_LABEL, keptExplanation, keptLinkable, statusLabel } from './report';
import type { RosterReportData } from './report';

const GROUP_LABEL = { spudbros: 'SpudBros Express', thc: 'THC' } as const;

/**
 * "Applied, no Payroll ID" (ADR-0145): everyone who applied with the listed
 * email but was not given their Payroll ID, the sheet's name beside the
 * name they applied with, and why. Tick the right ones — "Tick all safe"
 * takes every row Link settles with no question — and Link them in one go.
 * A name that differs is linked only once the office has seen both names in
 * the confirmation.
 */
export function KeptPanel({
  report,
  waiting,
  canEdit,
  pending,
  failures,
  onLinkMany,
}: {
  report: RosterReportData;
  waiting: RosterEntry[];
  canEdit: boolean;
  pending: boolean;
  /** Rows the last "Link ticked" could not link, with why. */
  failures: ReadonlyMap<string, string>;
  /** Resolves to the entry ids that could not be linked, which stay ticked. */
  onLinkMany: (items: LinkItem[]) => Promise<string[]>;
}) {
  const rows = keptRows(waiting, report.kept);
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set());
  const [asking, setAsking] = useState(false);
  if (rows.length === 0) return null;

  const live = new Set(rows.map((r) => r.row.id));
  const tickedNow = new Set([...ticked].filter((id) => live.has(id)));
  const plan = linkPlan(rows, tickedNow);
  const safe = rows.filter((r) => keptSafe(r.kept));
  const named = rows.filter((r) => r.kept.reason === 'name_differs');
  const stuck = rows.length - safe.length - named.length;
  const differing = rows.filter((r) => tickedNow.has(r.row.id) && r.kept.reason === 'name_differs');

  const tick = (id: string, on: boolean) => {
    const next = new Set(tickedNow);
    if (on) next.add(id);
    else next.delete(id);
    setTicked(next);
  };
  const tickAll = (some: readonly KeptRow[]) =>
    setTicked(new Set([...tickedNow, ...some.map((r) => r.row.id)]));

  const go = async () => {
    setAsking(false);
    const failed = await onLinkMany(plan);
    setTicked(new Set(failed));
  };

  return (
    <Panel
      title={`Applied, no Payroll ID (${rows.length})`}
      actions={
        canEdit ? (
          <Button
            size="sm"
            tone="primary"
            disabled={pending || plan.length === 0}
            onClick={() => setAsking(true)}
          >
            {pending ? 'Linking…' : `Link ticked (${plan.length})`}
          </Button>
        ) : null
      }
    >
      <p className="muted sm">
        These people applied with the email on the list, but their Payroll ID was not given to them.
        Most often the name they applied with is spelt differently from the sheet.{' '}
        {canEdit ? (
          <>
            Check each pair, tick the ones that are the same person, then <b>Link ticked</b>: they
            get their Payroll ID and group, come off the list, and stop getting the daily reminder.
          </>
        ) : (
          'An owner or manager can link them here.'
        )}
        {stuck > 0
          ? ` ${stuck} cannot be linked here because the Payroll ID clashes with another record: open the profile and put it right there.`
          : ''}
      </p>
      {canEdit ? (
        <div className="toolbar">
          <Button
            size="sm"
            tone="outline"
            disabled={pending || safe.length === 0}
            onClick={() => tickAll(safe)}
          >
            Tick all safe ({safe.length})
          </Button>
          <Button
            size="sm"
            tone="outline"
            disabled={pending || named.length === 0}
            onClick={() => tickAll(named)}
          >
            Tick all with a different name ({named.length})
          </Button>
          <Button
            size="sm"
            tone="ghost"
            disabled={pending || tickedNow.size === 0}
            onClick={() => setTicked(new Set())}
          >
            Clear ticks
          </Button>
        </div>
      ) : null}
      <TableScroll label="Applied, no Payroll ID" minWidth="52rem">
        <table className="tbl">
          <thead>
            <tr>
              {canEdit ? <th aria-label="Tick" className="roster-tick" /> : null}
              <th>On the sheet</th>
              <th>Applied as</th>
              <th>Payroll ID</th>
              <th>Why</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ row, kept }) => {
              const linkable = keptLinkable(kept);
              const failure = failures.get(row.id);
              return (
                <tr key={row.id}>
                  {canEdit ? (
                    <td className="roster-tick">
                      {linkable ? (
                        <Checkbox
                          checked={tickedNow.has(row.id)}
                          disabled={pending}
                          onChange={(on) => tick(row.id, on)}
                        >
                          <span className="sr-only">
                            Link {sheetName(row) || row.email} to {kept.staffName || 'who applied'}
                          </span>
                        </Checkbox>
                      ) : null}
                    </td>
                  ) : null}
                  <td>
                    <b>{sheetName(row) || '—'}</b>
                    <div className="sm muted">
                      {row.email} · {GROUP_LABEL[row.grp]}
                    </div>
                  </td>
                  <td>
                    <Link href={`/staff/${kept.staffId}`}>
                      <b>{kept.staffName || 'No name'}</b>
                    </Link>
                    <div className="sm muted">{statusLabel(kept.status)}</div>
                  </td>
                  <td className="mono">{row.payroll_id ?? '—'}</td>
                  <td className="sm">
                    <Pill tone={linkable ? 'amber' : 'coral'}>
                      {KEPT_REASON_LABEL[kept.reason]}
                    </Pill>
                    {!linkable ? (
                      <div className="muted">
                        {keptExplanation(kept, row.payroll_id)}
                        {kept.reason === 'payroll_id_taken' && kept.holderId ? (
                          <>
                            {' '}
                            <Link href={`/staff/${kept.holderId}`}>
                              Open {kept.holderName || 'the holder'}
                            </Link>
                          </>
                        ) : null}
                      </div>
                    ) : null}
                    {failure ? <div className="roster-fail">Not linked: {failure}</div> : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableScroll>

      <Modal
        open={asking}
        title={`Link ${plan.length} ${plan.length === 1 ? 'person' : 'people'}?`}
        onClose={() => setAsking(false)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setAsking(false)} autoFocus>
              Cancel
            </Button>
            <Button tone="primary" onClick={() => void go()}>
              Link {plan.length}
            </Button>
          </>
        }
      >
        <p className="sm">
          Each gets the Payroll ID and group from the sheet, comes off the invite list and stops
          getting the daily reminder.
        </p>
        {differing.length > 0 ? (
          <>
            <p className="sm">
              <b>
                {differing.length === 1
                  ? 'One has a different name from the sheet.'
                  : `${differing.length} have a different name from the sheet.`}
              </b>{' '}
              Link them only if each pair is the same person:
            </p>
            <ul className="sm roster-pairs">
              {differing.map(({ row, kept }) => (
                <li key={row.id}>
                  {sheetName(row) || 'No name'} → {kept.staffName || 'No name'}
                  {row.payroll_id ? <span className="muted"> · {row.payroll_id}</span> : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Modal>
    </Panel>
  );
}
