import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0081: generateDocument() draws the name badges with an Allocation
 * Timesheet for a client that has them, stores them beside it and attaches
 * them to the same copy — before the caller queues the email. The database
 * and Storage are fakes; the PDFs are drawn for real.
 */

const uploads: { bucket: string; path: string }[] = [];
let refuseUpload: string | null = null;

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string) => {
          if (refuseUpload && path.includes(refuseUpload))
            return { error: { message: 'bucket full' } };
          uploads.push({ bucket, path });
          return { error: null };
        },
      }),
    },
  }),
}));

const { generateDocument } = await import('../generate');
type Db = NonNullable<Parameters<typeof generateDocument>[3]>['db'];

const EVENT_ID = '0b5c3e0e-1c0a-4d6e-9a43-3f1d2b7c9a01';

function person(id: string, first: string, last: string, removed = false) {
  return {
    bookingId: id,
    employeeId: 412,
    name: removed ? 'Deleted account #1042' : `${first} ${last}`,
    firstName: removed ? null : first,
    surname: removed ? null : last,
    removed,
    photoPath: null,
    roleName: 'Waiting Staff',
    sectionId: 's1',
    startsAt: '2026-10-20T16:00:00Z',
    endsAt: '2026-10-20T22:30:00Z',
    finishAt: null,
    workedMin: null,
    status: 'scheduled',
    breakMin: 0,
  };
}

function fakeDb(nameBadges: boolean | undefined, attachError: string | null = null) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const db = {
    calls,
    rpc(fn: string, args: Record<string, unknown>) {
      calls.push({ fn, args });
      if (fn === 'event_document_data') {
        return Promise.resolve({
          data: {
            event: {
              title: 'Gala Dinner',
              clientName: "Leonardo Hotel St Paul's M and E",
              eventDate: '2026-10-20',
              poNumber: '4471-A',
              contactEmails: ['events@leonardo.test'],
              ...(nameBadges === undefined ? {} : { nameBadges }),
            },
            rows: [
              person('b1', 'Luca', 'Moretti'),
              person('b2', 'Aisha', 'Bello'),
              person('b3', '', '', true),
            ],
          },
          error: null,
        });
      }
      if (fn === 'record_event_document' || fn === 'record_event_document_autosend')
        return Promise.resolve({ data: 'doc-1', error: null });
      if (fn === 'attach_event_document_badges')
        return Promise.resolve({
          data: null,
          error: attachError ? { message: attachError } : null,
        });
      return Promise.resolve({ data: null, error: { message: `unexpected ${fn}` } });
    },
    storage: {
      from: () => ({ download: async () => ({ data: null, error: null }) }),
    },
  };
  return db;
}

describe('generateDocument and name badges (ADR-0081)', () => {
  beforeEach(() => {
    uploads.length = 0;
    refuseUpload = null;
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  });

  it('draws, stores and attaches the badges with the Allocation Timesheet', async () => {
    const db = fakeDb(true);
    const result = await generateDocument(EVENT_ID, 'allocation', 'required', {
      db: db as unknown as Db,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(uploads.map((u) => u.path.replace(/\/[^/]+\.pdf$/, ''))).toEqual([
      `${EVENT_ID}/allocation`,
      `${EVENT_ID}/badges`,
    ]);
    expect(uploads.every((u) => u.bucket === 'timesheets')).toBe(true);

    const attach = db.calls.find((c) => c.fn === 'attach_event_document_badges');
    expect(attach?.args).toEqual({
      p_document: 'doc-1',
      p_storage_path: uploads[1]!.path,
      p_file_name: "Leonardo Hotel St Paul's M and E – Gala Dinner – Name Badges.pdf",
      // The removed worker gets a timesheet row and no badge.
      p_count: 2,
    });
    // Recorded first, then attached: nothing has queued an email yet.
    expect(db.calls.map((c) => c.fn)).toEqual([
      'event_document_data',
      'record_event_document',
      'attach_event_document_badges',
    ]);
    expect(result.badges?.layout.count).toBe(2);
    expect(result.badges?.storagePath).toBe(uploads[1]!.path);
  });

  it('the automatic send does the same through the service role', async () => {
    const db = fakeDb(true);
    const result = await generateDocument(EVENT_ID, 'allocation', 'required', {
      db: db as unknown as Db,
      automatic: true,
    });
    expect(result.ok).toBe(true);
    expect(db.calls.map((c) => c.fn)).toEqual([
      'event_document_data',
      'record_event_document_autosend',
      'attach_event_document_badges',
    ]);
  });

  it('draws no badges for a client without them, or a database from before them', async () => {
    for (const flag of [false, undefined]) {
      uploads.length = 0;
      const db = fakeDb(flag);
      const result = await generateDocument(EVENT_ID, 'allocation', 'required', {
        db: db as unknown as Db,
      });
      expect(result.ok && result.badges).toBe(null);
      expect(uploads).toHaveLength(1);
      expect(db.calls.some((c) => c.fn === 'attach_event_document_badges')).toBe(false);
    }
  });

  it('never puts badges on the Completed Allocation Timesheet', async () => {
    const db = fakeDb(true);
    const result = await generateDocument(EVENT_ID, 'signout', 'required', {
      db: db as unknown as Db,
    });
    expect(result.ok && result.badges).toBe(null);
    expect(uploads).toHaveLength(1);
    expect(db.calls.some((c) => c.fn === 'attach_event_document_badges')).toBe(false);
  });

  it('a Send that cannot attach the badges does not go without them', async () => {
    const db = fakeDb(true, 'client_has_no_name_badges');
    const result = await generateDocument(EVENT_ID, 'allocation', 'required', {
      db: db as unknown as Db,
    });
    expect(result).toEqual({
      ok: false,
      status: 409,
      message: 'Name badges are switched off on the client card.',
    });
  });

  it('a Send whose badges Storage refuses stops before recording anything', async () => {
    refuseUpload = '/badges/';
    const db = fakeDb(true);
    const result = await generateDocument(EVENT_ID, 'allocation', 'required', {
      db: db as unknown as Db,
    });
    expect(result.ok).toBe(false);
    expect(db.calls.map((c) => c.fn)).toEqual(['event_document_data']);
  });

  it('a Download still hands over the sheet when the badges cannot be attached', async () => {
    const db = fakeDb(true, 'document_already_queued');
    const result = await generateDocument(EVENT_ID, 'allocation', 'best-effort', {
      db: db as unknown as Db,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
