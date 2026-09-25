import { describe, expect, it } from 'vitest';
import {
  HISTORY_SCOPE,
  type HistoryRow,
  historyHref,
  isHistoryEntity,
  isUuid,
  mergeOlder,
  nextBefore,
} from '../model';

const row = (id: number, patch: Partial<HistoryRow> = {}): HistoryRow => ({
  id,
  at: '2026-09-25T10:00:00Z',
  actor: null,
  actor_name: null,
  action: 'booking.manual_invite',
  entity: 'booking',
  entity_id: 'b1',
  entity_label: 'Staff Alpha · Gala',
  data: null,
  ...patch,
});

describe('record history', () => {
  it('only the three record pages have a history', () => {
    expect(isHistoryEntity('staff')).toBe(true);
    expect(isHistoryEntity('event')).toBe(true);
    expect(isHistoryEntity('client')).toBe(true);
    expect(isHistoryEntity('settings')).toBe(false);
    expect(isHistoryEntity(undefined)).toBe(false);
    expect(Object.keys(HISTORY_SCOPE).sort()).toEqual(['client', 'event', 'staff']);
  });

  it('accepts a record id only in uuid form', () => {
    expect(isUuid('dddddddd-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid("x' or 1=1")).toBe(false);
  });

  it('does not link an entry back to the page it is shown on', () => {
    const subject = { entity: 'staff' as const, id: 's1' };
    expect(historyHref(row(1, { entity: 'staff', entity_id: 's1' }), subject)).toBeNull();
    // Another record with a page of its own still links.
    expect(historyHref(row(2, { entity: 'event', entity_id: 'e1' }), subject)).toBe('/events/e1');
    // A booking has no page of its own.
    expect(historyHref(row(3), subject)).toBeNull();
  });

  it('offers Older only when the page came back full', () => {
    expect(nextBefore([row(9), row(7), row(4)], 3)).toBe(4);
    expect(nextBefore([row(9), row(7)], 3)).toBeNull();
    expect(nextBefore([], 3)).toBeNull();
  });

  it('appends an older page without repeating a row already shown', () => {
    expect(mergeOlder([row(9), row(7)], [row(7), row(4)]).map((r) => r.id)).toEqual([9, 7, 4]);
  });
});
