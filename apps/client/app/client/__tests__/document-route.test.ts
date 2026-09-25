import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientDocument } from '../documents';

/**
 * GET /client/events/:id/document (§11.2 "↓ Download Allocation Sheet",
 * §11.3). The handler owns three decisions — which kind was asked for, what
 * to answer when the view returned no copy, and what to answer when the
 * store cannot sign — and the tenancy decision it does NOT own: another
 * customer's event is simply an event `client_event_documents_v` returns
 * nothing for (ADR-0004), so it must come out identical to "nothing issued".
 */
const state = vi.hoisted(() => ({
  docs: {} as Record<string, ClientDocument[]>,
  signed: 'https://db.example/storage/v1/object/sign/timesheets/x.pdf?token=t' as string | null,
  loaded: [] as string[],
}));

vi.mock('../documents', () => ({
  loadDocuments: async (eventId: string) => {
    state.loaded.push(eventId);
    return state.docs[eventId] ?? [];
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
  state.docs = { [MINE]: [doc('allocation'), doc('signout')] };
  state.signed = 'https://db.example/storage/v1/object/sign/timesheets/x.pdf?token=t';
  state.loaded = [];
});

describe('GET /client/events/:id/document', () => {
  it('redirects to a short-lived signed link, uncached', async () => {
    const res = await get(MINE, '?kind=allocation');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(state.signed);
    expect(res.headers.get('cache-control')).toBe('no-store');
    // Through the view, under the caller's own session — the only read.
    expect(state.loaded).toEqual([MINE]);
  });

  it('resolves the kind: "signout" by name, anything else is the allocation sheet', async () => {
    state.docs[MINE] = [doc('signout')];
    expect((await get(MINE, '?kind=signout')).status).toBe(302);
    // No allocation copy exists, so both of these ask for one and get nothing.
    expect((await get(MINE)).status).toBe(404);
    expect((await get(MINE, '?kind=payslip')).status).toBe(404);
  });

  it('is 404 when that kind has not been issued', async () => {
    state.docs[MINE] = [doc('allocation')];
    const res = await get(MINE, '?kind=signout');
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('No document for this event yet.');
  });

  it("is the same 404 for another customer's event as for a nonexistent one (ADR-0004)", async () => {
    // The view returned no row for Sophie's event; the route cannot tell
    // that from an id that was never issued, and must not try.
    const theirs = await get(THEIRS, '?kind=allocation');
    const nothing = await get('00000000-0000-4000-8000-000000000000', '?kind=allocation');
    expect(theirs.status).toBe(404);
    expect(nothing.status).toBe(404);
    expect(await theirs.text()).toBe(await nothing.text());
  });

  it('is 503, not a broken redirect, when the store cannot sign', async () => {
    state.signed = null;
    const res = await get(MINE, '?kind=allocation');
    expect(res.status).toBe(503);
  });
});
