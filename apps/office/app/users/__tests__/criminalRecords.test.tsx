import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccountRow } from '../data';

/**
 * ADR-0180 · "Can review criminal records" on /users. The database decides
 * (admin_set_criminal_records_reviewer(): owners only, office logins only,
 * never a viewer, audited); this holds the action to that one RPC on the
 * owner's own session, its refusals in words, and what the row draws.
 */
const rpc = vi.fn();
vi.mock('next/headers', () => ({ cookies: async () => ({}) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@thc/db/server', () => ({ createClient: () => ({ rpc }) }));

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';

const { setCriminalRecordsReviewer } = await import('../criminalRecordsActions');
const { CriminalRecordsToggle } = await import('../CriminalRecordsToggle');

const account = (over: Partial<AccountRow> = {}): AccountRow => ({
  id: 'u1',
  email: 'sam@thc.test',
  role: 'admin',
  office_role: 'manager',
  full_name: 'Sam',
  phone: null,
  job_title: null,
  client_id: null,
  client_name: null,
  staff_id: null,
  created_at: '2026-10-01T09:00:00Z',
  last_sign_in_at: null,
  disabled: false,
  two_step: false,
  reviews_criminal_records: false,
  ...over,
});

beforeEach(() => rpc.mockReset());

describe('setCriminalRecordsReviewer', () => {
  it('calls the one RPC with the login and the switch', async () => {
    rpc.mockResolvedValue({ data: { changed: true }, error: null });
    expect(await setCriminalRecordsReviewer('u1', true)).toEqual({
      ok: true,
      message: 'They can now decide criminal declarations.',
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_set_criminal_records_reviewer', {
      p_user: 'u1',
      p_on: true,
    });
  });

  it('words the refusals', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'viewer_cannot_review' } });
    expect((await setCriminalRecordsReviewer('u1', true)).message).toMatch(/viewer/);
    rpc.mockResolvedValue({ data: null, error: { message: 'not_office_login' } });
    expect((await setCriminalRecordsReviewer('u1', true)).message).toMatch(/Back Office login/);
  });
});

describe('CriminalRecordsToggle', () => {
  it('offers Allow on an office login that is not named', () => {
    const html = renderToStaticMarkup(
      <CriminalRecordsToggle account={account()} anyoneNamed={false} />,
    );
    expect(html).toContain('Allow criminal record reviews');
    expect(html).not.toContain('Reviews criminal records');
  });

  it('marks a named login and offers Stop', () => {
    const html = renderToStaticMarkup(
      <CriminalRecordsToggle account={account({ reviews_criminal_records: true })} anyoneNamed />,
    );
    expect(html).toContain('Reviews criminal records');
    expect(html).toContain('Stop criminal record reviews');
  });

  it('is not offered on a viewer, nor on a client or worker login', () => {
    expect(
      renderToStaticMarkup(
        <CriminalRecordsToggle account={account({ office_role: 'viewer' })} anyoneNamed />,
      ),
    ).toBe('');
    expect(
      renderToStaticMarkup(
        <CriminalRecordsToggle
          account={account({ role: 'client', office_role: null })}
          anyoneNamed
        />,
      ),
    ).toBe('');
  });
});
