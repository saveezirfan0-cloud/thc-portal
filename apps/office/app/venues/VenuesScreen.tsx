'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, EmptyState, Note, Panel, Tabs } from '@thc/ui';
import { VenueMap, markerLabel } from './VenueMap';
import { VenueModal } from './VenueModal';
import { DeleteVenueModal } from './DeleteVenueModal';
import { formatCoordinates } from './geo';
import type { Venue, VenueType } from './types';
import './venues.css';

type Tab = 'list' | 'map';

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
  const [tab, setTab] = useState<Tab>('list');
  const [query, setQuery] = useState('');
  /** `null` = closed, `'new'` = create, a venue = edit it. */
  const [editing, setEditing] = useState<Venue | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Venue | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return venues;
    return venues.filter(
      (venue) =>
        venue.name.toLowerCase().includes(needle) || venue.address.toLowerCase().includes(needle),
    );
  }, [venues, query]);

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

  const saved = () => {
    close();
    router.refresh();
  };

  return (
    <>
      {/* §9.11: this row sits directly under the page title. */}
      <div className="toolbar">
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
          onChange={setTab}
          aria-label="Venue view"
        />
        <div className="right">
          <div className="search">
            <input
              className="input"
              style={{ height: 32, width: 280 }}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by name and address"
              aria-label="Search by name and address"
            />
          </div>
        </div>
      </div>

      {tab === 'list' ? (
        <>
          <Panel flush>
            <div className="panel-b tight">
              {filtered.length === 0 ? (
                <EmptyState>
                  <h3>{venues.length === 0 ? 'No venues yet' : 'No venue matches that search'}</h3>
                  <p>
                    {venues.length === 0
                      ? 'Add the first venue — its geofence radius is what decides whether a worker can check in at all.'
                      : 'Search runs over the venue name and its address.'}
                  </p>
                </EmptyState>
              ) : (
                <table className="tbl card-rows">
                  <thead>
                    <tr>
                      <th>Venue</th>
                      <th>Address</th>
                      <th>Type</th>
                      <th className="num">Geofence (m)</th>
                      <th className="num">Events</th>
                      <th className="actions">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((venue) => (
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
              )}
            </div>
          </Panel>
          <Note>
            <b>Events</b> is how many events have taken place at this venue. The geofence radius
            (100–3000 m) is what the check-in button checks against and what background tracking
            watches for exits. Editing opens the same modal titled with the venue&rsquo;s name,
            pre-filled with its pin, address and radius.
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
          onSaved={saved}
        />
      ) : null}

      {deleting ? (
        <DeleteVenueModal key={deleting.id} venue={deleting} onClose={close} onDeleted={saved} />
      ) : null}
    </>
  );
}
