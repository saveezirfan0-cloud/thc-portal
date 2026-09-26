'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { UK_ZONE, formatDateTimeIn } from '@thc/domain';
import { Alert, Avatar, EmptyState, Panel, Pill, SearchInput, Select } from '@thc/ui';
import { OfficeShell } from '../_components/OfficeShell';
import { actionLabel, entityHref, entityLabel } from '../_lib/accounts';
import type { ActivityFilters, ActivityPageData } from './data';
import { EXPORT_CAP, PERIODS, actorName, describe, exportHref } from './view-model';
import '../account/account.css';
import './activity.css';

/**
 * /activity — Activity log (ADR-0055, §1.7).
 *
 * Newest first, fifty at a time. Every stamp is an audit stamp, so UK
 * only (§1.8). An entry names who did it ("System" for a job or a
 * webhook), what they did, and links to what it was done to where the
 * Back Office has a page for it.
 */
export function ActivityScreen({
  data,
  filters,
}: {
  data: ActivityPageData;
  filters: ActivityFilters;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(filters.query ?? '');

  const go = (
    patch: Partial<Record<'entity' | 'actor' | 'q' | 'period' | 'before', string | null>>,
  ) => {
    const next = new URLSearchParams();
    const merged = {
      entity: filters.entity,
      actor: filters.actor,
      q: filters.query,
      period: filters.period === '30d' ? null : filters.period,
      before: null as string | null,
      ...patch,
    };
    for (const [key, value] of Object.entries(merged)) if (value) next.set(key, value);
    const search = next.toString();
    router.push(search ? `${pathname}?${search}` : pathname);
  };

  const filtered = Boolean(filters.entity || filters.actor || filters.query || filters.before);

  return (
    <OfficeShell
      activeHref="/activity"
      title="Activity log"
      crumbs={<>Who did what, and when · every change the platform records</>}
      actions={
        // A download, not a navigation: a plain link to the route, carrying
        // the filters on screen (not the page — the file starts at the newest).
        <a
          className="btn sm"
          href={exportHref(filters)}
          download
          title={`These filters as a CSV file, newest first, up to ${EXPORT_CAP.toLocaleString('en-GB')} entries. Times are UK time.`}
        >
          Export CSV
        </a>
      }
    >
      {data.problem ? <Alert tone="coral">{data.problem}</Alert> : null}

      <div className="toolbar activity-filters">
        <form
          className="search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            go({ q: query.trim() || null });
          }}
        >
          <SearchInput
            aria-label="Search the activity log"
            placeholder="Search action, person or record — press Enter"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </form>
        <Select
          aria-label="Area"
          value={filters.entity ?? ''}
          onChange={(event) => go({ entity: event.target.value || null })}
        >
          <option value="">Every area</option>
          {data.entities.map((entry) => (
            <option key={entry.entity} value={entry.entity}>
              {entityLabel(entry.entity)} ({entry.n})
            </option>
          ))}
        </Select>
        <Select
          aria-label="Person"
          value={filters.actor ?? ''}
          onChange={(event) => go({ actor: event.target.value || null })}
        >
          <option value="">Everyone</option>
          {data.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.name} ({actor.n})
            </option>
          ))}
        </Select>
        <Select
          aria-label="Period"
          value={filters.period}
          onChange={(event) => go({ period: event.target.value })}
        >
          {PERIODS.map((period) => (
            <option key={period.value} value={period.value}>
              {period.label}
            </option>
          ))}
        </Select>
      </div>

      <Panel flush>
        {data.rows.length === 0 ? (
          <EmptyState>
            {filtered
              ? 'Nothing matches these filters.'
              : 'Nothing has been recorded in this period.'}
          </EmptyState>
        ) : (
          <div className="table-scroll">
            <table className="tbl card-rows activity-table">
              <thead>
                <tr>
                  <th>When (UK time)</th>
                  <th>Who</th>
                  <th>What</th>
                  <th>Record</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => {
                  const who = actorName(row);
                  const href = entityHref(row.entity, row.entity_id);
                  const details = describe(row);
                  return (
                    <tr key={row.id}>
                      <td data-label="When" className="mono sm activity-when">
                        {formatDateTimeIn(new Date(row.at), UK_ZONE)}
                      </td>
                      <td data-label="Who" className="activity-who">
                        {row.actor ? (
                          <button
                            type="button"
                            className="linkish"
                            title={`Only ${who}`}
                            onClick={() => go({ actor: row.actor })}
                          >
                            <Avatar name={who} size="sm" />
                            <span>{who}</span>
                          </button>
                        ) : (
                          <Pill>System</Pill>
                        )}
                      </td>
                      <td className="cell-title">
                        <b>{actionLabel(row.action)}</b>
                        <span className="sub">{entityLabel(row.entity)}</span>
                      </td>
                      <td data-label="Record">
                        {href && row.entity_label ? (
                          <Link href={href}>{row.entity_label}</Link>
                        ) : (
                          (row.entity_label ?? <span className="muted">—</span>)
                        )}
                      </td>
                      <td data-label="Details" className="sm muted activity-details">
                        {details.length ? details.join(' · ') : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="activity-pager">
          {filters.before ? (
            <button type="button" className="btn sm" onClick={() => go({ before: null })}>
              ← Newest
            </button>
          ) : null}
          {data.nextBefore ? (
            <button
              type="button"
              className="btn sm ml-auto"
              onClick={() => go({ before: String(data.nextBefore) })}
            >
              Older →
            </button>
          ) : null}
        </div>
      </Panel>
    </OfficeShell>
  );
}
