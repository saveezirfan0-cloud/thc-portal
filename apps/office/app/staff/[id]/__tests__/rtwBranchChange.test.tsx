import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProfileRow } from '../types';

/**
 * "Change" on the Right to Work row (completion letter requirement §7): the
 * office corrects a branch the worker picked wrongly — settled status chosen
 * as "Dependant / other" is refused by Verify, because every branch but EU
 * settled always has an end date (ADR-0018). Owners and managers only; the
 * dialog's own behaviour is the same shape as DobCorrection's.
 */
const state = vi.hoisted(() => ({ rpcError: null as { message: string } | null }));
const rpc = vi.fn(async () => ({ error: state.rpcError }));

vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock('@thc/db/admin', () => ({ createAdminClient: () => ({ rpc }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));
vi.mock('../../_lib/sessionRole', () => ({ sessionIsAdmin: async () => true }));
vi.mock('../../data', () => ({ supabaseConfigured: () => true }));

const { changeRtwBranch } = await import('../actions');
const { Overview } = await import('../Overview');

const PROFILE = {
  id: 's1',
  display_name: 'Jamshed Mher Shula',
  status: 'compliant',
  removed: false,
  rtw_branch: 'dependant_other',
  right_to_work_until: null,
  joined_at: '2026-01-10T10:00:00Z',
  term_dates: [],
  wtr_optout: false,
} as unknown as ProfileRow;

const render = (profile: ProfileRow, canCorrectDob: boolean) =>
  renderToStaticMarkup(
    <Overview profile={profile} references={[]} declarations={[]} canCorrectDob={canCorrectDob} />,
  );

beforeEach(() => {
  rpc.mockClear();
  state.rpcError = null;
});

describe('Overview · Right to Work · Change', () => {
  it('offers Change to an owner or a manager', () => {
    const html = render(PROFILE, true);
    expect(html).toContain('Dependant or other');
    expect(html).toMatch(/>Change<\/button>/);
  });

  it('offers nothing to a scheduler or a viewer, or on a removed profile', () => {
    expect(render(PROFILE, false)).not.toMatch(/>Change<\/button>/);
    expect(render({ ...PROFILE, removed: true } as ProfileRow, true)).not.toMatch(
      />Change<\/button>/,
    );
  });
});

describe('changeRtwBranch', () => {
  it('records the new branch through record_right_to_work_change, keeping the share code', async () => {
    expect(await changeRtwBranch('s1', 'eu_settled', null)).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith('record_right_to_work_change', {
      p_staff: 's1',
      p_branch: 'eu_settled',
      p_until: null,
      p_share_code: null,
    });
  });

  it('refuses a branch that is not one of the five, and a malformed date, before the database', async () => {
    expect((await changeRtwBranch('s1', 'settled', null)).ok).toBe(false);
    expect((await changeRtwBranch('s1', 'work_visa', '31/12/2027')).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not give a UK or Irish citizen an end date', async () => {
    const result = await changeRtwBranch('s1', 'uk_irish', '2027-12-31');
    expect(result).toEqual({
      ok: false,
      message: 'A UK or Irish citizen has no right-to-work date.',
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('says what the database refused in words for the office', async () => {
    state.rpcError = { message: 'read_only' };
    expect(await changeRtwBranch('s1', 'eu_settled', null)).toEqual({
      ok: false,
      message: 'Your login is read-only, so this cannot be changed.',
    });
  });
});
