import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { QueueRow } from '../types';

/**
 * ADR-0213 (TK-19): "Not needed — graduated" on a Term Dates Letter — who it
 * is offered for, and what the action sends.
 */
const rpc = vi.hoisted(() => vi.fn());
const role = vi.hoisted(() => ({ write: true }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('../../_lib/sessionRole', () => ({
  READ_ONLY_MESSAGE: 'read only',
  sessionIsAdmin: async () => true,
  officeMayWrite: async () => role.write,
}));
vi.mock('@thc/db/server', () => ({ createClient: vi.fn(() => ({ rpc })) }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { loadGraduationClaims, withGraduationClaims } = await import('../termDatesData');
const { setAsideTermLetter } = await import('../letterActions');
const { TermLetterNotNeededButton } = await import('../TermLetterNotNeededButton');

function fakeClient(rows: unknown[]) {
  const calls: { table: string; eq: [string, string]; in: readonly string[] }[] = [];
  const client = {
    from: (table: string) => ({
      select: () => ({
        eq: (column: string, value: string) => ({
          in: async (_: string, values: readonly string[]) => {
            calls.push({ table, eq: [column, value], in: values });
            return { data: rows, error: null };
          },
        }),
      }),
    }),
  };
  return { client, calls };
}

beforeEach(() => {
  rpc.mockReset();
  role.write = true;
});

describe('who has told us they have graduated', () => {
  it('reads the Completion Letters of the workers with a term letter waiting', async () => {
    const { client, calls } = fakeClient([
      { staff_id: 's1', completion_date: null, completion_date_claimed: '2026-05-27' },
      { staff_id: 's1', completion_date: null, completion_date_claimed: '2026-04-01' },
      { staff_id: 's2', completion_date: null, completion_date_claimed: '2026-12-01' },
      { staff_id: 's3', completion_date: '2026-06-30', completion_date_claimed: '2026-07-31' },
    ]);
    const claims = await loadGraduationClaims(client, ['s1', 's2', 's3'], '2026-10-24');
    expect(calls).toEqual([
      {
        table: 'compliance_docs',
        eq: ['doc_type', 'university_completion_letter'],
        in: ['s1', 's2', 's3'],
      },
    ]);
    // The latest past date; a date still to come does not count; the office's
    // read wins over the worker's claim.
    expect([...claims]).toEqual([
      ['s1', '2026-05-27'],
      ['s3', '2026-06-30'],
    ]);
  });

  it('is merged onto term letter rows only', () => {
    const row = (over: Partial<QueueRow>) =>
      ({
        kind: 'document',
        item_id: 'd1',
        staff_id: 's1',
        item_type: 'university_term_dates_letter',
        ...over,
      }) as QueueRow;
    const merged = withGraduationClaims(
      [
        row({}),
        row({ item_id: 'd2', staff_id: 's2' }),
        row({ item_id: 'd3', item_type: 'passport' }),
      ],
      new Map([['s1', '2026-05-27']]),
    );
    expect(merged.map((r) => r.graduation_claimed)).toEqual(['2026-05-27', null, undefined]);
  });
});

describe('setAsideTermLetter', () => {
  it('asks the database, and says nothing was sent', async () => {
    rpc.mockResolvedValue({ data: { ok: true, completed: '2026-05-27' }, error: null });
    const result = await setAsideTermLetter('d1');
    expect(rpc).toHaveBeenCalledWith('compliance_set_aside_term_letter', { p_doc: 'd1' });
    expect(result.ok).toBe(true);
    expect(result.message).toContain('Nothing was sent to the worker');
  });

  it('says a refusal in words', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'no_graduation' } });
    const result = await setAsideTermLetter('d1');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('this letter is still needed');
  });

  it('a viewer is told before anything is sent', async () => {
    role.write = false;
    expect((await setAsideTermLetter('d1')).message).toBe('read only');
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('the button', () => {
  it('reads "Not needed — graduated"', () => {
    const html = renderToStaticMarkup(
      <TermLetterNotNeededButton docId="d1" name="Raj Grad" completed="2026-05-27" />,
    );
    expect(html).toContain('Not needed — graduated');
  });
});
