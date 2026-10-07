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
    expect(markup).toContain('Find the venue');
    expect(markup).toContain('by postcode or street');
    expect(markup).toContain('type="search"');
    // Nothing to search for yet, so Search cannot be pressed.
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Search<\/button>/);
  });

  it('leaves the read-only Address as the only field labelled "address"', () => {
    // e2e/tests/office.venues.spec.ts finds it with getByLabel('Address'),
    // which matches by substring: a second label containing the word makes
    // that a strict-mode violation (and two "address" fields for a screen reader).
    const labels = [...markup.matchAll(/<label[^>]*>(.*?)<\/label>/g)].map((m) =>
      (m[1] ?? '').replace(/<[^>]+>/g, ''),
    );
    expect(labels.filter((text) => /address/i.test(text))).toHaveLength(1);
  });

  it('keeps the address read-only: search places the pin, it does not make the address typeable', () => {
    expect(markup).toMatch(/<input[^>]*readOnly=""[^>]*placeholder="Drop the pin to fill this in"/);
  });
});
