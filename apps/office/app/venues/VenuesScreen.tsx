'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, Note, Panel, Select, TableScroll, Tabs, toast } from '@thc/ui';
import { AddedFilters } from '../_components/AddedFilters';
import { Pager } from '../_components/Pager';
import {
  addedFilterActive,
  formatDateAdded,
  matchesAdded,
  type AddedFilter,
} from '../_lib/addedBy';
import { oneOf, pageIndex, pageParam, sizeOf, useListQuery } from '../_lib/listQuery';
import { VenueMap, markerLabel } from './VenueMap';
import { VenueModal } from './VenueModal';
import { DeleteVenueModal } from './DeleteVenueModal';
import { formatCoordinates } from './geo';
import type { Venue, VenueType } from './types';
import './venues.css';

type Tab = 'list' | 'map';
type RadiusFilter = 'all' | 'standard' | 'custom';
type EventsFilter = 'all' | 'with' | 'none';
type Sort = 'name' | 'newest' | 'oldest' | 'events';

/** The pager's sizes, as on /clients (ADR-0124): 68 venues were one 22,000px page on a phone. */
export const PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

const TABS: readonly Tab[] = ['list', 'map'];
const RADII: readonly RadiusFilter[] = ['all', 'standard', 'custom'];
const EVENTS: readonly EventsFilter[] = ['all', 'with', 'none'];
const SORTS: readonly Sort[] = ['name', 'newest', 'oldest', 'events'];

/** The tab, search, filters, sort and page live in the URL (release audit L1). */
const QUERY = {
  tab: 'list',
  q: '',
  type: '',
  radius: 'all',
  events: 'all',
  by: '',
  from: '',
  to: '',
  sort: 'name',
  page: '1',
  size: String(DEFAULT_PAGE_SIZE),
} as const satisfies Record<string, string>;

export interface VenuesScreenProps {
  venues: Venue[];
  venueTypes: VenueType[];
}

/**
 * /venues — the directory of venues (§9.11).
 *
 * The toolbar sits directly under the page title, not in the page's
 * top-right corner: "+ New venue" and the List / On map tabs together on
 * the left, search by name and address on the right. The scope is explicit
 * about that, and it is the one thing about this screen that is easy to
 * get wrong.
 */
export function VenuesScreen({ venues, venueTypes }: VenuesScreenProps) {
  const router = useRouter();
  const [url, setUrl] = useListQuery(QUERY);
  const tab = oneOf(url.tab, TABS, 'list');
  const query = url.q;
  const typeFilter = url.type;
  const radiusFilter = oneOf(url.radius, RADII, 'all');
  const eventsFilter = oneOf(url.events, EVENTS, 'all');
  const added: AddedFilter = useMemo(
    () => ({ by: url.by, from: url.from, to: url.to }),
    [url.by, url.from, url.to],
  );
  const sort = oneOf(url.sort, SORTS, 'name');
  const pageSize = sizeOf(url.size, PAGE_SIZES, DEFAULT_PAGE_SIZE);
  // Any change to the search, a filter or the sort goes back to page 1:
  // the page belongs to the list it was turned on.
  const filterBy = (patch: Partial<Record<keyof typeof QUERY, string>>, replace = false) =>
    setUrl({ ...patch, page: '1' }, replace ? 'replace' : 'push');
  /** `null` = closed, `'new'` = create, a venue = edit it. */
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Venue | null>(null);

  const filtersActive =
    typeFilter !== '' ||
    radiusFilter !== 'all' ||
    eventsFilter !== 'all' ||
    addedFilterActive(added);
  const narrowed = query.trim() !== '' || filtersActive;

  const clearFilters = () =>
    filterBy({ type: '', radius: 'all', events: 'all', by: '', from: '', to: '' });

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matched = venues.filter((venue) => {
      if (
        needle &&
        !venue.name.toLowerCase().includes(needle) &&
        !venue.address.toLowerCase().includes(needle)
      ) {
        return false;
      }
      if (typeFilter && venue.venue_type !== typeFilter) return false;
      // "Custom" is the radius the list already flags with "default 150":
      // a venue whose geofence differs from its type's standard.
      const isStandard = venue.geofence_radius_m === venue.default_radius_m;
      if (radiusFilter === 'standard' && !isStandard) return false;
      if (radiusFilter === 'custom' && isStandard) return false;
      if (eventsFilter === 'with' && venue.events_past === 0) return false;
      if (eventsFilter === 'none' && venue.events_past > 0) return false;
      return matchesAdded(venue, added);
    });

    const sorted = [...matched];
    if (sort === 'newest') sorted.sort((a, b) => b.created_at.localeCompare(a.created_at));
    else if (sort === 'oldest') sorted.sort((a, b) => a.created_at.localeCompare(b.created_at));
    else if (sort === 'events') sorted.sort((a, b) => b.events_past - a.events_past);
    else sorted.sort((a, b) => a.name.localeCompare(b.name));
    return sorted;
  }, [venues, query, typeFilter, radiusFilter, eventsFilter, added, sort]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const current = Math.min(pageIndex(url.page), pages - 1);
  const shown = filtered.slice(current * pageSize, current * pageSize + pageSize);

  // The map draws `filtered`, not `venues`. §9.11's "every venue at once"
  // is what an untouched screen shows, because the search starts empty; the
  // search box sits in the same toolbar row as both tabs, so once a manager
  // has typed in it, it would be odd for one tab to ignore them.
  const markers = useMemo(
    () =>
      filtered.map((venue) => ({
        id: venue.id,
        lat: venue.lat,
        lng: venue.lng,
        radiusM: venue.geofence_radius_m,
        label: markerLabel(venue.name, venue.geofence_radius_m),
      })),
    [filtered],
  );

  const close = () => {
    setEditing(null);
    setDeleting(null);
  };

  // ADR-0137 §1 (release audit L10): a list edit says that it worked.
  const saved = (message: string) => () => {
    close();
    router.refresh();
    toast(message, { tone: 'green' });
  };

  return (
    <>
      {/* §9.11: this row sits directly under the page title. */}
      <div className="toolbar filters">
        <Button
          tone="primary"
          size="sm"
          // The radius defaults come from `venue_types` (§9.11). With none
          // loaded the modal has nothing to pre-fill from, so there is
          // nothing useful to open.
          disabled={venueTypes.length === 0}
          onClick={() => setEditing('new')}
        >
          + New venue
        </Button>
        <Tabs
          options={[
            { value: 'list', label: 'List' },
            { value: 'map', label: 'On map' },
          ]}
          value={tab}
          onChange={(next) => setUrl({ tab: next })}
          aria-label="Venue view"
        />
        <div className="right">
          <div className="search">
            <input
              className="input"
              style={{ width: 280 }}
              type="search"
              value={query}
              onChange={(event) => filterBy({ q: event.target.value }, true)}
              placeholder="Search by name and address"
              aria-label="Search by name and address"
            />
          </div>
        </div>
      </div>

      {/* Filters apply to both tabs: the map draws exactly what the list shows. */}
      <div className="toolbar filters" role="group" aria-label="Venue filters">
        <Select
          value={typeFilter}
          onChange={(event) => filterBy({ type: event.target.value })}
          aria-label="Filter by venue type"
          style={{ width: 190 }}
        >
          <option value="">Type: all</option>
          {venueTypes.map((type) => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </Select>
        <Select
          value={radiusFilter}
          onChange={(event) => filterBy({ radius: event.target.value })}
          aria-label="Filter by geofence"
          style={{ width: 170 }}
        >
          <option value="all">Geofence: all</option>
          <option value="standard">Standard radius</option>
          <option value="custom">Custom radius</option>
        </Select>
        <Select
          value={eventsFilter}
          onChange={(event) => filterBy({ events: event.target.value })}
          aria-label="Filter by events held"
          style={{ width: 170 }}
        >
          <option value="all">Events: any</option>
          <option value="with">Has held events</option>
          <option value="none">No events yet</option>
        </Select>
        <AddedFilters
          rows={venues}
          value={added}
          onChange={(next) => filterBy({ by: next.by, from: next.from, to: next.to })}
        />
        <div className="right">
          <Select
            value={sort}
            onChange={(event) => filterBy({ sort: event.target.value })}
            aria-label="Sort venues"
            style={{ width: 190 }}
          >
            <option value="name">Sort: name A–Z</option>
            <option value="newest">Sort: newest added</option>
            <option value="oldest">Sort: oldest added</option>
            <option value="events">Sort: most events</option>
          </Select>
          {filtersActive ? (
            <Button size="sm" tone="ghost" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      </div>

      {tab === 'list' ? (
        <>
          <Panel flush>
            <div className="panel-b tight">
              {filtered.length === 0 ? (
                <EmptyState>
                  <h3>
                    {venues.length === 0
                      ? 'No venues yet'
                      : filtersActive
                        ? 'No venue matches those filters'
                        : 'No venue matches that search'}
                  </h3>
                  <p>
                    {venues.length === 0
                      ? 'Add the first venue — its geofence radius is what decides whether a worker can check in at all.'
                      : filtersActive
                        ? 'Loosen a filter, or clear them to see every venue.'
                        : 'Search runs over the venue name and its address.'}
                  </p>
                </EmptyState>
              ) : (
                <TableScroll label="Venues" fixed minWidth="58rem">
                  <table className="tbl card-rows">
                    <thead>
                      <tr>
                        <th>Venue</th>
                        <th>Address</th>
                        <th className="col-m">Type</th>
                        <th className="num col-s">Geofence (m)</th>
                        <th className="num col-xs">Events</th>
                        <th className="col-s">Date added</th>
                        <th className="col-s">Added by</th>
                        <th className="actions cell-actions col-m">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((venue) => (
                        <tr key={venue.id}>
                          <td className="name cell-title">
                            <button
                              type="button"
                              className="venue-name"
                              onClick={() => setEditing(venue)}
                            >
                              {venue.name}
                            </button>
                            <span className="sub mono">{formatCoordinates(venue)}</span>
                          </td>
                          <td data-label="Address">{venue.address}</td>
                          <td data-label="Type" className="vt">
                            {venue.venue_type_label}
                          </td>
                          <td data-label="Geofence (m)" className="num">
                            {venue.geofence_radius_m}
                            {venue.geofence_radius_m !== venue.default_radius_m ? (
                              <span className="radius-note">default {venue.default_radius_m}</span>
                            ) : null}
                          </td>
                          <td data-label="Events" className="num">
                            {venue.events_past}
                          </td>
                          <td data-label="Date added" className="sm">
                            {/* An audit stamp: UK date only, never the viewer's zone (§1.8). */}
                            <time dateTime={venue.created_at}>
                              {formatDateAdded(venue.created_at)}
                            </time>
                          </td>
                          <td data-label="Added by" className="sm">
                            {venue.created_by_name ?? <span className="muted">—</span>}
                          </td>
                          <td className="actions cell-actions">
                            <Button size="sm" onClick={() => setEditing(venue)}>
                              Edit
                            </Button>
                            <Button size="sm" tone="danger" onClick={() => setDeleting(venue)}>
                              Delete
                            </Button>
                          </td>
                        </tr>
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
                onPageSize={(size) => filterBy({ size: String(size) })}
              />
            ) : null}
          </Panel>
          {narrowed && venues.length > 0 ? (
            <p className="muted sm" role="status">
              Showing {filtered.length} of {venues.length}{' '}
              {venues.length === 1 ? 'venue' : 'venues'}
            </p>
          ) : null}
          <Note>
            <b>Events</b> is how many events have taken place at this venue. The geofence radius
            (100–3000 m) is what the check-in button checks against and what background tracking
            watches for exits. <b>Date added</b> is a UK date; <b>Added by</b> reads &ldquo;—&rdquo;
            for venues that were there before it was recorded. Editing opens the same modal titled
            with the venue&rsquo;s name, pre-filled with its pin, address and radius.
          </Note>
        </>
      ) : (
        <>
          <VenueMap
            markers={markers}
            variant="tab"
            onSelectMarker={(id) => {
              const venue = venues.find((candidate) => candidate.id === id);
              if (venue) setEditing(venue);
            }}
            refitKey={`map:${filtered.map((venue) => venue.id).join(',')}`}
            ariaLabel="Every venue's geofence circle, to scale"
            legend
          />
          <Note>
            Every venue&rsquo;s geofence circle at once on a single full-width map — where they are
            and how big they are relative to each other. Clicking a pin opens its Edit modal.
          </Note>
        </>
      )}

      {editing !== null ? (
        <VenueModal
          // Keyed on the venue, so switching which one is open remounts the
          // form rather than leaving the previous venue's pin in state.
          key={editing === 'new' ? 'new' : editing.id}
          venue={editing === 'new' ? null : editing}
          venueTypes={venueTypes}
          onClose={close}
          onSaved={saved(editing === 'new' ? 'Venue created' : 'Venue saved')}
        />
      ) : null}

      {deleting ? (
        <DeleteVenueModal
          key={deleting.id}
          venue={deleting}
          onClose={close}
          onDeleted={saved('Venue deleted')}
        />
      ) : null}
    </>
  );
}
