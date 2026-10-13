import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientDocument } from '../documents';

/**
 * GET /client/events/:id/document (§11.2 "↓ Download Allocation Timesheet",
 * §11.3). The handler owns four decisions — which kind was asked for, what
 * to answer when the caller's own event has no copy, what to answer when the
 * read or the store fails, and that every answer is uncached — and the
 * tenancy decision it does NOT own: another customer's event is simply an
 * event `client_events_v` returns nothing for (ADR-0004), so it must come out
 * identical to an id that never existed.
 */
const state = vi.hoisted(() => ({
  events: new Set<string>(),
  docs: {} as Record<string, ClientDocument[]>,
  failRead: false,
  signed: 'https://db.example/storage/v1/object/sign/timesheets/x.pdf?token=t' as string | null,
  loaded: [] as string[],
}));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('../documents', () => ({
  loadEventDocuments: async (eventId: string) => {
    state.loaded.push(eventId);
    if (state.failRead) return { visible: true, documents: [], unavailable: true };
    if (!state.events.has(eventId)) return { visible: false, documents: [], unavailable: false };
    return { visible: true, documents: state.docs[eventId] ?? [], unavailable: false };
  },
  signDocument: async () => state.signed,
}));

const { GET } = await import('../events/[id]/document/route');

const MINE = '60000000-0000-4000-8000-000000000001';
const THEIRS = '60000000-0000-4000-8000-000000000002';

const doc = (kind: ClientDocument['kind']): ClientDocument => ({
  id: `doc-${kind}`,
  kind,
  file_name: `Leonardo – Gala Dinner (${kind}).pdf`,
  storage_path: `${MINE}/${kind}.pdf`,
  issued_at: '2026-09-18T10:00:00Z',
});

function get(id: string, query = ''): Promise<Response> {
  return GET(new Request(`https://portal.thc.example/client/events/${id}/document${query}`), {
    params: Promise.resolve({ id }),
  });
}

beforeEach(() => {
  state.events = new Set([MINE]);
  state.docs = { [MINE]: [doc('allocation'), doc('signout')] };
  state.failRead = false;
  state.signed = 'https://db.example/storage/v1/object/sign/timesheets/x.pdf?token=t';
  state.loaded = [];
});

describe('GET /client/events/:id/document', () => {
  it('redirects to a short-lived signed link, uncached', async () => {
    const res = await get(MINE, '?kind=allocation');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(state.signed);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Through the views, under the caller's own session — the only read.
    expect(state.loaded).toEqual([MINE]);
  });

  it('serves each kind by name', async () => {
    expect((await get(MINE, '?kind=signout')).status).toBe(302);
    expect((await get(MINE, '?kind=allocation')).status).toBe(302);
  });

  it('sends a missing or unknown kind back to the event page (303) — never a guess at the allocation sheet', async () => {
    for (const query of ['', '?kind=', '?kind=payslip', '?kind=SIGNOUT']) {
      const res = await get(MINE, query);
      expect(res.status, query).toBe(303);
      expect(res.headers.get('location'), query).toBe(
        `https://portal.thc.example/client/events/${MINE}`,
      );
      expect(res.headers.get('cache-control')).toBe('no-store');
    }
  });

  it("answers an unknown kind on another customer's event with the same 404 as any (no oracle)", async () => {
    const known = await get(THEIRS, '?kind=allocation');
    const body = await known.text();
    for (const query of ['', '?kind=payslip']) {
      for (const id of [THEIRS, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
        const res = await get(id, query);
        expect(res.status, `${id}${query}`).toBe(404);
        expect(res.headers.get('location')).toBeNull();
        expect(res.headers.get('cache-control')).toBe('no-store');
        expect(await res.text()).toBe(body);
      }
    }
  });

  it('sends the customer back to the event page when that kind has not been issued', async () => {
    state.docs[MINE] = [doc('allocation')];
    const res = await get(MINE, '?kind=signout');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `https://portal.thc.example/client/events/${MINE}?doc=missing`,
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it("is the same 404 for another customer's event as for a nonexistent one (ADR-0004)", async () => {
    // The view returned no row for Sophie's event; the route cannot tell
    // that from an id that was never issued, and must not try.
    const theirs = await get(THEIRS, '?kind=allocation');
    const nothing = await get('00000000-0000-4000-8000-000000000000', '?kind=allocation');
    const garbage = await get('not-a-uuid', '?kind=allocation');
    for (const res of [theirs, nothing, garbage]) {
      expect(res.status).toBe(404);
      expect(res.headers.get('location')).toBeNull();
    }
    const body = await theirs.text();
    expect(body).toBe('No document for this event yet.');
    expect(await nothing.text()).toBe(body);
    expect(await garbage.text()).toBe(body);
  });

  it('sends the customer back with ?doc=unavailable when the store cannot sign', async () => {
    state.signed = null;
    const res = await get(MINE, '?kind=allocation');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `https://portal.thc.example/client/events/${MINE}?doc=unavailable`,
    );
  });

  it('and when the documents could not be read', async () => {
    state.failRead = true;
    const res = await get(MINE, '?kind=allocation');
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toContain('?doc=unavailable');
  });
});
