import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ADR-0180 · the declaration follow-ups on the office screens: which
 * buttons a declaration carries, that only a criminal-records reviewer sees
 * any decision at all, the two server actions and their refusals, and the
 * lines the history reads.
 */
const rpc = vi.fn();
const createClient = vi.fn(() => ({ rpc }));
let reviewer: boolean | null = true;

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@thc/db/server', () => ({ createClient }));
vi.mock('../useCriminalRecordsReviewer', () => ({
  useCriminalRecordsReviewer: () => reviewer,
}));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { DeclarationDecisions, DeclarationFollowUp } = await import('../DeclarationFollowUp');
const { requestDeclarationDetails, reverseDeclarationRejection, canReviewCriminalRecords } =
  await import('../declarationActions');
const { declarationFollowUps } = await import('../declarationLines');

const target = (over: Partial<Parameters<typeof DeclarationFollowUp>[0]['target']> = {}) => ({
  id: 'c1',
  answer: true,
  status: 'pending' as const,
  superseded: false,
  source: 'onboarding' as const,
  staffStatus: 'documents',
  displayName: 'Cara Candidate',
  ...over,
});

beforeEach(() => {
  rpc.mockReset();
  createClient.mockClear();
  reviewer = true;
});

describe('DeclarationFollowUp', () => {
  it('offers Ask for more details on a pending Yes', () => {
    const html = renderToStaticMarkup(<DeclarationFollowUp target={target()} />);
    expect(html).toContain('Ask for more details');
    expect(html).not.toContain('Reverse rejection');
  });

  it('offers Reverse rejection on a rejected Yes', () => {
    const html = renderToStaticMarkup(
      <DeclarationFollowUp target={target({ status: 'rejected', staffStatus: 'compliant' })} />,
    );
    expect(html).toContain('Reverse rejection');
    expect(html).not.toContain('Ask for more details');
  });

  it('offers nothing on a decided, superseded or read-only declaration', () => {
    for (const t of [
      target({ status: 'verified' }),
      target({ status: 'details_requested' }),
      target({ superseded: true }),
      target({ staffStatus: 'removed' }),
    ]) {
      expect(renderToStaticMarkup(<DeclarationFollowUp target={t} />)).toBe('');
    }
    expect(renderToStaticMarkup(<DeclarationFollowUp target={target()} readOnly />)).toBe('');
  });

  it('does not offer Ask to someone who cannot answer from the app (a manual hold)', () => {
    const html = renderToStaticMarkup(
      <DeclarationFollowUp
        target={target({ staffStatus: 'blocked', blockKind: 'manual', source: 'in_employment' })}
      />,
    );
    expect(html).toBe('');
    expect(
      renderToStaticMarkup(
        <DeclarationFollowUp
          target={target({ staffStatus: 'compliant', blockKind: null, source: 'onboarding' })}
        />,
      ),
    ).toContain('Ask for more details');
  });

  it('draws nothing for an office user who may not decide criminal declarations', () => {
    reviewer = false;
    expect(renderToStaticMarkup(<DeclarationFollowUp target={target()} />)).toBe('');
    reviewer = null;
    expect(renderToStaticMarkup(<DeclarationFollowUp target={target()} />)).toBe('');
  });
});

describe('DeclarationDecisions', () => {
  it('shows the decisions to a reviewer', () => {
    expect(
      renderToStaticMarkup(
        <DeclarationDecisions>
          <button>Verify</button>
        </DeclarationDecisions>,
      ),
    ).toBe('<button>Verify</button>');
  });

  it('shows everyone else the read-only line instead', () => {
    reviewer = false;
    const html = renderToStaticMarkup(
      <DeclarationDecisions>
        <button>Verify</button>
      </DeclarationDecisions>,
    );
    expect(html).not.toContain('Verify');
    expect(html).toContain('Only office users allowed to review criminal records can decide this.');
  });

  it('shows nothing until the answer arrives', () => {
    reviewer = null;
    expect(
      renderToStaticMarkup(
        <DeclarationDecisions>
          <button>Verify</button>
        </DeclarationDecisions>,
      ),
    ).toBe('');
  });
});

describe('requestDeclarationDetails', () => {
  it('needs a message before reaching the database', async () => {
    expect((await requestDeclarationDetails('c1', '  ')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('calls the one RPC on the manager’s session with the trimmed message', async () => {
    rpc.mockResolvedValue({ data: { source: 'in_employment' }, error: null });
    const result = await requestDeclarationDetails('c1', '  What was the sentence? ');
    expect(rpc).toHaveBeenCalledExactlyOnceWith('compliance_request_declaration_details', {
      p_declaration: 'c1',
      p_message: 'What was the sentence?',
    });
    expect(result).toEqual({
      ok: true,
      message:
        'Sent. Their shifts stay paused; their updated declaration comes back to Needs review.',
    });
  });

  it('words the refusals', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'not_criminal_records_reviewer' } });
    expect(await requestDeclarationDetails('c1', 'x')).toEqual({
      ok: false,
      message: 'Only office users allowed to review criminal records can decide this.',
    });
    rpc.mockResolvedValue({ data: null, error: { message: 'not_pending: details_requested' } });
    expect((await requestDeclarationDetails('c1', 'x')).message).toMatch(/already been asked/);
    rpc.mockResolvedValue({ data: null, error: { message: 'read_only' } });
    expect((await requestDeclarationDetails('c1', 'x')).message).toMatch(/view this but not/);
    rpc.mockResolvedValue({ data: null, error: { message: 'cannot_answer_from_app: blocked' } });
    expect((await requestDeclarationDetails('c1', 'x')).message).toBe(
      'This person can’t answer from the app right now — call them.',
    );
  });
});

describe('reverseDeclarationRejection', () => {
  it('needs a note before reaching the database', async () => {
    expect((await reverseDeclarationRejection('c1', '')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says what the database did', async () => {
    rpc.mockResolvedValue({ data: { advanced: true }, error: null });
    expect((await reverseDeclarationRejection('c1', 'Cleared')).message).toMatch(/quiz/);
    expect(rpc).toHaveBeenCalledWith('compliance_reverse_declaration_rejection', {
      p_declaration: 'c1',
      p_note: 'Cleared',
    });
    rpc.mockResolvedValue({ data: { unblocked: true }, error: null });
    expect((await reverseDeclarationRejection('c1', 'Cleared')).message).toMatch(/Unblocked/);
    rpc.mockResolvedValue({ data: { status: 'blocked', liftedHold: false }, error: null });
    expect((await reverseDeclarationRejection('c1', 'Cleared')).message).toMatch(/another reason/);
    rpc.mockResolvedValue({ data: null, error: { message: 'not_rejected: superseded' } });
    expect((await reverseDeclarationRejection('c1', 'Cleared')).message).toMatch(
      /updated declaration/,
    );
  });
});

describe('canReviewCriminalRecords', () => {
  it('is the database’s answer, and any failure is a no', async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await canReviewCriminalRecords()).toBe(true);
    expect(rpc).toHaveBeenCalledWith('can_review_criminal_records');
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await canReviewCriminalRecords()).toBe(false);
  });
});

describe('declarationFollowUps', () => {
  it('reads the request, the reversal and an update', () => {
    expect(
      declarationFollowUps({ review_status: 'details_requested', worker_message: 'Which court?' }),
    ).toBe(' · asked: “Which court?” · waiting for their updated declaration');
    expect(
      declarationFollowUps({
        review_status: 'details_requested',
        worker_message: 'Which court?',
        superseded: true,
      }),
    ).toBe(' · asked: “Which court?”');
    expect(
      declarationFollowUps({
        review_status: 'verified',
        reversed_at: '2026-10-22T09:00:00Z',
        reversed_rejection_reason: 'Not enough detail',
      }),
    ).toMatch(
      /^ · Rejection reversed · .*2026 10:00 UK time · was rejected for: “Not enough detail”$/,
    );
    expect(declarationFollowUps({ review_status: 'pending', replaces_declaration_id: 'c0' })).toBe(
      ' · updated declaration',
    );
  });
});
