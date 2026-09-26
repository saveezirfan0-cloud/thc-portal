import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The office's review writes (audit D47, D31, D43, D32, D36): the completion-letter upload
 * (D47), the gov.uk report on the manual path (D31), the NI check (D43) and
 * the conditions saved beside a Verify (D32, D36). Every RPC goes through the
 * MANAGER'S session; the service key only issues a one-object signed upload,
 * and only once the caller is known to be the office.
 */
const state = vi.hoisted(() => ({
  user: { id: 'manager-1' } as { id: string } | null,
  role: 'admin' as string | null,
  rpcResult: {} as Record<string, { data: unknown; error: { message: string } | null }>,
}));
const sessionRpc = vi.hoisted(() =>
  vi.fn(async (fn: string) => state.rpcResult[fn] ?? { data: {}, error: null }),
);
const adminRpc = vi.hoisted(() => vi.fn(async () => ({ data: true, error: null })));
const signUpload = vi.hoisted(() =>
  vi.fn(async (path: string) => ({ data: { path, token: 'tok' }, error: null })),
);
const removeObject = vi.hoisted(() => vi.fn(async () => ({ error: null })));

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('../data', () => ({ supabaseConfigured: () => true }));
vi.mock('@thc/db/server', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.role ? { role: state.role } : null }),
        }),
      }),
    }),
    rpc: sessionRpc,
  }),
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    rpc: adminRpc,
    storage: { from: () => ({ createSignedUploadUrl: signUpload, remove: removeObject }) },
  }),
}));

const {
  attachRtwReport,
  resolveNiCheck,
  startOfficeUpload,
  submitOfficeCompletionLetter,
  verifyDocument,
} = await import('../actions');

const STAFF = '63700000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  state.user = { id: 'manager-1' };
  state.role = 'admin';
  state.rpcResult = {};
});

describe('D47 · the office uploads a completion letter', () => {
  const file = { name: 'Letter.PDF', type: 'application/pdf', size: 120_000 };

  it('issues a signed upload for a name the server chose, under the worker’s folder', async () => {
    const slot = await startOfficeUpload(STAFF, 'completion-letter', file);
    expect(slot.ok).toBe(true);
    const path = (signUpload.mock.calls[0] as unknown as [string])[0];
    expect(path).toMatch(new RegExp(`^${STAFF}/completion-letter/[0-9a-f-]{36}\\.pdf$`));
    expect(path).not.toContain('Letter');
  });

  it('issues nothing to a caller who is not the office', async () => {
    state.role = 'staff';
    const slot = await startOfficeUpload(STAFF, 'completion-letter', file);
    expect(slot).toEqual({ ok: false, message: 'Only the office can review documents.' });
    expect(signUpload).not.toHaveBeenCalled();
  });

  it('refuses a file the rule refuses before anything is signed', async () => {
    const slot = await startOfficeUpload(STAFF, 'completion-letter', {
      name: 'x.gif',
      type: 'image/gif',
      size: 10,
    });
    expect(slot).toEqual({ ok: false, message: 'Upload a PDF, JPG or PNG.' });
    expect(signUpload).not.toHaveBeenCalled();
  });

  it('refuses a staff id that is not an id, so no path is built from it', async () => {
    const slot = await startOfficeUpload('../x', 'completion-letter', file);
    expect(slot.ok).toBe(false);
    expect(signUpload).not.toHaveBeenCalled();
  });

  it('files it through office_submit_completion_letter as the manager', async () => {
    state.rpcResult['office_submit_completion_letter'] = {
      data: { ok: true, documentId: 'd9', status: 'pending' },
      error: null,
    };
    const result = await submitOfficeCompletionLetter({
      staffId: STAFF,
      path: `${STAFF}/completion-letter/a.pdf`,
      completionDate: '2026-06-30',
      form: 'letter',
      institution: ' University of Leeds ',
    });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Needs review');
    expect(sessionRpc).toHaveBeenCalledWith('office_submit_completion_letter', {
      p_staff: STAFF,
      p_file_path: `${STAFF}/completion-letter/a.pdf`,
      p_completion_date: '2026-06-30',
      p_evidence_form: 'letter',
      p_awarding_institution: 'University of Leeds',
    });
  });

  it('never sends a path outside the worker’s own completion-letter folder', async () => {
    const result = await submitOfficeCompletionLetter({
      staffId: STAFF,
      path: 'someone-else/completion-letter/a.pdf',
      completionDate: '2026-06-30',
      form: 'letter',
    });
    expect(result.ok).toBe(false);
    expect(sessionRpc).not.toHaveBeenCalled();
  });

  it('says why a refusal was refused, and removes the fresh upload nobody points at', async () => {
    state.rpcResult['office_submit_completion_letter'] = {
      data: { ok: false, reason: 'already_pending' },
      error: null,
    };
    const result = await submitOfficeCompletionLetter({
      staffId: STAFF,
      path: `${STAFF}/completion-letter/a.pdf`,
      completionDate: '2026-06-30',
      form: 'letter',
    });
    expect(result).toEqual({
      ok: false,
      message: 'A completion letter is already waiting in Needs review — decide that one first.',
    });
    expect(adminRpc).toHaveBeenCalledWith('evidence_path_discardable', {
      p_staff: STAFF,
      p_path: `${STAFF}/completion-letter/a.pdf`,
    });
    expect(removeObject).toHaveBeenCalledWith([`${STAFF}/completion-letter/a.pdf`]);
  });
});

describe('D31 · the gov.uk report on the manual path', () => {
  it('attaches it to the share code as the manager', async () => {
    state.rpcResult['compliance_attach_rtw_report'] = { data: { ok: true }, error: null };
    const result = await attachRtwReport('doc-1', STAFF, `${STAFF}/share-code-report/r.pdf`);
    expect(result.ok).toBe(true);
    expect(sessionRpc).toHaveBeenCalledWith('compliance_attach_rtw_report', {
      p_doc: 'doc-1',
      p_path: `${STAFF}/share-code-report/r.pdf`,
    });
  });

  it('keeps a report already on file', async () => {
    state.rpcResult['compliance_attach_rtw_report'] = {
      data: { ok: false, reason: 'report_already_attached' },
      error: null,
    };
    expect(await attachRtwReport('doc-1', STAFF, `${STAFF}/share-code-report/r.pdf`)).toEqual({
      ok: false,
      message: 'A gov.uk report is already attached to this share code.',
    });
  });

  it('says so while the automated check owns the share code, and removes the fresh upload', async () => {
    state.rpcResult['compliance_attach_rtw_report'] = {
      data: { ok: false, reason: 'automated_check_owns_report' },
      error: null,
    };
    const result = await attachRtwReport('doc-1', STAFF, `${STAFF}/share-code-report/r.pdf`);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/automatic gov\.uk check stores its own report/);
    expect(removeObject).toHaveBeenCalledWith([`${STAFF}/share-code-report/r.pdf`]);
  });
});

describe('D43 · the NI check', () => {
  it('records a match', async () => {
    expect((await resolveNiCheck('doc-1', true)).ok).toBe(true);
    expect(sessionRpc).toHaveBeenCalledWith('compliance_resolve_ni_check', {
      p_doc: 'doc-1',
      p_matches: true,
      p_reason: null,
    });
  });

  it('needs a reason for a mismatch, which goes to the worker', async () => {
    expect((await resolveNiCheck('doc-1', false, '  ')).ok).toBe(false);
    expect(sessionRpc).not.toHaveBeenCalled();
    await resolveNiCheck('doc-1', false, 'Different number');
    expect(sessionRpc).toHaveBeenCalledWith('compliance_resolve_ni_check', {
      p_doc: 'doc-1',
      p_matches: false,
      p_reason: 'Different number',
    });
  });
});

describe('D32 / D36 · the conditions confirmed beside a Verify', () => {
  it('saves the course level after the Verify, and says what it means', async () => {
    state.rpcResult['compliance_verify_document'] = { data: { verified: true }, error: null };
    state.rpcResult['compliance_set_below_degree_level'] = {
      data: { ok: true, changed: true, capHours: 10 },
      error: null,
    };
    const result = await verifyDocument(
      'doc-1',
      { expiry: '2027-01-31' },
      { staffId: STAFF, belowDegreeLevel: true },
    );
    expect(result.ok).toBe(true);
    expect(result.message).toContain('below degree level: 10 h a week in term time');
    expect(sessionRpc.mock.calls.map((c) => c[0])).toEqual([
      'compliance_verify_document',
      'compliance_set_below_degree_level',
    ]);
  });

  it('refuses an impossible visa limit before anything is verified', async () => {
    const result = await verifyDocument('doc-1', {}, { staffId: STAFF, visaHourLimit: '60' });
    expect(result).toEqual({
      ok: false,
      message: 'A visa hours limit is between 1 and 48 hours a week.',
    });
    expect(sessionRpc).not.toHaveBeenCalled();
  });

  it('sends an empty visa limit as no limit', async () => {
    state.rpcResult['compliance_verify_document'] = { data: { verified: true }, error: null };
    await verifyDocument('doc-1', {}, { staffId: STAFF, visaHourLimit: '' });
    expect(sessionRpc).toHaveBeenCalledWith('compliance_set_visa_hour_limit', {
      p_staff: STAFF,
      p_hours: null,
    });
  });

  it('saves nothing when the Verify is refused', async () => {
    state.rpcResult['compliance_verify_document'] = {
      data: null,
      error: { message: 'not_pending: verified' },
    };
    const result = await verifyDocument('doc-1', {}, { staffId: STAFF, visaHourLimit: '20' });
    expect(result).toEqual({ ok: false, message: 'This has already been verified.' });
    expect(sessionRpc).toHaveBeenCalledTimes(1);
  });
});
