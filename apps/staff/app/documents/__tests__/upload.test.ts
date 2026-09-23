import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The upload actions — the service key issues, the worker's session decides.
 *
 *   · the Storage name is built on the server from the SESSION's staff id,
 *     a fresh id and the file's extension: `<staff_id>/<folder>/<uuid>.<ext>`
 *     — never the worker's file name, never a path the browser supplied;
 *   · a file the rules refuse never gets a signed upload at all;
 *   · the RPC that files the document is called as the worker, and a
 *     refusal removes the orphaned object — only under their own prefix.
 */

const rpc = vi.fn();
const createSignedUploadUrl = vi.fn();
const remove = vi.fn();
const adminRpc = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('../../db', () => ({
  staffDb: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
  supabaseConfigured: () => true,
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => adminRpc(...args),
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (path: string) => createSignedUploadUrl(bucket, path),
        remove: (paths: string[]) => remove(bucket, paths),
      }),
    },
  }),
}));

const { finishCompletionLetter, finishDocumentUpload, startUpload } = await import('../actions');

const STAFF = 'd0000000-0000-4000-8000-000000000001';
const PDF = { name: 'My Passport (scan).PDF', type: 'application/pdf', size: 480_000 };

function worker(status: string, blockKind: string | null = null) {
  rpc.mockImplementation(async (fn: string) =>
    fn === 'staff_me'
      ? { data: { staffId: STAFF, status, blockKind }, error: null }
      : { data: null, error: null },
  );
}

beforeEach(() => {
  rpc.mockReset();
  createSignedUploadUrl.mockReset();
  remove.mockReset();
  adminRpc.mockReset();
  adminRpc.mockResolvedValue({ data: true, error: null });
  createSignedUploadUrl.mockResolvedValue({
    data: { token: 'tok', signedUrl: 'x', path: 'p' },
    error: null,
  });
});

describe('startUpload()', () => {
  it('builds the Storage name from the session, a fresh id and the extension', async () => {
    worker('compliant');
    const slot = await startUpload({ kind: 'document', docType: 'passport' }, PDF);
    expect(slot.ok).toBe(true);
    const path = (slot as { path: string }).path;
    expect(path).toMatch(new RegExp(`^${STAFF}/passport/[0-9a-f-]{36}\\.pdf$`));
    expect(path).not.toContain('Passport (scan)');
    expect(createSignedUploadUrl).toHaveBeenCalledWith('documents', path);
  });

  it('puts a document type in its own folder, the one submit_document_upload() checks', async () => {
    worker('blocked', 'auto_document');
    const slot = await startUpload({ kind: 'document', docType: 'visa_document' }, PDF);
    expect((slot as { path: string }).path).toMatch(new RegExp(`^${STAFF}/visa-document/`));
  });

  it('the completion letter goes under completion-letter/', async () => {
    worker('compliant');
    const slot = await startUpload({ kind: 'completion-letter' }, PDF);
    expect((slot as { path: string }).path).toMatch(new RegExp(`^${STAFF}/completion-letter/`));
  });

  it('refuses a file the rules refuse before anything is signed', async () => {
    worker('compliant');
    const slot = await startUpload(
      { kind: 'document', docType: 'passport' },
      { name: 'scan.gif', type: 'image/gif', size: 100 },
    );
    expect(slot).toEqual({ ok: false, message: 'Upload a PDF, JPG or PNG.' });
    const big = await startUpload(
      { kind: 'document', docType: 'passport' },
      { ...PDF, size: 10 * 1024 * 1024 + 1 },
    );
    expect(big).toEqual({ ok: false, message: 'That file is over 10 MB.' });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses a manual hold — nothing for them to fix (§10.1 case 2)', async () => {
    worker('blocked', 'manual');
    const slot = await startUpload({ kind: 'document', docType: 'passport' }, PDF);
    expect(slot.ok).toBe(false);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it('refuses the completion letter through the generic route', async () => {
    worker('compliant');
    const slot = await startUpload(
      { kind: 'document', docType: 'university_completion_letter' },
      PDF,
    );
    expect(slot.ok).toBe(false);
  });
});

describe('finish…() — the worker’s RPC', () => {
  it('files the document as the worker and says nothing changes until verified', async () => {
    rpc.mockResolvedValue({ data: { ok: true, documentId: 'd1', status: 'pending' }, error: null });
    const path = `${STAFF}/passport/abc.pdf`;
    const result = await finishDocumentUpload('passport', path, null);
    expect(rpc).toHaveBeenCalledWith('submit_document_upload', {
      p_doc_type: 'passport',
      p_file_path: path,
      p_share_code: null,
    });
    expect(result).toEqual({
      ok: true,
      note: 'Sent to the office for review. Nothing changes on your account until they verify it.',
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('a refusal is a sentence and the orphan is removed — under the worker’s own prefix only', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'staff_me'
        ? { data: { staffId: STAFF, status: 'compliant', blockKind: null }, error: null }
        : { data: { ok: false, reason: 'already_pending' }, error: null },
    );
    const mine = `${STAFF}/passport/abc.pdf`;
    expect(await finishDocumentUpload('passport', mine, null)).toEqual({
      ok: false,
      message: 'This document is already with the office for review.',
    });
    expect(remove).toHaveBeenCalledWith('documents', [mine]);

    expect(adminRpc).toHaveBeenCalledWith('evidence_path_discardable', {
      p_staff: STAFF,
      p_path: mine,
    });

    remove.mockReset();
    await finishDocumentUpload('passport', 'someone-else/passport/abc.pdf', null);
    expect(remove).not.toHaveBeenCalled();
  });

  it('never removes a path the database says is evidence — a verified document named back to a refusing RPC', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'staff_me'
        ? { data: { staffId: STAFF, status: 'compliant', blockKind: null }, error: null }
        : { data: { ok: false, reason: 'invalid_path' }, error: null },
    );
    adminRpc.mockResolvedValue({ data: false, error: null });
    await finishDocumentUpload('passport', `${STAFF}/passport/verified.pdf`, null);
    expect(remove).not.toHaveBeenCalled();
  });

  it('the completion letter goes through submit_completion_letter() with the date and form', async () => {
    rpc.mockResolvedValue({ data: { ok: true, documentId: 'd2', status: 'pending' }, error: null });
    const result = await finishCompletionLetter({
      path: `${STAFF}/completion-letter/abc.pdf`,
      completionDate: '2027-06-30',
      form: 'transcript',
      institution: '  ',
    });
    expect(rpc).toHaveBeenCalledWith('submit_completion_letter', {
      p_file_path: `${STAFF}/completion-letter/abc.pdf`,
      p_completion_date: '2027-06-30',
      p_evidence_form: 'transcript',
      p_awarding_institution: null,
    });
    expect(result.ok && result.note).toContain('does not change until the office approves');
  });
});
