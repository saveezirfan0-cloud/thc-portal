import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * New share code with the date of birth (ADR-0070).
 *
 *   · the form asks for the date of birth, pre-filled from the profile the
 *     way the onboarding re-entry sheet does, with gov.uk's hint;
 *   · "What happens next" says the office confirms every result (ADR-0041)
 *     and no longer sends the worker to the office about a wrong date;
 *   · the action sends the code and the date in ONE call,
 *     submit_share_code_with_dob(), as the worker — and a cleared or
 *     half-typed date is refused rather than read as "no change".
 */
const rpc = vi.fn();
const remove = vi.fn();
const adminRpc = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: () => {} }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock('../../db', () => ({
  staffDb: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
  supabaseConfigured: () => true,
}));
vi.mock('@thc/db/admin', () => ({
  createAdminClient: () => ({
    rpc: (...args: unknown[]) => adminRpc(...args),
    storage: { from: () => ({ remove: (paths: string[]) => remove(paths) }) },
  }),
}));
vi.mock('@thc/db/browser', () => ({ createClient: vi.fn() }));

const { finishShareCode } = await import('../actions');
const { UploadForm } = await import('../_components/UploadForm');

const STAFF = 'd0000000-0000-4000-8000-000000000001';

beforeEach(() => {
  rpc.mockReset();
  remove.mockReset();
  adminRpc.mockReset();
  adminRpc.mockResolvedValue({ data: true, error: null });
  rpc.mockImplementation(async (fn: string) =>
    fn === 'staff_me'
      ? { data: { staffId: STAFF, status: 'compliant', blockKind: null }, error: null }
      : { data: { ok: true, documentId: 'd9', status: 'pending', dobChanged: true }, error: null },
  );
});

describe('the New share code form', () => {
  const html = (automaticCheck: boolean) =>
    renderToStaticMarkup(
      <UploadForm
        docType="share_code_report"
        label="Share code report"
        automaticCheck={automaticCheck}
        dob="1995-06-05"
      />,
    );

  it('asks for the date of birth, pre-filled from the profile, with gov.uk’s hint', () => {
    const out = html(true);
    expect(out).toContain('New share code');
    expect(out).toContain('Date of birth');
    expect(out).toContain('value="05/06/1995"');
    expect(out).toContain('Must match the date of birth gov.uk holds for you.');
  });

  it('says the office confirms the result, and no longer sends the worker to the office about the date', () => {
    const out = html(true);
    expect(out).toContain('the office confirms the result');
    expect(out).not.toContain('it is verified —');
    expect(out).not.toContain('tell the office');
    expect(out).toContain('saved to your');
    expect(out).toContain('profile once the office verifies it.');
  });

  it('with the check off, the office checks it with gov.uk — same date field', () => {
    const out = html(false);
    expect(out).toContain('The office checks it with gov.uk, with the date of birth above.');
    expect(out).toContain('value="05/06/1995"');
  });

  it('a file upload has no date of birth', () => {
    const out = renderToStaticMarkup(<UploadForm docType="passport" label="Passport" />);
    expect(out).not.toContain('Date of birth');
  });
});

describe('finishShareCode — one call, as the worker', () => {
  it('sends the code, the date and the optional report to submit_share_code_with_dob()', async () => {
    const result = await finishShareCode(null, 'W98 7ZY 6XK', '1995-06-15');
    expect(rpc).toHaveBeenCalledWith('submit_share_code_with_dob', {
      p_share_code: 'W98 7ZY 6XK',
      p_dob: '1995-06-15',
      p_file_path: null,
    });
    expect(result).toEqual({
      ok: true,
      note: 'Sent. gov.uk is asked with the date of birth you entered; it’s saved to your profile once the office verifies the code.',
    });
  });

  it.each([
    ['', /Enter your date of birth/],
    ['15/06/19', /real date of birth/],
    ['1995-02-31', /real date of birth/],
  ])('refuses %j before the database', async (dob, message) => {
    const result = await finishShareCode(null, 'W98 7ZY 6XK', dob);
    expect(!result.ok && result.message).toMatch(message);
    expect(rpc).not.toHaveBeenCalledWith('submit_share_code_with_dob', expect.anything());
  });

  it('says the database’s refusal in words, and discards the uploaded report', async () => {
    rpc.mockImplementation(async (fn: string) =>
      fn === 'staff_me'
        ? { data: { staffId: STAFF, status: 'compliant', blockKind: null }, error: null }
        : { data: { ok: false, reason: 'under_18' }, error: null },
    );
    const report = `${STAFF}/share-code-report/abc.pdf`;
    const result = await finishShareCode(report, 'W98 7ZY 6XK', '2015-01-01');
    expect(!result.ok && result.message).toMatch(/under 18/);
    expect(remove).toHaveBeenCalledWith([report]);
  });
});
