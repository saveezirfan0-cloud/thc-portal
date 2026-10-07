import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { Venue, VenueType } from '../types';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('../actions', () => ({
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  deleteVenue: vi.fn(),
  loadUpcomingEvents: vi.fn(),
  reverseGeocode: vi.fn(),
  searchPlaces: vi.fn(),
}));
vi.mock('../VenueMap', () => ({ VenueMap: () => null, markerLabel: () => '' }));

const { VenuesScreen } = await import('../VenuesScreen');

const TYPES: VenueType[] = [{ key: 'hotel', label: 'Hotel', default_radius_m: 150, sort_order: 2 }];

const venue = (over: Partial<Venue>): Venue => ({
  id: 'v1',
  name: 'Leonardo Royal Hotel',
  address: '10 Godliman St, London EC4V 5AJ',
  venue_type: 'hotel',
  venue_type_label: 'Hotel',
  default_radius_m: 150,
  geofence_radius_m: 150,
  lat: 51.5133,
  lng: -0.099,
  events_past: 2,
  events_upcoming: 0,
  created_at: '2026-10-04T23:30:00Z',
  created_by: 'u1',
  created_by_name: 'Gisela M.',
  ...over,
});

describe('/venues list — Date added and Added by (§9.11)', () => {
  const markup = renderToStaticMarkup(
    <VenuesScreen
      venueTypes={TYPES}
      venues={[
        venue({}),
        venue({ id: 'v2', name: 'Sky Garden', created_by: null, created_by_name: null }),
      ]}
    />,
  );

  it('has the two new columns before Actions', () => {
    expect(markup).toMatch(/Events<\/th><th>Date added<\/th><th>Added by<\/th><th[^>]*>Actions/);
  });

  it('prints the UK date of the stamp, not the UTC one', () => {
    // 23:30 UTC on 4 Oct is 00:30 BST on 5 Oct.
    expect(markup).toContain('5 Oct 2026');
  });

  it('names the manager, and prints an em dash where nobody was recorded', () => {
    expect(markup).toContain('>Gisela M.<');
    expect(markup).toMatch(/data-label="Added by"[^>]*><span class="muted">—<\/span>/);
  });

  it('offers the filters, with only the managers on the page', () => {
    for (const label of [
      'Filter by venue type',
      'Filter by geofence',
      'Filter by events held',
      'Filter by who added',
      'Added from (UK date)',
      'Added to (UK date)',
    ]) {
      expect(markup).toContain(`aria-label="${label}"`);
    }
    expect(markup).toContain('>Not recorded<');
  });

  it('shows no Clear button until a filter is set', () => {
    expect(markup).not.toContain('Clear filters');
  });
});
