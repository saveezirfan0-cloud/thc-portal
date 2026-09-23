import { beforeEach, describe, expect, it, vi } from 'vitest';
import { data } from './fixtures';

/**
 * §10.7 · the conviction path, end to end on the app side.
 *
 * The database half — the block, the released bookings, E9 without the
 * text, the manual hold refused — is 430_staff_documents_hub.sql. What is
 * asserted here is everything between the button and that function:
 *
 *   1. the action calls `declare_my_conviction()`, the worker's own door,
 *      with NO staff id (docs/14 O10) and the details trimmed;
 *   2. every refusal comes back as a sentence, and nothing is sent at all
 *      when there is nothing to send;
 *   3. afterwards the app locks to Documents with §10.7's exact copy, the
 *      declaration shows as in review with its details withheld, and the
 *      confirmation quoted the real number of shifts it released.
 */

const rpc = vi.fn();
const revalidatePath = vi.fn();

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('next/cache', () => ({ revalidatePath: (...args: unknown[]) => revalidatePath(...args) }));
vi.mock('../../db', () => ({
  staffDb: () => ({ rpc: (...args: unknown[]) => rpc(...args) }),
  supabaseConfigured: () => true,
}));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({}) }));

const { declareConviction } = await import('../actions');
const { documentsNotice } = await import('../../_components/DocumentsLock');
const { appLock } = await import('../../profile/lock');
const { buildDocumentsView } = await import('../model');
const { consequence } = await import('../_components/DeclareForm');

beforeEach(() => {
  rpc.mockReset();
  revalidatePath.mockReset();
});

describe('declareConviction() — the action', () => {
  it('calls the worker’s own RPC with no staff id, details trimmed', async () => {
    rpc.mockResolvedValue({ data: { ok: true, status: 'blocked', released: 3 }, error: null });

    const result = await declareConviction(
      '  Driving while disqualified — community order  ',
      '2026-09-09',
    );

    expect(result).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0]!;
    expect(fn).toBe('declare_my_conviction');
    expect(args).toEqual({
      p_details: 'Driving while disqualified — community order',
      p_conviction_date: '2026-09-09',
    });
    expect(Object.keys(args as object)).not.toContain('p_staff');
    // Shifts, Invites and Radar all just closed — every cached screen goes.
    expect(revalidatePath).toHaveBeenCalledWith('/', 'layout');
  });

  it('sends the date only when it is one', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await declareConviction('Caution', 'last tuesday');
    expect(rpc.mock.calls[0]![1]).toMatchObject({ p_conviction_date: null });
  });

  it('sends nothing when there are no details', async () => {
    const result = await declareConviction('   ', null);
    expect(rpc).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, message: 'Enter the details of the conviction.' });
  });

  it.each([
    [
      'not_eligible',
      'Your account cannot make a declaration from the app. Please contact the office.',
    ],
    ['conviction_date_in_future', 'The date of conviction can’t be in the future.'],
    ['details_too_long', 'Keep the details under 4,000 characters — the office will contact you.'],
  ])('a %s refusal is a sentence, and nothing is revalidated', async (reason, sentence) => {
    rpc.mockResolvedValue({ data: { ok: false, reason }, error: null });
    expect(await declareConviction('Something', null)).toEqual({ ok: false, message: sentence });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it('a raised error is mapped too (unknown_staff)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'unknown_staff' } });
    expect(await declareConviction('Something', null)).toEqual({
      ok: false,
      message: 'We couldn’t find your record. Please contact the office.',
    });
  });
});

describe('what the worker sees afterwards', () => {
  const after = data({
    status: 'blocked',
    blockKind: 'conviction_review',
    declarations: [
      {
        id: 'decl-2',
        source: 'in_employment',
        answer: true,
        declaredAt: '2026-09-18T13:44:00+00:00',
        reviewStatus: 'pending',
        superseded: false,
      },
      {
        id: 'decl-1',
        source: 'onboarding',
        answer: false,
        declaredAt: '2026-03-01T09:00:00+00:00',
        reviewStatus: 'verified',
        superseded: false,
      },
    ],
  });

  it('the app locks to Documents (§10.1 case 1, §10.7 step 5)', () => {
    expect(
      appLock({
        status: 'blocked',
        blockKind: 'conviction_review',
        quizAttempts: 0,
        blockers: ['conviction_unreviewed'],
      }),
    ).toBe('documents');
  });

  it('with §10.7’s copy, word for word', () => {
    const notice = documentsNotice(['conviction_unreviewed'], 'conviction_review', false);
    expect(`${notice.headline} ${notice.detail}`).toBe(
      'Thanks for telling us. We’ve paused your upcoming shifts while the office reviews your ' +
        'declaration, and we’ll be in touch. If you need to speak to someone, contact us at: ' +
        'admin@thehospitalitycompany.co.uk.',
    );
  });

  it('the declaration is in review and its details are not on the screen', () => {
    const view = buildDocumentsView(after);
    const row = view.rows.find((r) => r.kind === 'criminal_declaration')!;
    expect(row.state).toBe('in_review');
    expect(row.meta).toBe('In review · declared 18.09.2026 14:44 · details not shown here');
    expect(JSON.stringify(view)).not.toMatch(/Driving|disqualified/);
    expect(view.statusPill).toEqual({ tone: 'coral', text: 'Blocked' });
  });

  it('a second declaration is still possible — it is history, not an edit', () => {
    expect(buildDocumentsView(after).canDeclare).toBe(true);
  });

  it('the confirmation quoted the shifts it would release', () => {
    expect(consequence(3)).toBe(
      'Submitting pauses your upcoming shifts straight away — 3 booked shifts will be released and offered to other staff. This can’t be undone from the app.',
    );
    expect(consequence(0)).toContain('You have no booked shifts to release');
  });
});
