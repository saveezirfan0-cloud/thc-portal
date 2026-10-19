import { describe, expect, it, vi } from 'vitest';
import type { FactsRead } from '../data';

/**
 * D43 / D32 / D36 on /onboarding/:id. Since ADR-0163 no API role may read
 * `staff.ni_number` off the table, so the full number comes from the
 * owner-rights `staff_identity_v` (admin only) and the conditions from
 * `staff` — and the screen still gets them as one row.
 */

vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: () => {} }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({}) }));

const { loadCandidateFacts } = await import('../data');

type Answer = { data: Record<string, unknown> | null; error: { message: string } | null };

function reader(answers: Record<string, Answer>) {
  const reads: { table: string; columns: string; column: string; value: string }[] = [];
  const db = {
    from(table: string) {
      return {
        select(columns: string) {
          return {
            eq(column: string, value: string) {
              reads.push({ table, columns, column, value });
              return { maybeSingle: async () => answers[table] ?? { data: null, error: null } };
            },
          };
        },
      };
    },
  } as unknown as FactsRead;
  return { db, reads };
}

describe('loadCandidateFacts()', () => {
  it('reads the NI number through staff_identity_v and never selects it off staff', async () => {
    const { db, reads } = reader({
      staff: {
        data: { below_degree_level: true, visa_weekly_hour_limit: null, languages: ['English'] },
        error: null,
      },
      staff_identity_v: { data: { ni_number: 'QQ123456B' }, error: null },
    });

    expect(await loadCandidateFacts(db, 's-1')).toEqual({
      data: {
        ni_number: 'QQ123456B',
        below_degree_level: true,
        visa_weekly_hour_limit: null,
        languages: ['English'],
      },
      error: null,
    });
    expect(reads).toContainEqual({
      table: 'staff_identity_v',
      columns: 'ni_number',
      column: 'staff_id',
      value: 's-1',
    });
    const staffRead = reads.find((r) => r.table === 'staff');
    expect(staffRead?.columns).not.toMatch(/ni_number|share_code|\bdob\b|home_address/);
  });

  it('gives no number, not an error, when the view returns no row (not an admin)', async () => {
    const { db } = reader({
      staff: {
        data: { below_degree_level: false, visa_weekly_hour_limit: 20, languages: null },
        error: null,
      },
      staff_identity_v: { data: null, error: null },
    });
    const facts = await loadCandidateFacts(db, 's-1');
    expect(facts.error).toBeNull();
    expect(facts.data?.ni_number).toBeNull();
    expect(facts.data?.visa_weekly_hour_limit).toBe(20);
  });

  it('fails the card when either read fails', async () => {
    const { db } = reader({
      staff: { data: { below_degree_level: false }, error: null },
      staff_identity_v: { data: null, error: { message: 'permission denied' } },
    });
    expect(await loadCandidateFacts(db, 's-1')).toEqual({
      data: null,
      error: { message: 'permission denied' },
    });
  });
});
