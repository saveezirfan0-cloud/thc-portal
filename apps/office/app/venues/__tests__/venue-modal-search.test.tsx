import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { VenueType } from '../types';

vi.mock('../actions', () => ({
  createVenue: vi.fn(),
  updateVenue: vi.fn(),
  reverseGeocode: vi.fn(),
  searchPlaces: vi.fn(),
}));
vi.mock('../VenueMap', () => ({ VenueMap: () => null, markerLabel: () => '' }));
// The modal portals into document.body, which a server render does not have.
vi.mock('@thc/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Modal: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { VenueModal } = await import('../VenueModal');

const TYPES: VenueType[] = [{ key: 'hotel', label: 'Hotel', default_radius_m: 150, sort_order: 2 }];

describe('New venue modal — search by postcode or street address (§9.11, ADR-0101)', () => {
  const markup = renderToStaticMarkup(
    <VenueModal
      venue={null}
      venueTypes={TYPES}
      onClose={() => undefined}
      onSaved={() => undefined}
    />,
  );

  it('offers a postcode / street-address search above the map', () => {
    expect(markup).toContain('postcode or street address');
    expect(markup).toContain('type="search"');
    // Nothing to search for yet, so Search cannot be pressed.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Search<\/button>/);
  });

  it('keeps the address read-only: search places the pin, it does not make the address typeable', () => {
    expect(markup).toMatch(/<input[^>]*readOnly=""[^>]*placeholder="Drop the pin to fill this in"/);
  });
});
