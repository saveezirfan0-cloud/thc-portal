import { describe, expect, it } from 'vitest';
import { venueAfterClientPick, venuesOfClient } from '../venue-for-client';

const leonardo = { id: 'v-leo', clientId: 'c-leo' };
const hackneyA = { id: 'v-h1', clientId: 'c-hackney' };
const hackneyB = { id: 'v-h2', clientId: 'c-hackney' };
const unlinked = { id: 'v-free', clientId: null };
const venues = [leonardo, hackneyA, hackneyB, unlinked];

describe('venuesOfClient', () => {
  it('lists only the venues tied to the client', () => {
    expect(venuesOfClient(venues, 'c-hackney')).toEqual([hackneyA, hackneyB]);
  });
  it('lists nothing for no client or a client with no venue', () => {
    expect(venuesOfClient(venues, '')).toEqual([]);
    expect(venuesOfClient(venues, 'c-other')).toEqual([]);
  });
});

describe('venueAfterClientPick', () => {
  it('applies the address of a client with exactly one venue, unasked', () => {
    expect(venueAfterClientPick(venues, 'c-leo', '')).toBe('v-leo');
  });
  it("replaces a previous client's venue with the new client's only venue", () => {
    expect(venueAfterClientPick(venues, 'c-leo', 'v-h1')).toBe('v-leo');
  });
  it('leaves a client with several venues to choose, keeping one of its own', () => {
    expect(venueAfterClientPick(venues, 'c-hackney', '')).toBe('');
    expect(venueAfterClientPick(venues, 'c-hackney', 'v-h2')).toBe('v-h2');
  });
  it("clears another client's venue when the new client has several", () => {
    expect(venueAfterClientPick(venues, 'c-hackney', 'v-leo')).toBe('');
  });
  it("clears another client's venue when the new client has none", () => {
    expect(venueAfterClientPick(venues, 'c-other', 'v-leo')).toBe('');
  });
  it('keeps an unlinked venue when the client has none of its own', () => {
    expect(venueAfterClientPick(venues, 'c-other', 'v-free')).toBe('v-free');
    expect(venueAfterClientPick(venues, 'c-other', '')).toBe('');
  });
});
