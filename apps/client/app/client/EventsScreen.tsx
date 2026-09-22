'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Avatar,
  AvatarGroup,
  Button,
  Panel,
  Pill,
  Progress,
  SearchInput,
  SegToggle,
} from '@thc/ui';
import { EventWindow } from './EventWindow';
import { ukDateShort } from './format';
import { byDateDescending, documentFor, fillOf, filterByTab, statusTone } from './rules';
import type { LineupRow, PortalEvent, RoleSection, Tab } from './rules';

/**
 * §11.1 · the customer's event list.
 *
 * Columns, in the order the scope names them: name · venue · date/time ·
 * "N of M confirmed" · photos of the confirmed workers · a button to
 * download the document · a link into the details.
 *
 * There is no money column, and there is nothing to add one from: the rows
 * come from `client_events_v` and `client_role_sections_v`, neither of
 * which carries a rate (§11.1).
 *
 * A client component because the tabs, the search box and the viewer's own
 * time zone are all browser facts. The rows themselves were fetched on the
 * server, under the caller's session.
 */
const FACES_SHOWN = 6;

const STATUS_LABEL: Record<PortalEvent['status'], string> = {
  upcoming: 'Upcoming',
  ongoing: 'Ongoing',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DOC_LABEL = { allocation: '↓ Allocation sheet', signout: '↓ Signed timesheet' } as const;

export function EventsScreen({
  events,
  sections,
  lineup,
  photos,
  now,
}: {
  events: PortalEvent[];
  sections: RoleSection[];
  lineup: LineupRow[];
  photos: Record<string, string>;
  /** Fixed on the server so the first paint cannot disagree with hydration. */
  now: string;
}) {
  const [tab, setTab] = useState<Tab>('upcoming');
  const [query, setQuery] = useState('');

  const at = useMemo(() => new Date(now), [now]);

  const counts = useMemo(
    () => ({
      upcoming: filterByTab(events, 'upcoming', at).length,
      past: filterByTab(events, 'past', at).length,
    }),
    [events, at],
  );

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = filterByTab(events, tab, at).filter(
      (e) =>
        needle === '' ||
        e.title.toLowerCase().includes(needle) ||
        e.venueName.toLowerCase().includes(needle) ||
        (e.poNumber ?? '').toLowerCase().includes(needle),
    );
    return byDateDescending(filtered);
  }, [events, tab, at, query]);

  const sectionsFor = (id: string) => sections.filter((s) => s.eventId === id);
  const facesFor = (id: string) =>
    lineup.filter((l) => l.eventId === id).sort((a, b) => a.sortKey.localeCompare(b.sortKey));

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Your events</h1>
          <div className="desc">Confirmed line-ups and timesheets · read-only</div>
        </div>
        <div className="actions">
          <SegToggle
            value={tab}
            onChange={(v) => setTab(v as Tab)}
            options={[
              { value: 'upcoming', label: 'Upcoming & ongoing', count: counts.upcoming },
              { value: 'past', label: 'Past', count: counts.past },
              { value: 'all', label: 'All' },
            ]}
          />
          <SearchInput
            placeholder="Search events"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            style={{ width: 220 }}
          />
        </div>
      </div>

      <Panel
        title="Events"
        actions={<Pill>{rows.length === 1 ? '1 event' : `${rows.length} events`}</Pill>}
        flush
      >
        {rows.length === 0 ? (
          <p className="muted" style={{ padding: '18px 20px' }}>
            No events to show here yet.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Event</th>
                    <th>Venue</th>
                    <th>Date &amp; time</th>
                    <th>Status</th>
                    <th>Confirmed</th>
                    <th>Line-up</th>
                    <th>Document</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((e) => {
                    const fill = fillOf(sectionsFor(e.id));
                    const faces = facesFor(e.id);
                    const doc = documentFor(e.status);
                    const cancelled = e.status === 'cancelled';

                    return (
                      <tr key={e.id} className={cancelled ? 'cancelled' : undefined}>
                        <td>
                          <b>{cancelled ? <s>{e.title}</s> : e.title}</b>
                          <span className="sub">{e.poNumber ? `PO ${e.poNumber}` : 'PO —'}</span>
                        </td>
                        <td>
                          {e.venueName}
                          <span className="sub">{e.venueAddress}</span>
                        </td>
                        <td className="win">
                          <b>{ukDateShort(e.startsAt)}</b>
                          <EventWindow startsAt={e.startsAt} endsAt={e.endsAt} className="sub" />
                        </td>
                        <td>
                          <Pill tone={statusTone(e.status)} dot={e.status === 'ongoing'}>
                            {STATUS_LABEL[e.status]}
                          </Pill>
                        </td>
                        <td>
                          {cancelled ? (
                            <span className="muted sm">—</span>
                          ) : (
                            <div className="fill-cell">
                              <span>
                                <b>{fill.confirmed}</b> of {fill.headcount} confirmed
                              </span>
                              <Progress value={fill.percent} tone={fill.tone} />
                            </div>
                          )}
                        </td>
                        <td>
                          {cancelled ? (
                            <span className="muted sm">—</span>
                          ) : (
                            <Faces people={faces} photos={photos} />
                          )}
                        </td>
                        <td>
                          <div className="stack tight">
                            {doc ? (
                              <Button
                                size="sm"
                                disabled
                                title="The timesheet documents arrive with §11.3"
                              >
                                {DOC_LABEL[doc]}
                              </Button>
                            ) : (
                              <span className="muted sm">No document</span>
                            )}
                            <Link className="sm" href={`/client/events/${e.id}`}>
                              Details →
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Same rows, no table. The phone drops no field (§1.2). */}
            <div className="cards" style={{ padding: 14 }}>
              {rows.map((e) => {
                const fill = fillOf(sectionsFor(e.id));
                const doc = documentFor(e.status);
                const cancelled = e.status === 'cancelled';

                return (
                  <div key={e.id} className={cancelled ? 'ecard cancelled' : 'ecard'}>
                    <div className="row">
                      <Pill tone={statusTone(e.status)} dot={e.status === 'ongoing'}>
                        {STATUS_LABEL[e.status]}
                      </Pill>
                      <span className="ml-auto win">
                        {ukDateShort(e.startsAt)} ·{' '}
                        <EventWindow startsAt={e.startsAt} endsAt={e.endsAt} />
                      </span>
                    </div>
                    <div className="t">{e.title}</div>
                    <div className="m">
                      {e.venueName}, {e.venueAddress}
                      {e.poNumber ? ` · PO ${e.poNumber}` : ''}
                    </div>
                    {cancelled ? null : (
                      <div className="row">
                        <Faces people={facesFor(e.id)} photos={photos} />
                        <span className="sm" style={{ marginLeft: 14 }}>
                          <b>{fill.confirmed}</b> of {fill.headcount} confirmed
                        </span>
                      </div>
                    )}
                    <div className="row">
                      {doc ? (
                        <Button
                          size="sm"
                          disabled
                          title="The timesheet documents arrive with §11.3"
                        >
                          {DOC_LABEL[doc]}
                        </Button>
                      ) : (
                        <span className="sm muted">No document</span>
                      )}
                      <Link className="ml-auto sm" href={`/client/events/${e.id}`}>
                        Details →
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Panel>
    </>
  );
}

/**
 * The faces on a row (§11.1): "photos of the confirmed workers (not
 * initials — so the customer recognises the people by face)". Initials are
 * the fallback when a worker has no selfie yet; a removed worker keeps
 * their slot with no photo at all, so the headcount is not skewed (§1.7).
 */
function Faces({ people, photos }: { people: LineupRow[]; photos: Record<string, string> }) {
  const shown = people.slice(0, FACES_SHOWN);
  const extra = people.length - shown.length;

  return (
    <AvatarGroup>
      {shown.map((p) => (
        <Avatar
          key={p.bookingId}
          name={p.name}
          size="sm"
          src={p.photoPath ? photos[p.photoPath] : undefined}
          deleted={p.name.startsWith('Deleted account')}
        />
      ))}
      {extra > 0 ? (
        <span className="more" title={`${extra} more confirmed`}>
          +{extra}
        </span>
      ) : null}
    </AvatarGroup>
  );
}
