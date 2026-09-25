import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ExtractorModule from '../../app/onboarding/extractor';
import type { DocumentExtractor, ExtractionResult } from '../../app/onboarding/extractor';

/**
 * ADR-0033 point 8 — the upload never waits on the model. Both upload
 * paths (the wizard's step 4 and the Documents tab) record the document,
 * flag it for manual review, hand the read to `after()` and return. The
 * extractor here never answers until the test says so: an action that
 * awaited it would never resolve.
 *
 * And the deferred work fails safe: a thrown download, a refused RPC, a
 * throwing extractor are caught and logged by error code only — never the
 * document or the provider's message — and the row keeps its flag.
 */

const STAFF = 'd0000000-0000-4000-8000-000000000001';
const FILE = '0f0e0d0c-0b0a-4908-8706-050403020100';
const SECRET = 'JANE DOE 12 JAN 1999 PASSPORT 123456789';

const h = vi.hoisted(() => ({
  deferred: [] as (() => unknown)[],
  afterThrows: false,
  extractor: null as unknown,
  staffRpc: vi.fn(),
  adminRpc: vi.fn(),
  download: vi.fn(),
}));

vi.mock('next/server', () => ({
  after: (task: () => unknown) => {
    if (h.afterThrows) throw new Error('`after` was called outside a request scope');
    h.deferred.push(task);
  },
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../../app/db', () => ({
  supabaseConfigured: () => true,
  staffDb: () => ({ rpc: (...args: unknown[]) => h.staffRpc(...args) }),
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => h.adminRpc(...args),
    storage: {
      from: () => ({
        list: async () => ({
          data: [{ name: `${FILE}.pdf`, metadata: { size: 48_000, mimetype: 'application/pdf' } }],
          error: null,
        }),
        download: (...args: unknown[]) => h.download(...args),
        remove: async () => ({ data: null, error: null }),
      }),
    },
  }),
}));
vi.mock('../../app/_lib/postcode', () => ({ geocodePostcode: vi.fn() }));
vi.mock('../../app/profile/photos', () => ({ photoPathFor: vi.fn() }));
vi.mock('../../app/onboarding/extractor', async (importOriginal) => {
  const actual = await importOriginal<typeof ExtractorModule>();
  return { ...actual, documentExtractor: () => h.extractor as DocumentExtractor | null };
});

const wizard = await import('../../app/onboarding/actions');
const documents = await import('../../app/documents/actions');

const READ: ExtractionResult = {
  expiryDate: '2031-04-30',
  holidays: null,
  completionDate: null,
  awardingInstitution: null,
  confidence: 0.94,
  raw: { model: 'claude-sonnet-5' },
};

/** An extractor whose answer the test releases by hand. */
function heldExtractor() {
  let release!: (result: ExtractionResult) => void;
  let fail!: (error: unknown) => void;
  const answer = new Promise<ExtractionResult>((resolve, reject) => {
    release = resolve;
    fail = reject;
  });
  const extract = vi.fn(() => answer);
  h.extractor = { provider: 'anthropic', extract } satisfies DocumentExtractor;
  return { extract, release, fail };
}

function recordCalls() {
  return h.adminRpc.mock.calls.filter(([fn]) => fn === 'record_document_extraction');
}

async function runDeferred() {
  const tasks = h.deferred.splice(0);
  await Promise.all(tasks.map((task) => task()));
}

let errorLog: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  process.env['SUPABASE_SERVICE_ROLE_KEY'] = 'service';
  h.deferred.length = 0;
  h.afterThrows = false;
  h.extractor = null;
  h.staffRpc.mockReset();
  h.staffRpc.mockImplementation(async (fn: string) => {
    if (fn === 'staff_me') return { data: { staffId: STAFF, status: 'compliant' }, error: null };
    if (fn === 'onboarding_attach_document') return { data: { docId: 'doc-w' }, error: null };
    if (fn === 'submit_document_upload')
      return { data: { ok: true, documentId: 'doc-d' }, error: null };
    if (fn === 'submit_completion_letter') {
      return { data: { ok: true, documentId: 'doc-c' }, error: null };
    }
    return { data: null, error: null };
  });
  h.adminRpc.mockReset();
  h.adminRpc.mockResolvedValue({ data: { ok: true }, error: null });
  h.download.mockReset();
  h.download.mockResolvedValue({
    data: new Blob([new TextEncoder().encode(`%PDF-1.7 ${SECRET}`)], { type: 'application/pdf' }),
    error: null,
  });
  errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  errorLog.mockRestore();
});

const uploads = [
  {
    name: 'wizard step 4 (onboarding_attach_document)',
    docId: 'doc-w',
    run: () =>
      wizard.finishDocumentUpload({
        docType: 'passport',
        path: `${STAFF}/passport/${FILE}.pdf`,
        fileName: 'passport.pdf',
      }),
  },
  {
    name: 'Documents tab renewal (submit_document_upload)',
    docId: 'doc-d',
    run: () => documents.finishDocumentUpload('passport', `${STAFF}/passport/${FILE}.pdf`, null),
  },
  {
    name: 'Documents tab completion letter (submit_completion_letter)',
    docId: 'doc-c',
    run: () =>
      documents.finishCompletionLetter({
        path: `${STAFF}/completion-letter/${FILE}.pdf`,
        completionDate: '2026-06-30',
        form: 'letter',
        institution: 'University of Leeds',
      }),
  },
];

describe.each(uploads)('$name', ({ docId, run }) => {
  it('returns before the extractor answers, with the row flagged until it does', async () => {
    const held = heldExtractor();

    const result = await run();

    expect(result.ok).toBe(true);
    // The read has not even started: it is queued behind the response.
    expect(held.extract).not.toHaveBeenCalled();
    expect(h.deferred).toHaveLength(1);
    // What the action DID await: one null-confidence write, which flags
    // the row and (20260928120100) clears nothing the worker entered.
    expect(recordCalls()).toEqual([
      [
        'record_document_extraction',
        {
          p_doc: docId,
          p_expiry: null,
          p_term_dates: null,
          p_completion: null,
          p_institution: null,
          p_confidence: null,
          p_raw: null,
        },
      ],
    ]);

    // After the response: the read runs, and is written only once it lands.
    const done = runDeferred();
    await vi.waitFor(() => expect(held.extract).toHaveBeenCalledTimes(1));
    expect(recordCalls()).toHaveLength(1);
    held.release(READ);
    await done;
    expect(recordCalls()).toHaveLength(2);
    expect(recordCalls()[1]![1]).toMatchObject({ p_doc: docId, p_confidence: 0.94 });
  });
});

describe('extractor off (no ANTHROPIC_API_KEY)', () => {
  it.each(uploads)('$name — nothing is flagged or scheduled', async ({ run }) => {
    h.extractor = null;
    const result = await run();
    expect(result.ok).toBe(true);
    expect(recordCalls()).toHaveLength(0);
    expect(h.deferred).toHaveLength(0);
  });
});

describe('the deferred read fails safe', () => {
  const upload = uploads[1]!;

  /** Every console.error argument, flattened — no document content in any. */
  function logged(): string {
    return JSON.stringify(errorLog.mock.calls);
  }

  it('a throwing extractor is caught, logged by code, and the row keeps its flag', async () => {
    const held = heldExtractor();
    await upload.run();
    const done = runDeferred();
    await vi.waitFor(() => expect(held.extract).toHaveBeenCalled());
    held.fail(Object.assign(new Error(`could not read ${SECRET}`), { name: 'APIError' }));
    await expect(done).resolves.toBeUndefined();
    // Only the flag was written; nothing un-flags the row.
    expect(recordCalls()).toHaveLength(1);
    expect(recordCalls()[0]![1]).toMatchObject({ p_confidence: null });
    expect(errorLog).toHaveBeenCalledWith('document extraction failed', {
      stage: 'extract',
      docId: 'doc-d',
      code: 'APIError',
    });
    expect(logged()).not.toContain('JANE DOE');
  });

  it('a failed download is logged by code and nothing is read', async () => {
    const held = heldExtractor();
    h.download.mockResolvedValue({ data: null, error: { name: 'StorageApiError', status: 404 } });
    await upload.run();
    await runDeferred();
    expect(held.extract).not.toHaveBeenCalled();
    expect(errorLog).toHaveBeenCalledWith('document extraction failed', {
      stage: 'download',
      docId: 'doc-d',
      code: 'http_404',
    });
  });

  it('a refused record RPC is logged by its Postgres code, not its message', async () => {
    const held = heldExtractor();
    await upload.run();
    h.adminRpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: `bad_date for ${SECRET}` },
    });
    const done = runDeferred();
    await vi.waitFor(() => expect(held.extract).toHaveBeenCalled());
    held.release(READ);
    await done;
    expect(errorLog).toHaveBeenCalledWith('document extraction failed', {
      stage: 'record',
      docId: 'doc-d',
      code: 'P0001',
    });
    expect(logged()).not.toContain('JANE DOE');
  });

  it('a failed flag write never fails the upload', async () => {
    heldExtractor();
    h.adminRpc.mockRejectedValue(new TypeError('fetch failed'));
    const result = await upload.run();
    expect(result.ok).toBe(true);
    expect(errorLog).toHaveBeenCalledWith('document extraction failed', {
      stage: 'flag',
      docId: 'doc-d',
      code: 'TypeError',
    });
  });

  it('after() refusing to schedule never fails the upload', async () => {
    heldExtractor();
    h.afterThrows = true;
    const result = await upload.run();
    expect(result.ok).toBe(true);
    expect(recordCalls()).toHaveLength(1);
    expect(errorLog).toHaveBeenCalledWith(
      'document extraction failed',
      expect.objectContaining({ stage: 'schedule', docId: 'doc-d' }),
    );
  });
});
